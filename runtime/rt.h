/* Hippogriff MOO2 port runtime: guest CPU state, memory and instruction helpers used by the statically
 * recompiled program code. Independently authored; Apache-2.0. Contains no original program material.
 *
 * Builds both natively (gcc/clang, hosted) and for wasm32 (freestanding; see rt_libc.c). */
#pragma once
#include <stdint.h>
#include <stddef.h>

#define LIKELY(x) __builtin_expect(!!(x), 1)
#define UNLIKELY(x) __builtin_expect(!!(x), 0)

/* Lazy flags: fk = (kind << 2) | size code (0 = 8-bit, 1 = 16-bit, 2 = 32-bit). */
enum { FK_ADD, FK_SUB, FK_LOGIC, FK_INC, FK_DEC, FK_SHL, FK_SHR, FK_SAR, FK_MUL, FK_ADC, FK_SBB, FK_EFL };

typedef struct {
  uint32_t eax, ecx, edx, ebx, esp, ebp, esi, edi;
  uint32_t fk, fr, fa, fb, fc;
  uint32_t df, iflag;
  uint32_t ret_to;          /* target popped by the last retf/iret (far returns may chain elsewhere) */
  uint16_t seg[6];
  uint32_t segbase[6];
  /* x87 */
  double st[8];
  int ftop;
  uint16_t fsw, fcw, ftag;
} Cpu;

extern Cpu C;
extern uint8_t *M;          /* guest linear memory */
extern uint32_t M_size;     /* bytes */
extern int32_t rt_budget;   /* back-edge countdown until the next rt_poll() */

/* ---------------------------------------------------------------- memory */
static inline uint32_t RD8(uint32_t a) { return M[a]; }
static inline uint32_t RD16(uint32_t a) { uint16_t v; __builtin_memcpy(&v, M + a, 2); return v; }
static inline uint32_t RD32(uint32_t a) { uint32_t v; __builtin_memcpy(&v, M + a, 4); return v; }
static inline void WR8(uint32_t a, uint32_t v) { M[a] = (uint8_t)v; }
static inline void WR16(uint32_t a, uint32_t v) { uint16_t x = (uint16_t)v; __builtin_memcpy(M + a, &x, 2); }
static inline void WR32(uint32_t a, uint32_t v) { __builtin_memcpy(M + a, &v, 4); }

/* ---------------------------------------------------------------- register sync */
#define SI_DECL                                                                                            \
  uint32_t eax = C.eax, ecx = C.ecx, edx = C.edx, ebx = C.ebx, esp = C.esp, ebp = C.ebp, esi = C.esi,       \
           edi = C.edi, fk = C.fk, fr = C.fr, fa = C.fa, fb = C.fb, fc = C.fc;                              \
  (void)fa; (void)fb; (void)fc; (void)fk; (void)fr
#define SO                                                                                                 \
  (C.eax = eax, C.ecx = ecx, C.edx = edx, C.ebx = ebx, C.esp = esp, C.ebp = ebp, C.esi = esi, C.edi = edi,  \
   C.fk = fk, C.fr = fr, C.fa = fa, C.fb = fb, C.fc = fc)
#define SIN                                                                                                \
  (eax = C.eax, ecx = C.ecx, edx = C.edx, ebx = C.ebx, esp = C.esp, ebp = C.ebp, esi = C.esi, edi = C.edi,  \
   fk = C.fk, fr = C.fr, fa = C.fa, fb = C.fb, fc = C.fc)

void rt_poll(void);
#define POLL                                                                                               \
  do {                                                                                                     \
    if (UNLIKELY(--rt_budget <= 0)) { SO; rt_poll(); SIN; }                                                \
  } while (0)

/* ---------------------------------------------------------------- flags */
static inline uint32_t fl_mask(uint32_t s) { return s == 0 ? 0xffu : s == 1 ? 0xffffu : 0xffffffffu; }
static inline uint32_t fl_sign(uint32_t s) { return s == 0 ? 0x80u : s == 1 ? 0x8000u : 0x80000000u; }
static inline int32_t fl_sx(uint32_t v, uint32_t s) { return s == 0 ? (int8_t)v : s == 1 ? (int16_t)v : (int32_t)v; }

