import { describe, expect, it } from 'vitest';

import { clampTablePageIndex, getTablePageCount, paginateTableRows } from './table-pagination.js';

describe('table-pagination utils', () => {
	describe('getTablePageCount', () => {
		it('returns 1 when totalRows is 0', () => {
			expect(getTablePageCount(0, 10)).toBe(1);
		});

		it('returns 1 when totalRows is negative', () => {
			expect(getTablePageCount(-5, 10)).toBe(1);
		});

		it('returns correct page count for exact multiples', () => {
			expect(getTablePageCount(20, 10)).toBe(2);
			expect(getTablePageCount(50, 10)).toBe(5);
		});

		it('returns correct page count for partial pages', () => {
			expect(getTablePageCount(21, 10)).toBe(3);
			expect(getTablePageCount(1, 10)).toBe(1);
			expect(getTablePageCount(11, 10)).toBe(2);
		});
	});

	describe('clampTablePageIndex', () => {
		it('clamps negative index to 0', () => {
			expect(clampTablePageIndex(-1, 50, 10)).toBe(0);
		});

		it('clamps index exceeding page count to last page index', () => {
			// 50 rows, 10 per page -> 5 pages (indices 0-4)
			expect(clampTablePageIndex(5, 50, 10)).toBe(4);
			expect(clampTablePageIndex(100, 50, 10)).toBe(4);
		});

		it('returns index as is when within valid range', () => {
			expect(clampTablePageIndex(2, 50, 10)).toBe(2);
			expect(clampTablePageIndex(0, 50, 10)).toBe(0);
			expect(clampTablePageIndex(4, 50, 10)).toBe(4);
		});

		it('handles 0 rows (returns 0 as it is the only valid index for 1 page)', () => {
			expect(clampTablePageIndex(0, 0, 10)).toBe(0);
			expect(clampTablePageIndex(5, 0, 10)).toBe(0);
		});
	});

	describe('paginateTableRows', () => {
		const rows = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

		it('returns first page of rows', () => {
			expect(paginateTableRows(rows, 0, 3)).toEqual([1, 2, 3]);
		});

		it('returns middle page of rows', () => {
			expect(paginateTableRows(rows, 1, 3)).toEqual([4, 5, 6]);
		});

		it('returns partial last page', () => {
			expect(paginateTableRows(rows, 3, 3)).toEqual([10]);
		});

		it('returns empty array if page index is out of bounds', () => {
			expect(paginateTableRows(rows, 4, 3)).toEqual([]);
		});

		it('returns empty array for empty rows', () => {
			expect(paginateTableRows([], 0, 10)).toEqual([]);
		});
	});
});
