import { beforeEach, describe, expect, it, vi } from 'vitest';

const openMock = vi.fn();
const closeMock = vi.fn();
const syncMock = vi.fn();
const retargetMock = vi.fn();

vi.mock('$lib/services/detached-asset-preview-window.js', () => ({
	detachedAssetPreviewWindowService: {
		open: openMock,
		close: closeMock,
		retarget: retargetMock,
		sync: syncMock
	}
}));

describe('assetPreviewState', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		openMock.mockResolvedValue(undefined);
		closeMock.mockResolvedValue(undefined);
		retargetMock.mockResolvedValue(undefined);
		syncMock.mockResolvedValue(undefined);
	});

	it('detaches the current asset preview and syncs later selection changes to the detached window', async () => {
		const { assetPreviewState } = await import('./asset-preview.svelte.js');

		assetPreviewState.setSelection('asset-1', {
			activeFileId: 'file-1',
			targetPdfPage: null,
			targetCadViewLabel: null
		});

		await assetPreviewState.detach({
			projectId: 'project-1',
			assetId: 'asset-1',
			assetName: 'Roof Framing'
		});

		expect(openMock).toHaveBeenCalledWith({
			projectId: 'project-1',
			assetId: 'asset-1',
			assetName: 'Roof Framing'
		});
		expect(assetPreviewState.isDetachedForAsset('asset-1')).toBe(true);

		await assetPreviewState.setSelection('asset-1', {
			activeFileId: 'file-2',
			targetPdfPage: 4,
			targetCadViewLabel: null
		});

		expect(assetPreviewState.isDetachedActive()).toBe(true);
		expect(syncMock).toHaveBeenCalledWith({
			projectId: 'project-1',
			assetId: 'asset-1',
			assetName: 'Roof Framing',
			activeFileId: 'file-2',
			targetPdfPage: 4,
			targetCadViewLabel: null
		});
	});

	it('retargets detached mode to a new asset without reopening the embedded preview flow', async () => {
		const { assetPreviewState } = await import('./asset-preview.svelte.js');

		await assetPreviewState.detach({
			projectId: 'project-1',
			assetId: 'asset-1',
			assetName: 'Roof Framing'
		});
		await assetPreviewState.setSelection('asset-9', {
			activeFileId: 'file-9',
			targetPdfPage: 2,
			targetCadViewLabel: null
		});

		await assetPreviewState.followAsset({
			projectId: 'project-2',
			assetId: 'asset-9',
			assetName: 'Wall Panels'
		});

		expect(retargetMock).toHaveBeenCalledWith({
			projectId: 'project-2',
			assetId: 'asset-9',
			assetName: 'Wall Panels'
		});
		expect(syncMock).toHaveBeenCalledWith({
			projectId: 'project-2',
			assetId: 'asset-9',
			assetName: 'Wall Panels',
			activeFileId: 'file-9',
			targetPdfPage: 2,
			targetCadViewLabel: null
		});
		expect(assetPreviewState.isDetachedForAsset('asset-9')).toBe(true);
	});

	it('resolves the active detached preview target only for asset estimate routes', async () => {
		const { resolveDetachedAssetPreviewTarget } = await import('./asset-preview.svelte.js');

		expect(
			resolveDetachedAssetPreviewTarget('/project/[id]/asset/[assetId]', {
				assetId: 'asset-4',
				assets: [
					{
						id: 'asset-4',
						project_id: 'project-3',
						display_name: 'Lintels'
					}
				]
			})
		).toEqual({
			projectId: 'project-3',
			assetId: 'asset-4',
			assetName: 'Lintels'
		});
		expect(resolveDetachedAssetPreviewTarget('/companies', {})).toBeNull();
	});

	it('clears detached mode after the detached window is closed manually', async () => {
		const { assetPreviewState } = await import('./asset-preview.svelte.js');

		await assetPreviewState.detach({
			projectId: 'project-1',
			assetId: 'asset-1',
			assetName: 'Roof Framing'
		});

		expect(assetPreviewState.finalizeDetachedSession()).toBe(true);
		expect(assetPreviewState.finalizeDetachedSession()).toBe(false);

		expect(assetPreviewState.isDetachedActive()).toBe(false);
	});

	it('keeps other asset editors attached while a different asset is detached', async () => {
		const { assetPreviewState } = await import('./asset-preview.svelte.js');

		await assetPreviewState.detach({
			projectId: 'project-1',
			assetId: 'asset-1',
			assetName: 'Roof Framing'
		});

		expect(assetPreviewState.isDetachedForAsset('asset-1')).toBe(true);
		expect(assetPreviewState.isDetachedForAsset('asset-9')).toBe(false);
	});

	it('keeps the embedded preview attached when detached window creation fails', async () => {
		openMock.mockRejectedValue(new Error('permission denied'));

		const { assetPreviewState } = await import('./asset-preview.svelte.js');

		await expect(
			assetPreviewState.detach({
				projectId: 'project-1',
				assetId: 'asset-1',
				assetName: 'Roof Framing'
			})
		).rejects.toThrow('permission denied');

		expect(assetPreviewState.isDetachedActive()).toBe(false);
		expect(assetPreviewState.isDetachedForAsset('asset-1')).toBe(false);
	});
});
