/* PC hardware and BIOS services for the port runtime: time base and PIT, interrupt delivery, keyboard,
 * mouse driver API, VGA DAC and a VBE 1.2-style banked 640x480x256 adapter.
 * Behaviour follows public hardware/BIOS/VBE/mouse-driver interface descriptions. Independently authored;
 * Apache-2.0. */
#include "rt.h"
#include "rt_int.h"
#include "host.h"

#define AL (C.eax & 0xff)
#define AH ((C.eax >> 8) & 0xff)
#define AX (C.eax & 0xffff)
#define BL (C.ebx & 0xff)
#define BH ((C.ebx >> 8) & 0xff)
#define BX (C.ebx & 0xffff)
#define CX (C.ecx & 0xffff)
#define DX (C.edx & 0xffff)
#define SETAX(v) (C.eax = (C.eax & 0xffff0000u) | ((v) & 0xffffu))
#define SETAL(v) (C.eax = (C.eax & 0xffffff00u) | ((v) & 0xffu))
#define SETAH(v) (C.eax = (C.eax & 0xffff00ffu) | (((v) & 0xffu) << 8))
#define SETBX(v) (C.ebx = (C.ebx & 0xffff0000u) | ((v) & 0xffffu))
#define SETBH(v) (C.ebx = (C.ebx & 0xffff00ffu) | (((v) & 0xffu) << 8))
#define SETBL(v) (C.ebx = (C.ebx & 0xffffff00u) | ((v) & 0xffu))
#define SETCX(v) (C.ecx = (C.ecx & 0xffff0000u) | ((v) & 0xffffu))
#define SETDX(v) (C.edx = (C.edx & 0xffff0000u) | ((v) & 0xffffu))
#define SETSI(v) (C.esi = (C.esi & 0xffff0000u) | ((v) & 0xffffu))
#define SETDI(v) (C.edi = (C.edi & 0xffff0000u) | ((v) & 0xffffu))

#define PIT_HZ 1193181.67
#define VIRTUAL_MS_PER_POLL 0.02 /* guest time charged per RT_POLL_INTERVAL back-edges in virtual mode */
#define WINDOW 0xA0000u
#define WINDOW_SIZE 0x10000u
#define KBUF_START 0x1e
#define KBUF_END 0x3e

static uint8_t vram_store[VRAM_SIZE];
static uint32_t pending_ticks;
static int pic_mask;
static double start_host_ms;
static double present_interval_ms = 1000.0 / 30.0;
static int dirty_present;

void pc_init(void) {
  RT.vram = vram_store;
  rt_memset(vram_store, 0, VRAM_SIZE);
  RT.pit_divisor = 65536;
  RT.pel_mask = 0xff;
  RT.video_mode = 3;
  WR16(0x41a, KBUF_START); WR16(0x41c, KBUF_START);
  WR16(0x480, KBUF_START); WR16(0x482, KBUF_END);
  RT.mmaxx = 639; RT.mmaxy = 199; RT.mx = 320; RT.my = 100;
  start_host_ms = host_now_ms();
  RT.last_host_ms = start_host_ms;
}

/* ------------------------------------------------------------------ banked frame buffer */
static void window_flush(void) {
  uint32_t off = RT.bank * WINDOW_SIZE;
  if (off + WINDOW_SIZE <= VRAM_SIZE) rt_memcpy(RT.vram + off, M + WINDOW, WINDOW_SIZE);
}
static void window_load(void) {
  uint32_t off = RT.bank * WINDOW_SIZE;
  if (off + WINDOW_SIZE <= VRAM_SIZE) rt_memcpy(M + WINDOW, RT.vram + off, WINDOW_SIZE);
}
static void set_bank(uint32_t bank) {
  if (bank == RT.bank) return;
  window_flush();
  RT.bank = bank;
  window_load();
}

void pc_present(void) {
  if (RT.vesa) {
    window_flush();
    uint32_t start = RT.display_start;
    if (start + (uint32_t)(RT.pitch * RT.height) > VRAM_SIZE) start = 0;
    host_present(RT.vram + start, RT.width, RT.height, RT.pitch, RT.pal);
  } else if (RT.video_mode == 0x13) {
    host_present(M + WINDOW, 320, 200, 320, RT.pal);
  } else return;
  RT.frames++;
  RT.next_present_ms = RT.now_ms + present_interval_ms;
  dirty_present = 0;
}

