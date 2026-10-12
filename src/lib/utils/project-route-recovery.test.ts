import { describe, expect, it, vi } from 'vitest';
import {
	loadProjectRouteWithRecovery,
	resolveRecoverableProjectRoute
} from './project-route-recovery';

describe('resolveRecoverableProjectRoute', () => {
	it('returns the project target for 404 project asset routes', () => {
		expect(resolveRecoverableProjectRoute('/project/project-1/asset/asset-9', 404)).toEqual({
			projectId: 'project-1',
			detachedPreview: false
		});
	});

	it('marks detached preview routes explicitly', () => {
		expect(resolveRecoverableProjectRoute('/project/project-1/asset/asset-9/preview', 404)).toEqual(
			{
				projectId: 'project-1',
				detachedPreview: true
			}
		);
	});

	it('recovers standalone detached preview routes explicitly', () => {
		expect(resolveRecoverableProjectRoute('/preview/asset/project-1/asset-9', 404)).toEqual({
			projectId: 'project-1',
			detachedPreview: true
		});
	});

	it('ignores non-404 states and unrelated paths', () => {
		expect(resolveRecoverableProjectRoute('/project/project-1', 200)).toBeNull();
		expect(resolveRecoverableProjectRoute('/settings', 404)).toBeNull();
	});

	it('retries once the tauri runtime becomes available', async () => {
		vi.useFakeTimers();
		const originalWindow = globalThis.window;
		const loader = vi
			.fn<() => Promise<string>>()
			.mockRejectedValueOnce(new Error('runtime not ready'))
			.mockResolvedValue('ready');

		vi.stubGlobal('window', {} as unknown as Window);

		const loadPromise = loadProjectRouteWithRecovery(loader);

		// Advance time slightly to let the retry loop poll
		await vi.advanceTimersByTimeAsync(10);

		// Attach tauri internals to resolve the wait
		(window as Window).__TAURI_INTERNALS__ = {};

		await vi.runAllTimersAsync();

		await expect(loadPromise).resolves.toBe('ready');
		expect(loader).toHaveBeenCalledTimes(2);

		if (originalWindow === undefined) {
			vi.unstubAllGlobals();
		} else {
			vi.stubGlobal('window', originalWindow);
		}
		vi.useRealTimers();
	});

	describe('loadProjectRouteWithRecovery', () => {
		it('exhausts retries and throws the last error', async () => {
			vi.useFakeTimers();

			const originalWindow = globalThis.window;
			vi.stubGlobal('window', { __TAURI_INTERNALS__: {} } as unknown as Window);

			try {
				const error = new Error('persistent error 7');
				const loader = vi.fn<() => Promise<string>>().mockRejectedValue(error);

				const assertion = expect(loadProjectRouteWithRecovery(loader)).rejects.toThrow(
					'persistent error 7'
				);
				await vi.runAllTimersAsync();
				await assertion;
				expect(loader).toHaveBeenCalledTimes(7);
			} finally {
				if (originalWindow === undefined) {
					vi.unstubAllGlobals();
				} else {
					vi.stubGlobal('window', originalWindow);
				}

				vi.useRealTimers();
			}
		});
	});
});
