/* DOS, DOS-extender (DOS/4GW-compatible DPMI) and process environment emulation for the port runtime.
 * Behaviour follows the public DOS and DPMI 0.9 interface descriptions. Independently authored; Apache-2.0. */
#include "rt.h"
#include "rt_int.h"
#include "host.h"

#define AL (C.eax & 0xff)
#define AH ((C.eax >> 8) & 0xff)
#define AX (C.eax & 0xffff)
#define BX (C.ebx & 0xffff)
#define CX (C.ecx & 0xffff)
#define DX (C.edx & 0xffff)
#define SETAX(v) (C.eax = (C.eax & 0xffff0000u) | ((v) & 0xffffu))
#define SETAL(v) (C.eax = (C.eax & 0xffffff00u) | ((v) & 0xffu))
#define SETBX(v) (C.ebx = (C.ebx & 0xffff0000u) | ((v) & 0xffffu))
#define SETCX(v) (C.ecx = (C.ecx & 0xffff0000u) | ((v) & 0xffffu))
#define SETDX(v) (C.edx = (C.edx & 0xffff0000u) | ((v) & 0xffffu))
#define SETSI(v) (C.esi = (C.esi & 0xffff0000u) | ((v) & 0xffffu))
#define SETDI(v) (C.edi = (C.edi & 0xffff0000u) | ((v) & 0xffffu))

static void ok(void) { SET_CF(0); }
static void fail(int code) { SETAX(code); SET_CF(1); }

/* ------------------------------------------------------------------ memory blocks (DPMI 0501h, DOS 48h) */
uint32_t rt_mem_alloc(uint32_t size) {
  size = (size + 0xfff) & ~0xfffu;
  if (!size) size = 0x1000;
  /* first fit between existing blocks, which are kept sorted */
  uint32_t at = RT.heap_lo;
  int i, n = 0;
  for (i = 0; i < MAX_BLOCKS && RT.blocks[i].used; i++) n++;
  for (i = 0; i < n; i++) {
    if (RT.blocks[i].base >= at + size) break;
    uint32_t end = RT.blocks[i].base + RT.blocks[i].size;
    if (end > at) at = end;
  }
  if (at + size > RT.heap_hi || n >= MAX_BLOCKS) return 0;
  for (int j = n; j > i; j--) RT.blocks[j] = RT.blocks[j - 1];
  RT.blocks[i].base = at; RT.blocks[i].size = size; RT.blocks[i].used = 1;
  rt_memset(M + at, 0, size);
  return at;
}
static int find_block(uint32_t base) {
  for (int i = 0; i < MAX_BLOCKS && RT.blocks[i].used; i++) if (RT.blocks[i].base == base) return i;
  return -1;
}
int rt_mem_free(uint32_t base) {
  int i = find_block(base);
  if (i < 0) return 0;
  for (; i < MAX_BLOCKS - 1 && RT.blocks[i].used; i++) RT.blocks[i] = RT.blocks[i + 1];
  RT.blocks[MAX_BLOCKS - 1].used = 0;
  return 1;
}
uint32_t rt_mem_resize(uint32_t base, uint32_t size) {
  int i = find_block(base);
  if (i < 0) return 0;
  size = (size + 0xfff) & ~0xfffu;
  uint32_t limit = (i + 1 < MAX_BLOCKS && RT.blocks[i + 1].used) ? RT.blocks[i + 1].base : RT.heap_hi;
  if (base + size <= limit) { RT.blocks[i].size = size; return base; }
  uint32_t old = RT.blocks[i].size;
  uint32_t nb = rt_mem_alloc(size);
  if (!nb) return 0;
  rt_memcpy(M + nb, M + base, old < size ? old : size);
  rt_mem_free(base);
  return nb;
}
static uint32_t mem_free_total(void) {
  uint32_t used = 0;
  for (int i = 0; i < MAX_BLOCKS && RT.blocks[i].used; i++) used += RT.blocks[i].size;
  return RT.heap_hi - RT.heap_lo - used;
}
static uint32_t mem_largest(void) {
  uint32_t at = RT.heap_lo, best = 0;
  for (int i = 0; i < MAX_BLOCKS && RT.blocks[i].used; i++) {
    if (RT.blocks[i].base > at && RT.blocks[i].base - at > best) best = RT.blocks[i].base - at;
    uint32_t e = RT.blocks[i].base + RT.blocks[i].size;
    if (e > at) at = e;
  }
  if (RT.heap_hi - at > best) best = RT.heap_hi - at;
  return best;
}

