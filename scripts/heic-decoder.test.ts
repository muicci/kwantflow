// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import createLibheif from 'libheif-js/libheif-wasm/libheif-bundle.mjs';

describe('bundled local HEIC decoder', () => {
	it('decodes the project-owned HEIC fixture through the real embedded WASM', async () => {
		const libheif = await createLibheif();
		expect(libheif.heif_get_version()).toBe('1.23.6');
		const decoder = new libheif.HeifDecoder();
		const images = decoder.decode(
			new Uint8Array(readFileSync('tests/fixtures/intake/red-square.heic'))
		);
		try {
			expect(images).toHaveLength(1);
			const image = images[0];
			expect([image.get_width(), image.get_height()]).toEqual([16, 16]);
			const pixels = {
				data: new Uint8ClampedArray(16 * 16 * 4),
				width: 16,
				height: 16
			} as ImageData;
			await new Promise<void>((resolve, reject) =>
				image.display(pixels, (displayed) => {
					if (displayed) resolve();
					else reject(new Error('Fixture HEIC did not decode.'));
				})
			);
			expect(pixels.data[0]).toBeGreaterThan(230);
			expect(pixels.data[1]).toBeLessThan(20);
			expect(pixels.data[2]).toBeLessThan(20);
			expect(pixels.data[3]).toBe(255);
		} finally {
			for (const image of images) image.free();
			if (decoder.decoder) libheif.heif_context_free(decoder.decoder);
		}
	});

	it('rejects a contradictory HEVC bit depth and releases its real handles and context', async () => {
		const libheif = await createLibheif();
		const bytes = Buffer.from(readFileSync('tests/fixtures/intake/red-square.heic'));
		const configuration = bytes.indexOf('hvcC') + 4;
		expect(configuration).toBeGreaterThan(4);
		// hvcC declares 10-bit samples, while this project-owned HEVC bitstream is 8-bit.
		// libheif 1.23.6 fixes this mismatch (GHSA-vv35-6hxg-95x8).
		bytes[configuration + 17] = (bytes[configuration + 17] & 0xf8) | 2;
		bytes[configuration + 18] = (bytes[configuration + 18] & 0xf8) | 2;
		const decoder = new libheif.HeifDecoder();
		const releaseContext = vi.spyOn(libheif, 'heif_context_free');
		const images = decoder.decode(bytes);
		try {
			expect(images).toHaveLength(1);
			const image = images[0];
			const pixels = {
				data: new Uint8ClampedArray(image.get_width() * image.get_height() * 4),
				width: image.get_width(),
				height: image.get_height()
			} as ImageData;
			const displayed = await new Promise<ImageData | null>((resolve) =>
				image.display(pixels, resolve)
			);
			expect(displayed).toBeNull();
		} finally {
			for (const image of images) image.free();
			if (decoder.decoder) libheif.heif_context_free(decoder.decoder);
		}
		expect(releaseContext).toHaveBeenCalledOnce();
		releaseContext.mockRestore();
	});

	it('rejects truncated and invalid files and can decode a valid file afterwards', async () => {
		const libheif = await createLibheif();
		const fixture = new Uint8Array(readFileSync('tests/fixtures/intake/red-square.heic'));
		const decoder = new libheif.HeifDecoder();
		let images: ReturnType<typeof decoder.decode> = [];
		try {
			expect(decoder.decode(new Uint8Array([0, 1, 2, 3]))).toEqual([]);
			expect(decoder.decode(fixture.subarray(0, 32))).toEqual([]);
			images = decoder.decode(fixture);
			expect(images).toHaveLength(1);
			expect([images[0].get_width(), images[0].get_height()]).toEqual([16, 16]);
		} finally {
			for (const image of images) image.free();
			if (decoder.decoder) libheif.heif_context_free(decoder.decoder);
		}
	});
});
