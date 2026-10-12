# Local email parser patches

The application keeps `@kenjiuno/msgreader` at 1.28.0 and `eml-parse-js` at
1.2.0-beta.1. `pnpm-workspace.yaml` registers the exact runtime patches, and
`pnpm-lock.yaml` binds their bytes. A normal `pnpm install --frozen-lockfile`
applies them automatically. No additional parser, worker, runtime service, or
dependency is required.

The MSG patch checks CFBF sectors, stream sizes, allocation-table counts, and
directory and stream cycles before following references or allocating buffers.
Named-property strings and both recurrence-date arrays check their declared
lengths against the actual input before requesting a typed array. Malformed
files fail with a controlled error instead of looping or allocating gigabytes.
Optional malformed recurrence metadata remains ignored by the upstream parser;
the usable message body and headers are preserved.

The EML patch preserves literal attachment filenames, decodes RFC 2231 encoded
parameters and complete continuations, and preserves malformed encoded names as
text. Only an encoded first part can carry charset/language metadata. UTF-8
encoded names are supported; malformed or unsupported percent byte sequences
remain readable escaped text. Filename values are preview metadata and are not
written to filesystem paths by the offline parser.

Explicit base64 text and HTML bodies use the existing charset decoder after
base64 byte decoding. ASCII and UTF-8 behavior is preserved, and the verified
ISO-8859-1 and GBK cases no longer produce replacement characters. The three
numeric-only GBK `eval` calls are replaced with `Number`; the application no
longer suppresses EML dynamic-code warnings. These calls previously received
generated bit digits or numeric loop indices, not arbitrary email source code.

Header lookups accept any casing, including nested MIME parts. Original header
names, values and repeated-header arrays remain unchanged. Media types,
encoding tokens and parameter names are compared without case sensitivity;
boundary, filename and other parameter values retain their original case.
Lookup retains the previous exact-name preference and otherwise uses the first
matching raw name. A message or part without Content-Type defaults to
`text/plain; charset=us-ascii`, as specified by
[RFC 2045 sections 5.1 and 5.2](https://www.rfc-editor.org/rfc/rfc2045.html#section-5.2).
Once the empty line starts a body, header-like lines remain body text.

## Source and rebuild

Original license notices and source headers remain intact. Each npm package's
unmodified archive and integrity is also retained in the dependency-source
receipt prepared for the final application lock. The separate preferred-source
archives are pinned in `third-party/manifest.json`:

| Package                      | Preferred source revision                  | Matching source patch                    |
| ---------------------------- | ------------------------------------------ | ---------------------------------------- |
| `@kenjiuno/msgreader@1.28.0` | `698f600631759f29165f2c538ae8130de8aa8a00` | `msgreader-1.28.0-source.patch`          |
| `eml-parse-js@1.2.0-beta.1`  | `6e622ae5f01d760b88aa7e84951b4b9a71764b7e` | `eml-parse-js-1.2.0-beta.1-source.patch` |

These revisions are the npm registry's `gitHead` values. MSG's upstream source
manifest still says `1.28.0-alpha.1`; the published npm package says `1.28.0`.
The source is retained without changing that historical metadata.

Extract a preferred-source archive into an empty directory and apply its
`*-source.patch` with `git apply`. MSG's archived `yarn.lock` pins TypeScript
5.7.2; use `pnpm import` to convert that lock, install with scripts disabled,
then run its TypeScript build. The verified source build compiled all 13 source
files with TypeScript 5.7.2 and zero diagnostics; all 13 emitted JavaScript files
match the installed patched package byte-for-byte. Do not substitute the app's
TypeScript 6 toolchain for this older upstream build configuration.

EML's archived `pnpm-lock.yaml` pins pnpm 9.15.1, TypeScript 5.7.2, Vite 6.0.3,
vite-plugin-dts 4.3.0, Rollup 4.28.1 and esbuild 0.24.0. With that package manager,
run `pnpm install --frozen-lockfile --ignore-scripts`, then `pnpm exec vite build`
inside the extracted source. Its existing `vite.config.ts` produces CJS, ES
module, IIFE and UMD variants with minification disabled.

The actual isolated build used the archived lock, public inputs, empty npm
configurations and an explicit tool-process environment without founder
credentials. The unmodified source reproduced all four original npm JavaScript
files byte-for-byte. After applying the source patch, all four rebuilt files
were used directly to generate the runtime patch and match the installed
application dependency byte-for-byte. The five type declaration files and
package entry points, exports and dependency declarations remain unchanged.
The upstream build keeps `js-base64` external; its lock pins 3.7.7 while the
application continues to use 3.7.8.

[preferred-source-build-verification.json](preferred-source-build-verification.json)
binds the exact tools, source, outputs, install and raw evidence. Before promotion,
33 synthetic messages across all four formats passed 132 full-result comparisons
against the preceding manually formatted runtime, with explicit expected values.
The differences were equivalent compiler binding names, optional-chain lowering
and layout. `verification-before-source-build.json` and
`eml-runtime-before-source-build.patch` preserve that preceding state as
historical comparison material. They describe the earlier lock and runtime,
not the current installation.

## Verification

From the application source root:

```sh
pnpm install --frozen-lockfile
pnpm exec vitest run src/lib/services/email-content.test.ts scripts/email-parser-malformed.test.ts --project '!storybook' --maxWorkers=1
```

The malformed MSG cases run the actual app parser in a child process with a
timeout and memory limit so a regression cannot hang the test runner. Allocation
spies intercept oversized requests before allocating memory. Inputs are derived
only from the public Apache-2.0 fixtures under `tests/fixtures/email`; no profile,
customer file, mailbox connection, provider, or external image is accessed.

`verification.json` binds the patches, preferred source, installed runtime and
synthetic regression evidence. These tests are source/runtime evidence on the
current macOS host, not installed-app acceptance on Windows or Intel macOS.
The current two-file suite passed 63 cases after the generated-runtime install.
The retained preceding installed-parser log passed 62 cases before the later
viewer/sanitizer regression was added. The preceding header/default run
reproduced nine valid-message failures while 30 existing service cases passed.
