import { describe, expect, it } from 'vitest';
import { buildDuplicateCode, buildDuplicateName } from './duplicate-records.js';

describe('duplicate record helpers', () => {
	it('builds a duplicate name with Copy of prefix', () => {
		expect(buildDuplicateName('Atlas Structural', [])).toBe('Copy of Atlas Structural');
	});

	it('increments duplicate names when needed', () => {
		expect(
			buildDuplicateName('Atlas Structural', [
				'Copy of Atlas Structural',
				'Copy of Atlas Structural (2)'
			])
		).toBe('Copy of Atlas Structural (3)');
	});

	it('returns blank duplicate code when source code is empty', () => {
		expect(buildDuplicateCode('', ['MAT-001'])).toBe('');
	});

	it('builds a duplicate code with COPY suffix', () => {
		expect(buildDuplicateCode('MAT-001', [])).toBe('MAT-001-COPY');
	});

	it('increments duplicate codes when needed', () => {
		expect(buildDuplicateCode('MAT-001', ['MAT-001-COPY', 'MAT-001-COPY-2'])).toBe(
			'MAT-001-COPY-3'
		);
	});
});
