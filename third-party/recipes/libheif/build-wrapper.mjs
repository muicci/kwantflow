// SPDX-License-Identifier: LGPL-3.0-only
// Browser wrapper derived from libheif-js scripts/bundle.js and install.js.
// Their original LGPL license and preferred source are included in the source archive.
import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const input = process.argv[2];
if (!input)
	throw new Error('Usage: node third-party/recipes/libheif/build-wrapper.mjs BUILD_DIRECTORY');
const buildDirectory = resolve(input);
const { build } = createRequire(realpathSync(join(root, 'node_modules/tsx/package.json')))(
	'esbuild'
);

await build({
	stdin: {
		contents: `import libheif from './libheif.js';
import wasmBinary from './libheif.wasm';
export default (opts = {}) => libheif({ ...opts, wasmBinary });`,
		resolveDir: buildDirectory,
		sourcefile: 'kwantflow-heif-wrapper.js',
		loader: 'js'
	},
	outfile: join(root, 'packages/libheif-js/libheif-wasm/libheif-bundle.mjs'),
	bundle: true,
	minify: true,
	target: 'es2019',
	platform: 'browser',
	format: 'esm',
	loader: { '.wasm': 'binary' },
	// The WASM is embedded. Preserve upstream browser selection in Node acceptance tests too.
	banner: { js: 'var process, __dirname;' },
	plugins: [
		{
			name: 'browser-only-filesystem-stubs',
			setup(builder) {
				builder.onResolve({ filter: /^(fs|path)$/ }, (args) => ({
					path: args.path,
					namespace: 'browser-empty'
				}));
				builder.onLoad({ filter: /.*/, namespace: 'browser-empty' }, () => ({
					contents: 'export default {};',
					loader: 'js'
				}));
			}
		}
	]
});
