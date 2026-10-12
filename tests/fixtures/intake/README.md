# HEIC fixture provenance

`red-square.heic` is a project-owned synthetic 16 by 16 red square, created locally
for the decoder test. It contains no camera, customer or third-party photograph.
It is covered by the application's GPL-3.0-only license.

The source bitmap is RGB `(255, 0, 0)` for every pixel. Recreate a PNG from that
bitmap and convert it on macOS with:

```sh
sips -s format heic red-square.png --out red-square.heic
```

HEIC encoding may vary by macOS version, so tests verify decoded geometry and
pixel color rather than asserting the encoder produces a fixed binary digest.
