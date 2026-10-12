import { describe, expect, it } from 'vitest';

import { normaliseEmailValue } from './email.js';

describe('email service', () => {
	it('trims and lowercases email values for persistence', () => {
		expect(normaliseEmailValue('  MiA.Collins@Example.COM  ')).toBe('mia.collins@example.com');
	});

	it('returns an empty string for empty-like values', () => {
		expect(normaliseEmailValue('   ')).toBe('');
		expect(normaliseEmailValue(null)).toBe('');
		expect(normaliseEmailValue(undefined)).toBe('');
	});
});