static inline uint32_t fl_cf(uint32_t k, uint32_t r, uint32_t a, uint32_t b, uint32_t c) {
  uint32_t s = k & 3, m = fl_mask(s);
  switch (k >> 2) {
  case FK_ADD: return (r & m) < (a & m);
  case FK_ADC: return c ? (r & m) <= (a & m) : (r & m) < (a & m);
  case FK_SUB: return (a & m) < (b & m);
  case FK_SBB: return c ? (a & m) <= (b & m) : (a & m) < (b & m);
  case FK_LOGIC: return 0;
  case FK_INC: case FK_DEC: case FK_SHL: case FK_SHR: case FK_SAR: case FK_MUL: return c;
  default: return r & 1;
  }
}
static inline uint32_t fl_zf(uint32_t k, uint32_t r) {
  return (k >> 2) == FK_EFL ? (r >> 6) & 1 : (r & fl_mask(k & 3)) == 0;
}
static inline uint32_t fl_sf(uint32_t k, uint32_t r) {
  return (k >> 2) == FK_EFL ? (r >> 7) & 1 : (r & fl_sign(k & 3)) != 0;
}
static inline uint32_t fl_of(uint32_t k, uint32_t r, uint32_t a, uint32_t b, uint32_t c) {
  uint32_t s = k & 3, sg = fl_sign(s), m = fl_mask(s);
  switch (k >> 2) {
  case FK_ADD: case FK_ADC: return ((a ^ r) & (b ^ r) & sg) != 0;
  case FK_SUB: case FK_SBB: return ((a ^ b) & (a ^ r) & sg) != 0;
  case FK_LOGIC: case FK_SAR: return 0;
  case FK_INC: return (r & m) == sg;
  case FK_DEC: return (r & m) == sg - 1;
  case FK_SHL: return (((r & sg) != 0) ^ c);
  case FK_SHR: return (a & sg) != 0;
  case FK_MUL: return c;
  default: return (r >> 11) & 1;
  }
}
static inline uint32_t fl_pf(uint32_t k, uint32_t r) {
  if ((k >> 2) == FK_EFL) return (r >> 2) & 1;
  return !__builtin_parity(r & 0xffu);
}
static inline uint32_t fl_af(uint32_t k, uint32_t r, uint32_t a, uint32_t b) {
  switch (k >> 2) {
  case FK_ADD: case FK_ADC: case FK_SUB: case FK_SBB: return ((a ^ b ^ r) >> 4) & 1;
  case FK_INC: return (r & 0xf) == 0;
  case FK_DEC: return (r & 0xf) == 0xf;
  case FK_EFL: return (r >> 4) & 1;
  default: return 0;
  }
}
static inline uint32_t fl_all(uint32_t k, uint32_t r, uint32_t a, uint32_t b, uint32_t c) {
  if ((k >> 2) == FK_EFL) return r;
  return fl_cf(k, r, a, b, c) | (fl_pf(k, r) << 2) | (fl_af(k, r, a, b) << 4) | (fl_zf(k, r) << 6) |
         (fl_sf(k, r) << 7) | (fl_of(k, r, a, b, c) << 11);
}

static inline int fl_cc(int cc, uint32_t k, uint32_t r, uint32_t a, uint32_t b, uint32_t c) {
  uint32_t s = k & 3, m = fl_mask(s);
  /* fast paths for compare/test, which is how nearly every branch is fed */
  if ((k >> 2) == FK_SUB) {
    switch (cc) {
    case 2: return (a & m) < (b & m);
    case 3: return (a & m) >= (b & m);
    case 4: return (r & m) == 0;
    case 5: return (r & m) != 0;
    case 6: return (a & m) <= (b & m);
    case 7: return (a & m) > (b & m);
    case 12: return fl_sx(a, s) < fl_sx(b, s);
    case 13: return fl_sx(a, s) >= fl_sx(b, s);
    case 14: return fl_sx(a, s) <= fl_sx(b, s);
    case 15: return fl_sx(a, s) > fl_sx(b, s);
    }
  } else if ((k >> 2) == FK_LOGIC) {
    switch (cc) {
    case 2: case 0: return 0;
    case 3: case 1: return 1;
    case 4: case 6: return (r & m) == 0;
    case 5: case 7: return (r & m) != 0;
    case 8: case 12: return fl_sx(r, s) < 0;
    case 9: case 13: return fl_sx(r, s) >= 0;
    case 14: return fl_sx(r, s) <= 0;
    case 15: return fl_sx(r, s) > 0;
    }
  }
  int v;
  switch (cc >> 1) {
  case 0: v = fl_of(k, r, a, b, c); break;
  case 1: v = fl_cf(k, r, a, b, c); break;
  case 2: v = fl_zf(k, r); break;
  case 3: v = fl_cf(k, r, a, b, c) | fl_zf(k, r); break;
  case 4: v = fl_sf(k, r); break;
  case 5: v = fl_pf(k, r); break;
  case 6: v = fl_sf(k, r) != fl_of(k, r, a, b, c); break;
  default: v = fl_zf(k, r) | (fl_sf(k, r) != fl_of(k, r, a, b, c)); break;
  }
  return (cc & 1) ? !v : v;
}