/* ------------------------------------------------------------------ paths */
/* DOS names map onto one flat, case-insensitive host directory: strip drive and directories. */
static void dos_name(uint32_t a, char *out, int cap) {
  char tmp[160]; int n = 0;
  while (n < 159 && M[a + n]) { tmp[n] = (char)M[a + n]; n++; }
  tmp[n] = 0;
  const char *b = tmp;
  for (const char *p = tmp; *p; p++) if (*p == '\\' || *p == '/' || *p == ':') b = p + 1;
  int k = 0;
  for (; *b && k < cap - 1; b++) out[k++] = (char)(*b >= 'a' && *b <= 'z' ? *b - 32 : *b);
  out[k] = 0;
}

static int alloc_handle(int host) {
  for (int i = 5; i < MAX_FILES; i++) if (RT.fh[i] < 0) { RT.fh[i] = host; return i; }
  host_close(host);
  return -1;
}

static int wild_match(const char *pat, const char *name) {
  /* DOS 8.3 matching: compare base and extension separately, '?' any char, '*' rest of field */
  char pb[9] = {0}, pe[4] = {0}, nb[9] = {0}, ne[4] = {0};
  const char *dot = 0;
  for (const char *p = pat; *p; p++) if (*p == '.') dot = p;
  int i = 0;
  for (const char *p = pat; *p && p != dot && i < 8; p++) {
    if (*p == '*') { while (i < 8) pb[i++] = '?'; break; }
    pb[i++] = *p;
  }
  while (i < 8) pb[i++] = ' ';
  i = 0;
  if (dot) for (const char *p = dot + 1; *p && i < 3; p++) {
    if (*p == '*') { while (i < 3) pe[i++] = '?'; break; }
    pe[i++] = *p;
  }
  while (i < 3) pe[i++] = ' ';
  dot = 0;
  for (const char *p = name; *p; p++) if (*p == '.') dot = p;
  i = 0;
  for (const char *p = name; *p && p != dot && i < 8; p++) nb[i++] = *p;
  if (dot && dot - name > 8) return 0;
  while (i < 8) nb[i++] = ' ';
  i = 0;
  if (dot) for (const char *p = dot + 1; *p && i < 3; p++) ne[i++] = *p;
  while (i < 3) ne[i++] = ' ';
  for (i = 0; i < 8; i++) if (pb[i] != '?' && pb[i] != nb[i]) return 0;
  for (i = 0; i < 3; i++) if (pe[i] != '?' && pe[i] != ne[i]) return 0;
  return 1;
}

static char *listing;
static uint32_t listing_len;
static int find_next(void) {
  uint32_t cap = 1 << 16;
  for (;;) {
    if (!listing) listing = (char *)M + (M_size - (1u << 20)); /* scratch area at the top of guest memory */
    listing_len = host_list(listing, cap);
    if (listing_len <= cap) break;
    cap = listing_len;
  }
  uint32_t p = 0, idx = 0;
  while (p < listing_len) {
    const char *nm = listing + p; p += rt_strlen(nm) + 1;
    const char *sz = listing + p; p += rt_strlen(sz) + 1;
    if (idx++ < RT.find_pos) continue;
    RT.find_pos = idx;
    char up[64]; int k = 0;
    for (const char *q = nm; *q && k < 63; q++) up[k++] = (char)(*q >= 'a' && *q <= 'z' ? *q - 32 : *q);
    up[k] = 0;
    if (k > 12 || !wild_match(RT.find_pattern, up)) continue;
    uint32_t size = 0;
    for (const char *q = sz; *q; q++) size = size * 10 + (uint32_t)(*q - '0');
    uint32_t d = RT.dta;
    WR8(d + 0x15, 0x20);
    WR16(d + 0x16, 0); WR16(d + 0x18, (16 << 9) | (10 << 5) | 1);
    WR32(d + 0x1a, size);
    rt_memset(M + d + 0x1e, 0, 13);
    rt_memcpy(M + d + 0x1e, up, (uint32_t)k);
    return 1;
  }
  return 0;
}

