/* Host platform interface for the MOO2 port runtime. Implemented natively (host_native.c) and for the
 * browser (host_wasm.c, backed by JavaScript imports). Independently authored; Apache-2.0. */
#pragma once
#include <stdint.h>

/* Files. Paths are DOS-style relative names with the drive/directory already stripped, upper-cased. */
enum { HOST_O_READ = 0, HOST_O_WRITE = 1, HOST_O_RDWR = 2, HOST_O_CREATE = 3 };
int host_open(const char *name, int mode);          /* handle >= 0 or -1 */
int host_read(int h, void *buf, uint32_t n);         /* bytes read or -1 */
int host_write(int h, const void *buf, uint32_t n);  /* bytes written or -1 */
int64_t host_seek(int h, int64_t off, int whence);   /* new position or -1 */
int host_close(int h);
int host_unlink(const char *name);
int host_rename(const char *from, const char *to);
/* Directory listing: writes "NAME\0size\0" pairs, returns bytes used (or required if larger than cap). */
uint32_t host_list(char *buf, uint32_t cap);

/* Time */
double host_now_ms(void);                            /* monotonic */
void host_local_time(int *y, int *mo, int *d, int *h, int *mi, int *s, int *cs);
void host_idle(double ms);                           /* the guest is waiting: sleep/yield up to ms */

/* Video: 8-bit indexed frame plus 256 x RGB (6-bit components as written by the guest) */
void host_present(const uint8_t *pixels, int width, int height, int pitch, const uint8_t *palette);

/* Input events pulled by the runtime */
typedef struct {
  int type;            /* 0 none, 1 key (scancode in code, bit 7 = release), 2 mouse */
  int code;
  int x, y, buttons;   /* mouse: absolute position in screen pixels, button bits */
} HostEvent;
int host_poll_event(HostEvent *ev);

/* Audio: interleaved signed 16-bit stereo at host_audio_rate() */
int host_audio_rate(void);
void host_audio_write(const int16_t *frames, int count);

void host_log(const char *msg);
void host_exit(int code) __attribute__((noreturn));