/* ------------------------------------------------------------------ interrupt delivery */
/* Invoke the protected-mode handler for vector v as the hardware would: push an interrupt frame whose
 * return address is the runtime's own stub, run the handler until its iret, then restore. */
static void deliver(int v) {
  Cpu saved = C;
  uint32_t ef = fl_all(C.fk, C.fr, C.fa, C.fb, C.fc) | 2u | (C.df << 10) | (C.iflag << 9);
  RT.in_irq++;
  C.esp -= 12;
  WR32(C.esp + 8, ef); WR32(C.esp + 4, C.seg[1]); WR32(C.esp, STUB_IRET_RETURN);
  C.iflag = 0; C.df = 0;
  rt_far_invoke(RT.pm_off[v], STUB_IRET_RETURN);
  RT.in_irq--;
  C = saved;
}

void pc_raise_irq(int irq) {
  if (irq == 0) pending_ticks++;
  else if (irq == 1) RT.kbd_irq_pending = 1;
}

static void call_mouse_handler(int cond) {
  Cpu saved = C;
  RT.in_irq++;
  C.eax = (uint32_t)cond; C.ebx = (uint32_t)RT.mbuttons; C.ecx = (uint32_t)RT.mx; C.edx = (uint32_t)RT.my;
  C.esi = (uint32_t)RT.mmickey_x; C.edi = (uint32_t)RT.mmickey_y;
  rt_setseg(3, RT.sel_data);
  C.esp -= 8;
  WR32(C.esp + 4, RT.sel_code); WR32(C.esp, STUB_IRET_RETURN);
  rt_far_invoke(RT.mhandler_off, STUB_IRET_RETURN);
  RT.in_irq--;
  C = saved;
}

/* ------------------------------------------------------------------ input events */
static void kq_push(int sc) {
  int n = (RT.kq_tail + 1) & 63;
  if (n == RT.kq_head) return;
  RT.kq[RT.kq_tail] = (uint8_t)sc;
  RT.kq_tail = n;
}

static int clampi(int v, int lo, int hi) { return v < lo ? lo : v > hi ? hi : v; }

static void mouse_event(int x, int y, int buttons) {
  /* The host pointer is absolute in screen pixels; spread it over the range the program configured with
   * int 33h functions 07h/08h (MOO2 asks for 0..1279 across its 640-pixel screen and halves CX itself). */
  int w = RT.width > 0 ? RT.width : 320, h = RT.height > 0 ? RT.height : 200;
  int sx = RT.mminx + (int)((int64_t)clampi(x, 0, w - 1) * (RT.mmaxx - RT.mminx + 1) / w);
  y = RT.mminy + (int)((int64_t)clampi(y, 0, h - 1) * (RT.mmaxy - RT.mminy + 1) / h);
  sx = clampi(sx, RT.mminx, RT.mmaxx);
  y = clampi(y, RT.mminy, RT.mmaxy);
  int cond = 0;
  if (sx != RT.mx || y != RT.my) cond |= 1;
  RT.mmickey_x += sx - RT.mx;
  RT.mmickey_y += (y - RT.my) * 2;
  RT.mx = sx; RT.my = y;
  for (int b = 0; b < 3; b++) {
    int was = (RT.mbuttons >> b) & 1, now = (buttons >> b) & 1;
    if (now && !was) { cond |= 2 << (b * 2); RT.mpress_count[b]++; RT.mpress_x[b] = sx; RT.mpress_y[b] = y; }
    if (!now && was) { cond |= 4 << (b * 2); RT.mrelease_count[b]++; RT.mrel_x[b] = sx; RT.mrel_y[b] = y; }
  }
  RT.mbuttons = buttons & 7;
  RT.mpending_mask |= cond;
}

static void pump_events(void) {
  HostEvent ev;
  while (host_poll_event(&ev)) {
    if (ev.type == 1) kq_push(ev.code);
    else if (ev.type == 2) mouse_event(ev.x, ev.y, ev.buttons);
  }
}

