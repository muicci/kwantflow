# Original benchmark inputs

These small synthetic files belong to this GPL-3.0-only application source. They
contain no customer data, provider credentials, downloaded artwork, or proprietary
drawing fonts. Positive preparation cases use real file formats rather than header
stubs. They are included in the standalone source export.

- STEP is a closed, six-face BREP of an 80 x 60 x 10 mm steel bracket plate.
- IGES represents the same plate with six planar B-spline surfaces.
- DXF and DWG contain the plate outline and an explicit dimension/material label.
- CSV and DOCX describe a synthetic steel beam RFQ and pricing reference.
- XLSX is an unrelated customer export using example names and `example.invalid`.
- PDF describes a synthetic steel canopy. It refers to the PDF standard font rather
  than embedding a redistributable font file.
- PNG depicts original dice pips. SVG contains an original decorative pattern.

From the application root, `node tests/fixtures/local-ai-benchmark/source/generate.mjs`
regenerates every format except DWG using existing JavaScript dependencies. Generate
the DWG from that DXF with the writer in the pinned LibreDWG 0.7.9 source archive:

```sh
tar -xzf third-party/sources/libredwg-web-0.7.9.tar.gz -C /your/temporary/build-directory
cd /your/temporary/build-directory/libredwg-web-b70b5573a6bf2345e5fb10f2adff7fb74a8123c5
autoreconf -fi
./configure --disable-shared --disable-bindings --disable-docs --disable-json
make -C src -j2 libredwg.la
make -C programs -j2 dxf2dwg
./programs/dxf2dwg -y -o /your/app/tests/fixtures/local-ai-benchmark/source/cad/sample.dwg /your/app/tests/fixtures/local-ai-benchmark/source/cad/sample-drawing.dxf
```

This optional regeneration needs a C toolchain, Autotools and Make. Ordinary users
and test runs use the already generated files and do not need that toolchain.
The writer does not transfer its license to the geometry it produces.

`scripts/local-ai-benchmark-sources.test.ts` loads the CAD fixtures with the pinned
OCCT and rebuilt LibreDWG WASM, and extracts DOCX, XLSX and PDF with the actual format
parsers. This proves portable preparation inputs. It does not prove native viewing,
image rendering, local AI inference, or the final benchmark score.
