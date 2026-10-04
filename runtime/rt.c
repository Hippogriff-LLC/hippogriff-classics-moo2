/* Core runtime: guest memory, selectors, interrupt delivery, diagnostics, string helpers and x87 model.
 * Independently authored; Apache-2.0. */
#include "rt.h"
#include "rt_int.h"
#include "host.h"

Cpu C;
uint8_t *M;
uint32_t M_size;
int32_t rt_budget = RT_POLL_INTERVAL;
Runtime RT;

/* ------------------------------------------------------------------ small libc-free helpers */
void rt_memcpy(void *d, const void *s, uint32_t n) { __builtin_memmove(d, s, n); }
void rt_memset(void *d, int v, uint32_t n) { __builtin_memset(d, v, n); }
uint32_t rt_strlen(const char *s) { uint32_t n = 0; while (s[n]) n++; return n; }
int rt_strcasecmp(const char *a, const char *b) {
  for (;; a++, b++) {
    int x = *a >= 'a' && *a <= 'z' ? *a - 32 : *a, y = *b >= 'a' && *b <= 'z' ? *b - 32 : *b;
    if (x != y || !x) return x - y;
  }
}

static void fmt_u(char **o, char *end, uint64_t v, int base, int width, char pad) {
  char tmp[24]; int n = 0;
  do { int d = (int)(v % base); tmp[n++] = (char)(d < 10 ? '0' + d : 'a' + d - 10); v /= base; } while (v);
  while (n < width && n < 23) tmp[n++] = pad;
  while (n && *o < end) *(*o)++ = tmp[--n];
}
int rt_vfmt(char *buf, uint32_t cap, const char *f, __builtin_va_list ap) {
  char *o = buf, *end = buf + cap - 1;
  for (; *f && o < end; f++) {
    if (*f != '%') { *o++ = *f; continue; }
    f++;
    char pad = ' '; int width = 0;
    if (*f == '0') { pad = '0'; f++; }
    while (*f >= '0' && *f <= '9') width = width * 10 + (*f++ - '0');
    int lng = 0;
    while (*f == 'l') { lng++; f++; }
    switch (*f) {
    case 'd': {
      int64_t v = lng ? __builtin_va_arg(ap, int64_t) : __builtin_va_arg(ap, int);
      if (v < 0 && o < end) { *o++ = '-'; v = -v; }
      fmt_u(&o, end, (uint64_t)v, 10, width, pad);
      break;
    }
    case 'u': fmt_u(&o, end, lng ? __builtin_va_arg(ap, uint64_t) : __builtin_va_arg(ap, unsigned), 10, width, pad); break;
    case 'x': fmt_u(&o, end, lng ? __builtin_va_arg(ap, uint64_t) : __builtin_va_arg(ap, unsigned), 16, width, pad); break;
    case 'c': *o++ = (char)__builtin_va_arg(ap, int); break;
    case 's': { const char *s = __builtin_va_arg(ap, const char *); if (!s) s = "(null)"; while (*s && o < end) *o++ = *s++; break; }
    default: *o++ = *f; break;
    }
  }
  *o = 0;
  return (int)(o - buf);
}
int rt_fmt(char *buf, uint32_t cap, const char *f, ...) {
  __builtin_va_list ap; __builtin_va_start(ap, f);
  int n = rt_vfmt(buf, cap, f, ap);
  __builtin_va_end(ap);
  return n;
}
void rt_logf(const char *f, ...) {
  char b[512];
  __builtin_va_list ap; __builtin_va_start(ap, f);
  rt_vfmt(b, sizeof b, f, ap);
  __builtin_va_end(ap);
  host_log(b);
}