/* ------------------------------------------------------------------ time */
void pc_advance(double ms) {
  if (ms <= 0) return;
  RT.now_ms += ms;
  RT.pit_frac += ms * (PIT_HZ / 1000.0) / (double)RT.pit_divisor;
  while (RT.pit_frac >= 1.0) { RT.pit_frac -= 1.0; pending_ticks++; }
  if (pending_ticks > 64) pending_ticks = 64;
}

/* The guest is visibly waiting (polling retrace, keyboard, mouse or the clock): move time forward. */
void pc_note_idle(void) {
  if (RT.realtime) {
    if (++RT.idle_count > 64) { host_idle(1.0); RT.idle_count = 0; }
  } else pc_advance(0.01);
}

void pc_poll(void) {
  if (RT.in_irq) return;
  pump_events();
  /* timer */
  while (pending_ticks && C.iflag && !(pic_mask & 1)) {
    pending_ticks--;
    deliver(8);
  }
  /* keyboard: one scancode per interrupt */
  if (C.iflag && !(pic_mask & 2) && RT.kq_head != RT.kq_tail && !RT.kbd_irq_pending) {
    RT.port60 = RT.kq[RT.kq_head];
    RT.kq_head = (RT.kq_head + 1) & 63;
    RT.kbd_irq_pending = 1;
    deliver(9);
    RT.kbd_irq_pending = 0;
  }
  /* mouse driver user handler */
  if (RT.mpending_mask && C.iflag) {
    int cond = RT.mpending_mask & (int)RT.mhandler_mask;
    RT.mpending_mask = 0;
    if (cond && RT.mhandler_off) call_mouse_handler(cond);
  }
  if (RT.now_ms >= RT.next_present_ms) pc_present();
}

void rt_poll(void) {
  rt_budget = RT_POLL_INTERVAL;
  RT.polls++;
  if (RT.realtime) {
    double h = host_now_ms();
    pc_advance(h - RT.last_host_ms);
    RT.last_host_ms = h;
  } else pc_advance(VIRTUAL_MS_PER_POLL);
  pc_poll();
}

/* ------------------------------------------------------------------ default BIOS keyboard handler */
static const char kb_lower[] = "\0\0331234567890-=\b\tqwertyuiop[]\r\0asdfghjkl;'`\0\\zxcvbnm,./\0*\0 ";
static const char kb_upper[] = "\0\033!@#$%^&*()_+\b\tQWERTYUIOP{}\r\0ASDFGHJKL:\"~\0|ZXCVBNM<>?\0*\0 ";

static void bios_key_store(uint32_t word) {
  uint32_t head = RD16(0x41a), tail = RD16(0x41c);
  uint32_t next = tail + 2 >= KBUF_END ? KBUF_START : tail + 2;
  if (next == head) return;
  WR16(0x400 + tail, word);
  WR16(0x41c, next);
}

void bios_int9_default(void) {
  uint32_t sc = RT.port60;
  uint32_t flags = RD8(0x417);
  int up = sc & 0x80;
  uint32_t k = sc & 0x7f;
  if (k == 0x2a || k == 0x36) { flags = up ? flags & ~(k == 0x2a ? 2u : 1u) : flags | (k == 0x2a ? 2u : 1u); }
  else if (k == 0x1d) flags = up ? flags & ~4u : flags | 4u;
  else if (k == 0x38) flags = up ? flags & ~8u : flags | 8u;
  else if (!up) {
    uint32_t ch = 0;
    if (k < sizeof kb_lower - 1) ch = (uint8_t)((flags & 3) ? kb_upper[k] : kb_lower[k]);
    if ((flags & 4) && ch >= 'a' && ch <= 'z') ch -= 0x60;
    if ((flags & 4) && ch >= 'A' && ch <= 'Z') ch -= 0x40;
    if (flags & 8) ch = 0;
    bios_key_store((k << 8) | ch);
  }
  WR8(0x417, flags);
}

