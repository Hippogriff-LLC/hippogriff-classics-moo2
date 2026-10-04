// wasmcc: a minimal C-to-WebAssembly-object compiler driver over the system's libclang-cpp 18.
//
// Some hosts ship the clang/LLVM shared libraries without the clang executable or any headers. This shim
// calls the handful of exported entry points that the clang executable itself uses, so it needs neither:
//   createInvocation(args)  ->  CompilerInstance::setInvocation  ->  createDiagnostics
//   ->  ExecuteCompilerInvocation
// Arguments are ordinary clang driver arguments; only `-c in.c -o out.o` is meaningful because there is no
// wasm-ld here (see link.ts for the linker). createInvocation is the tooling entry point and always adds
// -fsyntax-only, so the object-emission action and output file are forwarded to cc1 with -Xclang, where
// the last action given wins.
//
// Build:   g++ -O1 -o wasmcc tools/wasm/wasmcc.cpp -L/usr/lib/llvm-18/lib -l:libclang-cpp.so.18.1
//              -l:libLLVM.so.18.1 -Wl,-rpath,/usr/lib/llvm-18/lib
// Independently authored; Apache-2.0. Relies on the Itanium C++ ABI of the libclang-cpp 18 build.

#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

namespace clang {
class CompilerInstance;
class CompilerInvocation;
class PCHContainerOperations;
class InMemoryModuleCache;
class DiagnosticConsumer;
}

// clang::CreateInvocationOptions (clang 18): {IntrusiveRefCntPtr<DiagnosticsEngine> Diags;
// IntrusiveRefCntPtr<vfs::FileSystem> VFS; bool RecoverOnError; bool ProbePrecompiled;
// std::vector<std::string> *CC1Args}. All-null means "make your own diagnostics, real file system".
// The non-trivial destructor makes it pass by invisible reference, like the real type.
struct CreateInvocationOptions {
  void *diags = nullptr, *vfs = nullptr;
  bool recover_on_error = false, probe_precompiled = false;
  void *cc1_args = nullptr;
  ~CreateInvocationOptions() {}
};
struct ArgList { const char *const *data; std::size_t size; };

extern "C" {
// std::unique_ptr<CompilerInvocation> createInvocation(ArrayRef<const char*>, CreateInvocationOptions)
void createInvocation_(void **ret, ArgList args, CreateInvocationOptions *opts)
    __asm__("_ZN5clang16createInvocationEN4llvm8ArrayRefIPKcEENS_23CreateInvocationOptionsE");
void PCHContainerOperations_ctor(void *self) __asm__("_ZN5clang22PCHContainerOperationsC1Ev");
void CompilerInstance_ctor(void *self, std::shared_ptr<clang::PCHContainerOperations> *ops, clang::InMemoryModuleCache *)
    __asm__("_ZN5clang16CompilerInstanceC1ESt10shared_ptrINS_22PCHContainerOperationsEEPNS_19InMemoryModuleCacheE");
void CompilerInstance_setInvocation(void *self, std::shared_ptr<clang::CompilerInvocation> *inv)
    __asm__("_ZN5clang16CompilerInstance13setInvocationESt10shared_ptrINS_18CompilerInvocationEE");
void CompilerInstance_createDiagnostics(void *self, clang::DiagnosticConsumer *client, bool own)
    __asm__("_ZN5clang16CompilerInstance17createDiagnosticsEPNS_18DiagnosticConsumerEb");
bool ExecuteCompilerInvocation_(void *self) __asm__("_ZN5clang25ExecuteCompilerInvocationEPNS_16CompilerInstanceE");
void LLVMInitializeWebAssemblyTargetInfo(void);
void LLVMInitializeWebAssemblyTarget(void);
void LLVMInitializeWebAssemblyTargetMC(void);
void LLVMInitializeWebAssemblyAsmPrinter(void);
void LLVMInitializeWebAssemblyAsmParser(void);
}

int main(int argc, char **argv) {
  if (argc < 2) {
    std::fprintf(stderr, "usage: wasmcc --target=wasm32-unknown-unknown [clang args] -c in.c -o out.o\n");
    return 2;
  }
  LLVMInitializeWebAssemblyTargetInfo();
  LLVMInitializeWebAssemblyTarget();
  LLVMInitializeWebAssemblyTargetMC();
  LLVMInitializeWebAssemblyAsmPrinter();
  LLVMInitializeWebAssemblyAsmParser();

  // createInvocation expects argv[0] to be the driver name.
  std::vector<const char *> args{"clang"};
  const char *out = nullptr;
  for (int i = 1; i < argc; i++) {
    if (!std::strcmp(argv[i], "-o") && i + 1 < argc) out = argv[++i];
    else args.push_back(argv[i]);
  }
  if (!out) {
    std::fprintf(stderr, "wasmcc: -o <output> is required\n");
    return 2;
  }
  for (const char *a : {"-Xclang", "-emit-obj", "-Xclang", "-o", "-Xclang", out}) args.push_back(a);
  CreateInvocationOptions opts;
  std::vector<std::string> cc1;
  opts.cc1_args = &cc1;
  void *inv = nullptr;
  createInvocation_(&inv, ArgList{args.data(), args.size()}, &opts);
  if (!inv) {
    std::fprintf(stderr, "wasmcc: could not build a compiler invocation\n");
    return 1;
  }
  if (std::getenv("WASMCC_VERBOSE")) {
    for (auto &a : cc1) std::fprintf(stderr, "%s ", a.c_str());
    std::fprintf(stderr, "\n");
  }
  // Objects of unknown size: generous zeroed storage, never destroyed (the process exits right after).
  void *ops_mem = std::calloc(1, 1 << 16);
  PCHContainerOperations_ctor(ops_mem);
  std::shared_ptr<clang::PCHContainerOperations> ops(static_cast<clang::PCHContainerOperations *>(ops_mem),
                                                     [](clang::PCHContainerOperations *) {});
  void *ci = std::calloc(1, 1 << 20);
  CompilerInstance_ctor(ci, &ops, nullptr);
  std::shared_ptr<clang::CompilerInvocation> sinv(static_cast<clang::CompilerInvocation *>(inv),
                                                  [](clang::CompilerInvocation *) {});
  CompilerInstance_setInvocation(ci, &sinv);
  CompilerInstance_createDiagnostics(ci, nullptr, true);
  bool ok = ExecuteCompilerInvocation_(ci);
  std::fflush(stderr);
  std::_Exit(ok ? 0 : 1);
}