#define CC(n) fl_cc((n), fk, fr, fa, fb, fc)
#define GETCF fl_cf(fk, fr, fa, fb, fc)
#define MATFLAGS (fr = fl_all(fk, fr, fa, fb, fc), fk = FK_EFL << 2)
#define EFLAGS (fl_all(fk, fr, fa, fb, fc) | 0x2u | (C.df << 10) | (C.iflag << 9))
#define SETEFL(v) (fr = (v), fk = FK_EFL << 2, C.df = ((v) >> 10) & 1, C.iflag = ((v) >> 9) & 1)

/* ---------------------------------------------------------------- shifts and rotates */
#define FKS(kind, bits) (((kind) << 2) | ((bits) == 8 ? 0 : (bits) == 16 ? 1 : 2))
#define DEF_SHIFTS(B, MASK)                                                                                 \
  /* n is in 1..31 */                                                                                      \
  static inline uint32_t sh_shl##B(uint32_t v, uint32_t n, uint32_t *fk, uint32_t *fr, uint32_t *fa,      \
                                   uint32_t *fb, uint32_t *fc) {                                           \
    uint32_t r = n >= B ? 0 : (v << n) & MASK;                                                             \
    *fc = n > B ? 0 : (v >> (B - n)) & 1;                                                                  \
    *fk = FKS(FK_SHL, B); *fr = r; *fa = v; *fb = n;                                                        \
    return r;                                                                                              \
  }                                                                                                        \
  static inline uint32_t sh_shr##B(uint32_t v, uint32_t n, uint32_t *fk, uint32_t *fr, uint32_t *fa,      \
                                   uint32_t *fb, uint32_t *fc) {                                           \
    uint32_t r = n >= B ? 0 : (v >> n);                                                                    \
    *fc = n > B ? 0 : (v >> (n - 1)) & 1;                                                                  \
    *fk = FKS(FK_SHR, B); *fr = r; *fa = v; *fb = n;                                                        \
    return r;                                                                                              \
  }                                                                                                        \
  static inline uint32_t sh_sar##B(uint32_t v, uint32_t n, uint32_t *fk, uint32_t *fr, uint32_t *fa,      \
                                   uint32_t *fb, uint32_t *fc) {                                           \
    int32_t sv = fl_sx(v, B == 8 ? 0 : B == 16 ? 1 : 2);                                                   \
    uint32_t nn = n >= B ? B - 1 : n;                                                                      \
    uint32_t r = (uint32_t)(sv >> nn) & MASK;                                                              \
    *fc = (uint32_t)(sv >> (n >= B ? B - 1 : n - 1)) & 1;                                                  \
    *fk = FKS(FK_SAR, B); *fr = r; *fa = v; *fb = n;                                                        \
    return r;                                                                                              \
  }                                                                                                        \
  static inline uint32_t sh_rol##B(uint32_t v, uint32_t n, uint32_t *fk, uint32_t *fr, uint32_t *fa,      \
                                   uint32_t *fb, uint32_t *fc) {                                           \
    uint32_t e = fl_all(*fk, *fr, *fa, *fb, *fc), k = n % B;                                               \
    uint32_t r = k ? ((v << k) | (v >> (B - k))) & MASK : v;                                               \
    uint32_t cf = r & 1, of = ((r >> (B - 1)) & 1) ^ cf;                                                   \
    *fr = (e & ~0x801u) | cf | (of << 11); *fk = FK_EFL << 2;                                               \
    return r;                                                                                              \
  }                                                                                                        \
  static inline uint32_t sh_ror##B(uint32_t v, uint32_t n, uint32_t *fk, uint32_t *fr, uint32_t *fa,      \
                                   uint32_t *fb, uint32_t *fc) {                                           \
    uint32_t e = fl_all(*fk, *fr, *fa, *fb, *fc), k = n % B;                                               \
    uint32_t r = k ? ((v >> k) | (v << (B - k))) & MASK : v;                                               \
    uint32_t cf = (r >> (B - 1)) & 1, of = cf ^ ((r >> (B - 2)) & 1);                                      \
    *fr = (e & ~0x801u) | cf | (of << 11); *fk = FK_EFL << 2;                                               \
    return r;                                                                                              \
  }                                                                                                        \
  static inline uint32_t sh_rcl##B(uint32_t v, uint32_t n, uint32_t *fk, uint32_t *fr, uint32_t *fa,      \
                                   uint32_t *fb, uint32_t *fc) {                                           \
    uint32_t e = fl_all(*fk, *fr, *fa, *fb, *fc), cf = e & 1, k = n % (B + 1);                             \
    for (uint32_t i = 0; i < k; i++) { uint32_t out = (v >> (B - 1)) & 1; v = ((v << 1) | cf) & MASK; cf = out; } \
    uint32_t of = ((v >> (B - 1)) & 1) ^ cf;                                                               \
    *fr = (e & ~0x801u) | cf | (of << 11); *fk = FK_EFL << 2;                                               \
    return v;                                                                                              \
  }                                                                                                        \
  static inline uint32_t sh_rcr##B(uint32_t v, uint32_t n, uint32_t *fk, uint32_t *fr, uint32_t *fa,      \
                                   uint32_t *fb, uint32_t *fc) {                                           \
    uint32_t e = fl_all(*fk, *fr, *fa, *fb, *fc), cf = e & 1, k = n % (B + 1);                             \
    uint32_t of = ((v >> (B - 1)) & 1) ^ cf;                                                               \
    for (uint32_t i = 0; i < k; i++) { uint32_t out = v & 1; v = (v >> 1) | (cf << (B - 1)); cf = out; }  \
    *fr = (e & ~0x801u) | cf | (of << 11); *fk = FK_EFL << 2;                                               \
    return v;                                                                                              \
  }
