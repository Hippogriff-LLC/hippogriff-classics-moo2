/* Internal runtime state shared between the runtime modules. Independently authored; Apache-2.0. */
#pragma once
#include <stdint.h>
#include "rt.h"

#define RT_POLL_INTERVAL 2000
#define STUB_BASE 0xF0000u      /* native "BIOS" entry points live in the ROM area */
#define STUB_IRET_RETURN (STUB_BASE + 0xff0u)
#define MAX_SEL 128
#define MAX_FILES 64
#define MAX_BLOCKS 512
#define VRAM_SIZE (4u << 20)

typedef struct { uint32_t base, limit; int used; } SelDesc;
typedef struct { uint32_t base, size; int used; } MemBlock;

typedef struct {
  /* image */
  uint32_t code_lo, code_hi, data_lo, data_hi, entry, initial_esp;
  /* descriptors */
  SelDesc sel[MAX_SEL];
  uint16_t sel_code, sel_data, sel_psp, sel_env, sel_zero;
  uint32_t psp_lin, env_lin;
  /* interrupt vectors */
  uint16_t pm_sel[256];
  uint32_t pm_off[256];
  uint32_t rm_vec[256];
  /* memory */
  MemBlock blocks[MAX_BLOCKS];
  uint32_t heap_lo, heap_hi;
  uint32_t dos_next, dos_end;
  /* time */
  int realtime;
  double now_ms;          /* guest-visible time */
  double last_host_ms;
  double pit_last_ms;
  double pit_frac;
  uint32_t pit_divisor;
  uint32_t pit_latch;
  int pit_mode_byte, pit_lohi_state, pit_reload_lo;
  double next_present_ms;
  uint64_t polls;
  int in_irq;
  int idle_count;
  /* DOS */
  uint32_t dta;
  int fh[MAX_FILES];      /* DOS handle -> host handle (-1 = closed); 0..4 reserved */
  char find_pattern[16];
  uint32_t find_pos;
  int find_attr;
  /* keyboard */
  uint8_t kq[64]; int kq_head, kq_tail;
  uint8_t port60;
  int kbd_irq_pending;
  /* mouse */
  int mx, my, mbuttons, mvisible;
  int mminx, mmaxx, mminy, mmaxy;
  uint32_t mhandler_sel, mhandler_off, mhandler_mask;
  int mpending_mask;
  int mmickey_x, mmickey_y;
  int mpress_count[3], mrelease_count[3], mpress_x[3], mpress_y[3], mrel_x[3], mrel_y[3];
  /* VGA / VESA */
  uint8_t pal[768];
  int dac_write, dac_read, dac_sub, dac_rsub;
  uint8_t pel_mask;
  int video_mode;         /* 0x03 text, 0x13, or VESA mode number | 0x100 */
  int vesa, width, height, pitch;
  uint32_t bank, display_start;
  uint8_t *vram;
  int seq_index, crtc_index, gc_index, attr_index;
  uint8_t seq[8], crtc[32], gc[16];
  int frames;
  /* diagnostics */
  int verbose;
  uint32_t trace_int;
  int exit_code;
} Runtime;

extern Runtime RT;

/* helpers */
void rt_memcpy(void *d, const void *s, uint32_t n);
void rt_memset(void *d, int v, uint32_t n);
uint32_t rt_strlen(const char *s);
int rt_strcasecmp(const char *a, const char *b);
int rt_fmt(char *buf, uint32_t cap, const char *f, ...);
void rt_logf(const char *f, ...);
const char *rt_func_name(uint32_t a, uint32_t *off);
void rt_backtrace(void);
void rt_dump_regs(void);
uint16_t rt_alloc_selector(uint32_t base, uint32_t limit);
SelDesc *rt_sel(uint32_t sel);
void rt_set_flag(uint32_t bit, int on);
int rt_get_flag(uint32_t bit);
#define SET_CF(on) rt_set_flag(1u, (on))

/* modules */
void rt_stub_call(uint32_t addr);
void rt_init(const uint8_t *image, uint32_t len, const char *cmdline);
void rt_run(void);
uint32_t rt_mem_alloc(uint32_t size);
int rt_mem_free(uint32_t base);
uint32_t rt_mem_resize(uint32_t base, uint32_t size);
void dos_int21(void);
void dpmi_int31(void);
void bios_int10(void);
void bios_int16(void);
void bios_int9_default(void);
void bios_int1a(void);
void mouse_int33(void);
void pc_init(void);
void pc_poll(void);
void pc_raise_irq(int irq);
void pc_present(void);
void pc_note_idle(void);
void pc_advance(double ms);
int dos_init(void);
/* real-mode register structure for DPMI 0300h-0302h */
typedef struct { uint32_t edi, esi, ebp, res, ebx, edx, ecx, eax; uint16_t flags, es, ds, fs, gs, ip, cs, sp, ss; } RmRegs;
void bios_real_int(int n, RmRegs *r);
/* virtual Miles digital sound driver (audio.c) */
void audio_int66(RmRegs *r);
void audio_advance(double ms);
