/* Virtual Miles AIL 3 digital sound driver.  Independently authored; Apache-2.0.
 *
 * The game links the Miles Audio Interface Library 3.02, whose protected-mode half (sample mixer, XMIDI
 * sequencer, timers) is part of the recompiled executable.  Hardware access lives in separate real-mode
 * driver files (SB16.DIG, SBPRO2.MDI, ...) that the library loads into DOS memory and calls through
 * int 66h using DPMI 0300h, with AX = function and BX/CX/DX/SI/DI as arguments.  This module answers
 * those calls in place of a digital (.DIG) driver: it describes one 16-bit stereo output format, lets the
 * library's own mixer fill its double DMA buffer as usual, and plays that buffer out through host.h at
 * the guest-clock rate a real card would consume it.  Music (.MDI) drivers synthesize in the driver
 * itself and are not emulated: device verification fails, so the library runs without music.
 *
 * Layouts below are from the Miles VDI conventions as used by the library code in the executable:
 *   driver header (start of the loaded file): "AIL3DIG\x1a" / "AIL3MDI\x1a" signature;
 *   DIG_DDT: u8 format_supported[4] at +0; per format (bit 1 = 16-bit, bit 0 = stereo) a 14-byte record
 *            at +0x10 + 14 * format: u16 min_rate, nominal_rate, max_rate, min_half_buffer,
 *            max_half_buffer; u32 flags (bit 0 = signed samples);
 *   DIG_DST: real far pointers to DMA half-buffers A and B at +0 and +4, s16 active half at +8 (-1 when
 *            idle).  The mixer refills the half that was just played whenever +8 changes. */
#include "host.h"
#include "rt_int.h"

#define DDT_OFF 0x100u          /* inside the loaded driver image, whose real-mode code is never run */
#define DST_OFF 0x180u
#define DRIVER_MIN_SIZE 0x200u
#define FMT_S16_STEREO 3

static struct {
  uint32_t hdr;               /* linear address of the DIG driver header, 0 if none seen */
  int playing;
  uint32_t rate, format;
  double frac;                /* half-buffer progress, 0..1 */
  double phase;               /* resampler position in the current half, in guest frames */
  int16_t out[4096 * 2];
  int out_n;
} A;

static uint32_t real_lin(uint32_t far) { return ((far >> 16) << 4) + (far & 0xffff); }

static int sig_is(uint32_t hdr, const char *kind) {
  static const char base[] = "AIL3";
  for (int i = 0; i < 4; i++) if (M[hdr + i] != (uint8_t)base[i]) return 0;
  for (int i = 0; i < 3; i++) if (M[hdr + 4 + i] != (uint8_t)kind[i]) return 0;
  return 1;
}

static void describe(uint32_t hdr) {
  uint32_t ddt = hdr + DDT_OFF, dst = hdr + DST_OFF;
  rt_memset(M + ddt, 0, DST_OFF - DDT_OFF + 0x20);
  M[ddt + FMT_S16_STEREO] = 1;
  uint32_t rec = ddt + 0x10 + 14 * FMT_S16_STEREO;
  uint32_t rate = (uint32_t)host_audio_rate();
  if (rate < 8000 || rate > 48000) rate = 22050;
  WR16(rec + 0, 11025); WR16(rec + 2, 22050); WR16(rec + 4, rate > 22050 ? rate : 22050);
  WR16(rec + 6, 0x100); WR16(rec + 8, 0x2000);
  WR32(rec + 10, 1);
  WR16(dst + 8, 0xffff);
}

static void flush_out(void) {
  if (A.out_n) host_audio_write(A.out, A.out_n);
  A.out_n = 0;
}