DEF_SHIFTS(8, 0xffu)
DEF_SHIFTS(16, 0xffffu)
DEF_SHIFTS(32, 0xffffffffu)

#define SHL8(v, n) sh_shl8(v, n, &fk, &fr, &fa, &fb, &fc)
#define SHL16(v, n) sh_shl16(v, n, &fk, &fr, &fa, &fb, &fc)
#define SHL32(v, n) sh_shl32(v, n, &fk, &fr, &fa, &fb, &fc)
#define SHR8(v, n) sh_shr8(v, n, &fk, &fr, &fa, &fb, &fc)
#define SHR16(v, n) sh_shr16(v, n, &fk, &fr, &fa, &fb, &fc)
#define SHR32(v, n) sh_shr32(v, n, &fk, &fr, &fa, &fb, &fc)
#define SAR8(v, n) sh_sar8(v, n, &fk, &fr, &fa, &fb, &fc)
#define SAR16(v, n) sh_sar16(v, n, &fk, &fr, &fa, &fb, &fc)
#define SAR32(v, n) sh_sar32(v, n, &fk, &fr, &fa, &fb, &fc)
#define ROL8(v, n) sh_rol8(v, n, &fk, &fr, &fa, &fb, &fc)
#define ROL16(v, n) sh_rol16(v, n, &fk, &fr, &fa, &fb, &fc)
#define ROL32(v, n) sh_rol32(v, n, &fk, &fr, &fa, &fb, &fc)
#define ROR8(v, n) sh_ror8(v, n, &fk, &fr, &fa, &fb, &fc)
#define ROR16(v, n) sh_ror16(v, n, &fk, &fr, &fa, &fb, &fc)
#define ROR32(v, n) sh_ror32(v, n, &fk, &fr, &fa, &fb, &fc)
#define RCL8(v, n) sh_rcl8(v, n, &fk, &fr, &fa, &fb, &fc)
#define RCL16(v, n) sh_rcl16(v, n, &fk, &fr, &fa, &fb, &fc)
#define RCL32(v, n) sh_rcl32(v, n, &fk, &fr, &fa, &fb, &fc)
#define RCR8(v, n) sh_rcr8(v, n, &fk, &fr, &fa, &fb, &fc)
#define RCR16(v, n) sh_rcr16(v, n, &fk, &fr, &fa, &fb, &fc)
#define RCR32(v, n) sh_rcr32(v, n, &fk, &fr, &fa, &fb, &fc)