/* ------------------------------------------------------------------ int 21h */
void dos_int21(void) {
  uint32_t ah = AH;
  switch (ah) {
  case 0x02: { char b[2] = {(char)(C.edx & 0xff), 0}; (void)b; ok(); return; }
  case 0x06: if ((C.edx & 0xff) == 0xff) { SETAL(0); rt_set_flag(0x40, 1); } return;
  case 0x09: return;
  case 0x0b: SETAL(0); return;
  case 0x0e: SETAL(26); return;                 /* select drive: number of drives */
  case 0x19: SETAL(2); return;                  /* current drive C: */
  case 0x1a: RT.dta = C.edx; return;
  case 0x2f: C.ebx = RT.dta; rt_setseg(0, RT.sel_data); return;
  case 0x25: { int v = AL; RT.pm_sel[v] = C.seg[3]; RT.pm_off[v] = C.edx; if (RT.verbose) rt_logf("int21/25: vector %x -> %x", v, C.edx); return; }
  case 0x35: { int v = AL; C.ebx = RT.pm_off[v]; rt_setseg(0, RT.pm_sel[v]); return; }
  case 0x2a: { int y, mo, d, h, mi, s, cs; host_local_time(&y, &mo, &d, &h, &mi, &s, &cs);
    SETCX(y); SETDX((mo << 8) | d); SETAL(0); return; }
  case 0x2c: { int y, mo, d, h, mi, s, cs; pc_note_idle(); /* commonly polled while waiting */
    host_local_time(&y, &mo, &d, &h, &mi, &s, &cs);
    SETCX((h << 8) | mi); SETDX((s << 8) | cs); return; }
  case 0x30: C.eax = 0x0005 | (0 << 8); C.ebx = 0; C.ecx = 0; return; /* DOS 5.0 */
  case 0x33: if (AL == 0) SETDX(0); return;     /* ctrl-break state */
  case 0x36: SETAX(64); SETBX(0x7fff); SETCX(512); SETDX(0x7fff); return; /* disk free */
  case 0x3b: ok(); return;                       /* chdir */
  case 0x39: case 0x3a: ok(); return;            /* mkdir/rmdir */
  case 0x3c: case 0x5b: {                        /* create */
    char n[64]; dos_name(C.edx, n, sizeof n);
    int h = host_open(n, HOST_O_CREATE);
    if (h < 0) { fail(3); return; }
    int d = alloc_handle(h);
    if (d < 0) { fail(4); return; }
    if (RT.verbose) rt_logf("dos: create %s -> %d", n, d);
    C.eax = (uint32_t)d; ok(); return;
  }
  case 0x3d: {
    char n[64]; dos_name(C.edx, n, sizeof n);
    int mode = AL & 3;
    int h = host_open(n, mode == 0 ? HOST_O_READ : mode == 1 ? HOST_O_WRITE : HOST_O_RDWR);
    if (RT.verbose) rt_logf("dos: open %s mode %d -> %d", n, mode, h);
    if (h < 0) { fail(2); return; }
    int d = alloc_handle(h);
    if (d < 0) { fail(4); return; }
    C.eax = (uint32_t)d; ok(); return;
  }
  case 0x3e: {
    int d = BX;
    if (d < 5) { ok(); return; }
    if (d >= MAX_FILES || RT.fh[d] < 0) { fail(6); return; }
    host_close(RT.fh[d]); RT.fh[d] = -1; ok(); return;
  }
  case 0x3f: {
    int d = BX;
    if (d == 0) { C.eax = 0; ok(); return; }
    if (d >= MAX_FILES || d < 5 || RT.fh[d] < 0) { fail(6); return; }
    uint32_t n = C.ecx, a = C.edx;
    if (a + n > M_size) { fail(5); return; }
    int r = host_read(RT.fh[d], M + a, n);
    if (r < 0) { fail(5); return; }
    C.eax = (uint32_t)r; ok(); return;
  }
  case 0x40: {
    int d = BX;
    uint32_t n = C.ecx, a = C.edx;
    if (d == 1 || d == 2) {
      char b[256]; uint32_t k = n < 255 ? n : 255;
      rt_memcpy(b, M + a, k); b[k] = 0;
      while (k && (b[k - 1] == '\n' || b[k - 1] == '\r')) b[--k] = 0;
      if (k) rt_logf("[guest] %s", b);
      C.eax = n; ok(); return;
    }
    if (d >= MAX_FILES || d < 5 || RT.fh[d] < 0) { fail(6); return; }
    if (n == 0) { /* truncate at current position: emulated by host seek semantics */ C.eax = 0; ok(); return; }
    int r = host_write(RT.fh[d], M + a, n);
    if (r < 0) { fail(5); return; }
    C.eax = (uint32_t)r; ok(); return;
  }
  case 0x41: { char n[64]; dos_name(C.edx, n, sizeof n); if (host_unlink(n) < 0) fail(2); else ok(); return; }
  case 0x42: {
    int d = BX;
    if (d >= MAX_FILES || d < 5 || RT.fh[d] < 0) { fail(6); return; }
    int64_t off = (int32_t)((CX << 16) | DX);
    int64_t r = host_seek(RT.fh[d], off, AL);
    if (r < 0) { fail(0x19); return; }
    SETAX((uint32_t)r & 0xffff); SETDX((uint32_t)r >> 16); C.eax = (uint32_t)r & 0xffff; ok(); return;
  }
  case 0x43: { /* get/set attributes */
    char n[64]; dos_name(C.edx, n, sizeof n);
    int h = host_open(n, HOST_O_READ);
    if (h < 0) { fail(2); return; }
    host_close(h); SETCX(0x20); ok(); return;
  }
  case 0x44:
    if (AL == 0) { int d = BX; SETDX(d < 5 ? 0x80 | (d == 0 ? 1 : d == 1 ? 2 : 0) : 0); ok(); return; }
    if (AL == 8) { SETAX(1); ok(); return; }   /* fixed media */
    if (AL == 9) { SETDX(0); ok(); return; }
    ok(); return;
  case 0x45: case 0x46: fail(4); return;
  case 0x47: { /* getcwd: DS:ESI <- path without drive and leading backslash */
    const char *cwd = "MPS\\ORION2";
    rt_memcpy(M + C.esi, cwd, rt_strlen(cwd) + 1); ok(); return;
  }
  case 0x48: { /* allocate memory: BX paragraphs. DOS/4GW returns a selector in AX for flat memory */
    uint32_t sz = BX * 16u;
    uint32_t b = rt_mem_alloc(sz);
    if (!b) { SETBX(mem_largest() / 16 > 0xffff ? 0xffff : mem_largest() / 16); fail(8); return; }
    C.eax = rt_alloc_selector(b, sz - 1); ok(); return;
  }
  case 0x49: ok(); return;
  case 0x4a: ok(); return;                        /* resize: the flat image is not resizable; claim success */
  case 0x4c: RT.exit_code = AL; rt_logf("guest exit(%d)", AL); host_exit(AL);
  case 0x4e: {
    char n[64]; dos_name(C.edx, n, sizeof n);
    rt_memcpy(RT.find_pattern, n, 15); RT.find_pattern[15] = 0;
    RT.find_attr = CX; RT.find_pos = 0;
    if (find_next()) { WR32(RT.dta, RT.find_pos); ok(); } else fail(0x12);
    return;
  }
  case 0x4f: if (find_next()) ok(); else fail(0x12); return;
  case 0x56: {
    char a[64], b[64]; dos_name(C.edx, a, sizeof a); dos_name(C.edi, b, sizeof b);
    if (host_rename(a, b) < 0) fail(5); else ok(); return;
  }
  case 0x57: if (AL == 0) { SETCX(0); SETDX((16 << 9) | (10 << 5) | 1); } ok(); return;
  case 0x62: SETBX(RT.sel_psp); return;
  case 0xff: /* DOS/4GW presence check (DX=0x78): report DOS/4GW */
    if (AH == 0xff && DX == 0x78) { C.eax = 0xffff3447; rt_setseg(5, 0); return; }
    break;
  }
  rt_logf("unimplemented int 21h ah=%x al=%x", ah, AL);
  fail(1);
}

