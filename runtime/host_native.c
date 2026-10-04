/* Native (POSIX) host for development and headless verification of the recompiled program.
 *
 *   moo2-native <build-dir> <game-dir> <save-dir> <frame-dir> [options]
 *     --ms N          stop after N ms of guest time (default 60000)
 *     --every N       write every Nth presented frame as PPM (default 0: only the last frame)
 *     --script FILE   timed input: lines "<ms> key <scancode-hex>" | "<ms> mouse <x> <y> <buttons>"
 *     --realtime      use the host clock instead of deterministic virtual time
 *     --verbose       log service calls
 *     --trace-int     log every software interrupt
 *
 * The game directory is opened read-only; files the game creates or modifies go to the save directory,
 * which shadows the game directory. Independently authored; Apache-2.0. */
#define _GNU_SOURCE
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#include "host.h"
#include "rt.h"
#include "rt_int.h"

static const char *game_dir, *save_dir, *frame_dir;
static double limit_ms = 60000;
static int every;
static long presented;
static uint8_t last_frame[800 * 600];
static uint8_t last_pal[768];
static int last_w, last_h;

/* ------------------------------------------------------------------ files */
static int find_in(const char *dir, const char *name, char *out, size_t cap) {
  DIR *d = opendir(dir);
  if (!d) return 0;
  struct dirent *e;
  int found = 0;
  while ((e = readdir(d))) {
    if (!strcasecmp(e->d_name, name)) {
      snprintf(out, cap, "%s/%s", dir, e->d_name);
      found = 1;
      break;
    }
  }
  closedir(d);
  return found;
}

static int copy_file(const char *from, const char *to) {
  int a = open(from, O_RDONLY), b = open(to, O_WRONLY | O_CREAT | O_TRUNC, 0644);
  if (a < 0 || b < 0) { if (a >= 0) close(a); if (b >= 0) close(b); return -1; }
  char buf[65536];
  ssize_t n;
  while ((n = read(a, buf, sizeof buf)) > 0) if (write(b, buf, (size_t)n) != n) { n = -1; break; }
  close(a); close(b);
  return n < 0 ? -1 : 0;
}

int host_open(const char *name, int mode) {
  char p[1024], g[1024];
  int in_save = find_in(save_dir, name, p, sizeof p);
  if (mode == HOST_O_CREATE) {
    if (!in_save) snprintf(p, sizeof p, "%s/%s", save_dir, name);
    return open(p, O_RDWR | O_CREAT | O_TRUNC, 0644);
  }
  if (!in_save) {
    if (!find_in(game_dir, name, g, sizeof g)) return -1;
    if (mode == HOST_O_READ) return open(g, O_RDONLY);
    snprintf(p, sizeof p, "%s/%s", save_dir, name);
    if (copy_file(g, p) < 0) return -1;
  }
  return open(p, mode == HOST_O_READ ? O_RDONLY : mode == HOST_O_WRITE ? O_WRONLY : O_RDWR);
}
int host_read(int h, void *buf, uint32_t n) { return (int)read(h, buf, n); }
int host_write(int h, const void *buf, uint32_t n) { return (int)write(h, buf, n); }
int64_t host_seek(int h, int64_t off, int whence) { return lseek(h, off, whence); }
int host_close(int h) { return close(h); }
int host_unlink(const char *name) {
  char p[1024];
  if (!find_in(save_dir, name, p, sizeof p)) return -1;
  return unlink(p);
}
int host_rename(const char *from, const char *to) {
  char p[1024], q[1024];
  if (!find_in(save_dir, from, p, sizeof p)) {
    char g[1024];
    if (!find_in(game_dir, from, g, sizeof g)) return -1;
    snprintf(p, sizeof p, "%s/%s", save_dir, from);
    if (copy_file(g, p) < 0) return -1;
  }
  snprintf(q, sizeof q, "%s/%s", save_dir, to);
  return rename(p, q);
}

