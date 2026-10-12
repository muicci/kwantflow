# LiteRT-LM native source and notice evidence

## Exact inputs

`third-party/native-source-manifest.json` pins the original LiteRT-LM v0.16.0
archive at commit `924e79c91542761242244e4f1651851f822e4cbb`, LiteRT at
`0ff28117f1cb5556d0e015bf80b773f74e2bee51`, and TensorFlow at
`9e1afa4e5cfd8818518183211b77f2976c7dc450`. The dependency archives are included
under `third-party/sources/native/`. The LiteRT-LM source archive omits exactly
45 unused opaque files from `prebuilt/`, keeping all source, BUILD files and
model test fixtures. Its raw upstream digest, exact omitted file inventory and
deterministic output digest are retained. The configured CPU target has no
`cc_import` dependencies. Rebuilding after deleting these exact prebuilt files
succeeded and produced the same artifact SHA-256 that passed real GREEDY text,
tool and vision smoke. See `litert-native/source-transform-verification.json`
and `litert-native/omitted-prebuilts.json`.

Each archived license/notice is copied unchanged and records its archive member
and SHA-256. Cargo source archives are the complete pinned Cargo.lock and
cxxbridge_cmd/Cargo.lock registry-source superset, including build, test and
other-platform crates. They are not a claim that every crate is linked into every
release binary. Two crate archives omitted license text; their root notices were
retrieved at the exact `.cargo_vcs_info.json` commits and are recorded separately.

Google's authentic `THIRD_PARTY_NOTICES.txt` and `CLiteRTLM.spdx.json` release
assets are included under `third-party/licenses/native/litert-dependencies/`.
All 141 extracted third-party license texts are preserved. The notice identifies
Apple frameworks/binaries, so it does not establish Windows DLL membership. SPDX
summary license labels conflict with some extracted original texts, including
Dawn, Eigen and Boost. Preserve the original text rather than replacing it with
a generic license selected from the summary label. The SPDX package entries do
not supply source revisions for most packages.

## Public CPU source build candidate

The included source replacement implements the pinned Gemma provider C ABI with
public SentencePiece and LLGuidance 1.3.0 code. It uses the release's existing FC
and Python tool grammar generators, preserves options and constrained decoding,
and supplies normalized SentencePiece token bytes to LLGuidance. The GREEDY
patch maps the CPU sampler to the existing exact top-logit selection path and
retains that selection through session configuration updates. The provider
implementation replaces the upstream disabled CMake stub.

In a clean local directory, extract the included LiteRT-LM archive, then apply
only these source changes. Replace `<app-source>` with this source checkout:

```sh
tar -xzf <app-source>/third-party/sources/native/LiteRT-LM-924e79c91542761242244e4f1651851f822e4cbb-source-only.tar.gz
cd LiteRT-LM-924e79c91542761242244e4f1651851f822e4cbb
patch -p1 < <app-source>/third-party/recipes/litert-native/open-gemma-provider.patch
patch -p1 < <app-source>/third-party/recipes/litert-native/open-cpu-c-api.patch
patch -p1 < <app-source>/third-party/recipes/litert-native/open-cpu-greedy.patch
patch -p1 < <app-source>/third-party/recipes/litert-native/open-rust-security.patch
cp <app-source>/third-party/recipes/litert-native/gemma-llguidance-provider.cc runtime/components/logits_processor/constrained_decoding/
cp <app-source>/third-party/recipes/litert-native/gemma-llguidance-provider-test.cc runtime/components/logits_processor/constrained_decoding/
```

Use the upstream-pinned Bazel 7.6.1. Official platform executable URLs and
checksums are recorded in `native-source-manifest.json` under `buildTools`.
The macOS arm64 candidate commands are:

```sh
bazelisk test --config=macos_arm64 --deleted_packages=swift \
  --@litert//litert/build_common:build_include=cpu_only \
  //runtime/components:prompt_template_test \
  //runtime/components/logits_processor/constrained_decoding:gemma_llguidance_provider_test \
  //runtime/components:sampler_factory_test
bazelisk build --config=macos_arm64 --deleted_packages=swift \
  --@litert//litert/build_common:build_include=cpu_only \
  //c:litert_lm_c_open_cpu
```

For an isolated macOS smoke, copy `bazel-bin/c/liblitert_lm_c_open_cpu.dylib`
to a writable test directory as `liblitert_lm_c.dylib`, set its install ID to
`@rpath/liblitert_lm_c.dylib` with `install_name_tool`, and ad-hoc sign that copy.
Keep the raw build artifact intact. Compile the retained harness with C++20,
this extracted source directory as an include path, the test directory as a
library search path and rpath, and `-llitert_lm_c`. Run the harness with the
hash-verified model path, the included `red-square.png` path and a separate
cache directory. Create that writable cache directory before running the harness;
XNNPACK cannot create its cache file if the parent directory does not exist.
Production/native runtime bundles require their own platform,
architecture, signing and installed-app checks.

