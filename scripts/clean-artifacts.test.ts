import { describe, expect, it } from 'vitest';

import { CLEAN_ARTIFACT_PATHS, cleanArtifacts } from './clean-artifacts';

describe('cleanArtifacts', () => {
	it('removes only the fixed artifact paths under the supplied root', () => {
		const removed: string[] = [];
		const result = cleanArtifacts(
			'/workspace/app',
			(target) => removed.push(target),
			(target) => target.endsWith('/dist') || target.endsWith('/src-tauri/target'),
			() => ['Kwantflow.app', 'release-state']
		);

		expect(CLEAN_ARTIFACT_PATHS).toEqual([
			'.cache',
			'.pnpm-store',
			'.svelte-kit',
			'build',
			'src-tauri/target'
		]);
		expect(removed).toEqual([
			'/workspace/app/src-tauri/target',
			'/workspace/app/dist/Kwantflow.app'
		]);
		expect(result.skippedPaths).toEqual(['.cache', '.pnpm-store', '.svelte-kit', 'build']);
		expect(result.preservedPaths).toEqual(['dist/release-state']);
	});
});
