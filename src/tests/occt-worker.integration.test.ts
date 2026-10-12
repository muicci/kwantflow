// @vitest-environment node

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// occt-import-js does not publish TypeScript declarations.
// @ts-expect-error pinned runtime package has no declaration file
import createOC from 'occt-import-js';

const require = createRequire(import.meta.url);

describe('real OCCT WASM parser', () => {
	it('imports the pinned package AP214 solid fixture into a non-empty triangle mesh', async () => {
		const packageRoot = dirname(require.resolve('occt-import-js/package.json'));
		const fixturePath = join(packageRoot, 'test', 'testfiles', 'cube-fcstd', 'cube.step');
		const bytes = new Uint8Array(readFileSync(fixturePath));
		const parser = await createOC();

		const result = parser.ReadStepFile(bytes, null) as {
			success: boolean;
			root?: { children?: unknown[] };
			meshes?: Array<{
				attributes?: { position?: { array?: number[] } };
				index?: { array?: number[] };
			}>;
		};

		expect(result.success).toBe(true);
		expect(result.root?.children?.length).toBeGreaterThan(0);
		expect(result.meshes?.length).toBeGreaterThan(0);
		expect(result.meshes?.[0]?.attributes?.position?.array?.length).toBeGreaterThan(0);
		expect(result.meshes?.[0]?.index?.array?.length).toBeGreaterThan(0);
	});
});
