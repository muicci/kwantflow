import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadWorkspaceShell = vi.fn();
const loadDetachedPreviewShell = vi.fn();

vi.mock('$lib/state/projects.svelte', () => ({
	projectsState: {
		loadWorkspaceShell,
		loadDetachedPreviewShell
	}
}));

describe('project layout access guard', () => {
	beforeEach(() => {
		loadWorkspaceShell.mockReset();
		loadDetachedPreviewShell.mockReset();
		vi.unstubAllGlobals();
	});

	it('guards the route before loading the RFQ workspace shell', async () => {
		loadWorkspaceShell.mockResolvedValue({
			project: { id: 'project-1' },
			assets: [],
			unassignedFiles: []
		});
		const mod = await import('./+layout');

		const result = await mod.load({
			params: { id: 'project-1' },
			url: new URL('https://kwantflow.test/project/project-1')
		} as Parameters<typeof mod.load>[0]);

		expect(loadWorkspaceShell).toHaveBeenCalledWith('project-1');
		expect(result).toMatchObject({
			project: { id: 'project-1' }
		});
	});

	it('keeps project workspace routes client-only because RFQ data is Tauri-local', async () => {
		const mod = await import('./+layout');

		expect(mod.ssr).toBe(false);
	});

	it('skips the workspace shell for detached preview routes', async () => {
		loadDetachedPreviewShell.mockResolvedValue({
			project: { id: 'project-1' },
			assets: [],
			unassignedFiles: []
		});
		const mod = await import('./+layout');

		const result = await mod.load({
			params: { id: 'project-1' },
			url: new URL('https://kwantflow.test/project/project-1/asset/asset-7/preview')
		} as Parameters<typeof mod.load>[0]);

		expect(loadWorkspaceShell).not.toHaveBeenCalled();
		expect(loadDetachedPreviewShell).toHaveBeenCalledWith('project-1');
		expect(result).toEqual({
			project: { id: 'project-1' },
			assets: [],
			unassignedFiles: []
		});
	});

	it('retries workspace-shell loading once the Tauri runtime attaches during startup', async () => {
		vi.useFakeTimers();
		loadWorkspaceShell.mockRejectedValueOnce(new Error('runtime not ready')).mockResolvedValueOnce({
			project: { id: 'project-1' },
			assets: [],
			unassignedFiles: []
		});
		const mod = await import('./+layout');
		const originalWindow = globalThis.window;
		(globalThis as Record<string, unknown>).window = {};

		const loadPromise = mod.load({
			params: { id: 'project-1' },
			url: new URL('https://kwantflow.test/project/project-1')
		} as Parameters<typeof mod.load>[0]);

		// Attach Tauri internals simulating startup delay
		(globalThis as Record<string, unknown>).window = {
			__TAURI_INTERNALS__: {}
		};
		await vi.runAllTimersAsync();

		const result = await loadPromise;

		expect(loadWorkspaceShell).toHaveBeenCalledTimes(2);
		expect(result).toMatchObject({
			project: { id: 'project-1' }
		});

		(globalThis as Record<string, unknown>).window = originalWindow;
		vi.useRealTimers();
	});

	it('retries asset routes until the requested asset is present in the workspace shell', async () => {
		vi.useFakeTimers();
		loadWorkspaceShell
			.mockResolvedValueOnce({
				project: { id: 'project-1' },
				assets: [],
				unassignedFiles: []
			})
			.mockResolvedValueOnce({
				project: { id: 'project-1' },
				assets: [{ id: 'asset-7' }],
				unassignedFiles: []
			});
		vi.stubGlobal('window', { __TAURI_INTERNALS__: {} } as unknown as Window);
		const mod = await import('./+layout');

		const loadPromise = mod.load({
			params: { id: 'project-1', assetId: 'asset-7' },
			url: new URL('https://kwantflow.test/project/project-1/asset/asset-7')
		} as unknown as Parameters<typeof mod.load>[0]);

		await vi.runAllTimersAsync();

		await expect(loadPromise).resolves.toMatchObject({
			project: { id: 'project-1' },
			assets: [{ id: 'asset-7' }]
		});
		expect(loadWorkspaceShell).toHaveBeenCalledTimes(2);
		vi.useRealTimers();
	});
});