The Windows command substitutes `--config=windows`, which enables monolithic
linking and requires AVX2 in the upstream configuration. Its native compilation,
DLL exports, import-library module identity and installed-app inference must be
verified on Windows. The normalized DLL must be paired with an import library
whose module name is `litert_lm_c.dll`, matching the app link contract. The macOS
arm64 library is not a universal macOS artifact. Build x86_64 separately with
`--config=macos --cpu=darwin_x86_64` and the appropriate Apple platform toolchain,
then verify both architectures before forming a universal library. No architecture
or platform is considered verified merely because this recipe lists it.

The source-built CPU target deliberately excludes static GPU accelerator/sampler
imports. App integration must select a CPU device and retain an accurate hardware
capability contract. Do not replace a GPU-capable release with this library while
claiming GPU functionality. The current approved release XCFramework is not
reproduced by this source route.

Bazel can use the included archives as a `--distdir` after placing an archive
under the basename of a declared upstream URL. Repository SHA-256 pins remain the
integrity check. Bazel also fetches build rules, toolchains and generated build
inputs. A complete offline build requires the corresponding Bazel repository
cache and platform tools; the source archive collection is not a complete offline
build cache. Keep configured dependency and build receipts for the actual release
rather than treating an unconfigured `query deps(...)` superset as a binary SBOM.

## Native Rust security patch, 10 October 2026

The fourth patch updates the source candidate's complete Rust/Bazel dependency
graph without changing the pinned LiteRT-LM, LiteRT or TensorFlow revisions or
the application runtime bundle. It updates `crossbeam-epoch` to 0.9.20, `anyhow`
to 1.0.103 and `rand` to 0.8.6. The CXX runtime, flags, macro, build package and
separately built `cxxbridge-cmd` generator use matching 1.0.195 pins. Both Cargo
locks, the generated Bazel lock and the generator's new `indexmap` build
dependency move together. CXX 1.0.195's declared Rust minimum is 1.85; this
recipe's rules_rust 0.61.0 uses Rust 1.86.0. Added generator dependencies retain
the existing main-lock `indexmap` 2.13.0 and Serde 1.0.228 versions.

