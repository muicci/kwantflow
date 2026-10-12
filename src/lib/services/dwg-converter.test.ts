import { describe, expect, it, vi } from 'vitest';

// Mock the problematic library BEFORE importing dwg-converter
vi.mock('@linkiez/dxf-renew', () => ({
	Helper: class {
		constructor() {}
	}
}));

import { serializeDxfEntity } from './dwg-converter';

describe('DWG to DXF entity mappings', () => {
	it('maps LINE entities correctly', () => {
		const entity = {
			type: 'LINE',
			startPoint: { x: 10, y: 20 },
			endPoint: { x: 30, y: 40 }
		};

		const lines: string[] = [];
		serializeDxfEntity(lines, entity);

		expect(lines).toEqual(['0\nLINE', '8\n0', '10\n10', '20\n20', '11\n30', '21\n40']);
	});

	it('maps CIRCLE entities correctly', () => {
		const entity = {
			type: 'CIRCLE',
			center: { x: 100, y: 200, z: 50 },
			radius: 25
		};

		const lines: string[] = [];
		serializeDxfEntity(lines, entity);

		expect(lines).toEqual(['0\nCIRCLE', '8\n0', '10\n100', '20\n200', '30\n50', '40\n25']);
	});

	it('handles LINE fallback with missing points', () => {
		const entity = { type: 'LINE' };

		const lines: string[] = [];
		serializeDxfEntity(lines, entity);

		expect(lines).toEqual(['0\nLINE', '8\n0', '10\n0', '20\n0', '11\n0', '21\n0']);
	});

	it('handles CIRCLE fallback with missing properties', () => {
		const entity = { type: 'CIRCLE' };

		const lines: string[] = [];
		serializeDxfEntity(lines, entity);

		expect(lines).toEqual([
			'0\nCIRCLE',
			'8\n0',
			'10\n0',
			'20\n0',
			'40\n1' // Default radius
		]);
	});
});
