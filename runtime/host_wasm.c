/* WebAssembly entry points. Every host_* service in host.h stays undefined here and becomes an import
 * from module "env" at link time (tools/wasm/link.ts); the JavaScript side (src/port/) implements them on
 * top of the browser or Node. Independently authored; Apache-2.0. */
#include <stdint.h>
#include "host.h"
#include "rt.h"
#include "rt_int.h"

extern unsigned char __heap_base;
static uintptr_t brk_ptr;

/* Bump allocator over linear memory; nothing is ever freed (the guest owns its own 64 MB heap). */
void *moo2_alloc(uint32_t n) {
  if (!brk_ptr) brk_ptr = (uintptr_t)&__heap_base;
  uintptr_t p = (brk_ptr + 15) & ~(uintptr_t)15;
  uintptr_t end = p + n;
  uintptr_t have = (uintptr_t)__builtin_wasm_memory_size(0) << 16;
  if (end > have && __builtin_wasm_memory_grow(0, (end - have + 0xffff) >> 16) == (uintptr_t)-1) return 0;
  brk_ptr = end;
  return (void *)p;
}

/* flags: bit 0 real time (host clock) instead of virtual time, bit 1 verbose logging. */
void moo2_start(const uint8_t *image, uint32_t len, uint32_t entry, uint32_t esp, uint32_t mem_mb, int flags) {
  M_size = mem_mb << 20;
  M = moo2_alloc(M_size);
  if (!M) { host_log("moo2: cannot allocate guest memory"); host_exit(2); }
  rt_init(image, len, "");
  RT.entry = entry; RT.initial_esp = esp;
  RT.realtime = flags & 1; RT.verbose = (flags >> 1) & 1;
  rt_run();
}

/* Guest-visible time, so the host can keep virtual-time runs reproducible (local time, input scripts). */
double moo2_guest_ms(void) { return RT.now_ms; }
uint32_t moo2_frames(void) { return RT.frames; }

/* Log the guest registers and call stack (for a host that stops the run, e.g. at a time limit). */
void moo2_debug_dump(void) { rt_dump_regs(); rt_backtrace(); }

/* Scratch for the host to pass strings and buffers in. */
void *moo2_scratch(uint32_t n) {
  static uint8_t *buf;
  static uint32_t cap;
  if (n > cap) { buf = moo2_alloc(n); cap = buf ? n : 0; }
  return buf;
}
