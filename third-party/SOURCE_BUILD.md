# Pinned sources and rebuild instructions

The source archives in `sources/` are inputs for the corresponding release.
`manifest.json` pins their upstream revision, original download URL and SHA-256.
Verify the archives before extraction with `pnpm exec tsx scripts/verify-third-party.ts`.
Build in a scratch directory, never over an existing installation or user database.
General compiler tools are prerequisites, not installer requirements.

## LibreDWG 0.7.9 and workers

Extract `libredwg-web-0.7.9.tar.gz`. It includes the full LibreDWG C source, C++
embind code, JavaScript/TypeScript wrappers, COPYING, and the upstream committed
WASM. That committed WASM is byte-identical to the npm 0.7.9 WASM and the parser
embedded in `@mlightcad/cad-simple-viewer` 1.5.11's worker.

The upstream recipe, retained in `bindings/javascript/package.json`, is:

```sh
# The archive has no .git directory. autogen.sh expects a scratch Git repository.
git init -q
./autogen.sh
cd bindings/javascript
pnpm install --frozen-lockfile
pnpm build:prepare
pnpm build:obj
pnpm build:wasm
pnpm copy
pnpm build
```

This requires Emscripten, automake, autoconf, make and a C++17 compiler.
Emscripten **4.0.13** and the upstream lockfile's **TypeScript 5.8.2** were used
to execute this source build on macOS arm64. Put the absolute
`bindings/javascript/node_modules/.bin` directory on PATH before linking:
Emscripten's declaration generator runs TypeScript from a temporary directory.
An unrelated global TypeScript version can fail that step. Emscripten 3.1.69
compiled the C source but its older embind declaration generator failed in Node;
use the verified 4.0.13 route. Its source and linked zlib 1.3.1 archive, including
runtime licenses, are included here. The zlib archive also matches the SHA-512
in Emscripten 4.0.13's `tools/ports/zlib.py`.

The rebuilt module instantiated and matched the shipped parser's version,
entity type/count and layer count for the upstream `2000/Line.dwg`,
`2010/Text.dwg` and `2010/circle.dwg` fixtures. This is functional rebuild proof,
not a claim of byte-identical compiler output or installed-app rendering proof.
The exact flags in the pinned source enable zlib, memory growth, embind and
mimalloc. Do not guess the original prebuilt compiler version from the package
version. A source rebuild can be functionally equivalent without producing an
identical digest; any changed WASM must be shipped with its matching generated
JavaScript glue and worker. Do not mix generated glue from different toolchains.

Extract `cad-viewer-1.5.11.tar.gz` to rebuild the CAD viewer and DWG parser worker
using its exact lockfile and build scripts. Preserve its MIT wrapper license and
the embedded LibreDWG GPL notice. MText renderer 0.12.4 is pinned in the app lock.
The shipped workers are copied from those exact packages, with only trailing
whitespace normalized. Run the CAD fixture suite after any worker rebuild.

## OCCT STEP/IGES importer

Extract `occt-import-js-0.0.23.tar.gz` and populate its `occt/` submodule directory
from `OCCT-7.6.1.tar.gz`, stripping the archive's outer directory. The importer
revision is `c2148e54b456b571238d35cac037d304053d64b2`; OCCT is
`d2abb6d844231cb8f29be6894440874a4700e4a5`. Use Emscripten 3.1.69, the version
recorded by the upstream 0.0.23 release, and the pinned CMakeLists.txt:

```sh
emcmake cmake -S . -B build/wasm -G Ninja -DEMSCRIPTEN=1 -DCMAKE_BUILD_TYPE=Release
emmake cmake --build build/wasm
```

The upstream Windows scripts under `tools/` show the equivalent MinGW Makefiles
commands, distribution copies and tests. Preserve the LGPL 2.1 importer and OCCT
texts plus OCCT_LGPL_EXCEPTION.txt. Supply the exact source, build instructions
and usable replacement route for the library in a binary distribution.

The pinned source rebuild was executed on macOS arm64 with Emscripten 3.1.69,
CMake 4.3.3 and Ninja 1.13.2. The rebuilt parser passed 22 upstream tests and
75 complete-output comparisons against the shipped importer under the pinned
Node 24.18.0 runtime. The generated JavaScript matches the wrapper archive;
rebuilt and shipped WASM hashes differ. All archived wrapper/OCCT source files
remained byte-equal after the build. Four original compiler warnings and five
SDK packaging/version/test differences are recorded, with their actual scope.
See [the repeatable recipe](recipes/occt-import/README.md) and
[the fixed evidence receipt](recipes/occt-import/verification.json). These
standalone checks do not establish installed WebView rendering or desktop
platform acceptance, and the shipped package has not been replaced.

## HEIC/HEIF decoder

The shipped `packages/libheif-js` is custom version `1.23.6-kwantflow.1`, not
registry `libheif-js` 1.23.5. Its embedded WASM is built from libheif **1.23.6**
(`f81f28ac014b1c28dee483ac45b72c6b05bc421a`) and libde265 **1.1.3**
(`ba62bf4cfb3242f3bf0a45617ff09e35236e4d82`). Their exact official release
archives, hashes, notices and matching Emscripten **3.1.61** source are pinned.
The library uses HEVC decoding through libde265; optional AOM, OpenJPEG,
FFmpeg, uncompressed and WebCodecs codecs are disabled.

```sh
# With Emscripten 3.1.61 activated, cmake/make and locked app tools installed:
bash third-party/recipes/libheif/rebuild.sh /absolute/path/to/new-scratch-directory
pnpm exec vitest run scripts/heic-decoder.test.ts src/lib/services/intake-preprocessing.test.ts
```

