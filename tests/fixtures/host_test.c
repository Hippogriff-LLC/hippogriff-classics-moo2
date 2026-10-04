/* Minimal host for tests/recomp.test.ts: runs a recompiled synthetic program with no files, display or
 * input, prints guest log lines to stdout and, on exit, the first 64 bytes of guest memory at the
 * address given on the command line.  Independently authored; Apache-2.0.
 *
 *   host_test <build-dir> <dump-addr-hex> */
#include <stdio.h>
#include <stdlib.h>
#include "host.h"
#include "rt.h"
#include "rt_int.h"

static uint32_t dump_addr;

int host_open(const char *name, int mode) { (void)name; (void)mode; return -1; }
int host_read(int h, void *buf, uint32_t n) { (void)h; (void)buf; (void)n; return -1; }
int host_write(int h, const void *buf, uint32_t n) { (void)h; (void)buf; (void)n; return -1; }
int64_t host_seek(int h, int64_t off, int whence) { (void)h; (void)off; (void)whence; return -1; }
int host_close(int h) { (void)h; return -1; }
int host_unlink(const char *name) { (void)name; return -1; }
int host_rename(const char *from, const char *to) { (void)from; (void)to; return -1; }
uint32_t host_list(char *buf, uint32_t cap) { (void)buf; (void)cap; return 0; }
double host_now_ms(void) { return 0; }
void host_local_time(int *y, int *mo, int *d, int *h, int *mi, int *s, int *cs) {
  *y = 1996; *mo = 10; *d = 1; *h = *mi = *s = *cs = 0;
}
void host_idle(double ms) { (void)ms; }
void host_present(const uint8_t *pixels, int width, int height, int pitch, const uint8_t *palette) {
  (void)pixels; (void)width; (void)height; (void)pitch; (void)palette;
}
int host_poll_event(HostEvent *ev) { ev->type = 0; return 0; }
int host_audio_rate(void) { return 44100; }
void host_audio_write(const int16_t *frames, int count) { (void)frames; (void)count; }
void host_log(const char *msg) { printf("log %s\n", msg); }
void host_exit(int code) {
  printf("mem");
  for (uint32_t i = 0; i < 64; i += 4) printf(" %08x", RD32(dump_addr + i));
  printf("\nexit %d\n", code);
  fflush(stdout);
  exit(code);
}

static uint8_t *read_all(const char *path, uint32_t *len) {
  FILE *f = fopen(path, "rb");
  if (!f) { perror(path); exit(2); }
  fseek(f, 0, SEEK_END);
  long n = ftell(f);
  fseek(f, 0, SEEK_SET);
  uint8_t *b = malloc((size_t)n);
  if (fread(b, 1, (size_t)n, f) != (size_t)n) { perror(path); exit(2); }
  fclose(f);
  *len = (uint32_t)n;
  return b;
}

int main(int argc, char **argv) {
  if (argc != 3) { fprintf(stderr, "usage: host_test <build-dir> <dump-addr-hex>\n"); return 2; }
  char p[1024];
  uint32_t len;
  dump_addr = (uint32_t)strtoul(argv[2], 0, 16);
  snprintf(p, sizeof p, "%s/image.bin", argv[1]);
  uint8_t *image = read_all(p, &len);
  snprintf(p, sizeof p, "%s/entry.txt", argv[1]);
  FILE *f = fopen(p, "r");
  unsigned entry = 0, esp = 0;
  if (!f || fscanf(f, "%x %x", &entry, &esp) != 2) { fprintf(stderr, "bad %s\n", p); return 2; }
  fclose(f);
  M_size = 64u << 20;
  M = calloc(1, M_size);
  rt_init(image, len, "");
  RT.entry = entry; RT.initial_esp = esp;
  rt_run();
  return 0;
}
