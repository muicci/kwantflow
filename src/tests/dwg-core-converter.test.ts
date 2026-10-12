import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractDwgEntityMetadata } from '../lib/services/dwg-core-converter.js';

describe('dwg-core-converter', () => {
	let mockLibreDwgInstance: any;
	let mockLogger: any;
	let mockCreate: any;

	beforeEach(async () => {
		vi.resetModules();

		mockLibreDwgInstance = {
			dwg_read_data: vi.fn(),
			convert: vi.fn(),
			dwg_free: vi.fn()
		};

		mockCreate = vi.fn().mockResolvedValue(mockLibreDwgInstance);

		vi.doMock('@mlightcad/libredwg-web', () => {
			return {
				LibreDwg: {
					create: mockCreate
				},
				Dwg_File_Type: {
					DWG: 1
				}
			};
		});

		mockLogger = {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn()
		};
		vi.doMock('../lib/services/logger.js', () => {
			return {
				createLogger: vi.fn().mockReturnValue(mockLogger)
			};
		});
	});

	afterEach(() => {
		vi.doUnmock('@mlightcad/libredwg-web');
		vi.doUnmock('../lib/services/logger.js');
		vi.clearAllMocks();
	});

	it('should log error and throw when libreDWG fails to read (catch block)', async () => {
		const mockError = new Error('Read mocked failure');
		mockLibreDwgInstance.dwg_read_data.mockImplementationOnce(() => {
			throw mockError;
		});
		const { convertDwgToDxf } = await import('../lib/services/dwg-core-converter.js');

		const dwgBytes = new Uint8Array([1, 2, 3]);

		await expect(convertDwgToDxf(dwgBytes)).rejects.toThrowError(/Read mocked failure/);
	});

	it('should throw an error when read returns null', async () => {
		mockLibreDwgInstance.dwg_read_data.mockReturnValueOnce(null);
		const { convertDwgToDxf } = await import('../lib/services/dwg-core-converter.js');

		const dwgBytes = new Uint8Array([1, 2, 3]);

		await expect(convertDwgToDxf(dwgBytes)).rejects.toThrowError(/DWG: read returned null/);
	});

	it('should throw an error when conversion returns null', async () => {
		mockLibreDwgInstance.dwg_read_data.mockReturnValueOnce({});
		mockLibreDwgInstance.convert.mockReturnValueOnce(null);
		const { convertDwgToDxf } = await import('../lib/services/dwg-core-converter.js');

		const dwgBytes = new Uint8Array([1, 2, 3]);

		await expect(convertDwgToDxf(dwgBytes)).rejects.toThrowError(/DWG: convert returned null/);
	});

	it('should return successfully when entities are found', async () => {
		mockLibreDwgInstance.dwg_read_data.mockReturnValueOnce({});
		const mockDb = {
			entities: [
				{ type: 'LINE', layer: '0', startPoint: { x: 0, y: 0 }, endPoint: { x: 10, y: 10 } }
			],
			tables: { LAYER: { entries: [] }, BLOCK_RECORD: { entries: [] } }
		};
		mockLibreDwgInstance.convert.mockReturnValueOnce(mockDb);
		const { convertDwgToDxf } = await import('../lib/services/dwg-core-converter.js');

		const dwgBytes = new Uint8Array([1, 2, 3]);

		const result = await convertDwgToDxf(dwgBytes);
		expect(result.dxfContent.length).toBeGreaterThan(100);
		expect(result.metadata).toContain('Entities: 1');
	});

	describe('extractDwgEntityMetadata', () => {
		it('handles empty object correctly', () => {
			const result = extractDwgEntityMetadata({});
			expect(result).toEqual({
				entityCount: 0,
				layerCount: 0,
				layers: [],
				textLabels: [],
				dimensionValues: []
			});
		});

		it('ignores null/undefined entities', () => {
			const db = {
				entities: [null, undefined, { type: 'LINE', layer: 'L1' }, null]
			};
			const result = extractDwgEntityMetadata(db);
			expect(result.entityCount).toBe(1);
			expect(result.layers[0].name).toBe('L1');
			expect(result.layers[0].total).toBe(1);
		});

		it('extracts basic entity and layer counts', () => {
			const db = {
				entities: [
					{ type: 'LINE', layer: 'L1' },
					{ type: 'CIRCLE', layer: 'L1' },
					{ type: 'LINE', layer: 'L2' }
				],
				tables: { LAYER: { entries: [1, 2, 3, 4] } }
			};
			const result = extractDwgEntityMetadata(db);
			expect(result.entityCount).toBe(3);
			expect(result.layerCount).toBe(4);
		});

		it('correctly groups and sorts entity types by layer (by total, then by type count)', () => {
			const db = {
				entities: [
					{ type: 'LINE', layer: 'L2' },
					{ type: 'ARC', layer: 'L1' },
					{ type: 'LINE', layer: 'L1' },
					{ type: 'LINE', layer: 'L1' },
					{ type: 'CIRCLE', layer: 'L1' },
					{ type: 'CIRCLE', layer: 'L2' },
					{ type: 'CIRCLE', layer: 'L2' },
					{ type: 'CIRCLE', layer: 'L2' },
					{ type: 'CIRCLE', layer: 'L2' }
				]
			};

			const result = extractDwgEntityMetadata(db);
			expect(result.layers).toHaveLength(2);

			// L2 should be first
			expect(result.layers[0].name).toBe('L2');
			expect(result.layers[0].total).toBe(5);
			// Entity types for L2 sorted by count desc
			expect(result.layers[0].entityTypes[0]).toEqual({ type: 'CIRCLE', count: 4 });
			expect(result.layers[0].entityTypes[1]).toEqual({ type: 'LINE', count: 1 });

			// L1 should be second
			expect(result.layers[1].name).toBe('L1');
			expect(result.layers[1].total).toBe(4);
			expect(result.layers[1].entityTypes[0]).toEqual({ type: 'LINE', count: 2 });
		});

		it('extracts text values, ignoring empty strings', () => {
			const db = {
				entities: [
					{ type: 'TEXT', text: 'Hello' },
					{ type: 'MTEXT', value: ' World ' },
					{ type: 'TEXT', text: ' ' },
					{ type: 'MTEXT', text: '' },
					{ type: 'LINE', text: 'Should not extract this' }
				]
			};
			const result = extractDwgEntityMetadata(db);
			expect(result.textLabels).toEqual(['Hello', 'World']);
		});

		it('extracts dimension values', () => {
			const db = {
				entities: [
					{ type: 'DIMENSION', text: '100' },
					{ type: 'DIMLINEAR', text: '200 ' },
					{ type: 'DIMALIGNED', text: ' 300' },
					{ type: 'DIMENSION', text: ' ' }
				]
			};
			const result = extractDwgEntityMetadata(db);
			expect(result.dimensionValues).toEqual(['100', '200', '300']);
		});

		it('truncates text values to 50 items and dimension values to 30 items', () => {
			const entities = [];
			for (let i = 0; i < 60; i++) {
				entities.push({ type: 'TEXT', text: `T${i}` });
			}
			for (let i = 0; i < 40; i++) {
				entities.push({ type: 'DIMENSION', text: `D${i}` });
			}
			const result = extractDwgEntityMetadata({ entities });

			expect(result.textLabels).toHaveLength(50);
			expect(result.textLabels[49]).toBe('T49');

			expect(result.dimensionValues).toHaveLength(30);
			expect(result.dimensionValues[29]).toBe('D29');
		});
	});
});
