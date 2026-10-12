import { beforeEach, describe, expect, it, vi } from 'vitest';

const getByLabelMock = vi.fn();
const invokeMock = vi.fn();
const logErrorMock = vi.fn();
const setFocusMock = vi.fn();
const showMock = vi.fn();
const unminimizeMock = vi.fn();
const centerMock = vi.fn();
const emitToMock = vi.fn();
const closeMock = vi.fn();
const webviewWindowConstructorMock = vi.fn();
const onceHandlers = new Map<string, (event?: unknown) => unknown>();

vi.mock('@tauri-apps/plugin-log', () => ({
	info: vi.fn(),
	warn: vi.fn(),
	error: logErrorMock,
	debug: vi.fn(),
	trace: vi.fn(),
	log: vi.fn(),
	attachConsole: vi.fn()
}));

vi.mock('@tauri-apps/api/webviewWindow', () => ({
	WebviewWindow: Object.assign(
		function WebviewWindow(label: string, options: unknown) {
			webviewWindowConstructorMock(label, options);
			return {
				label,
				show: showMock,
				unminimize: unminimizeMock,
				center: centerMock,
				setFocus: setFocusMock,
				once: vi.fn((event: string, callback: (payload?: unknown) => unknown) => {
					onceHandlers.set(event, callback);
					return Promise.resolve(() => {
						onceHandlers.delete(event);
					});
				})
			};
		},
		{
			getByLabel: getByLabelMock
		}
	)
}));

vi.mock('@tauri-apps/api/core', () => ({
	invoke: invokeMock
}));

vi.mock('@tauri-apps/api/window', () => ({
	getCurrentWindow: () => ({
		emitTo: emitToMock
	})
}));

vi.mock('$lib/utils/env.js', () => ({
	isTauri: () => true
}));

