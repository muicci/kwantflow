import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PdfViewer from './test-pdf-viewer-host.svelte';

const mocks = vi.hoisted(() => ({
	getDocument: vi.fn(),
	workerDestroy: vi.fn(),
	workerTerminate: vi.fn(),
	readVaultFile: vi.fn(),
	logger: { error: vi.fn(), warn: vi.fn() }
}));

vi.mock('$lib/services/assets', () => ({ readVaultFile: mocks.readVaultFile }));
vi.mock('$lib/services/logger.js', () => ({ createLogger: () => mocks.logger }));
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
	getDocument: mocks.getDocument,
	VerbosityLevel: { ERRORS: 0 },
	PDFWorker: { create: () => ({ destroy: mocks.workerDestroy }) }
}));
vi.mock('pdfjs-dist/legacy/build/pdf.worker.mjs?worker', () => ({
	default: class {
		terminate = mocks.workerTerminate;
	}
}));

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function page() {
	return {
		getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 200 * scale }),
		render: vi.fn((_options: { canvas: HTMLCanvasElement }) => ({
			promise: Promise.resolve(),
			cancel: vi.fn()
		}))
	};
}

function document(numPages = 1) {
	const firstPage = page();
	return { numPages, getPage: vi.fn().mockResolvedValue(firstPage), firstPage };
}

