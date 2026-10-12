import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
	isHeicFile,
	extractZip,
	preprocessIntakeFiles,
	convertHeicToJpeg
} from './intake-preprocessing.js';
import JSZip from 'jszip';
import * as envUtils from '../utils/env.js';
import * as tauriFs from '@tauri-apps/plugin-fs';

vi.mock('../utils/env.js', () => ({
	isTauri: vi.fn()
}));

vi.mock('./logger.js', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn()
	})
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
	readFile: vi.fn(),
	writeFile: vi.fn(),
	mkdir: vi.fn()
}));

vi.mock('@tauri-apps/api/path', () => ({
	appLocalDataDir: vi.fn().mockResolvedValue('/appData'),
	join: vi.fn((...args) => Promise.resolve(args.join('/')))
}));

const heif = vi.hoisted(() => ({ decode: vi.fn(), freeContext: vi.fn() }));
vi.mock('libheif-js/libheif-wasm/libheif-bundle.mjs', () => ({
	default: () => ({
		HeifDecoder: class {
			decoder = 42;
			decode = heif.decode;
		},
		heif_context_free: heif.freeContext
	})
}));

describe('intake-preprocessing', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	describe('isHeicFile', () => {
		it('detects heic/heif extensions correctly', () => {
			expect(isHeicFile('photo.heic')).toBe(true);
			expect(isHeicFile('photo.HEIC')).toBe(true);
			expect(isHeicFile('photo.heif')).toBe(true);
			expect(isHeicFile('photo.jpg')).toBe(false);
			expect(isHeicFile('heic.png')).toBe(false);
		});
	});

	describe('convertHeicToJpeg', () => {
		function image(displayFails = false) {
			return {
				get_width: () => 2,
				get_height: () => 1,
				display: vi.fn((pixels: ImageData, callback: (pixels: ImageData | null) => void) => {
					pixels.data.set([255, 0, 0, 255, 0, 255, 0, 255]);
					callback(displayFails ? null : pixels);
				}),
				free: vi.fn()
			};
		}

		it('converts the first image at existing JPEG quality and releases all decoded handles', async () => {
			const first = image();
			const second = image();
			heif.decode.mockReturnValue([first, second]);
			const putImageData = vi.fn();
			vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
				createImageData: () => ({ data: new Uint8ClampedArray(8), width: 2, height: 1 }),
				putImageData
			} as unknown as CanvasRenderingContext2D);
			const toBlob = vi
				.spyOn(HTMLCanvasElement.prototype, 'toBlob')
				.mockImplementation((callback) => {
					callback({
						arrayBuffer: async () => new Uint8Array([255, 216, 255, 217]).buffer
					} as Blob);
				});
			const bytes = new Uint8Array([0, 1, 2, 3]).subarray(1, 3);
			expect(await convertHeicToJpeg(bytes)).toEqual(new Uint8Array([255, 216, 255, 217]));
			expect(heif.decode).toHaveBeenCalledWith(bytes);
			expect(first.display).toHaveBeenCalledOnce();
			expect(second.display).not.toHaveBeenCalled();
			expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.92);
			expect(putImageData).toHaveBeenCalledOnce();
			expect(first.free).toHaveBeenCalledOnce();
			expect(second.free).toHaveBeenCalledOnce();
			expect(heif.freeContext).toHaveBeenCalledWith(42);
		});

		it('rejects an empty or malformed HEIC and releases the decoder context', async () => {
			heif.decode.mockReturnValue([]);
			await expect(convertHeicToJpeg(new Uint8Array())).rejects.toThrow('no decodable image');
			expect(heif.freeContext).toHaveBeenCalledWith(42);
		});

		it('releases image resources when pixel decoding fails', async () => {
			const first = image(true);
			heif.decode.mockReturnValue([first]);
			vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
				createImageData: () => ({ data: new Uint8ClampedArray(8), width: 2, height: 1 })
			} as unknown as CanvasRenderingContext2D);
			await expect(convertHeicToJpeg(new Uint8Array([1]))).rejects.toThrow('decoding failed');
			expect(first.free).toHaveBeenCalledOnce();
			expect(heif.freeContext).toHaveBeenCalledWith(42);
		});
	});

	describe('extractZip', () => {
		it('extracts valid zip contents', async () => {
			const zip = new JSZip();
			zip.file('test.txt', 'hello world');
			const zipBytes = await zip.generateAsync({ type: 'uint8array' });

			const result = await extractZip(zipBytes, 'test.zip');
			expect(result.entries).toHaveLength(1);
			expect(result.entries[0].name).toBe('test.txt');
			expect(new TextDecoder().decode(result.entries[0].bytes)).toBe('hello world');
			expect(result.truncated).toBe(false);
		});

		it('skips macOS metadata files', async () => {
			const zip = new JSZip();
			zip.file('__MACOSX/._test.txt', 'meta');
			zip.file('folder/.DS_Store', 'meta');
			zip.file('real.txt', 'data');
			const zipBytes = await zip.generateAsync({ type: 'uint8array' });

			const result = await extractZip(zipBytes, 'test.zip');
			expect(result.entries).toHaveLength(1);
			expect(result.entries[0].name).toBe('real.txt');
		});

		it('skips nested archives', async () => {
			const zip = new JSZip();
			zip.file('nested.zip', 'PK...');
			zip.file('real.txt', 'data');
			const zipBytes = await zip.generateAsync({ type: 'uint8array' });

			const result = await extractZip(zipBytes, 'test.zip');
			expect(result.entries).toHaveLength(1);
			expect(result.entries[0].name).toBe('real.txt');
		});

		it('truncates if too many files', async () => {
			const zip = new JSZip();
			for (let i = 0; i < 505; i++) {
				zip.file(`file${i}.txt`, 'data');
			}
			const zipBytes = await zip.generateAsync({ type: 'uint8array' });

			const result = await extractZip(zipBytes, 'test.zip');
			expect(result.entries).toHaveLength(500);
			expect(result.truncated).toBe(true);
			expect(result.truncatedReason).toContain('limit: 500');
		});

		it('handles empty zip extraction safely', async () => {
			const zip = new JSZip();
			const zipBytes = await zip.generateAsync({ type: 'uint8array' });

			const result = await extractZip(zipBytes, 'empty.zip');
			expect(result.entries).toHaveLength(0);
			expect(result.totalFiles).toBe(0);
			expect(result.totalBytes).toBe(0);
			expect(result.truncated).toBe(false);
		});

		it('throws on corrupted or 0-byte zip file', async () => {
			const invalidBytes = new Uint8Array(0);
			await expect(extractZip(invalidBytes, 'corrupt.zip')).rejects.toThrow();
		});
	});

	describe('preprocessIntakeFiles', () => {
		it('returns files as-is if not in Tauri', async () => {
			vi.mocked(envUtils.isTauri).mockReturnValue(false);
			const files = [{ path: '/tmp/test.jpg', name: 'test.jpg' }];
			const result = await preprocessIntakeFiles(files);
			expect(result).toEqual(files);
		});

		it('returns files as-is if extensions do not need preprocessing', async () => {
			vi.mocked(envUtils.isTauri).mockReturnValue(true);
			const files = [{ path: '/tmp/test.pdf', name: 'test.pdf' }];
			const result = await preprocessIntakeFiles(files);
			expect(result).toEqual(files);
		});

		it('handles zip extraction failures gracefully by passing original file', async () => {
			vi.mocked(envUtils.isTauri).mockReturnValue(true);
			vi.mocked(tauriFs.readFile).mockRejectedValue(new Error('Read error'));

			const files = [{ path: '/tmp/test.zip', name: 'test.zip' }];
			const result = await preprocessIntakeFiles(files);

			expect(result).toEqual(files);
		});
	});
});
