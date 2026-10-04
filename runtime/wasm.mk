# WebAssembly build of the recompiled program plus this runtime.
#
#   make -f runtime/wasm.mk BUILD=<private-build-dir> OUT=<private-output-dir> -j3
#
# BUILD is the directory written by tools/re/recompile.ts (gen/, image.bin, entry.txt). The generated C is
# derived from the user's own executable, so BUILD and OUT must both live outside the repository.
# Produces $(OUT)/moo2.wasm, whose host services are imports from module "env" (see runtime/host.h and
# src/port/). Compiles with tools/wasm/wasmcc (built here from the system libclang-cpp 18) and links with
# tools/wasm/link.ts, so neither a clang executable nor wasm-ld is required. Set WASMCC to use another
# compiler driver that accepts clang arguments (for example a real clang).

RT_DIR := $(patsubst %/,%,$(dir $(lastword $(MAKEFILE_LIST))))
ROOT := $(patsubst %/,%,$(dir $(RT_DIR)))
ifeq ($(ROOT),)
ROOT := .
endif
ifndef BUILD
$(error set BUILD=<private-build-dir>)
endif
ifndef OUT
$(error set OUT=<private-output-dir>)
endif
GEN_DIR := $(BUILD)/gen
LLVM_LIB ?= /usr/lib/llvm-18/lib
WASMCC ?= $(OUT)/wasmcc
NODE ?= node
STACK ?= 8388608

TARGET_FLAGS := --target=wasm32-unknown-unknown -mbulk-memory -ffreestanding -fno-builtin -nostdlibinc \
  -I$(ROOT)/tools/wasm/include -I$(RT_DIR) -I$(GEN_DIR)
GEN_CFLAGS := $(TARGET_FLAGS) -O1 -w -fno-strict-aliasing
RT_CFLAGS := $(TARGET_FLAGS) -O1 -Wall -Wextra -Wno-unused-parameter -fno-strict-aliasing
EXPORTS := moo2_start moo2_alloc moo2_scratch moo2_guest_ms moo2_frames moo2_debug_dump

GEN_OBJ := $(patsubst $(GEN_DIR)/%.c,$(OUT)/gen/%.o,$(wildcard $(GEN_DIR)/*.c))
RT_OBJ := $(addprefix $(OUT)/,rt.o dos.o pc.o host_wasm.o libc_wasm.o)

$(OUT)/moo2.wasm: $(GEN_OBJ) $(RT_OBJ) $(ROOT)/tools/wasm/link.ts $(lastword $(MAKEFILE_LIST))
	$(NODE) $(ROOT)/tools/wasm/link.ts -o $@ --stack $(STACK) $(addprefix --export ,$(EXPORTS)) $(GEN_OBJ) $(RT_OBJ)

$(OUT)/gen/%.o: $(GEN_DIR)/%.c $(GEN_DIR)/funcs.h $(RT_DIR)/rt.h | $(WASMCC) $(OUT)/gen
	$(WASMCC) $(GEN_CFLAGS) -c $< -o $@

$(OUT)/%.o: $(RT_DIR)/%.c $(RT_DIR)/rt.h $(RT_DIR)/rt_int.h $(RT_DIR)/host.h | $(WASMCC) $(OUT)
	$(WASMCC) $(RT_CFLAGS) -c $< -o $@

$(OUT)/wasmcc: $(ROOT)/tools/wasm/wasmcc.cpp | $(OUT)
	$(CXX) -O1 -Wall -o $@ $< -L$(LLVM_LIB) -l:libclang-cpp.so.18.1 -l:libLLVM.so.18.1 -Wl,-rpath,$(LLVM_LIB)

$(OUT) $(OUT)/gen:
	mkdir -p $@