/* ------------------------------------------------------------------ int 16h */
void bios_int16(void) {
  uint32_t ah = AH;
  uint32_t head = RD16(0x41a), tail = RD16(0x41c);
  switch (ah) {
  case 0x00: case 0x10:
    while (RD16(0x41a) == RD16(0x41c)) { pc_note_idle(); rt_poll(); }
    head = RD16(0x41a);
    SETAX(RD16(0x400 + head));
    WR16(0x41a, head + 2 >= KBUF_END ? KBUF_START : head + 2);
    return;
  case 0x01: case 0x11:
    if (head == tail) { pc_note_idle(); rt_set_flag(0x40, 1); return; }
    SETAX(RD16(0x400 + head)); rt_set_flag(0x40, 0);
    return;
  case 0x02: case 0x12: SETAL(RD8(0x417)); return;
  case 0x03: case 0x05: return;
  }
  rt_logf("unimplemented int 16h ah=%x", ah);
}

/* ------------------------------------------------------------------ int 1Ah */
static uint32_t bcd(uint32_t v) { return ((v / 10) << 4) | (v % 10); }
void bios_int1a(void) {
  int y, mo, d, h, mi, s, cs;
  switch (AH) {
  case 0x00: pc_note_idle(); { uint32_t t = RD32(0x46c); SETCX(t >> 16); SETDX(t); SETAL(0); } return;
  case 0x02: host_local_time(&y, &mo, &d, &h, &mi, &s, &cs);
    SETCX((bcd((uint32_t)h) << 8) | bcd((uint32_t)mi)); SETDX(bcd((uint32_t)s) << 8); SET_CF(0); return;
  case 0x04: host_local_time(&y, &mo, &d, &h, &mi, &s, &cs);
    SETCX((bcd((uint32_t)y / 100) << 8) | bcd((uint32_t)y % 100)); SETDX((bcd((uint32_t)mo) << 8) | bcd((uint32_t)d)); SET_CF(0); return;
  }
  SET_CF(1);
}

/* ------------------------------------------------------------------ int 33h mouse driver */
void mouse_int33(void) {
  uint32_t ax = AX;
  pc_note_idle();
  switch (ax) {
  case 0x00: case 0x21:
    RT.mvisible = 0; RT.mminx = 0; RT.mminy = 0;
    RT.mmaxx = 639; RT.mmaxy = RT.vesa ? RT.height - 1 : 199;
    RT.mhandler_mask = 0; RT.mhandler_off = 0;
    SETAX(0xffff); SETBX(3); return;
  case 0x01: RT.mvisible++; return;
  case 0x02: RT.mvisible--; return;
  case 0x03: SETBX(RT.mbuttons); SETCX(RT.mx); SETDX(RT.my); return;
  case 0x04: RT.mx = clampi(CX, RT.mminx, RT.mmaxx); RT.my = clampi(DX, RT.mminy, RT.mmaxy); return;
  case 0x05: case 0x06: {
    int b = BX > 2 ? 0 : BX;
    SETAX(RT.mbuttons);
    if (ax == 5) { SETBX(RT.mpress_count[b]); SETCX(RT.mpress_x[b]); SETDX(RT.mpress_y[b]); RT.mpress_count[b] = 0; }
    else { SETBX(RT.mrelease_count[b]); SETCX(RT.mrel_x[b]); SETDX(RT.mrel_y[b]); RT.mrelease_count[b] = 0; }
    return;
  }
  case 0x07: RT.mminx = (int16_t)CX; RT.mmaxx = (int16_t)DX; if (RT.mminx > RT.mmaxx) { int t = RT.mminx; RT.mminx = RT.mmaxx; RT.mmaxx = t; }
    RT.mx = clampi(RT.mx, RT.mminx, RT.mmaxx); return;
  case 0x08: RT.mminy = (int16_t)CX; RT.mmaxy = (int16_t)DX; if (RT.mminy > RT.mmaxy) { int t = RT.mminy; RT.mminy = RT.mmaxy; RT.mmaxy = t; }
    RT.my = clampi(RT.my, RT.mminy, RT.mmaxy); return;
  case 0x09: case 0x0a: case 0x0f: case 0x13: case 0x1a: case 0x1d: return;
  case 0x0b: SETCX(RT.mmickey_x); SETDX(RT.mmickey_y); RT.mmickey_x = RT.mmickey_y = 0; return;
  case 0x0c: RT.mhandler_mask = CX; RT.mhandler_sel = C.seg[0]; RT.mhandler_off = C.edx;
    if (RT.verbose) rt_logf("mouse: handler %x mask %x", C.edx, CX);
    return;
  case 0x14: { uint32_t om = RT.mhandler_mask, oo = RT.mhandler_off;
    RT.mhandler_mask = CX; RT.mhandler_off = C.edx; SETCX(om); C.edx = oo; rt_setseg(0, RT.sel_code); return; }
  case 0x15: SETBX(64); return;
  case 0x1b: SETBX(50); SETCX(50); SETDX(50); return;
  case 0x1e: SETBX(0); return;
  case 0x24: SETBX(0x0626); SETCX(0x0400); return;
  }
  if (RT.verbose) rt_logf("unimplemented int 33h ax=%x", ax);
}

