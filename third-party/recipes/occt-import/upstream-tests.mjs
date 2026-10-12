import { before, describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

if (!process.env.OCCT_WRAPPER_SOURCE) {
	throw new Error('Set OCCT_WRAPPER_SOURCE to the extracted pinned wrapper source directory.');
}
const source = resolve(process.env.OCCT_WRAPPER_SOURCE);
const require = createRequire(import.meta.url);
Object.assign(globalThis, { before, describe, it });
process.chdir(source);
require(join(source, 'test/test.js'));
