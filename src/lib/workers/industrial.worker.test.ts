import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IndustrialWorkerAPI } from './industrial.worker';

const mocks = vi.hoisted(() => ({
	expose: vi.fn(),
	getDocument: vi.fn(),
	workerDestroy: vi.fn(),
	workerTerminate: vi.fn(),
	blob: vi.fn()
}));
vi.mock('comlink', () => ({ expose: mocks.expose }));
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
	getDocument: mocks.getDocument,
	PDFWorker: { create: () => ({ destroy: mocks.workerDestroy }) }
}));
vi.mock('pdfjs-dist/legacy/build/pdf.worker.mjs?worker', () => ({
	default: class {
		terminate = mocks.workerTerminate;
	}
}));

describe('industrial PDF thumbnail resource lifecycle', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		mocks.getDocument.mockReset();
		mocks.blob.mockResolvedValue(new Blob(['thumbnail'], { type: 'image/png' }));
		vi.stubGlobal(
			'OffscreenCanvas',
			class {
				getContext() {
					return {};
				}
				convertToBlob = mocks.blob;
			}
		);
	});
	afterEach(() => vi.unstubAllGlobals());

	it.each(['success', 'load', 'page', 'render', 'blob'] as const)(
		'destroys only the loading task on %s',
		async (stage) => {
			const failure = new Error(`synthetic ${stage} failure`);
			const page = {
				getViewport: () => ({ width: 100, height: 200 }),
				render: vi.fn(() => ({
					promise: stage === 'render' ? Promise.reject(failure) : Promise.resolve()
				}))
			};
			const pdf = {
				getPage: vi.fn(() => (stage === 'page' ? Promise.reject(failure) : Promise.resolve(page)))
			};
			const task = {
				promise: stage === 'load' ? Promise.reject(failure) : Promise.resolve(pdf),
				destroy: vi.fn().mockResolvedValue(undefined)
			};
			mocks.getDocument.mockReturnValue(task);
			if (stage === 'blob') mocks.blob.mockRejectedValueOnce(failure);
			await import('./industrial.worker');
			const api = mocks.expose.mock.calls[0][0] as IndustrialWorkerAPI;
			if (stage === 'success')
				await expect(api.renderPdfThumbnail(new Uint8Array([1]))).resolves.toBeInstanceOf(Blob);
			else await expect(api.renderPdfThumbnail(new Uint8Array([1]))).rejects.toBe(failure);
			expect(task.destroy).toHaveBeenCalledOnce();
			expect(mocks.getDocument.mock.calls[0][0].worker).toBeDefined();
			expect(mocks.workerDestroy).not.toHaveBeenCalled();
			expect(mocks.workerTerminate).not.toHaveBeenCalled();
		}
	);

	it('uses one independent worker for concurrent thumbnails and cleans both documents', async () => {
		const page = {
			getViewport: () => ({ width: 100, height: 200 }),
			render: () => ({ promise: Promise.resolve() })
		};
		const tasks = [1, 2].map(() => ({
			promise: Promise.resolve({ getPage: () => Promise.resolve(page) }),
			destroy: vi.fn().mockResolvedValue(undefined)
		}));
		for (const task of tasks) mocks.getDocument.mockReturnValueOnce(task);
		await import('./industrial.worker');
		const api = mocks.expose.mock.calls[0][0] as IndustrialWorkerAPI;
		await Promise.all([
			api.renderPdfThumbnail(new Uint8Array([1])),
			api.renderPdfThumbnail(new Uint8Array([2]))
		]);
		for (const task of tasks) expect(task.destroy).toHaveBeenCalledOnce();
		expect(mocks.getDocument.mock.calls[0][0].worker).toBe(
			mocks.getDocument.mock.calls[1][0].worker
		);
		expect(mocks.workerDestroy).not.toHaveBeenCalled();
		expect(mocks.workerTerminate).not.toHaveBeenCalled();
	});
});
