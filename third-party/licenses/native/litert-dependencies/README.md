# LiteRT dependency notice inputs

These files retain upstream license texts. `third-party/native-source-manifest.json`
records their hashes, exact archives/revisions and evidence scope.

`official-apple-v0.16.0/` contains the unmodified Google LiteRT-LM release notice
and SPDX assets, plus each original extracted license text. This authentic Apple
inventory is not an exact Windows binary bill of materials. Summary SPDX license
labels must not override the extracted copyright and license text.

Other directories contain notice files from the pinned source archives. This is
an explicit source-input superset, including unused platform and build/test files.
It does not claim those components are all linked into a shipped native library.

See `third-party/recipes/litert-native.md` for build instructions and unresolved
binary-to-source mapping requirements.
