import { describe, expect, it } from 'vitest';
import { base, resolve } from './paths.js';

describe('paths', () => {
	it('exports an empty base string', () => {
		expect(base).toBe('');
	});

	it('resolve returns the same path string', () => {
		expect(resolve('/test-path')).toBe('/test-path');
		expect(resolve('')).toBe('');
		expect(resolve('relative/path')).toBe('relative/path');
	});
});
