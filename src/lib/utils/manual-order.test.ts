import { describe, expect, it } from 'vitest';

import { buildMergedManualOrderIds } from './manual-order.js';

describe('buildMergedManualOrderIds', () => {
	it('replaces only the visible subset while preserving hidden item positions', () => {
		expect(buildMergedManualOrderIds(['a', 'b', 'c', 'd', 'e'], ['e', 'b', 'd'])).toEqual([
			'a',
			'e',
			'c',
			'b',
			'd'
		]);
	});

	it('returns the full list unchanged when there are no visible ids', () => {
		expect(buildMergedManualOrderIds(['a', 'b', 'c'], [])).toEqual(['a', 'b', 'c']);
	});

	it('throws when the visible ids do not match the source subset', () => {
		expect(() => buildMergedManualOrderIds(['a', 'b', 'c'], ['b', 'x'])).toThrow(/visible rows/i);
	});
});