/* ------------------------------------------------------------------ DPMI */
static uint32_t dos_alloc_para(uint32_t paras) {
  uint32_t sz = paras * 16, b = RT.dos_next;
  if (b + sz > RT.dos_end) return 0;
  RT.dos_next = (b + sz + 15) & ~15u;
  return b;
}

void dpmi_int31(void) {
  uint32_t ax = AX;
  switch (ax) {
  case 0x0000: { /* allocate CX descriptors */
    uint16_t first = 0;
    for (uint32_t i = 0; i < CX; i++) { uint16_t s = rt_alloc_selector(0, 0); if (!i) first = s; }
    SETAX(first); ok(); return;
  }
  case 0x0001: { SelDesc *d = rt_sel(BX); if (d) d->used = 0; ok(); return; }
  case 0x0002: { uint16_t s = rt_alloc_selector(BX * 16u, 0xffff); SETAX(s); ok(); return; }
  case 0x0003: SETAX(8); ok(); return;
  case 0x0006: { SelDesc *d = rt_sel(BX); uint32_t b = d ? d->base : 0; SETCX(b >> 16); SETDX(b); ok(); return; }
  case 0x0007: { SelDesc *d = rt_sel(BX); if (!d) { fail(0x8022); return; } d->base = (CX << 16) | DX;
    for (int s = 0; s < 6; s++) if (C.seg[s] == BX) C.segbase[s] = d->base;
    ok(); return; }
  case 0x0008: { SelDesc *d = rt_sel(BX); if (d) d->limit = (CX << 16) | DX; ok(); return; }
  case 0x0009: ok(); return;
  case 0x000a: { SelDesc *d = rt_sel(BX); SETAX(rt_alloc_selector(d ? d->base : 0, d ? d->limit : 0xffffffff)); ok(); return; }
  case 0x000b: { SelDesc *d = rt_sel(BX); uint32_t b = d ? d->base : 0, l = d ? d->limit : 0xfffff; uint32_t a = C.edi + C.segbase[0];
    WR16(a, l & 0xffff); WR16(a + 2, b & 0xffff); WR8(a + 4, b >> 16); WR8(a + 5, 0xf2); WR8(a + 6, 0xc0 | ((l >> 16) & 15)); WR8(a + 7, b >> 24); ok(); return; }
  case 0x000c: { SelDesc *d = rt_sel(BX); uint32_t a = C.edi + C.segbase[0];
    if (d) { d->base = RD16(a + 2) | (RD8(a + 4) << 16) | (RD8(a + 7) << 24); d->limit = RD16(a) | ((RD8(a + 6) & 15) << 16); } ok(); return; }
  case 0x0100: { uint32_t b = dos_alloc_para(BX); if (!b) { SETBX((RT.dos_end - RT.dos_next) / 16); fail(8); return; }
    SETAX(b >> 4); SETDX(rt_alloc_selector(b, BX * 16u - 1)); ok(); return; }
  case 0x0101: ok(); return;
  case 0x0102: ok(); return;
  case 0x0200: { uint32_t v = RT.rm_vec[C.ebx & 0xff]; SETCX(v >> 16); SETDX(v); ok(); return; }
  case 0x0201: RT.rm_vec[C.ebx & 0xff] = (CX << 16) | DX; ok(); return;
  case 0x0202: SETCX(RT.sel_code); C.edx = STUB_BASE + 0x800 + (C.ebx & 0x1f) * 4; ok(); return;
  case 0x0203: ok(); return;
  case 0x0204: { int v = C.ebx & 0xff; SETCX(RT.pm_sel[v]); C.edx = RT.pm_off[v]; ok(); return; }
  case 0x0205: { int v = C.ebx & 0xff; RT.pm_sel[v] = (uint16_t)CX; RT.pm_off[v] = C.edx;
    if (RT.verbose) rt_logf("dpmi: pm vector %x -> %x:%x", v, CX, C.edx);
    ok(); return; }
  case 0x0300: case 0x0301: case 0x0302: {
    uint32_t a = C.edi + C.segbase[0];
    RmRegs r; rt_memcpy(&r, M + a, sizeof r);
    if (ax == 0x0300) bios_real_int(C.ebx & 0xff, &r);
    else { if (RT.verbose) rt_logf("dpmi: real-mode far call %x:%x refused", r.cs, r.ip); r.flags |= 1; rt_memcpy(M + a, &r, sizeof r); fail(0x8001); return; }
    rt_memcpy(M + a, &r, sizeof r);
    ok(); return;
  }
  case 0x0303: fail(0x8015); return;              /* no real-mode callbacks */
  case 0x0400: SETAX(0x005a); SETBX(5); SETCX(4); SETDX(0x0870); ok(); return;
  case 0x0500: { uint32_t a = C.edi + C.segbase[0]; rt_memset(M + a, 0xff, 0x30);
    uint32_t largest = mem_largest(), free = mem_free_total();
    WR32(a, largest); WR32(a + 4, largest / 4096); WR32(a + 8, largest / 4096); WR32(a + 0xc, (RT.heap_hi - RT.heap_lo) / 4096);
    WR32(a + 0x10, free / 4096); WR32(a + 0x14, free / 4096); WR32(a + 0x18, (RT.heap_hi - RT.heap_lo) / 4096);
    WR32(a + 0x1c, (RT.heap_hi - RT.heap_lo) / 4096); WR32(a + 0x20, 0);
    ok(); return; }
  case 0x0501: { uint32_t sz = (BX << 16) | CX; uint32_t b = rt_mem_alloc(sz);
    if (RT.verbose) rt_logf("dpmi: alloc %x -> %x", sz, b);
    if (!b) { fail(0x8013); return; }
    SETBX(b >> 16); SETCX(b); SETSI(b >> 16); SETDI(b); ok(); return; }
  case 0x0502: rt_mem_free((C.esi << 16) | (C.edi & 0xffff)); ok(); return;
  case 0x0503: { uint32_t old = ((C.esi & 0xffff) << 16) | (C.edi & 0xffff), sz = (BX << 16) | CX;
    uint32_t b = rt_mem_resize(old, sz); if (!b) { fail(0x8013); return; }
    SETBX(b >> 16); SETCX(b); SETSI(b >> 16); SETDI(b); ok(); return; }
  case 0x0600: case 0x0601: case 0x0602: case 0x0603: case 0x0702: case 0x0703: ok(); return;
  case 0x0604: SETBX(0); SETCX(4096); ok(); return;
  case 0x0800: { uint32_t phys = (BX << 16) | CX; SETBX(phys >> 16); SETCX(phys); ok(); return; }
  case 0x0900: { int was = C.iflag; C.iflag = 0; SETAL(was); ok(); return; }
  case 0x0901: { int was = C.iflag; C.iflag = 1; SETAL(was); ok(); return; }
  case 0x0902: SETAL(C.iflag); ok(); return;
  case 0x0e00: SETAX(0); ok(); return;
  }
  rt_logf("unimplemented int 31h ax=%x", ax);
  fail(0x8001);
}

