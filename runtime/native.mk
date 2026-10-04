# Native (host) build of the recompiled program plus this runtime.
#
#   make -f runtime/native.mk BUILD=<private-build-dir> OUT=<private-output-dir> -j3
#
# BUILD is the directory written by tools/re/recompile.ts (gen/, image.bin, entry.txt). The generated C is
# derived from the user's own executable, so BUILD and OUT must both live outside the repository.
# Produces $(OUT)/moo2-native; see runtime/host_native.c for its command line.

RT_DIR := $(patsubst %/,%,$(dir $(lastword $(MAKEFILE_LIST))))
ifndef BUILD
$(error set BUILD=<private-build-dir>)
endif
ifndef OUT
$(error set OUT=<private-output-dir>)
endif
GEN_DIR := $(BUILD)/gen
CC ?= gcc
GEN_CFLAGS := -O1 -g0 -w -fno-strict-aliasing -I$(RT_DIR) -I$(GEN_DIR)
RT_CFLAGS := -O1 -g -Wall -Wextra -Wno-unused-parameter -fno-strict-aliasing -I$(RT_DIR) -I$(GEN_DIR)

GEN_OBJ := $(patsubst $(GEN_DIR)/%.c,$(OUT)/%.o,$(wildcard $(GEN_DIR)/*.c))
RT_OBJ := $(addprefix $(OUT)/,rt.o dos.o pc.o audio.o host_native.o)

$(OUT)/moo2-native: $(GEN_OBJ) $(RT_OBJ)
	$(CC) -o $@ $^ -lm

$(OUT)/%.o: $(GEN_DIR)/%.c $(GEN_DIR)/funcs.h $(RT_DIR)/rt.h | $(OUT)
	$(CC) $(GEN_CFLAGS) -c $< -o $@

$(OUT)/%.o: $(RT_DIR)/%.c $(RT_DIR)/rt.h $(RT_DIR)/rt_int.h $(RT_DIR)/host.h | $(OUT)
	$(CC) $(RT_CFLAGS) -c $< -o $@

$(OUT):
	mkdir -p $@