describe('detachedAssetPreviewWindowService', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		onceHandlers.clear();
		setFocusMock.mockResolvedValue(undefined);
		showMock.mockResolvedValue(undefined);
		unminimizeMock.mockResolvedValue(undefined);
		centerMock.mockResolvedValue(undefined);
		emitToMock.mockResolvedValue(undefined);
		closeMock.mockResolvedValue(undefined);
		invokeMock.mockReset();
	});

	it('retargets the existing detached preview window for an explicit detach action', async () => {
		getByLabelMock.mockResolvedValue({
			label: 'asset-preview',
			show: showMock,
			unminimize: unminimizeMock,
			setFocus: setFocusMock,
			close: closeMock
		});
		invokeMock.mockResolvedValue(true);

		const { detachedAssetPreviewWindowService } =
			await import('./detached-asset-preview-window.js');

		await detachedAssetPreviewWindowService.open({
			projectId: 'project-1',
			assetId: 'asset-7',
			assetName: 'Roof Framing'
		});

		expect(getByLabelMock).toHaveBeenCalledWith('asset-preview');
		expect(invokeMock).toHaveBeenCalledWith('retarget_detached_preview_window', {
			route: '/preview/asset/project-1/asset-7',
			title: 'Preview • Roof Framing'
		});
		expect(closeMock).not.toHaveBeenCalled();
		expect(webviewWindowConstructorMock).not.toHaveBeenCalled();
		expect(emitToMock).not.toHaveBeenCalled();
	});

	it('falls back to close-and-recreate when native retarget is unavailable', async () => {
		getByLabelMock
			.mockResolvedValueOnce({
				label: 'asset-preview',
				show: showMock,
				unminimize: unminimizeMock,
				setFocus: setFocusMock,
				close: closeMock
			})
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(null);
		invokeMock.mockResolvedValue(false);

		const { detachedAssetPreviewWindowService } =
			await import('./detached-asset-preview-window.js');

		const openPromise = detachedAssetPreviewWindowService.open({
			projectId: 'project-9',
			assetId: 'asset-3',
			assetName: 'Sample Readme'
		});

		await vi.waitFor(() => {
			expect(onceHandlers.has('tauri://created')).toBe(true);
		});
		await onceHandlers.get('tauri://created')?.();
		await openPromise;

		expect(invokeMock).toHaveBeenCalledWith('retarget_detached_preview_window', {
			route: '/preview/asset/project-9/asset-3',
			title: 'Preview • Sample Readme'
		});
		expect(closeMock).toHaveBeenCalledTimes(1);
		expect(webviewWindowConstructorMock).toHaveBeenCalledWith(
			'asset-preview',
			expect.objectContaining({
				url: expect.stringMatching(/\/preview\/asset\/project-9\/asset-3$/)
			})
		);
	});

	it('retargets the existing detached preview window without stealing focus', async () => {
		getByLabelMock.mockResolvedValue({
			label: 'asset-preview',
			show: showMock,
			unminimize: unminimizeMock,
			setFocus: setFocusMock,
			close: closeMock
		});

		const { detachedAssetPreviewWindowService } =
			await import('./detached-asset-preview-window.js');

		await detachedAssetPreviewWindowService.retarget({
			projectId: 'project-2',
			assetId: 'asset-9',
			assetName: 'Wall Panels'
		});

		expect(getByLabelMock).toHaveBeenCalledWith('asset-preview');
		expect(webviewWindowConstructorMock).not.toHaveBeenCalled();
		expect(emitToMock).toHaveBeenCalledWith('asset-preview', 'asset-preview:navigate', {
			projectId: 'project-2',
			assetId: 'asset-9',
			assetName: 'Wall Panels'
		});
		expect(setFocusMock).not.toHaveBeenCalled();
		expect(showMock).toHaveBeenCalledTimes(1);
		expect(unminimizeMock).toHaveBeenCalledTimes(1);
	});

	it('creates the detached preview window and probes its visibility on tauri://created', async () => {
		getByLabelMock.mockResolvedValue(null);

		const { detachedAssetPreviewWindowService } =
			await import('./detached-asset-preview-window.js');

		const openPromise = detachedAssetPreviewWindowService.open({
			projectId: 'project-3',
			assetId: 'asset-12',
			assetName: 'Mezzanine'
		});

		await Promise.resolve();

		expect(webviewWindowConstructorMock).toHaveBeenCalledWith(
			'asset-preview',
			expect.objectContaining({
				url: expect.stringMatching(/\/preview\/asset\/project-3\/asset-12$/),
				title: 'Preview • Mezzanine',
				focus: true,
				decorations: true,
				resizable: true
			})
		);

		await onceHandlers.get('tauri://created')?.();
		await openPromise;

		expect(showMock).toHaveBeenCalledTimes(1);
		expect(unminimizeMock).toHaveBeenCalledTimes(1);
		expect(setFocusMock).toHaveBeenCalledTimes(1);
	});

	it('records diagnostics when tauri://error fires during window creation', async () => {
		getByLabelMock.mockResolvedValue(null);

		const { detachedAssetPreviewWindowService } =
			await import('./detached-asset-preview-window.js');

		const openPromise = detachedAssetPreviewWindowService.open({
			projectId: 'project-4',
			assetId: 'asset-14',
			assetName: 'Columns'
		});

		await Promise.resolve();

		await onceHandlers.get('tauri://error')?.({ payload: 'boom' });

		await expect(openPromise).rejects.toThrow('boom');
		expect(logErrorMock).toHaveBeenCalled();
	});

	it('reports whether the detached preview window still exists', async () => {
		getByLabelMock.mockResolvedValueOnce({
			label: 'asset-preview',
			show: showMock,
			unminimize: unminimizeMock,
			setFocus: setFocusMock,
			close: closeMock
		});

		const { detachedAssetPreviewWindowService } =
			await import('./detached-asset-preview-window.js');

		await expect(detachedAssetPreviewWindowService.isOpen()).resolves.toBe(true);

		getByLabelMock.mockResolvedValueOnce(null);
		await expect(detachedAssetPreviewWindowService.isOpen()).resolves.toBe(false);
	});
});