/* ------------------------------------------------------------------ software interrupts */
void rt_int(uint32_t n, uint32_t ret) {
  (void)ret;
  if (RT.trace_int) rt_logf("int %x ax=%x bx=%x cx=%x dx=%x", n, C.eax, C.ebx, C.ecx, C.edx);
  switch (n) {
  case 0x21: dos_int21(); return;
  case 0x31: dpmi_int31(); return;
  case 0x10: bios_int10(); return;
  case 0x16: bios_int16(); return;
  case 0x1a: bios_int1a(); return;
  case 0x33: mouse_int33(); return;
  case 0x2f: if (AX == 0x1687 || AX == 0x1600) { SETAX(AX == 0x1600 ? 0 : 1); return; } SETAL(0); return;
  case 0x11: SETAX(0x0026); return;
  case 0x12: SETAX(640); return;
  case 0x15: SET_CF(1); SETAX(0x8600); return;
  case 0x7a: SETAL(0); return;                   /* IPX not installed */
  case 0x03: return;
  }
  rt_logf("unhandled software interrupt %x (ax=%x)", n, C.eax);
  SET_CF(1);
}

/* ------------------------------------------------------------------ native stubs (default handlers) */
/* Calls into the STUB area: default interrupt handlers (the original real-mode BIOS/DOS chain) and the
 * return address used when the runtime itself invokes guest handlers. */
