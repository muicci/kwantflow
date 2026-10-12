# OCCT importer source rebuild verification

This recipe covers the pinned `occt-import-js` 0.0.23 wrapper and OCCT 7.6.1
WebAssembly importer. It does not replace the application package or prove an
installed macOS/Windows WebView workflow.

## Build from public inputs

Verify the source archives against `third-party/manifest.json`, then extract
`occt-import-js-0.0.23.tar.gz` into a new scratch directory and populate its
`occt/` directory from `OCCT-7.6.1.tar.gz`. Strip each archive's outer directory.
The wrapper commit is `c2148e54b456b571238d35cac037d304053d64b2`; OCCT is
`d2abb6d844231cb8f29be6894440874a4700e4a5`. Do not patch their build or parser
files when reproducing this receipt.

Install Emscripten **3.1.69** using the official SDK. The SDK source used here is
the public tag archive:
<https://codeload.github.com/emscripten-core/emsdk/tar.gz/refs/tags/3.1.69>.
Its SHA-256 is
`7fbf610accce016f8b05196c254cc92162c07571979fbd0b6e5a4c50fded157c`.
From that extracted SDK directory:

```sh
python3 emsdk.py install 3.1.69
python3 emsdk.py activate 3.1.69
source ./emsdk_env.sh
```

Use the matching Windows environment script when building there. The
[official SDK documentation](https://emscripten.org/docs/getting_started/downloads.html)
describes platform bootstrap requirements. The receipt records observed hashes
and public URLs for the actual compiler, Node and Python bundles; those hashes
are observations, not signed upstream attestations.

With CMake and Ninja available, run from the extracted wrapper source:

```sh
emcmake cmake -S . -B build/wasm -G Ninja -DEMSCRIPTEN=1 -DCMAKE_BUILD_TYPE=Release
emmake cmake --build build/wasm --parallel 6
```

The unchanged upstream build produces the matching pair
`build/wasm/Release/occt-import-js.js` and `occt-import-js.wasm`. Retain both files.
The completed isolated scratch tree occupied about 2.6 GiB;
allow 8 GiB for the SDK, preserved bootstrap archives, sources and build files.
The executed host was macOS arm64, with CMake 4.3.3 and Ninja 1.13.2. The
Emscripten driver used host Python 3.14.5 and SDK Node 18.20.3. SDK Python 3.9.2
was installed and observed but was not the selected driver. Equivalent upstream
Windows MinGW commands remain in the wrapper's `tools/` directory; they have
not been executed by this receipt.

## Run the checks

Use the project's pinned Node **24.18.0**. These checks use only Node's standard
library and the unchanged upstream test files, so no new test dependency is
needed. Run from the application source directory and use absolute paths for
the wrapper and rebuilt distribution:

```sh
OCCT_WRAPPER_SOURCE=/absolute/path/to/wrapper \
  node --test third-party/recipes/occt-import/upstream-tests.mjs

node third-party/recipes/occt-import/verify-rebuild.mjs \
  /absolute/path/to/wrapper/build/wasm/Release \
  /absolute/path/to/app/node_modules/occt-import-js/dist \
  /absolute/path/to/wrapper \
  /absolute/path/to/app \
  /absolute/path/to/new-comparison.json
```

In PowerShell, set `$env:OCCT_WRAPPER_SOURCE` before the first command instead
of using the shell assignment syntax. The expected wrapper test path is
`build/wasm/Release`; when the build is outside the extracted source directory,
provide that path using a directory link as the isolated experiment did.
If that external build directory sits under an ESM application package, give
the scratch build directory a `package.json` containing `{"type":"commonjs"}`.
That matches the published wrapper's module format; the isolated test used this
metadata without modifying the wrapper or application package.

`verify-rebuild.mjs` checks separate real WASM files and explicitly supplies
each file's bytes to its own factory. It compares the complete parser result
objects, including assembly trees/names, colors, face groups, positions,
normals and triangle indices. It checks all 57 archived upstream CAD files,
two original project fixtures, five output units, four meshing configurations
and seven empty/invalid/truncated inputs.

The retained Node 24 run passed all 22 upstream tests and all 75 comparisons.
Both parsers rejected the seven invalid cases. Eleven upstream fixtures
reported success with no triangle indices in both implementations; the receipt
preserves those outputs rather than presenting them as nonempty geometry.
Both original project fixtures explicitly require successful nonempty geometry.
The earlier standalone Node 25.6.0 results remain separately recorded.
The initial baseline upstream test process did not record its Node version;
its command and log are retained without assigning a historical runtime.

## Result and limits

All 125 wrapper and 35,508 OCCT regular source files were byte-equal to their
preferred-source archives after the build. The generated JavaScript is
byte-equal to the wrapper archive's distributed glue and equal to the installed
npm glue after line-ending normalization. The installed npm WASM is byte-equal
to the wrapper archive's distributed WASM. Rebuilt WASM differs from shipped
WASM; both exact hashes are recorded. This is functional parser compatibility
and a working preferred-source build, not byte-for-byte compiler reproduction.

The SDK compiler tree is not entirely byte-equal to the tagged Emscripten
source: 6,757 of 6,762 common files match. Its package/lock files and two test
codesize fixtures differ in the untouched public compiler bundle; the SDK
installer rewrites `emscripten-version.txt` to the selected release version.
The full difference record and bundle-origin proof are retained. The original
strict equality check failed; it is not reported as an exact SDK-source pass.

The build retains four original OCCT compiler warnings: two invalid `#elseif`
directives and two deprecated Emscripten stack-trace macros. An initial SDK
invocation incorrectly included `--keep-downloads`, so it returned exit 1 after
installing the SDK. The corrected install and activation returned exit 0.
These logs are retained alongside the successful build and parser proof.

No application package, lockfile, shipped runtime or signing identity changed.
This evidence does not cover browser/WebView rendering, installed desktop
platforms, older operating systems, every malformed file or performance.
Library replacement and redistribution still require the matching generated
pair, preserved LGPL/OCCT exception notices, a source app build and its CAD
acceptance checks as described in `third-party/SOURCE_BUILD.md`.