/* ------------------------------------------------------------------ video BIOS and VBE */
typedef struct { int mode, w, h; } VbeMode;
static const VbeMode vbe_modes[] = {{0x100, 640, 400}, {0x101, 640, 480}, {0x103, 800, 600}};

static void put_cstr(uint32_t a, const char *s) { rt_memcpy(M + a, s, rt_strlen(s) + 1); }

static void vbe_info(uint32_t a, uint32_t rseg, uint32_t roff) {
  /* a = linear buffer; rseg:roff = its real-mode address, used for the far pointers inside it */
  rt_memset(M + a, 0, 256);
  rt_memcpy(M + a, "VESA", 4);
  WR16(a + 4, 0x0102);
  WR16(a + 6, roff + 0x60); WR16(a + 8, rseg);
  WR32(a + 0x0a, 1);                      /* DAC switchable */
  WR16(a + 0x0e, roff + 0x40); WR16(a + 0x10, rseg);
  WR16(a + 0x12, VRAM_SIZE >> 16);
  for (int i = 0; i < 3; i++) WR16(a + 0x40 + i * 2, vbe_modes[i].mode);
  WR16(a + 0x46, 0xffff);
  put_cstr(a + 0x60, "Hippogriff VBE");
}

static const VbeMode *find_mode(int m) {
  for (unsigned i = 0; i < sizeof vbe_modes / sizeof vbe_modes[0]; i++) if (vbe_modes[i].mode == m) return &vbe_modes[i];
  return 0;
}

static void vbe_mode_info(uint32_t a, const VbeMode *m) {
  rt_memset(M + a, 0, 256);
  WR16(a + 0x00, 0x001b);
  WR8(a + 0x02, 7); WR8(a + 0x03, 0);
  WR16(a + 0x04, 64); WR16(a + 0x06, 64);
  WR16(a + 0x08, 0xa000); WR16(a + 0x0a, 0);
  WR32(a + 0x0c, 0);
  WR16(a + 0x10, m->w);
  WR16(a + 0x12, m->w); WR16(a + 0x14, m->h);
  WR8(a + 0x16, 8); WR8(a + 0x17, 16); WR8(a + 0x18, 1); WR8(a + 0x19, 8);
  WR8(a + 0x1a, 1); WR8(a + 0x1b, 4); WR8(a + 0x1c, 0);
  WR8(a + 0x1d, VRAM_SIZE / (uint32_t)(m->w * m->h) - 1);
  WR8(a + 0x1e, 1);
}

static void set_vbe_mode(int mode) {
  const VbeMode *m = find_mode(mode & 0x1ff);
  if (!m) { SETAX(0x014f); return; }
  RT.vesa = 1; RT.video_mode = m->mode; RT.width = m->w; RT.height = m->h; RT.pitch = m->w;
  RT.bank = 0; RT.display_start = 0;
  if (!(mode & 0x8000)) { rt_memset(RT.vram, 0, VRAM_SIZE); rt_memset(M + WINDOW, 0, WINDOW_SIZE); }
  RT.mmaxx = m->w - 1; RT.mmaxy = m->h - 1;
  rt_logf("video: VBE mode %x %dx%d", m->mode, m->w, m->h);
  SETAX(0x004f);
}

