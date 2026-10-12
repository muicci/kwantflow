import { describe, expect, it } from 'vitest';

import {
	getFieldErrorInputClass,
	getFieldErrorMessage,
	getFieldErrorMessageClass,
	getFieldInvalidTone,
	isRequiredFieldError
} from './field-errors.js';

describe('getFieldErrorMessage', () => {
	it('returns null for undefined, null, or empty array', () => {
		expect(getFieldErrorMessage()).toBeNull();
		expect(getFieldErrorMessage(null)).toBeNull();
		expect(getFieldErrorMessage([])).toBeNull();
	});

	it('returns null when array contains only empty or whitespace strings', () => {
		expect(getFieldErrorMessage(['', '  ', '\t'])).toBeNull();
	});

	it('returns the first valid error message and trims whitespace', () => {
		expect(getFieldErrorMessage(['  ', ' Error 1 ', 'Error 2'])).toBe('Error 1');
	});
});

describe('field error presentation', () => {
	it('treats required-field errors as neutral validation guidance', () => {
		expect(isRequiredFieldError('Company is required')).toBe(true);
		expect(getFieldInvalidTone(['Company is required'])).toBe('neutral');
		expect(getFieldErrorInputClass(['Company is required'])).toBe('');
		expect(getFieldErrorMessageClass(['Company is required'])).toBe('field-help px-1');
	});

	it('keeps invalid-format errors destructive', () => {
		expect(isRequiredFieldError('Email must be valid')).toBe(false);
		expect(getFieldInvalidTone(['Email must be valid'])).toBe('destructive');
		expect(getFieldErrorInputClass(['Email must be valid'])).toBe('border-destructive');
		expect(getFieldErrorMessageClass(['Email must be valid'])).toBe(
			'field-help px-1 text-destructive'
		);
	});
});