static void stub_iret(void) {
  uint32_t ef = RD32(C.esp + 8);
  C.ret_to = RD32(C.esp);
  C.esp += 12;
  C.fk = FK_EFL << 2; C.fr = ef; C.df = (ef >> 10) & 1; C.iflag = (ef >> 9) & 1;
}
void rt_stub_call(uint32_t a) {
  uint32_t off = a - STUB_BASE;
  if (off < 0x400) { /* default protected-mode handler for vector off/4, entered as an interrupt */
    int v = (int)(off / 4);
    if (v == 8) { WR32(0x46c, RD32(0x46c) + 1); /* BIOS tick */
      if (RT.pm_off[0x1c] != STUB_BASE + 0x1c * 4) { /* chain user tick hook */
        uint32_t ef = RD32(C.esp + 8);
        C.esp -= 12; WR32(C.esp + 8, ef & ~0x200u); WR32(C.esp + 4, RT.sel_code); WR32(C.esp, STUB_IRET_RETURN);
        rt_far_invoke(RT.pm_off[0x1c], STUB_IRET_RETURN);
      }
    }
    if (v == 9) bios_int9_default();
    stub_iret();
    return;
  }
  if (off >= 0x800 && off < 0x880) { rt_trap(a, "default exception handler reached"); }
  rt_trap(a, "unknown stub");
}