static uint32_t list_dir(const char *dir, char *buf, uint32_t cap, uint32_t used, const char *skip_dir) {
  DIR *d = opendir(dir);
  if (!d) return used;
  struct dirent *e;
  while ((e = readdir(d))) {
    if (e->d_name[0] == '.') continue;
    char p[1024];
    if (skip_dir && find_in(skip_dir, e->d_name, p, sizeof p)) continue;
    snprintf(p, sizeof p, "%s/%s", dir, e->d_name);
    struct stat st;
    if (stat(p, &st) || !S_ISREG(st.st_mode)) continue;
    char sz[24];
    int sl = snprintf(sz, sizeof sz, "%lld", (long long)st.st_size);
    uint32_t nl = (uint32_t)strlen(e->d_name);
    if (used + nl + 1 + (uint32_t)sl + 1 <= cap) {
      memcpy(buf + used, e->d_name, nl + 1);
      memcpy(buf + used + nl + 1, sz, (size_t)sl + 1);
    }
    used += nl + 1 + (uint32_t)sl + 1;
  }
  closedir(d);
  return used;
}
uint32_t host_list(char *buf, uint32_t cap) {
  uint32_t used = list_dir(save_dir, buf, cap, 0, 0);
  return list_dir(game_dir, buf, cap, used, save_dir);
}

/* ------------------------------------------------------------------ time */
double host_now_ms(void) {
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return (double)ts.tv_sec * 1000.0 + (double)ts.tv_nsec / 1e6;
}
void host_local_time(int *y, int *mo, int *d, int *h, int *mi, int *s, int *cs) {
  /* fixed in virtual mode so runs are reproducible */
  struct timespec now;
  clock_gettime(CLOCK_REALTIME, &now);
  time_t t = RT.realtime ? now.tv_sec : (time_t)(1000000000 + (long)(RT.now_ms / 1000));
  struct tm tm;
  localtime_r(&t, &tm);
  *y = tm.tm_year + 1900; *mo = tm.tm_mon + 1; *d = tm.tm_mday;
  *h = tm.tm_hour; *mi = tm.tm_min; *s = tm.tm_sec;
  *cs = RT.realtime ? (int)(now.tv_nsec / 10000000) : (int)((long)RT.now_ms % 1000 / 10);
}
void host_idle(double ms) {
  if (RT.realtime) usleep((useconds_t)(ms * 1000));
}

/* ------------------------------------------------------------------ video */
static void write_ppm(const char *path, const uint8_t *px, int w, int h, const uint8_t *pal) {
  FILE *f = fopen(path, "wb");
  if (!f) return;
  fprintf(f, "P6\n%d %d\n255\n", w, h);
  uint8_t *row = malloc((size_t)w * 3);
  for (int y = 0; y < h; y++) {
    for (int x = 0; x < w; x++) {
      const uint8_t *c = pal + px[y * w + x] * 3;
      row[x * 3] = (uint8_t)(c[0] << 2 | c[0] >> 4);
      row[x * 3 + 1] = (uint8_t)(c[1] << 2 | c[1] >> 4);
      row[x * 3 + 2] = (uint8_t)(c[2] << 2 | c[2] >> 4);
    }
    fwrite(row, 1, (size_t)w * 3, f);
  }
  free(row);
  fclose(f);
}

void host_present(const uint8_t *pixels, int w, int h, int pitch, const uint8_t *palette) {
  if (w * h > (int)sizeof last_frame) return;
  for (int y = 0; y < h; y++) memcpy(last_frame + y * w, pixels + y * pitch, (size_t)w);
  memcpy(last_pal, palette, 768);
  last_w = w; last_h = h;
  presented++;
  if (every && presented % every == 0) {
    char p[1024];
    snprintf(p, sizeof p, "%s/frame-%06ld-%08.0fms.ppm", frame_dir, presented, RT.now_ms);
    write_ppm(p, last_frame, w, h, last_pal);
  }
}

/* ------------------------------------------------------------------ input script */
typedef struct { double t; int type, a, b, c; } ScriptEv;
static ScriptEv *script;
static int script_n, script_pos;

static void load_script(const char *path) {
  FILE *f = fopen(path, "r");
  if (!f) { fprintf(stderr, "cannot open script %s\n", path); exit(2); }
  char line[256];
  int cap = 0;
  while (fgets(line, sizeof line, f)) {
    double t; char kind[16]; int a = 0, b = 0, c = 0;
    if (line[0] == '#' || sscanf(line, "%lf %15s", &t, kind) != 2) continue;
    ScriptEv ev = {t, 0, 0, 0, 0};
    if (!strcmp(kind, "key") && sscanf(line, "%*f %*s %x", &a) == 1) ev.type = 1, ev.a = a;
    else if (!strcmp(kind, "mouse") && sscanf(line, "%*f %*s %d %d %d", &a, &b, &c) == 3) ev.type = 2, ev.a = a, ev.b = b, ev.c = c;
    else continue;
    if (script_n == cap) { cap = cap ? cap * 2 : 64; script = realloc(script, sizeof *script * (size_t)cap); }
    script[script_n++] = ev;
  }
  fclose(f);
}