The standalone generator's Bazel `rust_binary` also declares version 1.0.195.
The pinned generator reads `CARGO_PKG_VERSION_PATCH` when mangling bridge symbols;
[rules_rust 0.61.0](https://github.com/bazelbuild/rules_rust/blob/0.61.0/rust/private/rustc.bzl)
derives that value from the target's version. Without the declaration it defaults
to zero. The first security candidate built and exposed the application C APIs,
then crashed during conversation creation because generated C++ called version
zero symbols while Rust defined version 195 symbols. Both failed runs are retained
in the separate security receipt. Require the prompt-template test, inspect the
raw library with `nm -m` for unresolved `cxxbridge` symbols, and complete real model
inference before accepting a candidate. The preparation verifier now rejects
such unresolved symbols before promoting a macOS runtime.

The fixes correspond to
[crossbeam-epoch invalid pointer formatting](https://rustsec.org/advisories/RUSTSEC-2026-0204.html),
[anyhow mutable error downcasting](https://rustsec.org/advisories/RUSTSEC-2026-0190.html),
[CXX string initialization during panic](https://rustsec.org/advisories/RUSTSEC-2026-0202.html)
and [Rand logger reentrancy](https://rustsec.org/advisories/RUSTSEC-2026-0097.html).
These are dependency defects; this audit does not establish that importing a
customer file exploits them. The configured native Rand build has no `log`
feature, a prerequisite for its advisory. `paste` 1.0.15 remains a host
procedural macro with an unmaintained-package warning and no reported
vulnerability in the audited database. Its archived source is preserved.

Original source archives, lock audits and native/model receipts remain historical
evidence. Updated audit receipts have the `audit-native-rust-security-` prefix
under `docs/development`. The separate
[`security-verification.json`](litert-native/security-verification.json) records
the corrected four-patch candidate: seven prompt-template tests, five provider
tests and four sampler tests passed. The built C API exports all 54 functions
called by the application, has no unresolved CXX bridge symbols, and passes the
pinned model's text, required/enum-constrained tool and synthetic image fixtures
with GREEDY type 3. The returned response objects were strictly parsed and checked.
The receipt also retains both earlier exit-139 runs and their mismatched symbols.
Baseline `verification.json` and the application runtime are not substituted.

The application input-preparation commands still identify the historical native
bundle: macOS acquires the pinned release XCFramework, and the Windows command
builds its recorded source/prebuilt GPU route. Applying the public CPU recipe does
not update either application's bundled runtime. Their unresolved binary/source
mapping and platform checks remain release blockers.

## Native preparation failure checks

Both preparation scripts assemble and validate a sibling candidate directory
before replacing an existing runtime. Promotion failure restores the previous
directory; a failed rollback retains both directories and reports their recovery
location. Cached input, compilation or validation failures leave the previous
bundle untouched. The Windows verifier rejects DLLs outside the reviewed
`requiredRuntimeFiles` inventory, including stale DLLs in nested resource folders.
Do not automatically delete an unexpected library to make this check pass.

The developer regressions are:

```sh
pnpm exec vitest run scripts/native-prepare.test.ts scripts/litert-lm-v016-contract.test.ts scripts/verify-windows-release-source.test.ts --project '!storybook' --maxWorkers=1
pwsh -NoProfile -File scripts/verify-windows-runtime.test.ps1
pwsh -NoProfile -File scripts/native-windows.test.ps1
```

The PowerShell staging fixtures execute the production staging block with
synthetic compiler outputs in unique temporary directories. They verify failure
preservation, promotion, rollback and first-install behavior on any supported
PowerShell host. They do not compile Windows code, certify Authenticode or prove
installed-app execution. These tools are for source contributors, not consumers.

## Remaining exact prebuilt source boundaries

- The LiteRT-LM Windows/macOS LiteRT prebuilts differ in SHA-256 and size from the
  prebuilts stored at its declared LiteRT source revision. A WORKSPACE pin proves
  a source/header dependency; it does not establish that binary's source revision.
- The Gemma provider prebuilt has no public implementation in either pinned tree.
  Its upstream CMake stub returns null and disables constraints. The source
  replacement has source build and focused grammar proof. Platform delivery and
  installed-app parity still require verification.
- The public WebGPU source target depends on `ml_drift`, but its archive declaration
  supplies no URL or hash. No exact public source build route for that prebuilt
  accelerator was established.
- TopK GPU sampler implementation/source targets were not located in the pinned
  public trees. The runtime loads the prebuilt sampler libraries dynamically.
- LiteRT's Dawn declaration supplies a header source revision; it does not map the
  bundled `libwebgpu_dawn.dll` to a proven source revision/build configuration.
- The Swift source graph forms a universal dylib and plain framework ZIP. The
  public release packaging route for the exact XCFramework ZIP is not present.

Qualcomm QAIRT, MediaTek NeuroPilot, Google Tensor, Samsung Exynos and Intel
OpenVINO repository macros are optional accelerator SDK declarations. Their
presence in WORKSPACE is not evidence that those SDKs are shipped in macOS or
Windows builds. The explicit CPU source configuration excludes GPU/NPU build
support. No proprietary SDK, credential, or authenticated vendor download is
included in this source collection.

## Verification status

The historical three-patch source provider compiled on macOS arm64 with Bazel 7.6.1 against the exact
Bazel-pinned source graph. All five focused native acceptance tests passed, covering
FC tool/schema rejection, atomic reserved delimiters with mixed text/tool output,
Python newline syntax, empty tools and bad inputs. Four CPU sampler factory tests
also passed, including batched GREEDY argmax before and after configuration
updates. The shared CPU C API built successfully. Its arm64 Mach-O exports the
engine and conversation APIs, declares minimum macOS 11.0 and dynamically depends
only on Apple system libraries/frameworks.

The pinned E4B model returned ordinary text, a required/enum-constrained synthetic
tool call and a correct synthetic image response using the source-built CPU C API
with TOP_P(k=1). The patched GREEDY type 3 library also passed all three cases with zero
temperature and constrained decoding enabled. The retained
`litert-native/cpu-smoke.cc` keeps constrained decoding enabled, uses GREEDY with
zero temperature and asserts the known synthetic responses. It accepts the model,
red-square PNG and cache directory as three arguments. No user data is used.
The baseline grammar and numeric parser predate upstream integer-schema fix
`f300c4f`; the synthetic tests do not establish complete schema parity.
Windows, universal macOS, older macOS runtime and installed-app delivery remain
unverified. Detailed source/build/inference receipts are retained in
`litert-native/verification.json`. The later four-patch Rust security candidate
has its own `litert-native/security-verification.json` and configured-source
receipt; neither changes the application's bundled runtime.
`distributionReview.ready` remains false.