/* ------------------------------------------------------------------ process setup */
static void put_str(uint32_t a, const char *s) { rt_memcpy(M + a, s, rt_strlen(s) + 1); }

void rt_init(const uint8_t *image, uint32_t len, const char *cmdline) {
  rt_memset(&RT, 0, sizeof RT);
  rt_memset(&C, 0, sizeof C);
  rt_memset(M, 0, M_size);
  for (int i = 0; i < MAX_FILES; i++) RT.fh[i] = -1;
  /* image: [count] then per object [base][size][bytes] */
  uint32_t n, p = 4;
  rt_memcpy(&n, image, 4);
  for (uint32_t i = 0; i < n && p + 8 <= len; i++) {
    uint32_t base, size;
    rt_memcpy(&base, image + p, 4); rt_memcpy(&size, image + p + 4, 4); p += 8;
    rt_memcpy(M + base, image + p, size); p += size;
    if (i == 0) { RT.code_lo = base; RT.code_hi = base + size; }
    if (i == 1) { RT.data_lo = base; RT.data_hi = base + size; }
  }
  /* descriptors: 0 = null; flat code/data; PSP; environment */
  RT.sel[1].used = RT.sel[2].used = 1;
  RT.sel[1].limit = RT.sel[2].limit = 0xffffffffu;
  RT.sel_code = 0x08; RT.sel_data = 0x10;
  RT.psp_lin = 0x10000; RT.env_lin = 0x10100;
  RT.sel[3].used = 1; RT.sel[3].base = RT.psp_lin; RT.sel[3].limit = 0xff; RT.sel_psp = 0x18;
  RT.sel[4].used = 1; RT.sel[4].base = RT.env_lin; RT.sel[4].limit = 0xeff; RT.sel_env = 0x20;
  RT.dos_next = 0x12000; RT.dos_end = 0x9f000;
  RT.heap_lo = 0x400000; RT.heap_hi = M_size - (2u << 20);
  for (int v = 0; v < 256; v++) { RT.pm_sel[v] = RT.sel_code; RT.pm_off[v] = STUB_BASE + v * 4; RT.rm_vec[v] = 0xf000u << 16 | (v * 4); }
  /* PSP: int 20h, top of memory, environment selector, command tail */
  WR16(RT.psp_lin, 0x20cd);
  WR16(RT.psp_lin + 2, 0x9fff);
  WR16(RT.psp_lin + 0x2c, RT.sel_env);
  uint32_t cl = rt_strlen(cmdline);
  if (cl > 125) cl = 125;
  WR8(RT.psp_lin + 0x80, cl);
  rt_memcpy(M + RT.psp_lin + 0x81, cmdline, cl);
  WR8(RT.psp_lin + 0x81 + cl, 0x0d);
  /* environment block: strings, empty string, count, program path */
  uint32_t e = RT.env_lin;
  const char *env[] = {"COMSPEC=C:\\COMMAND.COM", "PATH=C:\\", "DOS4G=QUIET", 0};
  for (int i = 0; env[i]; i++) { put_str(e, env[i]); e += rt_strlen(env[i]) + 1; }
  WR8(e++, 0);
  WR16(e, 1); e += 2;
  put_str(e, "C:\\MPS\\ORION2\\ORION2.EXE");
  /* BIOS data area */
  WR16(0x410, 0x0026); WR16(0x413, 640); WR8(0x449, 3); WR16(0x44a, 80); WR8(0x484, 24);
  WR16(0x463, 0x3d4);
  RT.dta = RT.psp_lin + 0x80;
  /* CPU */
  C.fcw = 0x37f; C.iflag = 1;
  C.seg[1] = RT.sel_code; C.seg[2] = C.seg[3] = RT.sel_data;
  C.seg[0] = RT.sel_psp; C.segbase[0] = RT.psp_lin;
  C.fk = FK_EFL << 2; C.fr = 0x202;
  pc_init();
}

