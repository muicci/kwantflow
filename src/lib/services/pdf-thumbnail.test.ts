import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const readVaultFileMock = vi.fn();
const renderPdfThumbnailMock = vi.fn();
const loggerMock = {
	trace: vi.fn(),
	debug: vi.fn(),
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn()
};

vi.mock('./assets', () => ({
	readVaultFile: readVaultFileMock
}));

vi.mock('./worker-client', () => ({
	workerClient: {
		getAPI: () => ({
			renderPdfThumbnail: renderPdfThumbnailMock
		})
	}
}));

vi.mock('./logger.js', () => ({
	createLogger: () => loggerMock
}));

describe('pdf thumbnail service', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		vi.useFakeTimers();
		vi.stubGlobal(
			'URL',
			Object.assign(URL, {
				createObjectURL: vi.fn(() => 'blob:thumbnail')
			})
		);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('caches successful thumbnails after the first render', async () => {
		readVaultFileMock.mockResolvedValue(new Uint8Array([1, 2, 3]));
		renderPdfThumbnailMock.mockResolvedValue(new Blob(['thumbnail'], { type: 'image/png' }));

		const { getPdfThumbnail } = await import('./pdf-thumbnail');

		const first = await getPdfThumbnail('workspace/demo.pdf');
		const second = await getPdfThumbnail('workspace/demo.pdf');

		expect(first).toBe('blob:thumbnail');
		expect(second).toBe('blob:thumbnail');
		expect(readVaultFileMock).toHaveBeenCalledTimes(1);
		expect(renderPdfThumbnailMock).toHaveBeenCalledTimes(1);
	});

	it('suppresses repeated failures for the same file during the cooldown window', async () => {
		readVaultFileMock.mockResolvedValue(new Uint8Array([9, 9, 9]));
		renderPdfThumbnailMock.mockRejectedValue(new Error('worker-canvas failed'));

		const { getPdfThumbnail } = await import('./pdf-thumbnail');

		await expect(getPdfThumbnail('workspace/failing.pdf')).resolves.toBeNull();
		await expect(getPdfThumbnail('workspace/failing.pdf')).resolves.toBeNull();

		expect(readVaultFileMock).toHaveBeenCalledTimes(1);
		expect(renderPdfThumbnailMock).toHaveBeenCalledTimes(1);
		expect(loggerMock.error).toHaveBeenCalledTimes(1);
	});

	it('retries a failed thumbnail render after the cooldown expires', async () => {
		readVaultFileMock.mockResolvedValue(new Uint8Array([7, 7, 7]));
		renderPdfThumbnailMock
			.mockRejectedValueOnce(new Error('worker-canvas failed'))
			.mockResolvedValueOnce(new Blob(['thumbnail'], { type: 'image/png' }));

		const { getPdfThumbnail } = await import('./pdf-thumbnail');

		await expect(getPdfThumbnail('workspace/retry.pdf')).resolves.toBeNull();
		await vi.advanceTimersByTimeAsync(30_001);
		await expect(getPdfThumbnail('workspace/retry.pdf')).resolves.toBe('blob:thumbnail');

		expect(readVaultFileMock).toHaveBeenCalledTimes(2);
		expect(renderPdfThumbnailMock).toHaveBeenCalledTimes(2);
		expect(loggerMock.error).toHaveBeenCalledTimes(1);
	});
});