/* ------------------------------------------------------------------ diagnostics */
const char *rt_func_name(uint32_t a, uint32_t *off) {
  unsigned lo = 0, hi = rt_func_count;
  while (lo < hi) { unsigned mid = (lo + hi) / 2; if (rt_func_addrs[mid] <= a) lo = mid + 1; else hi = mid; }
  if (!lo) { *off = a; return "?"; }
  *off = a - rt_func_addrs[lo - 1];
  return rt_func_names[lo - 1];
}
void rt_backtrace(void) {
  /* heuristic: scan the guest stack for return addresses into the code object */
  uint32_t sp = C.esp, n = 0;
  for (uint32_t i = 0; i < 4096 && n < 24; i += 4) {
    uint32_t a = sp + i;
    if (a + 4 > M_size) break;
    uint32_t v = RD32(a);
    if (v >= RT.code_lo && v < RT.code_hi && v > RT.code_lo + 5 && M[v - 5] == 0xe8) {
      uint32_t off; const char *nm = rt_func_name(v, &off);
      rt_logf("  [esp+%x] %x %s+%x", i, v, nm, off);
      n++;
    }
  }
}
void rt_dump_regs(void) {
  rt_logf("eax=%08x ebx=%08x ecx=%08x edx=%08x esi=%08x edi=%08x ebp=%08x esp=%08x", C.eax, C.ebx, C.ecx,
          C.edx, C.esi, C.edi, C.ebp, C.esp);
}
__attribute__((noreturn)) void rt_trap(uint32_t addr, const char *why) {
  uint32_t off; const char *nm = rt_func_name(addr, &off);
  rt_logf("TRAP at %x (%s+%x): %s", addr, nm, off, why);
  rt_dump_regs();
  rt_backtrace();
  host_exit(3);
}
void rt_bad_call(uint32_t a) {
  if (a >= STUB_BASE && a < STUB_BASE + 0x1000) { rt_stub_call(a); return; }
  rt_trap(a, "call to unknown address");
}
void rt_divide_error(void) {
  rt_logf("divide error");
  rt_trap(0, "divide error");
}

/* ------------------------------------------------------------------ selectors */
uint16_t rt_alloc_selector(uint32_t base, uint32_t limit) {
  for (int i = 8; i < MAX_SEL; i++)
    if (!RT.sel[i].used) {
      RT.sel[i].used = 1; RT.sel[i].base = base; RT.sel[i].limit = limit;
      return (uint16_t)(i * 8 + 7); /* LDT, RPL 3 */
    }
  return 0;
}
SelDesc *rt_sel(uint32_t sel) {
  uint32_t i = (sel & 0xffff) >> 3;
  if (i >= MAX_SEL || !RT.sel[i].used) return 0;
  return &RT.sel[i];
}
void rt_setseg(uint32_t seg, uint32_t sel) {
  sel &= 0xffff;
  C.seg[seg] = (uint16_t)sel;
  SelDesc *d = rt_sel(sel);
  C.segbase[seg] = d ? d->base : 0;
  if (seg == 3 && C.segbase[seg] && RT.verbose)
    rt_logf("note: DS loaded with non-flat selector %x (base %x)", sel, C.segbase[seg]);
}

