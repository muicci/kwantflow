import { describe, expect, it } from 'vitest';

import { getErrorMessage } from './runtime-form-errors.js';

describe('getErrorMessage', () => {
	it('returns the message from an Error instance', () => {
		expect(getErrorMessage(new Error('duplicate code'))).toBe('duplicate code');
	});

	it('stringifies non-Error values', () => {
		expect(getErrorMessage({ code: 'X' })).toBe('[object Object]');
	});
});
