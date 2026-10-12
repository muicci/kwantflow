import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tileImageWithGridCoordinates } from './image-tiler.js';

describe('image tiler', () => {
	let dataUrlCounter = 0;
	let renderedCanvasDimensions: Array<{ width: number; height: number }> = [];

	beforeEach(() => {
		dataUrlCounter = 0;
		renderedCanvasDimensions = [];

		vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
			if (tagName === 'canvas') {
				const canvas = {
					width: 0,
					height: 0,
					getContext: () => ({
						fillStyle: '#ffffff',
						fillRect() {},
						drawImage() {},
						beginPath() {},
						moveTo() {},
						lineTo() {},
						stroke() {},
						fillText() {},
						strokeStyle: '',
						lineWidth: 0,
						font: ''
					}),
					toDataURL: function (mimeType?: string) {
						renderedCanvasDimensions.push({
							width: this.width,
							height: this.height
						});
						return `data:${mimeType ?? 'image/jpeg'};base64,tile-${++dataUrlCounter}`;
					}
				};
				return canvas as unknown as HTMLCanvasElement;
			}
			return document.createElementNS('http://www.w3.org/1999/xhtml', tagName) as HTMLElement;
		});

		globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock');
		globalThis.URL.revokeObjectURL = vi.fn();
		globalThis.Image = class MockImage {
			onload: (() => void) | null = null;
			onerror: (() => void) | null = null;
			width = 2000;
			height = 1200;
			set src(_value: string) {
				queueMicrotask(() => this.onload?.());
			}
		} as unknown as typeof Image;
	});

	it('splits a large image into tiles with overlap and correct coordinate labels', async () => {
		const blob = new Blob(['mock-data'], { type: 'image/jpeg' });
		const tiles = await tileImageWithGridCoordinates(blob);

		// With 2000x1200 image, 1056x576 tile size, and 15% overlap:
		// strideX = 1056 * 0.85 = 898
		// strideY = 576 * 0.85 = 490
		// cols: Math.ceil((2000 - 1056) / 898) + 1 = 3 cols
		// rows: Math.ceil((1200 - 576) / 490) + 1 = 3 rows
		// Total tiles = 3 * 3 = 9
		expect(tiles.length).toBe(9);
		expect(tiles[0].displayName).toBe('Grid A-1');
		expect(tiles[0].inlineData).toBe('tile-1');
		expect(tiles[0].x).toBe(0);
		expect(tiles[0].y).toBe(0);
		expect(tiles[0].width).toBe(1056);
		expect(tiles[0].height).toBe(576);

		expect(tiles[1].displayName).toBe('Grid B-1');
		expect(tiles[1].x).toBe(898);

		expect(tiles[8].displayName).toBe('Grid C-3');
		expect(tiles[8].x).toBe(944); // imgW - tileW = 2000 - 1056 = 944 due to clamp
		expect(tiles[8].y).toBe(624); // imgH - tileH = 1200 - 576 = 624 due to clamp

		expect(renderedCanvasDimensions.length).toBe(9);
		expect(renderedCanvasDimensions[0]).toEqual({ width: 1056, height: 576 });
	});

	it('splits image cleanly when drawOverlay option is false', async () => {
		const blob = new Blob(['mock-data'], { type: 'image/jpeg' });

		const strokeSpy = vi.fn();
		const fillTextSpy = vi.fn();

		vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
			if (tagName === 'canvas') {
				const canvas = {
					width: 0,
					height: 0,
					getContext: () => ({
						fillStyle: '#ffffff',
						fillRect() {},
						drawImage() {},
						beginPath() {},
						moveTo() {},
						lineTo() {},
						stroke: strokeSpy,
						fillText: fillTextSpy,
						strokeStyle: '',
						lineWidth: 0,
						font: ''
					}),
					toDataURL: () => 'data:image/jpeg;base64,tile-clean'
				};
				return canvas as unknown as HTMLCanvasElement;
			}
			return document.createElementNS('http://www.w3.org/1999/xhtml', tagName) as HTMLElement;
		});

		const tiles = await tileImageWithGridCoordinates(blob, { drawOverlay: false });
		expect(tiles.length).toBe(9);
		expect(strokeSpy).not.toHaveBeenCalled();
		expect(fillTextSpy).not.toHaveBeenCalled();
	});
});