/* ------------------------------------------------------------------ string helpers */
void rt_rep_movs(uint32_t *esi, uint32_t *edi, uint32_t *ecx, uint32_t sz) {
  uint32_t n = *ecx;
  if (!n) return;
  uint32_t sb = C.segbase[3], db = C.segbase[0];
  uint32_t s = *esi + sb, d = *edi + db, bytes = n * sz;
  if (!C.df) {
    if (d >= s + bytes || d <= s) {
      if (d + bytes > M_size || s + bytes > M_size) rt_trap(0, "rep movs out of range");
      __builtin_memmove(M + d, M + s, bytes);
    } else for (uint32_t i = 0; i < bytes; i++) M[d + i] = M[s + i]; /* forward overlapping copy replicates */
    *esi += bytes; *edi += bytes;
  } else {
    for (uint32_t i = 0; i < n; i++) {
      __builtin_memmove(M + d, M + s, sz);
      d -= sz; s -= sz;
    }
    *esi -= bytes; *edi -= bytes;
  }
  *ecx = 0;
}
void rt_rep_stos(uint32_t *edi, uint32_t *ecx, uint32_t eax, uint32_t sz) {
  uint32_t n = *ecx;
  if (!n) return;
  uint32_t d = *edi + C.segbase[0], bytes = n * sz;
  if (!C.df) {
    if (d + bytes > M_size) rt_trap(0, "rep stos out of range");
    if (sz == 1) __builtin_memset(M + d, (int)(eax & 0xff), bytes);
    else if (sz == 2) for (uint32_t i = 0; i < n; i++) WR16(d + i * 2, eax);
    else for (uint32_t i = 0; i < n; i++) WR32(d + i * 4, eax);
    *edi += bytes;
  } else {
    for (uint32_t i = 0; i < n; i++) {
      if (sz == 1) WR8(d, eax); else if (sz == 2) WR16(d, eax); else WR32(d, eax);
      d -= sz;
    }
    *edi -= bytes;
  }
  *ecx = 0;
}

/* ------------------------------------------------------------------ rare system instructions */
void rt_special(uint32_t addr, const char *op) {
  if (!__builtin_strcmp(op, "lsl")) { /* used to size segments: report 4 GB flat limit, ZF=1 */
    rt_set_flag(0x40, 1);
    return;
  }
  if (!__builtin_strcmp(op, "lar")) { rt_set_flag(0x40, 1); return; }
  rt_trap(addr, op);
}

void rt_set_flag(uint32_t bit, int on) {
  uint32_t e = fl_all(C.fk, C.fr, C.fa, C.fb, C.fc);
  e = on ? e | bit : e & ~bit;
  C.fk = FK_EFL << 2; C.fr = e;
}
int rt_get_flag(uint32_t bit) { return (fl_all(C.fk, C.fr, C.fa, C.fb, C.fc) & bit) != 0; }

/* ------------------------------------------------------------------ x87 model (double precision) */
#define ST(i) C.st[(C.ftop + (i)) & 7]
static void f_push(double v) { C.ftop = (C.ftop - 1) & 7; ST(0) = v; }
static double f_pop(void) { double v = ST(0); C.ftop = (C.ftop + 1) & 7; return v; }
static double f_load(uint32_t a, uint32_t size, int integer) {
  if (integer) {
    if (size == 2) return (int16_t)RD16(a);
    if (size == 4) return (int32_t)RD32(a);
    int64_t v; __builtin_memcpy(&v, M + a, 8); return (double)v;
  }
  if (size == 4) { float f; __builtin_memcpy(&f, M + a, 4); return f; }
  if (size == 8) { double d; __builtin_memcpy(&d, M + a, 8); return d; }
  /* 80-bit extended */
  uint64_t mant; uint16_t se; __builtin_memcpy(&mant, M + a, 8); __builtin_memcpy(&se, M + a + 8, 2);
  if (!mant) return (se & 0x8000) ? -0.0 : 0.0;
  int e = (se & 0x7fff) - 16383 - 63;
  double v = (double)mant;
  while (e > 0) { v *= 2; e--; }
  while (e < 0) { v /= 2; e++; }
  return (se & 0x8000) ? -v : v;
}
static double f_round(double v) {
  switch ((C.fcw >> 10) & 3) {
  case 0: { double r = __builtin_floor(v + 0.5); if (r - v == 0.5 && __builtin_fmod(r, 2.0) != 0) r -= 1; return r; }
  case 1: return __builtin_floor(v);
  case 2: return __builtin_ceil(v);
  default: return __builtin_trunc(v);
  }
}
static void f_store(uint32_t a, uint32_t size, int integer, double v) {
  if (integer) {
    double r = f_round(v);
    if (size == 2) WR16(a, (uint32_t)(int32_t)(r < -32768 || r > 32767 ? -32768 : r));
    else if (size == 4) WR32(a, (uint32_t)(r < -2147483648.0 || r > 2147483647.0 ? INT32_MIN : (int32_t)r));
    else { int64_t x = (int64_t)r; __builtin_memcpy(M + a, &x, 8); }
    return;
  }
  if (size == 4) { float f = (float)v; __builtin_memcpy(M + a, &f, 4); return; }
  if (size == 8) { __builtin_memcpy(M + a, &v, 8); return; }
  /* 80-bit */
  uint64_t bits; __builtin_memcpy(&bits, &v, 8);
  uint16_t se = (uint16_t)((bits >> 63) << 15);
  uint64_t mant = 0;
  int e = (int)((bits >> 52) & 0x7ff);
  if (e) { se |= (uint16_t)(e - 1023 + 16383); mant = (1ull << 63) | ((bits & ((1ull << 52) - 1)) << 11); }
  __builtin_memcpy(M + a, &mant, 8); __builtin_memcpy(M + a + 8, &se, 2);
}
static void f_compare(double a, double b) {
  C.fsw &= ~0x4500;
  if (a != a || b != b) C.fsw |= 0x4500;
  else if (a < b) C.fsw |= 0x0100;
  else if (a == b) C.fsw |= 0x4000;
}
uint32_t rt_fpu_sw(void) { return (C.fsw & ~0x3800u) | ((uint32_t)(C.ftop & 7) << 11); }