describe('PDF viewer resource lifecycle', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getDocument.mockReset();
		vi.stubGlobal(
			'ResizeObserver',
			class {
				observe() {}
				disconnect() {}
			}
		);
	});
	afterEach(async () => {
		cleanup();
		await Promise.resolve();
		vi.unstubAllGlobals();
	});

	it('destroys a completed loading task on same-source unmount before stopping its owned worker', async () => {
		const pdf = document();
		const destroyed = deferred<void>();
		const task = { promise: Promise.resolve(pdf), destroy: vi.fn(() => destroyed.promise) };
		mocks.getDocument.mockReturnValue(task);
		const view = render(PdfViewer, { pdfBytes: new Uint8Array([1]) });
		await waitFor(() => expect(pdf.firstPage.render).toHaveBeenCalledOnce());
		view.unmount();
		await waitFor(() => expect(task.destroy).toHaveBeenCalledOnce());
		expect(mocks.workerDestroy).not.toHaveBeenCalled();
		expect(mocks.workerTerminate).not.toHaveBeenCalled();
		destroyed.resolve();
		await waitFor(() => expect(mocks.workerTerminate).toHaveBeenCalledOnce());
		expect(mocks.workerDestroy).toHaveBeenCalledOnce();
	});

	it('cleans a failed loading task and reports the load error', async () => {
		const pending = deferred<ReturnType<typeof document>>();
		const task = { promise: pending.promise, destroy: vi.fn().mockResolvedValue(undefined) };
		mocks.getDocument.mockReturnValue(task);
		const view = render(PdfViewer, { pdfBytes: new Uint8Array([1]) });
		await waitFor(() => expect(mocks.getDocument).toHaveBeenCalledOnce());
		pending.reject(new Error('malformed PDF'));
		await waitFor(() => expect(view.getByText('Could not load PDF document')).toBeTruthy());
		expect(task.destroy).toHaveBeenCalledOnce();
		expect(mocks.logger.error).toHaveBeenCalledOnce();
	});

	it('does not start a document after unmount while the same file is still being read', async () => {
		const pending = deferred<Uint8Array>();
		mocks.readVaultFile.mockReturnValueOnce(pending.promise);
		const view = render(PdfViewer, { filePath: 'synthetic.pdf' });
		await waitFor(() => expect(mocks.readVaultFile).toHaveBeenCalledOnce());
		view.unmount();
		pending.resolve(new Uint8Array([1]));
		await Promise.resolve();
		expect(mocks.getDocument).not.toHaveBeenCalled();
		expect(mocks.logger.error).not.toHaveBeenCalled();
	});

	it('ignores an old A load after A to B to A source changes and destroys every old task', async () => {
		const a = new Uint8Array([1]);
		const b = new Uint8Array([2]);
		const oldA = deferred<ReturnType<typeof document>>();
		const oldB = deferred<ReturnType<typeof document>>();
		const current = document(3);
		const tasks = [oldA.promise, oldB.promise, Promise.resolve(current)].map((promise) => ({
			promise,
			destroy: vi.fn().mockResolvedValue(undefined)
		}));
		for (const task of tasks) mocks.getDocument.mockReturnValueOnce(task);
		const view = render(PdfViewer, { pdfBytes: a });
		await waitFor(() => expect(mocks.getDocument).toHaveBeenCalledTimes(1));
		await view.rerender({ pdfBytes: b });
		await waitFor(() => expect(mocks.getDocument).toHaveBeenCalledTimes(2));
		await view.rerender({ pdfBytes: a });
		await waitFor(() => expect(current.firstPage.render).toHaveBeenCalledOnce());
		const staleA = document(9);
		const staleB = document(8);
		oldA.resolve(staleA);
		oldB.resolve(staleB);
		await Promise.resolve();
		expect(tasks[0].destroy).toHaveBeenCalledOnce();
		expect(tasks[1].destroy).toHaveBeenCalledOnce();
		expect(staleA.getPage).not.toHaveBeenCalled();
		expect(staleB.getPage).not.toHaveBeenCalled();
		expect(view.getByText('1 / 3')).toBeTruthy();
		expect(mocks.workerDestroy).not.toHaveBeenCalled();
		const worker = mocks.getDocument.mock.calls[0][0].worker;
		expect(mocks.getDocument.mock.calls.every(([options]) => options.worker === worker)).toBe(true);
	});

	it('does not render a stale page request after a newer zoom request', async () => {
		const first = deferred<ReturnType<typeof page>>();
		const pdf = document();
		pdf.getPage.mockReturnValueOnce(first.promise);
		mocks.getDocument.mockReturnValue({
			promise: Promise.resolve(pdf),
			destroy: vi.fn().mockResolvedValue(undefined)
		});
		const view = render(PdfViewer, { pdfBytes: new Uint8Array([1]) });
		await waitFor(() => expect(pdf.getPage).toHaveBeenCalledOnce());
		await fireEvent.click(view.getByRole('button', { name: 'Zoom in' }));
		await waitFor(() => expect(pdf.firstPage.render).toHaveBeenCalledOnce());
		const stalePage = page();
		first.resolve(stalePage);
		await Promise.resolve();
		expect(stalePage.render).not.toHaveBeenCalled();
		expect(pdf.firstPage.render.mock.calls[0]?.[0].canvas).toBe(
			view.container.querySelector('canvas')
		);
	});

	it('does not render a page resolved after the viewer unmounts', async () => {
		const pendingPage = deferred<ReturnType<typeof page>>();
		const pdf = document();
		pdf.getPage.mockReturnValueOnce(pendingPage.promise);
		const task = { promise: Promise.resolve(pdf), destroy: vi.fn().mockResolvedValue(undefined) };
		mocks.getDocument.mockReturnValue(task);
		const view = render(PdfViewer, { pdfBytes: new Uint8Array([1]) });
		await waitFor(() => expect(pdf.getPage).toHaveBeenCalledOnce());
		view.unmount();
		const stalePage = page();
		pendingPage.resolve(stalePage);
		await Promise.resolve();
		expect(stalePage.render).not.toHaveBeenCalled();
		expect(task.destroy).toHaveBeenCalledOnce();
		expect(mocks.logger.error).not.toHaveBeenCalled();
	});

	it('keeps a newer render cancellable when an old render finishes late', async () => {
		const previous = deferred<void>();
		const current = deferred<void>();
		const cancelPrevious = vi.fn();
		const cancelCurrent = vi.fn();
		const pdf = document();
		pdf.firstPage.render
			.mockReturnValueOnce({ promise: previous.promise, cancel: cancelPrevious })
			.mockReturnValueOnce({ promise: current.promise, cancel: cancelCurrent });
		mocks.getDocument.mockReturnValue({
			promise: Promise.resolve(pdf),
			destroy: vi.fn().mockResolvedValue(undefined)
		});
		const view = render(PdfViewer, { pdfBytes: new Uint8Array([1]) });
		await waitFor(() => expect(pdf.firstPage.render).toHaveBeenCalledTimes(1));
		await fireEvent.click(view.getByRole('button', { name: 'Zoom in' }));
		await waitFor(() => expect(pdf.firstPage.render).toHaveBeenCalledTimes(2));
		expect(cancelPrevious).toHaveBeenCalledOnce();
		previous.resolve();
		await Promise.resolve();
		await fireEvent.click(view.getByRole('button', { name: 'Zoom out' }));
		await waitFor(() => expect(pdf.firstPage.render).toHaveBeenCalledTimes(3));
		expect(cancelCurrent).toHaveBeenCalledOnce();
		current.resolve();
	});
});