static void dac_set_block(uint32_t a, int first, int count) {
  for (int i = 0; i < count && first + i < 256; i++)
    for (int c = 0; c < 3; c++) RT.pal[(first + i) * 3 + c] = M[a + i * 3 + c] & 63;
  dirty_present = 1;
}

/* es:edi as linear address: protected-mode callers use the ES base; real-mode callers set segbase too */
static uint32_t es_di(void) { return C.segbase[0] + C.edi; }

void bios_int10(void) {
  uint32_t ah = AH;
  if (ah == 0x4f) {
    switch (AL) {
    case 0x00: vbe_info(es_di(), C.seg[0], C.edi & 0xffff); SETAX(0x004f); return;
    case 0x01: { const VbeMode *m = find_mode(CX & 0x1ff); if (!m) { SETAX(0x014f); return; }
      vbe_mode_info(es_di(), m); SETAX(0x004f); return; }
    case 0x02: set_vbe_mode(BX); return;
    case 0x03: SETBX(RT.vesa ? RT.video_mode : RT.video_mode); SETAX(0x004f); return;
    case 0x04: SETBX(0x40); SETAX(0x004f); return;
    case 0x05:
      if (BH == 0) { if (BL == 0) set_bank(DX); }
      else SETDX(RT.bank);
      SETAX(0x004f); return;
    case 0x06:
      if (BL == 0 || BL == 2) RT.pitch = BL == 0 ? CX : CX;
      SETBX(RT.pitch); SETCX(RT.pitch); SETDX(RT.pitch ? VRAM_SIZE / (uint32_t)RT.pitch : 0); SETAX(0x004f); return;
    case 0x07:
      if (BL == 0 || BL == 0x80) {
        RT.display_start = DX * (uint32_t)RT.pitch + CX;
        pc_present();
      } else if (BL == 1) { SETBH(0); SETCX(RT.pitch ? RT.display_start % (uint32_t)RT.pitch : 0); SETDX(RT.pitch ? RT.display_start / (uint32_t)RT.pitch : 0); }
      SETAX(0x004f); return;
    case 0x08: SETBH(6); SETAX(0x004f); return;
    case 0x09: if (BL == 0 || BL == 0x80) {
        for (uint32_t i = 0; i < CX; i++) {
          uint32_t a = es_di() + i * 4;
          RT.pal[(DX + i) * 3 + 0] = M[a + 2] & 63; RT.pal[(DX + i) * 3 + 1] = M[a + 1] & 63; RT.pal[(DX + i) * 3 + 2] = M[a] & 63;
        }
      }
      SETAX(0x004f); return;
    }
    SETAX(0x014f);
    return;
  }
  switch (ah) {
  case 0x00:
    RT.vesa = 0; RT.video_mode = AL & 0x7f;
    if (RT.video_mode == 0x13) {
      if (!(AL & 0x80)) rt_memset(M + WINDOW, 0, WINDOW_SIZE);
      RT.width = 320; RT.height = 200; RT.pitch = 320; RT.mmaxx = 639; RT.mmaxy = 199;
    } else { RT.width = RT.height = 0; }
    WR8(0x449, RT.video_mode);
    rt_logf("video: BIOS mode %x", RT.video_mode);
    return;
  case 0x0f: SETAL(RT.vesa ? 0x13 : RT.video_mode); SETAH(RT.video_mode == 0x13 ? 40 : 80); SETBH(0); return;
  case 0x10:
    if (AL == 0x12) dac_set_block(C.segbase[0] + C.edx, BX, CX);
    else if (AL == 0x10) { int i = BX & 0xff; RT.pal[i * 3] = (C.edx >> 8) & 63; RT.pal[i * 3 + 1] = (C.ecx >> 8) & 63; RT.pal[i * 3 + 2] = C.ecx & 63; }
    else if (AL == 0x17) for (uint32_t i = 0; i < CX; i++) for (int c = 0; c < 3; c++) M[C.segbase[0] + C.edx + i * 3 + c] = RT.pal[((BX + i) & 255) * 3 + c];
    else if (AL == 0x15) { int i = BX & 0xff; SETDX(RT.pal[i * 3] << 8); SETCX((RT.pal[i * 3 + 1] << 8) | RT.pal[i * 3 + 2]); }
    return;
  case 0x11: return;
  case 0x12: if (BL == 0x10) { SETBX(0x0003); SETCX(0x0009); } return;
  case 0x1a: if (AL == 0) { SETAL(0x1a); SETBX(0x0008); } return;
  case 0x01: case 0x02: case 0x05: case 0x06: case 0x07: case 0x09: case 0x0a: case 0x0b: return;
  case 0x03: SETCX(0x0607); SETDX(0); return;
  case 0x08: SETAX(0x0720); return;
  case 0x0e: return;
  case 0x1b: SETAL(0); return;
  }
  if (RT.verbose) rt_logf("unimplemented int 10h ax=%x", AX);
}