__attribute__((noreturn)) static void finish(int code) {
  char p[1024];
  if (last_w) {
    snprintf(p, sizeof p, "%s/last.ppm", frame_dir);
    write_ppm(p, last_frame, last_w, last_h, last_pal);
  }
  fprintf(stderr, "[host] exit %d at guest %.0f ms, %ld frames presented, %llu polls\n", code, RT.now_ms, presented,
          (unsigned long long)RT.polls);
  exit(code);
}

int host_poll_event(HostEvent *ev) {
  if (RT.now_ms >= limit_ms) {
    if (RT.verbose) { rt_logf("time limit reached; guest stack:"); rt_dump_regs(); rt_backtrace(); }
    finish(0);
  }
  if (script_pos < script_n && script[script_pos].t <= RT.now_ms) {
    ScriptEv *s = &script[script_pos++];
    ev->type = s->type; ev->code = s->a; ev->x = s->a; ev->y = s->b; ev->buttons = s->c;
    return 1;
  }
  return 0;
}

int host_audio_rate(void) { return 22050; }
void host_audio_write(const int16_t *frames, int count) { (void)frames; (void)count; }
void host_log(const char *msg) { fprintf(stderr, "%s\n", msg); }
void host_exit(int code) { finish(code); }

/* ------------------------------------------------------------------ main */
static uint8_t *read_all(const char *path, uint32_t *len) {
  FILE *f = fopen(path, "rb");
  if (!f) { fprintf(stderr, "cannot open %s: %s\n", path, strerror(errno)); exit(2); }
  fseek(f, 0, SEEK_END);
  long n = ftell(f);
  fseek(f, 0, SEEK_SET);
  uint8_t *b = malloc((size_t)n);
  if (fread(b, 1, (size_t)n, f) != (size_t)n) { fprintf(stderr, "short read %s\n", path); exit(2); }
  fclose(f);
  *len = (uint32_t)n;
  return b;
}

int main(int argc, char **argv) {
  if (argc < 5) {
    fprintf(stderr, "usage: %s <build-dir> <game-dir> <save-dir> <frame-dir> [--ms N] [--every N] [--script F] "
                    "[--realtime] [--verbose] [--trace-int]\n", argv[0]);
    return 2;
  }
  const char *build = argv[1];
  game_dir = argv[2]; save_dir = argv[3]; frame_dir = argv[4];
  int realtime = 0, verbose = 0, trace_int = 0;
  for (int i = 5; i < argc; i++) {
    if (!strcmp(argv[i], "--ms") && i + 1 < argc) limit_ms = atof(argv[++i]);
    else if (!strcmp(argv[i], "--every") && i + 1 < argc) every = atoi(argv[++i]);
    else if (!strcmp(argv[i], "--script") && i + 1 < argc) load_script(argv[++i]);
    else if (!strcmp(argv[i], "--realtime")) realtime = 1;
    else if (!strcmp(argv[i], "--verbose")) verbose = 1;
    else if (!strcmp(argv[i], "--trace-int")) trace_int = 1;
    else { fprintf(stderr, "unknown option %s\n", argv[i]); return 2; }
  }
  char p[1024];
  uint32_t len;
  snprintf(p, sizeof p, "%s/image.bin", build);
  uint8_t *image = read_all(p, &len);
  snprintf(p, sizeof p, "%s/entry.txt", build);
  FILE *f = fopen(p, "r");
  unsigned entry = 0, esp = 0;
  if (!f || fscanf(f, "%x %x", &entry, &esp) != 2) { fprintf(stderr, "bad %s\n", p); return 2; }
  fclose(f);

  M_size = 64u << 20;
  M = calloc(1, M_size);
  rt_init(image, len, "");
  RT.entry = entry; RT.initial_esp = esp;
  RT.realtime = realtime; RT.verbose = verbose; RT.trace_int = (uint32_t)trace_int;
  rt_run();
  return 0;
}