`rebuild.sh` verifies both codec archive hashes before extraction. libde265
1.1.3 changed to CMake, so the recipe builds its static library and generated
version header before running libheif's unmodified Emscripten script. It sets
`CORES` explicitly, disables unsafe evaluation, and skips declaration generation:
the app supplies the small existing factory/interface declaration. The bundling
recipe reuses the lockfile's esbuild through tsx and embeds the matching WASM.
It retains the upstream factory contract and browser environment selection,
with empty Node filesystem stubs. Its three-line factory derives from the
included libheif-js 1.23.5 preferred source; the original LGPL notice is retained.
The app decodes the first image, then uses local canvas JPEG encoding at quality
0.92. No server or network decoder is required.

The updated decoder source build and browser bundle were executed on macOS
arm64 with Emscripten 3.1.61. The custom browser factory reports libheif 1.23.6
and returns the same dimensions and all 1,024 RGBA bytes as the previous
registry decoder for the project-owned `tests/fixtures/intake/red-square.heic`.
A contradictory HEVC configuration bit depth is rejected by the updated
decoder, while the previous decoder accepted it. Invalid/truncated inputs,
recovery and application resource cleanup are covered by focused tests.
`rebuild-evidence.json` records exact source/compiler pins, generated digests
and acceptance limits. Decoder proof does not establish installed WebView or
every malformed-file behavior. Earlier baseline rebuild receipts describe
unshipped predecessor versions and are preserved as historical evidence.

Both LGPL importers can be replaced by rebuilding their matching upstream npm
package and using that local package in a source build of Kwantflow. Preserve
matching generated JavaScript/WASM pairs, update the package/lock pin, rebuild
the app, and run the intake/CAD acceptance checks before redistribution. Supply
the complete application source and library sources together, including these
build and installation instructions. Signing identities are supplied by the
person rebuilding; an archived app signing identity is not needed to modify
or locally install a fork.

## MLightCAD preferred sources

The core/model/geometry/interface sources are pinned to the public
`realdwg-web` tag v1.12.5, commit `6757ff9e4da84a3edb0bb2a01a733f8063b9567f`.
Its package manifests match common/data-model 1.12.5 and geometry-engine/
graphic-interface 3.12.5. The archive contains TypeScript and build files, with
no RealDWG runtime binary. CAD/three-renderer 1.5.11 source is in the separately
pinned CAD viewer archive. MText parser 1.5.0, MText renderer 0.12.4 and SHX
parser 1.4.5 also have exact tagged source archives.

The SHX source input omits only `data/ISO.shx`, `data/SIMPLEX8.shx` and
`examples/fonts/gdt.shx`. Those unused upstream font fixtures have unresolved
redistribution rights; parser and build code are retained. The manifest records
the upstream archive hash, exact omitted paths, deterministic transformation,
and resulting archive hash. The source preparer verifies the raw download before
calling `scripts/source-archive-transform.ts`, and exports only the transformed
archive. Upstream tests/examples requiring those original fonts are not acceptance
proof for the replacement font set. Use `scripts/third-party-assets.test.ts`
with the bundled open fonts for that check.

## Fonts

Liberation's source and unmodified 2.1.5 TTF release are included. Noto Sans CJK SC
is the unmodified OTF file pinned to upstream revision
`f8d157532fbfaeda587e826d4cd5b21a49186f7c` and recorded in manifest.json.
`pnpm exec tsx scripts/build-cad-open-font.ts` rebuilds the renamed OFL SHX
derivative from the bundled LiberationSans-Regular.ttf. It uses the exact
`opentype.js` parser already supplied by the MText dependency. The script contains
the original dimension symbol geometry and deterministic curve flattening.
It also builds KwantflowOpenGdt.shx with original geometric tolerance symbols
and the documented GDT letter-slot mapping, kept separate from ordinary text.
Font aliases are in `static/cad-data/fonts/fonts.json`. Font substitution preserves
coverage, not an assertion of identical legacy font metrics or SHAPE semantics.

## npm, Cargo, native libraries and release gate

`pnpm install --frozen-lockfile` and the pinned Rust toolchain reconstruct the
package dependency graph. `pnpm exec tsx scripts/cargo-cli.ts fetch --locked
--manifest-path src-tauri/Cargo.toml` fetches the exact registry sources for all
locked platforms. `pnpm exec tsx scripts/third-party-inventory.ts --strict`
copies actual package notices and checks source-license inputs. Upstream notice
files omitted from published packages are retained with revision and hash in
`upstream-license-inputs.json`. Keep the lockfiles and these notices together.

Native acquisition, compiler/source pins and source patching are documented in
`src-tauri/native/README.md`, `native-inputs.json`,
`.github/windows-native-runtime-contract.json` and the native license tree.
Include the generated Bazel dependency notice collection with a Windows native
build. A pinned binary download does not, by itself, establish its complete
preferred-source or notice closure.
`native-source-manifest.json` pins the acquired native dependency archives and
the official LiteRT-LM 0.16.0 Apple SPDX/notice assets. The original notice asset
and 141 extracted component license texts are preserved. Its review status
tracks source-only tool-provider replacement, GPU provenance, and actual target
delivery separately from this completed notice collection.

Run `pnpm exec tsx scripts/verify-third-party.ts --distribution` before packaging
or publishing a release. It rejects unresolved distribution review, notice gaps,
lockfile drift, modified source archives, mixed DWG binaries and unapproved font
files. Resolve review items using actual build and installed-app evidence before
changing the manifest's review status. Do not treat the default hash check as a
completed distribution review.
