/* The few C library routines the runtime and generated code reach in a freestanding wasm32 build
 * (compiled with -fno-builtin so the loops are not turned back into calls to themselves).
 * Independently authored; Apache-2.0. */
#include <stddef.h>
#include <stdint.h>

void *memcpy(void *d, const void *s, size_t n) {
  uint8_t *dp = d;
  const uint8_t *sp = s;
  while (n--) *dp++ = *sp++;
  return d;
}
void *memmove(void *d, const void *s, size_t n) {
  uint8_t *dp = d;
  const uint8_t *sp = s;
  if (dp < sp) while (n--) *dp++ = *sp++;
  else { dp += n; sp += n; while (n--) *--dp = *--sp; }
  return d;
}
void *memset(void *d, int c, size_t n) {
  uint8_t *dp = d;
  while (n--) *dp++ = (uint8_t)c;
  return d;
}
int memcmp(const void *a, const void *b, size_t n) {
  const uint8_t *x = a, *y = b;
  for (; n--; x++, y++) if (*x != *y) return *x - *y;
  return 0;
}
size_t strlen(const char *s) {
  size_t n = 0;
  while (s[n]) n++;
  return n;
}
int strcmp(const char *a, const char *b) {
  while (*a && *a == *b) a++, b++;
  return (uint8_t)*a - (uint8_t)*b;
}
/* Only used by the x87 model for round-half-even parity tests on integral values, where this is exact. */
double fmod(double x, double y) { return x - __builtin_trunc(x / y) * y; }