/* ------------------------------------------------------------------ real-mode interrupts via DPMI 0300h */
void bios_real_int(int n, RmRegs *r) {
  Cpu saved = C;
  C.eax = r->eax; C.ebx = r->ebx; C.ecx = r->ecx; C.edx = r->edx; C.esi = r->esi & 0xffff; C.edi = r->edi & 0xffff; C.ebp = r->ebp;
  C.seg[0] = r->es; C.segbase[0] = (uint32_t)r->es << 4;
  C.seg[3] = r->ds; C.segbase[3] = (uint32_t)r->ds << 4;
  C.fk = FK_EFL << 2; C.fr = r->flags & ~1u;
  if (n == 0x10) bios_int10();
  else if (n == 0x33) mouse_int33();
  else if (n == 0x16) bios_int16();
  else if (n == 0x1a) bios_int1a();
  else if (n == 0x21) {
    /* DOS calls with DS:DX buffers: present the real-mode buffer as a flat address */
    uint32_t edx = C.edx;
    C.edx = C.segbase[3] + (edx & 0xffff);
    dos_int21();
    if (C.edx == C.segbase[3] + (edx & 0xffff)) C.edx = edx;
  } else rt_logf("real-mode int %x ax=%x not supported", n, r->eax);
  r->eax = C.eax; r->ebx = C.ebx; r->ecx = C.ecx; r->edx = C.edx; r->esi = C.esi; r->edi = C.edi; r->ebp = C.ebp;
  r->es = C.seg[0]; r->ds = C.seg[3];
  r->flags = (uint16_t)((r->flags & ~0x8d5u) | (fl_all(C.fk, C.fr, C.fa, C.fb, C.fc) & 0x8d5u));
  C = saved;
}

/* ------------------------------------------------------------------ I/O ports */
static uint32_t retrace_status(void) {
  /* 70 Hz frame; vertical retrace for the last ~1.1 ms; display-enable toggles with horizontal timing */
  double period = 1000.0 / 70.0;
  double t = RT.now_ms - (double)(uint64_t)(RT.now_ms / period) * period;
  uint32_t v = t > period - 1.1 ? 0x08 | 0x01 : 0;
  if (!v && ((uint64_t)(RT.now_ms * 31.5)) & 1) v |= 1;
  return v;
}

static uint32_t pit_read_counter(void) {
  double ticks = RT.pit_frac * (double)RT.pit_divisor;
  uint32_t c = (uint32_t)((double)RT.pit_divisor - ticks);
  return c & 0xffff;
}

