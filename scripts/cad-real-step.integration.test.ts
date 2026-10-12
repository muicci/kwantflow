import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error occt-import-js does not publish TypeScript declarations
import createOcctImport from 'occt-import-js';

const fixtureDirectory = process.env.KWANTFLOW_CAD_FIXTURE_DIR ?? '';
const fixtureNames = ['4140 Shaft.STEP', 'MS WASHER X 2.STEP', 'CAST IRON ROLLERS X 2.STEP'];
const fixturesAvailable =
	fixtureDirectory.length > 0 &&
	fixtureNames.every((fileName) => existsSync(join(fixtureDirectory, fileName)));

describe('real STEP parser integration', () => {
	it.skipIf(!fixturesAvailable)('produces mesh geometry for the reported STEP files', async () => {
		const occt = await createOcctImport();

		for (const fileName of fixtureNames) {
			const result = occt.ReadStepFile(readFileSync(join(fixtureDirectory, fileName)), null);
			expect(result.success, fileName).toBe(true);
			expect(result.meshes.length, fileName).toBeGreaterThan(0);
			expect(result.meshes[0].index.array.length, fileName).toBeGreaterThan(0);
		}
	});
});
