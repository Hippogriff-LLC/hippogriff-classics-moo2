/* Unit test for runtime/audio.c (virtual Miles digital driver), driven the way the library in the game
 * drives a .DIG driver: install header, DRV_INIT, DRV_GET_INFO, VERIFY_IO, then double-buffered playback.
 * Prints "ok" and exits 0 on success.  Independently authored; Apache-2.0.
 *
 *   audio_test <host-rate> */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "host.h"
#include "rt.h"
#include "rt_int.h"

Runtime RT;
Cpu C;
uint8_t *M;
uint32_t M_size;
int32_t rt_budget;

static int host_rate;
static int16_t got[1 << 16];
static int got_n;

int host_audio_rate(void) { return host_rate; }
void host_audio_write(const int16_t *frames, int count) {
  if (got_n + count > (int)(sizeof got / 4)) { fprintf(stderr, "overflow\n"); exit(1); }
  memcpy(got + got_n * 2, frames, (size_t)count * 4);
  got_n += count;
}
void rt_memset(void *d, int v, uint32_t n) { memset(d, v, n); }
void rt_logf(const char *f, ...) { (void)f; }

#define CHECK(c) do { if (!(c)) { fprintf(stderr, "line %d: %s\n", __LINE__, #c); return 1; } } while (0)

static RmRegs call(uint32_t fn, uint32_t cx, uint32_t dx) {
  RmRegs r;
  memset(&r, 0, sizeof r);
  r.eax = fn; r.ecx = cx; r.edx = dx;
  audio_int66(&r);
  return r;
}

static void fill(uint32_t lin, int frames, int16_t l, int16_t r) {
  for (int i = 0; i < frames; i++) { WR16(lin + i * 4, (uint16_t)l); WR16(lin + i * 4 + 2, (uint16_t)r); }
}

int main(int argc, char **argv) {
  host_rate = argc > 1 ? atoi(argv[1]) : 22050;
  M_size = 1u << 20;
  M = calloc(1, M_size);
  const uint32_t seg = 0x9000, hdr = seg << 4;
  memcpy(M + hdr, "AIL3DIG\x1a", 8);
  RT.rm_vec[0x66] = seg << 16 | 0x16a;

  call(0x300, 0, 0);
  RmRegs r = call(0x301, 0, 0);
  uint32_t ddt = ((r.edx & 0xffff) << 4) + (r.eax & 0xffff), dst = ((r.ecx & 0xffff) << 4) + (r.ebx & 0xffff);
  CHECK(ddt >= hdr && ddt < hdr + 0x200 && dst >= hdr && dst < hdr + 0x200);
  CHECK(M[ddt] == 0 && M[ddt + 1] == 0 && M[ddt + 2] == 0 && M[ddt + 3] == 1);  /* 16-bit stereo only */
  uint32_t rec = ddt + 0x10 + 14 * 3;
  CHECK(RD16(rec) <= 22050 && RD16(rec + 2) == 22050 && RD16(rec + 4) >= 22050);
  CHECK(RD16(rec + 6) <= RD16(rec + 8) && RD32(rec + 10) == 1);
  CHECK((int16_t)RD16(dst + 8) == -1);
  CHECK((call(0x304, 0, 0).eax & 0xffff) != 0);

  /* the library's buffer setup: two 256-frame halves in DOS memory */
  const uint32_t buf = 0xa0000 - 0x1000, half = 256 * 4;
  WR32(dst, (buf >> 4) << 16);
  WR32(dst + 4, ((buf >> 4) << 16) + half);
  fill(buf, 256, 1000, -1000);
  fill(buf + half, 256, 2000, -2000);
  const int per_half = (int)(256.0 * host_rate / 22050 + 0.5);

  call(0x401, 22050, 3);
  CHECK((int16_t)RD16(dst + 8) == 0);
  CHECK(got_n == per_half && got[0] == 1000 && got[1] == -1000);
  double half_ms = 256 * 1000.0 / 22050;
  audio_advance(half_ms * 0.5);
  CHECK(got_n == per_half);
  audio_advance(half_ms * 0.5 + 0.001);
  CHECK((int16_t)RD16(dst + 8) == 1);
  CHECK(abs(got_n - 2 * per_half) <= 1 && got[per_half * 2 + 4] == 2000);
  /* the mixer refills the half that finished */
  fill(buf, 256, 3000, -3000);
  audio_advance(half_ms);
  CHECK((int16_t)RD16(dst + 8) == 0);
  CHECK(got[(got_n - 1) * 2] == 3000 && got[(got_n - 1) * 2 + 1] == -3000);
  int n = got_n;
  call(0x402, 0, 0);
  CHECK((int16_t)RD16(dst + 8) == -1);
  audio_advance(half_ms * 4);
  CHECK(got_n == n);

  /* a music driver is reported absent */
  memcpy(M + hdr, "AIL3MDI\x1a", 8);
  CHECK((call(0x304, 0, 0).eax & 0xffff) == 0);
  printf("ok %d frames\n", got_n);
  return 0;
}