uint32_t rt_in(uint32_t port, uint32_t size) {
  port &= 0xffff;
  switch (port) {
  case 0x3da: case 0x3ba: pc_note_idle(); RT.attr_index = -1; return retrace_status();
  case 0x3c9: { uint32_t v = RT.pal[RT.dac_read % 768]; RT.dac_read = (RT.dac_read + 1) % 768; return v; }
  case 0x3c8: return (uint32_t)(RT.dac_write / 3);
  case 0x3c7: return 0;
  case 0x3c6: return RT.pel_mask;
  case 0x3c4: return (uint32_t)RT.seq_index;
  case 0x3c5: return RT.seq[RT.seq_index & 7];
  case 0x3d4: return (uint32_t)RT.crtc_index;
  case 0x3d5: return RT.crtc[RT.crtc_index & 31];
  case 0x3ce: return (uint32_t)RT.gc_index;
  case 0x3cf: return RT.gc[RT.gc_index & 15];
  case 0x3cc: return 0xe3;
  case 0x60: return RT.port60;
  case 0x61: return 0x20;
  case 0x64: return RT.kq_head != RT.kq_tail ? 0x1d : 0x1c;
  case 0x21: return (uint32_t)pic_mask;
  case 0xa1: return 0xff;
  case 0x20: case 0xa0: return 0;
  case 0x40: {
    static int lo = 1; static uint32_t latched;
    if (lo) latched = RT.pit_latch ? RT.pit_latch : pit_read_counter();
    uint32_t v = lo ? latched & 0xff : (latched >> 8) & 0xff;
    if (!lo) RT.pit_latch = 0;
    lo = !lo;
    pc_note_idle();
    return v;
  }
  case 0x201: return 0xf0;
  }
  if (RT.verbose) rt_logf("in %x (size %d)", port, size);
  return size == 1 ? 0xff : size == 2 ? 0xffff : 0xffffffffu;
}

void rt_out(uint32_t port, uint32_t size, uint32_t v) {
  port &= 0xffff;
  if (size == 2 && (port == 0x3c4 || port == 0x3d4 || port == 0x3ce)) {
    rt_out(port, 1, v & 0xff);
    rt_out(port + 1, 1, (v >> 8) & 0xff);
    return;
  }
  v &= size == 1 ? 0xffu : size == 2 ? 0xffffu : 0xffffffffu;
  switch (port) {
  case 0x3c8: RT.dac_write = (int)(v & 0xff) * 3; return;
  case 0x3c7: RT.dac_read = (int)(v & 0xff) * 3; return;
  case 0x3c9: RT.pal[RT.dac_write % 768] = (uint8_t)(v & 63); RT.dac_write = (RT.dac_write + 1) % 768; dirty_present = 1; return;
  case 0x3c6: RT.pel_mask = (uint8_t)v; return;
  case 0x3c4: RT.seq_index = (int)v; return;
  case 0x3c5: RT.seq[RT.seq_index & 7] = (uint8_t)v; return;
  case 0x3d4: RT.crtc_index = (int)v; return;
  case 0x3d5: RT.crtc[RT.crtc_index & 31] = (uint8_t)v; return;
  case 0x3ce: RT.gc_index = (int)v; return;
  case 0x3cf: RT.gc[RT.gc_index & 15] = (uint8_t)v; return;
  case 0x3c0: case 0x3c2: return;
  case 0x20: case 0xa0: return;            /* EOI */
  case 0x21: pic_mask = (int)v; return;
  case 0xa1: return;
  case 0x43:
    if ((v >> 6) == 0) {
      if ((v & 0x30) == 0) { RT.pit_latch = pit_read_counter(); if (!RT.pit_latch) RT.pit_latch = 1; }
      else RT.pit_lohi_state = 0;
    }
    return;
  case 0x40:
    if (!RT.pit_lohi_state) { RT.pit_reload_lo = (int)v; RT.pit_lohi_state = 1; }
    else {
      uint32_t d = ((v & 0xff) << 8) | (uint32_t)RT.pit_reload_lo;
      RT.pit_divisor = d ? d : 65536;
      RT.pit_lohi_state = 0;
      if (RT.verbose) rt_logf("pit: divisor %d (%d Hz)", RT.pit_divisor, (int)(PIT_HZ / RT.pit_divisor));
    }
    return;
  case 0x41: case 0x42: case 0x61: case 0x60: case 0x64: return;
  }
  if (RT.verbose) rt_logf("out %x <- %x (size %d)", port, v, size);
}

void rt_ins(uint32_t size, uint32_t rep) { (void)size; (void)rep; rt_trap(0, "ins"); }
void rt_outs(uint32_t size, uint32_t rep) { (void)size; (void)rep; rt_trap(0, "outs"); }
