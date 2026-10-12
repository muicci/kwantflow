#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-only
set -euo pipefail

app_root="$(cd "$(dirname "$0")/../../.." && pwd)"
scratch="${1:?Usage: rebuild.sh NEW_SCRATCH_DIRECTORY}"
test ! -e "$scratch" || { echo 'Use a new scratch directory.' >&2; exit 1; }
emcc --version | head -1 | grep -q '3.1.61' || { echo 'Activate Emscripten 3.1.61 first.' >&2; exit 1; }
node --input-type=module - "$app_root" <<'JS'
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
for (const [name, expected] of [
  ['libheif-1.23.6.tar.gz', '4484346dc5995319dbc11e3a1c35d0a2ec46511ce370900869337fd2c7033125'],
  ['libde265-1.1.3.tar.gz', '554228bd17788c99a7e63b37ab5634722190e6e2bf60c1dcb01cef328e133905']
]) {
  const actual = createHash('sha256').update(readFileSync(join(process.argv[2], 'third-party/sources', name))).digest('hex');
  if (actual !== expected) throw new Error(`Source archive hash mismatch: ${name}`);
}
JS
mkdir -p "$scratch"
scratch="$(cd "$scratch" && pwd)"
mkdir "$scratch/source" "$scratch/build"
tar -xzf "$app_root/third-party/sources/libheif-1.23.6.tar.gz" -C "$scratch/source" --strip-components=1
cp "$app_root/third-party/sources/libde265-1.1.3.tar.gz" "$scratch/build/"
cd "$scratch/build"
tar -xzf libde265-1.1.3.tar.gz

# libde265 1.1.3 uses CMake instead of the older upstream autotools recipe.
emcmake cmake -S libde265-1.1.3 -B libde265-1.1.3/build \
  -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DENABLE_SIMD=OFF \
  -DENABLE_SDL=OFF -DENABLE_DECODER=OFF -DENABLE_ENCODER=OFF \
  -DENABLE_SHERLOCK265=OFF -DENABLE_INTERNAL_DEVELOPMENT_TOOLS=OFF
emmake cmake --build libde265-1.1.3/build -j"${CORES:-6}"
mkdir -p libde265-1.1.3/libde265/.libs
cp libde265-1.1.3/build/libde265/libde265.a libde265-1.1.3/libde265/.libs/
cp libde265-1.1.3/build/libde265/de265-version.h libde265-1.1.3/libde265/

# Set optional codec choices explicitly before the unmodified upstream build script.
emcmake cmake "$scratch/source" -DBUILD_TESTING=OFF \
  -DWITH_EXAMPLES=OFF -DWITH_GDK_PIXBUF=OFF -DENABLE_PLUGIN_LOADING=OFF \
  -DENABLE_MULTITHREADING_SUPPORT=OFF -DBUILD_SHARED_LIBS=OFF \
  -DLIBDE265_INCLUDE_DIR="$scratch/build/libde265-1.1.3" \
  -DLIBDE265_LIBRARY="-L$scratch/build/libde265-1.1.3/libde265/.libs" \
  -DWITH_AOM_DECODER=OFF -DWITH_AOM_ENCODER=OFF -DWITH_OpenH264_DECODER=OFF \
  -DWITH_X264=OFF -DWITH_X265=OFF -DWITH_LIBSHARPYUV=OFF
LIBDE265_VERSION=1.1.3 CORES="${CORES:-6}" USE_WASM=1 USE_UNSAFE_EVAL=0 \
  USE_TYPESCRIPT=0 "$scratch/source/build-emscripten.sh" "$scratch/source"
node "$app_root/third-party/recipes/libheif/build-wrapper.mjs" "$scratch/build"
