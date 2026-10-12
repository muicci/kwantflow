import { describe, expect, it } from 'vitest';

import { CLEAN_ARTIFACT_PATHS, cleanArtifacts } from '../../scripts/clean-artifacts';

describe('clean artifacts', () => {
	it('removes known disposable artifact paths and reports missing paths separately', () => {
		const existingPaths = new Set<string>([
			'/repo/.cache',
			'/repo/build',
			'/repo/dist',
			'/repo/src-tauri/target'
		]);
		const removedPaths: string[] = [];

		const result = cleanArtifacts(
			'/repo',
			(targetPath) => {
				removedPaths.push(targetPath);
				existingPaths.delete(targetPath);
			},
			(targetPath) => existingPaths.has(targetPath),
			(targetPath) => (targetPath === '/repo/dist' ? ['release-state', 'staged-installer.dmg'] : [])
		);

		expect(CLEAN_ARTIFACT_PATHS).toEqual([
			'.cache',
			'.pnpm-store',
			'.svelte-kit',
			'build',
			'src-tauri/target'
		]);
		expect(result.removedPaths).toEqual([
			'.cache',
			'build',
			'src-tauri/target',
			'dist/staged-installer.dmg'
		]);
		expect(result.skippedPaths).toContain('.pnpm-store');
		expect(result.preservedPaths).toEqual(['dist/release-state']);
		expect(removedPaths).toEqual([
			'/repo/.cache',
			'/repo/build',
			'/repo/src-tauri/target',
			'/repo/dist/staged-installer.dmg'
		]);
	});
});