static inline uint32_t sh_shld(uint32_t d, uint32_t s, uint32_t n, uint32_t B, uint32_t *fk, uint32_t *fr,
                               uint32_t *fa, uint32_t *fb, uint32_t *fc) {
  uint32_t m = B == 32 ? 0xffffffffu : 0xffffu;
  uint64_t w = ((uint64_t)d << B) | s;
  uint32_t r = (uint32_t)((w << n) >> B) & m;
  *fc = (uint32_t)(d >> (B - n)) & 1;
  *fk = (FK_SHL << 2) | (B == 32 ? 2 : 1); *fr = r; *fa = d; *fb = n;
  return r;
}
static inline uint32_t sh_shrd(uint32_t d, uint32_t s, uint32_t n, uint32_t B, uint32_t *fk, uint32_t *fr,
                               uint32_t *fa, uint32_t *fb, uint32_t *fc) {
  uint32_t m = B == 32 ? 0xffffffffu : 0xffffu;
  uint64_t w = ((uint64_t)s << B) | d;
  uint32_t r = (uint32_t)(w >> n) & m;
  *fc = (d >> (n - 1)) & 1;
  *fk = (FK_SHR << 2) | (B == 32 ? 2 : 1); *fr = r; *fa = d; *fb = n;
  return r;
}
#define SHLD16(d, s, n) sh_shld(d, s, n, 16, &fk, &fr, &fa, &fb, &fc)
#define SHLD32(d, s, n) sh_shld(d, s, n, 32, &fk, &fr, &fa, &fb, &fc)
#define SHRD16(d, s, n) sh_shrd(d, s, n, 16, &fk, &fr, &fa, &fb, &fc)
#define SHRD32(d, s, n) sh_shrd(d, s, n, 32, &fk, &fr, &fa, &fb, &fc)

/* ---------------------------------------------------------------- multiply / divide */
void rt_divide_error(void);
#define MUL8(s) do { uint32_t p = (eax & 0xffu) * (s); eax = (eax & 0xffff0000u) | (p & 0xffffu); \
    fc = (p >> 8) != 0; fk = FK_MUL << 2; fr = p & 0xffu; } while (0)
#define MUL16(s) do { uint32_t p = (eax & 0xffffu) * (s); eax = (eax & 0xffff0000u) | (p & 0xffffu); \
    edx = (edx & 0xffff0000u) | (p >> 16); fc = (p >> 16) != 0; fk = (FK_MUL << 2) | 1; fr = p & 0xffffu; } while (0)
#define MUL32(s) do { uint64_t p = (uint64_t)eax * (s); eax = (uint32_t)p; edx = (uint32_t)(p >> 32); \
    fc = edx != 0; fk = (FK_MUL << 2) | 2; fr = eax; } while (0)
#define IMUL18(s) do { int32_t p = (int32_t)(int8_t)eax * (int32_t)(int8_t)(s); \
    eax = (eax & 0xffff0000u) | ((uint32_t)p & 0xffffu); fc = p != (int8_t)p; fk = FK_MUL << 2; fr = (uint32_t)p & 0xffu; } while (0)
#define IMUL116(s) do { int32_t p = (int32_t)(int16_t)eax * (int32_t)(int16_t)(s); \
    eax = (eax & 0xffff0000u) | ((uint32_t)p & 0xffffu); edx = (edx & 0xffff0000u) | (((uint32_t)p >> 16) & 0xffffu); \
    fc = p != (int16_t)p; fk = (FK_MUL << 2) | 1; fr = (uint32_t)p & 0xffffu; } while (0)
#define IMUL132(s) do { int64_t p = (int64_t)(int32_t)eax * (int64_t)(int32_t)(s); eax = (uint32_t)p; \
    edx = (uint32_t)((uint64_t)p >> 32); fc = p != (int32_t)p; fk = (FK_MUL << 2) | 2; fr = eax; } while (0)
#define DIV8(s) do { uint32_t d = (s), n = eax & 0xffffu; if (!d || n / d > 0xff) { SO; rt_divide_error(); } \
    eax = (eax & 0xffff0000u) | ((n % d) << 8) | (n / d); } while (0)
#define DIV16(s) do { uint32_t d = (s), n = ((edx & 0xffffu) << 16) | (eax & 0xffffu); \
    if (!d || n / d > 0xffff) { SO; rt_divide_error(); } \
    eax = (eax & 0xffff0000u) | (n / d); edx = (edx & 0xffff0000u) | (n % d); } while (0)