/* Hand the half that just became active to the host, resampled to the host rate. */
static void emit_half(int half) {
  uint32_t dst = A.hdr + DST_OFF;
  uint32_t buf = real_lin(RD32(dst + (half ? 4 : 0)));
  uint32_t bytes = RD32(dst + 4) - RD32(dst);
  uint32_t frames = (bytes & 0xffff) / 4;
  if (!frames || buf + frames * 4 > M_size) return;
  double step = (double)A.rate / (double)host_audio_rate();
  for (; A.phase < frames; A.phase += step) {
    uint32_t i = (uint32_t)A.phase, j = i + 1 < frames ? i + 1 : i;
    double t = A.phase - i;
    for (int c = 0; c < 2; c++) {
      double a = (int16_t)RD16(buf + i * 4 + c * 2), b = (int16_t)RD16(buf + j * 4 + c * 2);
      A.out[A.out_n * 2 + c] = (int16_t)(a + (b - a) * t);
    }
    if (++A.out_n == 4096) flush_out();
  }
  A.phase -= frames;
  flush_out();
}

static void stop(void) {
  A.playing = 0;
  if (A.hdr) WR16(A.hdr + DST_OFF + 8, 0xffff);
}

void audio_advance(double ms) {
  if (!A.playing) return;
  uint32_t dst = A.hdr + DST_OFF;
  uint32_t frames = ((RD32(dst + 4) - RD32(dst)) & 0xffff) / 4;
  if (!frames) return;
  A.frac += ms * (double)A.rate / 1000.0 / (double)frames;
  int flips = 0;
  while (A.frac >= 1.0) {
    A.frac -= 1.0;
    int next = (int16_t)RD16(dst + 8) ^ 1;
    WR16(dst + 8, (uint32_t)next);
    emit_half(next);
    /* a long host stall: drop the backlog instead of replaying stale halves */
    if (++flips == 2) { A.frac = 0; break; }
  }
}

static void dig_call(RmRegs *r, uint32_t hdr) {
  uint32_t seg = hdr >> 4;
  switch (r->eax & 0xffff) {
  case 0x300:                                   /* DRV_INIT */
    A.hdr = hdr;
    describe(hdr);
    r->eax = 1;
    return;
  case 0x301:                                   /* DRV_GET_INFO: DDT in DX:AX, DST in CX:BX */
    r->eax = DDT_OFF; r->edx = seg;
    r->ebx = DST_OFF; r->ecx = seg;
    return;
  case 0x302: return;                           /* DRV_SERVE: nothing to service */
  case 0x303: r->eax = 0xffff; return;          /* DRV_PARSE_ENV: no environment variable */
  case 0x304: r->eax = 1; return;               /* DRV_VERIFY_IO: device present */
  case 0x305: return;                           /* DRV_INIT_DEV */
  case 0x306: stop(); return;                   /* DRV_SHUTDOWN_DEV */
  case 0x400: return;                           /* hardware volume */
  case 0x401:                                   /* DIG_START_P_CMD: CX = rate, DX = format */
    A.rate = r->ecx & 0xffff;
    A.format = r->edx & 0xffff;
    if (A.format != FMT_S16_STEREO || A.rate < 4000) { rt_logf("audio: unsupported format %u rate %u", A.format, A.rate); return; }
    A.playing = 1; A.frac = 0; A.phase = 0;
    WR16(hdr + DST_OFF + 8, 0);
    emit_half(0);
    return;
  case 0x402: stop(); return;                   /* DIG_STOP_P_REQ */
  default:
    if (RT.verbose) rt_logf("audio: DIG function %x ignored", r->eax & 0xffff);
    return;
  }
}

/* int 66h issued through DPMI 0300h.  The library points the real-mode vector at the loaded driver's
 * entry, so the driver header is at offset 0 of the vector's segment. */
void audio_int66(RmRegs *r) {
  uint32_t hdr = (RT.rm_vec[0x66] >> 16) << 4;
  if (hdr + DRIVER_MIN_SIZE <= M_size && sig_is(hdr, "DIG")) { dig_call(r, hdr); return; }
  /* music drivers: report no device so the library carries on without music */
  uint32_t fn = r->eax & 0xffff;
  if (fn == 0x301) { r->eax = r->ebx = r->ecx = r->edx = 0; return; }
  if (RT.verbose || fn == 0x300) rt_logf("audio: int 66h function %x for a non-digital driver; music is not emulated", fn);
  r->eax = 0;
}
