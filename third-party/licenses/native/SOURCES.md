# Windows native notice sources

These are unchanged license files extracted from the exact native inputs in
`.github/windows-native-runtime-contract.json`, not a replacement license for Kwantflow.

- LiteRT-LM: Google AI Edge commit `924e79c91542761242244e4f1651851f822e4cbb`, upstream `LICENSE`.
- PDFium: bblanchon `chromium/7920`, `pdfium-win-x64.tgz`, archive `LICENSE` and complete `licenses/`.
- The Windows build also copies dependency LICENSE/NOTICE/COPYING/COPYRIGHT files from its pinned Bazel dependency source tree into `native-runtime/licenses/litert-dependencies/`. That generated bundle must accompany a binary release. The upstream prebuilt GPU binaries are hash-pinned but the source license collection does not establish a complete binary bill of materials for them.

Visual C++ Redistributable and WebView2 retain Microsoft's redistribution terms.
The VC++ installer is not open-source software. Redistribution is limited to
licensed Visual Studio users. See the official terms:
<https://learn.microsoft.com/en-us/cpp/windows/redistributing-visual-cpp-files>.
The pinned VC++ installer contains its own license agreement.