#define DIV32(s) do { uint64_t d = (s), n = ((uint64_t)edx << 32) | eax; \
    if (!d || n / d > 0xffffffffu) { SO; rt_divide_error(); } \
    eax = (uint32_t)(n / d); edx = (uint32_t)(n % d); } while (0)
#define IDIV8(s) do { int32_t d = (int8_t)(s), n = (int16_t)eax; \
    if (!d || (n == -32768 && d == -1) || n / d > 127 || n / d < -128) { SO; rt_divide_error(); } \
    eax = (eax & 0xffff0000u) | (((uint32_t)(n % d) & 0xffu) << 8) | ((uint32_t)(n / d) & 0xffu); } while (0)
#define IDIV16(s) do { int32_t d = (int16_t)(s), n = (int32_t)(((edx & 0xffffu) << 16) | (eax & 0xffffu)); \
    if (!d || (n == INT32_MIN && d == -1) || n / d > 32767 || n / d < -32768) { SO; rt_divide_error(); } \
    eax = (eax & 0xffff0000u) | ((uint32_t)(n / d) & 0xffffu); edx = (edx & 0xffff0000u) | ((uint32_t)(n % d) & 0xffffu); } while (0)
#define IDIV32(s) do { int64_t d = (int32_t)(s), n = (int64_t)(((uint64_t)edx << 32) | eax); \
    if (!d || (n == INT64_MIN && d == -1) || n / d > INT32_MAX || n / d < INT32_MIN) { SO; rt_divide_error(); } \
    eax = (uint32_t)(n / d); edx = (uint32_t)(n % d); } while (0)

/* ---------------------------------------------------------------- string instructions (source DS:esi, destination ES:edi) */
#define STEP(n) (C.df ? (uint32_t)-(n) : (uint32_t)(n))
#define MOVS8 do { WR8(C.segbase[0] + edi, RD8(C.segbase[3] + esi)); esi += STEP(1); edi += STEP(1); } while (0)
#define MOVS16 do { WR16(C.segbase[0] + edi, RD16(C.segbase[3] + esi)); esi += STEP(2); edi += STEP(2); } while (0)
#define MOVS32 do { WR32(C.segbase[0] + edi, RD32(C.segbase[3] + esi)); esi += STEP(4); edi += STEP(4); } while (0)
void rt_rep_movs(uint32_t *esi, uint32_t *edi, uint32_t *ecx, uint32_t sz);
void rt_rep_stos(uint32_t *edi, uint32_t *ecx, uint32_t eax, uint32_t sz);
#define REPMOVS8 rt_rep_movs(&esi, &edi, &ecx, 1)
#define REPMOVS16 rt_rep_movs(&esi, &edi, &ecx, 2)
#define REPMOVS32 rt_rep_movs(&esi, &edi, &ecx, 4)
#define STOS8 do { WR8(C.segbase[0] + edi, eax); edi += STEP(1); } while (0)
#define STOS16 do { WR16(C.segbase[0] + edi, eax); edi += STEP(2); } while (0)
#define STOS32 do { WR32(C.segbase[0] + edi, eax); edi += STEP(4); } while (0)
#define REPSTOS8 rt_rep_stos(&edi, &ecx, eax, 1)
#define REPSTOS16 rt_rep_stos(&edi, &ecx, eax, 2)
#define REPSTOS32 rt_rep_stos(&edi, &ecx, eax, 4)
#define LODS8 do { eax = (eax & 0xffffff00u) | RD8(C.segbase[3] + esi); esi += STEP(1); } while (0)
#define LODS16 do { eax = (eax & 0xffff0000u) | RD16(C.segbase[3] + esi); esi += STEP(2); } while (0)
#define LODS32 do { eax = RD32(C.segbase[3] + esi); esi += STEP(4); } while (0)
#define REPLODS8 do { while (ecx) { LODS8; ecx--; } } while (0)
#define REPLODS16 do { while (ecx) { LODS16; ecx--; } } while (0)
#define REPLODS32 do { while (ecx) { LODS32; ecx--; } } while (0)
#define SCASN(B, MASK, SZC) do { uint32_t a = eax & MASK, b = RD##B(C.segbase[0] + edi), r = (a - b) & MASK; \
    fk = (FK_SUB << 2) | SZC; fr = r; fa = a; fb = b; edi += STEP(B / 8); } while (0)