/* ------------------------------------------------------------------ Watcom CRT interrupt back ends */
/* __int386x_: esi = interrupt, edi -> input REGS, edx -> output REGS, ebx -> SREGS. The original loads the
 * registers and returns into a table of `int N; ret` stubs; the effect is reproduced directly. */
void hle_int386x(void) {
  uint32_t n = C.esi & 0xff, in = C.edi, out = C.edx, sr = C.ebx;
  uint16_t ds0 = C.seg[3], es0 = C.seg[0];
  uint32_t ebp0 = C.ebp;
  rt_setseg(0, RD16(sr));
  rt_setseg(3, RD16(sr + 6));
  C.eax = RD32(in); C.ebx = RD32(in + 4); C.ecx = RD32(in + 8);
  C.edx = RD32(in + 12); C.esi = RD32(in + 16); C.edi = RD32(in + 20);
  rt_int(n, 0);
  uint32_t cf = rt_get_flag(1);
  WR32(out, C.eax); WR32(out + 4, C.ebx); WR32(out + 8, C.ecx);
  WR32(out + 12, C.edx); WR32(out + 16, C.esi); WR32(out + 20, C.edi);
  WR32(out + 24, cf ? 0xffffffffu : 0);
  WR16(sr + 6, C.seg[3]);
  WR16(sr, C.seg[0]);
  C.eax = C.seg[3]; C.ebx = sr;
  rt_setseg(0, es0); rt_setseg(3, ds0);
  C.ebp = ebp0;
  C.ret_to = RD32(C.esp);
  C.esp += 4;
}

/* _DoINTR_: eax = interrupt, edx -> REGPACK {eax, ebx, ecx, edx, ebp, esi, edi, ds, es, fs, gs, flags};
 * every register is preserved. */
void hle_DoINTR(void) {
  Cpu saved = C;
  uint32_t n = C.eax & 0xff, rp = C.edx;
  C.eax = RD32(rp); C.ebx = RD32(rp + 4); C.ecx = RD32(rp + 8); C.edx = RD32(rp + 12);
  C.ebp = RD32(rp + 0x10); C.esi = RD32(rp + 0x14); C.edi = RD32(rp + 0x18);
  rt_setseg(3, RD16(rp + 0x1c)); rt_setseg(0, RD16(rp + 0x1e));
  rt_setseg(4, RD16(rp + 0x20)); rt_setseg(5, RD16(rp + 0x22));
  rt_int(n, 0);
  uint32_t ef = fl_all(C.fk, C.fr, C.fa, C.fb, C.fc) | 2u | (C.iflag << 9);
  WR32(rp, C.eax); WR32(rp + 4, C.ebx); WR32(rp + 8, C.ecx); WR32(rp + 12, C.edx);
  WR32(rp + 0x10, C.ebp); WR32(rp + 0x14, C.esi); WR32(rp + 0x18, C.edi);
  WR16(rp + 0x1c, C.seg[3]); WR16(rp + 0x1e, C.seg[0]); WR16(rp + 0x20, C.seg[4]); WR16(rp + 0x22, C.seg[5]);
  WR16(rp + 0x24, ef);
  uint32_t esp = saved.esp;
  C = saved;
  C.ret_to = RD32(esp);
  C.esp = esp + 4;
}

/* ------------------------------------------------------------------ run */
void rt_run(void) {
  C.esp = RT.initial_esp;
  rt_budget = RT_POLL_INTERVAL;
  rt_call(RT.entry);
  rt_logf("guest entry returned");
  host_exit(RT.exit_code);
}
