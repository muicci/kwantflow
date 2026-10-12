# Kwantflow AI Native Bridge

This directory contains the narrow native boundary for Kwantflow AI.

## Runtime Contract

- Rust owns download, SHA verification, runtime state, cancellation, and Tauri events.
- C++ owns only the LiteRT-LM v0.16 engine/conversation calls behind the C ABI in `litert_lm_bridge.h`.
- The production adapter is `litert_lm_bridge_litert.cc`.
- The stub adapter is development-only and fail-closed. Release builds set `KWANTFLOW_REQUIRE_LITERT_LM_NATIVE=1`, so no release-profile app can ship with the stub.
- Download verifies and installs the model only. The engine loads only for a user-started Local AI operation. A completed operation keeps it resident, but must leave no active stream or background compute.

## Native Artifact Inputs

The checked-in `engine.h`, `conversation.h`, and `src-tauri/native-runtime/` are one pinned LiteRT-LM v0.16
runtime closure. `conversation.h` keeps the upstream API declarations but includes the sibling
`engine.h` because Kwantflow stages both headers in one flat include directory on macOS and Windows.
Builds never accept external header, library, or rpath overrides because doing so
could compile against a different ABI than the app bundles.

### v0.16 Session and Conversation boundary

LiteRT-LM v0.16 exposes low-level `Session` checkpoint/rewind functions in
`engine.h`, but that C API accepts only low-level `InputData` values (with session-level
template handling). It does not expose the
Conversation layer's role/history rendering, Gemma 4 tool declarations and parsed tool calls,
reasoning-channel configuration, or model-specific multimodal preprocessing. The v0.16 upstream
documentation therefore recommends `Conversation` for chat/context management. Kwantflow's
production adapter intentionally uses the v0.16 `Conversation` C API so those semantics remain
owned by the released Gemma 4 data processor and prompt template. This is a deliberate v0.16
boundary, not a compatibility shim.

The C Conversation API currently exposes `clone`, but does not expose the underlying Session
handle or its checkpoint/rewind methods. Persistent turns use that clone as a transactional branch:
the clone receives the turn, cancellation discards it, and only a completed turn replaces the
committed conversation. Replacing this with direct Session calls would require reimplementing the
Gemma 4 prompt template, tool protocol, reasoning channels, and image preprocessing outside the
released runtime. Do not remove this branch/commit behavior until an upstream C API provides an
equivalent Conversation checkpoint/rewind contract and the complete tool, reasoning, multimodal,
and cancellation matrix is re-verified. This is also required by the upstream v0.16 Conversation
contract: `CancelProcess` poisons the underlying session and the documentation says that the
Conversation must not be reused after cancellation. A clone is therefore the cancellation-safe
branch primitive, not an avoidable legacy implementation.

The upstream v0.16 contract is pinned at
<https://github.com/google-ai-edge/LiteRT-LM/blob/v0.16.0/runtime/conversation/conversation.h>.

macOS release builds must keep both `liblitert_lm_c.dylib` and `libpdfium.dylib` universal
(`arm64` + `x86_64`).
Do not ship an Apple Silicon-only Local AI runtime as a universal macOS app; that would make
Kwantflow appear installable on Intel while breaking the native LiteRT-LM boundary.

`pnpm native:prepare` validates the SHA-256-pinned archives in `native-inputs.json`,
sets the staged install names, and checks both Mach-O slices, the macOS 12.0 minimum,
and the dependency list. Only OS framework/library paths and the exact staged install
names are accepted. Old arm64-only runtime shards fail the closure check.

`pnpm distribution:build` requires native Local AI for every release profile. Default
macOS builds use ad hoc signing; an explicit `--sign` uses maintainer-owned Developer ID
credentials, notarizes and staples the app, then signs/notarizes/staples the actual final
DMG bytes before writing their checksum. No credentials are required for community builds.
Tauri places the native directory at `local-ai/native/`, the same resource directory used
by the bridge. Signing/build success does not prove visible installed inference.

Windows x64 uses `scripts/native-windows.ps1` and the hash-pinned input contract at
`.github/windows-native-runtime-contract.json`. The checked-in source patch compiles the
same v0.16 C API. `scripts/verify-windows-runtime.ps1` checks required exports and every
PE machine/import dependency recursively, with an explicit Windows OS/API-set allowlist.
DLLs are installed both beside the EXE (for startup loading) and in `local-ai/native`
(for native resource lookup). A required Microsoft VC++ runtime is installed from the
hash-pinned bundled redistributable; it is never inferred from the runner's System32.
The Evergreen WebView2 offline installer is bundled separately by Tauri NSIS.

The Windows distribution builder compiles before bundling, verifies the final EXE's
imports and writes prerequisite decisions, then creates the installer. Run native
installed-device QA on Windows x64, Apple Silicon, and Intel before claiming support.
The native notices and corresponding-source review remain separate publication gates;
see `third-party/manifest.json` and `THIRD_PARTY_NOTICES.md`.

Do not link the raw Bazel `bazel-bin/c/libengine.lo` archive directly into the Tauri binary. It exposes the C API symbols, but it does not carry the transitive LiteRT-LM dependency closure.

## Boundaries

Do not add:

- Python runtime packaging.
- LiteRT-LM CLI import/list/serve.
- Localhost model servers.
- CLI registries or `~/.litert-lm` product state.
- Copied model caches.
- Sidecars unless direct linking fails with a documented linker, ABI, signing, or packaging blocker.

Bazel or CMake may be used by release engineering to build the upstream LiteRT-LM artifact, but they are developer build tools only. They are not app runtime dependencies and must not be required from Kwantflow users.