#define SCAS8 SCASN(8, 0xffu, 0)
#define SCAS16 SCASN(16, 0xffffu, 1)
#define SCAS32 SCASN(32, 0xffffffffu, 2)
#define CMPSN(B, MASK, SZC) do { uint32_t a = RD##B(C.segbase[3] + esi), b = RD##B(C.segbase[0] + edi), r = (a - b) & MASK; \
    fk = (FK_SUB << 2) | SZC; fr = r; fa = a; fb = b; esi += STEP(B / 8); edi += STEP(B / 8); } while (0)
#define CMPS8 CMPSN(8, 0xffu, 0)
#define CMPS16 CMPSN(16, 0xffffu, 1)
#define CMPS32 CMPSN(32, 0xffffffffu, 2)
/* repe (F3) continues while equal; repne (F2) while not equal */
#define REPSCAS8 do { while (ecx) { SCAS8; ecx--; if (!CC(4)) break; } } while (0)
#define REPSCAS16 do { while (ecx) { SCAS16; ecx--; if (!CC(4)) break; } } while (0)
#define REPSCAS32 do { while (ecx) { SCAS32; ecx--; if (!CC(4)) break; } } while (0)
#define REPNESCAS8 do { while (ecx) { SCAS8; ecx--; if (CC(4)) break; } } while (0)
#define REPNESCAS16 do { while (ecx) { SCAS16; ecx--; if (CC(4)) break; } } while (0)
#define REPNESCAS32 do { while (ecx) { SCAS32; ecx--; if (CC(4)) break; } } while (0)
#define REPCMPS8 do { while (ecx) { CMPS8; ecx--; if (!CC(4)) break; } } while (0)
#define REPCMPS16 do { while (ecx) { CMPS16; ecx--; if (!CC(4)) break; } } while (0)
#define REPCMPS32 do { while (ecx) { CMPS32; ecx--; if (!CC(4)) break; } } while (0)
#define REPNECMPS8 do { while (ecx) { CMPS8; ecx--; if (CC(4)) break; } } while (0)
#define REPNECMPS16 do { while (ecx) { CMPS16; ecx--; if (CC(4)) break; } } while (0)
#define REPNECMPS32 do { while (ecx) { CMPS32; ecx--; if (CC(4)) break; } } while (0)
/* F2 prefix on movs/stos/lods behaves like rep */
#define REPNEMOVS8 REPMOVS8
#define REPNEMOVS16 REPMOVS16
#define REPNEMOVS32 REPMOVS32
#define REPNESTOS8 REPSTOS8
#define REPNESTOS16 REPSTOS16
#define REPNESTOS32 REPSTOS32
#define REPNELODS8 REPLODS8
#define REPNELODS16 REPLODS16
#define REPNELODS32 REPLODS32

/* ---------------------------------------------------------------- runtime services */
void rt_call(uint32_t addr);               /* generated: indirect call dispatch */
void rt_bad_call(uint32_t addr);
void rt_trap(uint32_t addr, const char *why) __attribute__((noreturn));
void rt_int(uint32_t n, uint32_t ret);      /* software interrupt with registers in C */
void rt_special(uint32_t addr, const char *op);
uint32_t rt_in(uint32_t port, uint32_t size);
void rt_out(uint32_t port, uint32_t size, uint32_t v);
void rt_ins(uint32_t size, uint32_t rep);
void rt_outs(uint32_t size, uint32_t rep);
void rt_setseg(uint32_t seg, uint32_t sel);
void rt_fpu(const char *op, uint32_t addr, uint32_t size, int st0, int st1);
uint32_t rt_fpu_sw(void);
/* native replacements for platform-boundary routines (see src/recomp/layout.ts) */
void rt_far_invoke(uint32_t target, uint32_t expect);
void rt_resume(uint32_t expect);
/* After a call: the callee's ret may have popped an address other than the one the call pushed. */
#define RET_CHECK(next) do { if (UNLIKELY(C.ret_to != (next))) rt_resume(next); } while (0)
void hle_DoINTR(void);
void hle_int386x(void);
#define FPU(op, a, sz, s0, s1) rt_fpu(op, a, sz, s0, s1)
#define FPU_SW() rt_fpu_sw()

extern const uint32_t rt_func_addrs[];
extern const unsigned rt_func_count;
extern const char *const rt_func_names[];