void rt_fpu(const char *op, uint32_t a, uint32_t size, int s0, int s1) {
  const char *o = op;
#define IS(x) (!__builtin_strcmp(o, x))
  int mem = size != 0;
  int integer = o[1] == 'i' && o[0] == 'f' && !IS("fincstp");
  if (IS("finit")) { C.ftop = 0; C.fsw = 0; C.fcw = 0x37f; C.ftag = 0xffff; return; }
  if (IS("fclex")) { C.fsw &= 0x7f00; return; }
  if (IS("fldcw")) { C.fcw = (uint16_t)RD16(a); return; }
  if (IS("fnstcw")) { WR16(a, C.fcw); return; }
  if (IS("fnstsw")) { WR16(a, rt_fpu_sw()); return; }
  if (IS("fnstenv") || IS("fnsave")) {
    rt_memset(M + a, 0, IS("fnsave") ? 108 : 28);
    WR16(a, C.fcw); WR16(a + 4, rt_fpu_sw()); WR16(a + 8, 0xffff);
    if (IS("fnsave")) { for (int i = 0; i < 8; i++) f_store(a + 28 + i * 10, 10, 0, ST(i)); C.ftop = 0; C.fsw = 0; C.fcw = 0x37f; }
    return;
  }
  if (IS("fldenv") || IS("frstor")) {
    C.fcw = (uint16_t)RD16(a); C.fsw = (uint16_t)RD16(a + 4); C.ftop = (C.fsw >> 11) & 7;
    if (IS("frstor")) for (int i = 0; i < 8; i++) ST(i) = f_load(a + 28 + i * 10, 10, 0);
    return;
  }
  if (IS("fld") || IS("fild")) { double v = mem ? f_load(a, size, integer) : ST(s0); f_push(v); return; }
  if (IS("fst") || IS("fstp") || IS("fist") || IS("fistp")) {
    if (mem) f_store(a, size, integer, ST(0)); else ST(s0) = ST(0);
    if (o[__builtin_strlen(o) - 1] == 'p') f_pop();
    return;
  }
  if (IS("fxch")) { double t = ST(0); ST(0) = ST(s0); ST(s0) = t; return; }
  if (IS("fld1")) { f_push(1.0); return; }
  if (IS("fldz")) { f_push(0.0); return; }
  if (IS("fldpi")) { f_push(3.14159265358979323846); return; }
  if (IS("fldl2e")) { f_push(1.4426950408889634); return; }
  if (IS("fldl2t")) { f_push(3.3219280948873622); return; }
  if (IS("fldlg2")) { f_push(0.30102999566398120); return; }
  if (IS("fldln2")) { f_push(0.69314718055994531); return; }
  if (IS("fchs")) { ST(0) = -ST(0); return; }
  if (IS("fabs")) { ST(0) = __builtin_fabs(ST(0)); return; }
  if (IS("fsqrt")) { ST(0) = __builtin_sqrt(ST(0)); return; }
  if (IS("frndint")) { ST(0) = f_round(ST(0)); return; }
  if (IS("ftst")) { f_compare(ST(0), 0.0); return; }
  if (IS("fxam")) { C.fsw &= ~0x4700; double v = ST(0); if (v < 0 || (v == 0 && 1 / v < 0)) C.fsw |= 0x200; C.fsw |= v == 0 ? 0x4000 : 0x400; return; }
  if (IS("ffree") || IS("fincstp") || IS("fdecstp")) {
    if (IS("fincstp")) C.ftop = (C.ftop + 1) & 7;
    if (IS("fdecstp")) C.ftop = (C.ftop - 1) & 7;
    return;
  }
  if (IS("fcom") || IS("fcomp") || IS("fucom") || IS("fucomp") || IS("ficom") || IS("ficomp")) {
    double b = mem ? f_load(a, size, integer) : ST(s1 >= 0 ? s1 : s0 >= 0 ? s0 : 1);
    f_compare(ST(0), b);
    if (o[__builtin_strlen(o) - 1] == 'p') f_pop();
    return;
  }
  if (IS("fcompp") || IS("fucompp")) { f_compare(ST(0), ST(1)); f_pop(); f_pop(); return; }
  /* arithmetic: fadd fsub fsubr fmul fdiv fdivr, f?p, fi? */
  {
    const char *b = o + (integer ? 2 : 1);
    char base[8]; int n = 0;
    while (b[n] && n < 7) { base[n] = b[n]; n++; }
    base[n] = 0;
    int pop = 0;
    if (n && base[n - 1] == 'p' && !mem) { pop = 1; base[--n] = 0; }
    int kind = !__builtin_strcmp(base, "add") ? 0 : !__builtin_strcmp(base, "mul") ? 1 : !__builtin_strcmp(base, "sub") ? 2
             : !__builtin_strcmp(base, "subr") ? 3 : !__builtin_strcmp(base, "div") ? 4 : !__builtin_strcmp(base, "divr") ? 5 : -1;
    if (kind >= 0) {
      double *dst; double src;
      if (mem) { dst = &ST(0); src = f_load(a, size, integer); }
      else { dst = &ST(s0); src = ST(s1); }
      switch (kind) {
      case 0: *dst = *dst + src; break;
      case 1: *dst = *dst * src; break;
      case 2: *dst = *dst - src; break;
      case 3: *dst = src - *dst; break;
      case 4: *dst = *dst / src; break;
      case 5: *dst = src / *dst; break;
      }
      if (pop) f_pop();
      return;
    }
  }
  rt_trap(0, op);
#undef IS
}

/* Run guest code entered through a far frame whose return address is `expect`. A handler may leave
 * through retf/iret to a different address (interrupt chaining by pushing the old vector and returning
 * into it); keep following such targets until control comes back to `expect`. */
void rt_far_invoke(uint32_t target, uint32_t expect) {
  C.ret_to = expect;
  rt_call(target);
  rt_resume(expect);
}

/* Control returned to an address other than `expect`: run from there (as the CPU would) until a return
 * finally lands on `expect`. */
void rt_resume(uint32_t expect) {
  for (int n = 0; C.ret_to != expect; n++) {
    uint32_t target = C.ret_to;
    if (n > 64) rt_trap(target, "return chain does not terminate");
    C.ret_to = expect;
    rt_call(target);
  }
}
