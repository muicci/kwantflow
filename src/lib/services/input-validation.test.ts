import { describe, expect, it } from 'vitest';
import { isValidEmailAddress, isValidGenericPhone } from './input-validation.js';

describe('input-validation', () => {
	describe('isValidEmailAddress', () => {
		it('returns true for valid email addresses', () => {
			expect(isValidEmailAddress('test@example.com')).toBe(true);
			expect(isValidEmailAddress('user.name+tag+sorting@example.com')).toBe(true);
			expect(isValidEmailAddress('x@example.com')).toBe(true);
		});

		it('trims whitespace and returns true for valid email addresses', () => {
			expect(isValidEmailAddress('  test@example.com  ')).toBe(true);
			expect(isValidEmailAddress('\ttest@example.com\n')).toBe(true);
		});

		it('returns false for invalid email addresses', () => {
			expect(isValidEmailAddress('test@')).toBe(false);
			expect(isValidEmailAddress('@example.com')).toBe(false);
			expect(isValidEmailAddress('test@example')).toBe(false);
			expect(isValidEmailAddress('test example.com')).toBe(false);
			expect(isValidEmailAddress('test@example..com')).toBe(false);
		});

		it('returns false for null, undefined, or empty strings', () => {
			expect(isValidEmailAddress(null)).toBe(false);
			expect(isValidEmailAddress(undefined)).toBe(false);
			expect(isValidEmailAddress('')).toBe(false);
			expect(isValidEmailAddress('   ')).toBe(false);
		});
	});

	describe('isValidGenericPhone', () => {
		it('returns true for valid generic phone numbers', () => {
			expect(isValidGenericPhone('+1 555-555-5555')).toBe(true);
			expect(isValidGenericPhone('(555) 555-5555')).toBe(true);
			expect(isValidGenericPhone('12345')).toBe(true);
			expect(isValidGenericPhone('+1234567890')).toBe(true);
			expect(isValidGenericPhone('123 456 789')).toBe(true);
		});

		it('trims whitespace and returns true for valid phone numbers', () => {
			expect(isValidGenericPhone('  +1 555-555-5555  ')).toBe(true);
			expect(isValidGenericPhone('\t(555) 555-5555\n')).toBe(true);
		});

		it('returns false for invalid generic phone numbers', () => {
			expect(isValidGenericPhone('1234')).toBe(false); // Too short
			expect(isValidGenericPhone('+1')).toBe(false); // Too short
			expect(isValidGenericPhone('abcde')).toBe(false); // letters
			expect(isValidGenericPhone('555-555-5555ext123')).toBe(false); // letters
			expect(isValidGenericPhone('-123456')).toBe(false); // Starts with dash
		});

		it('returns false for null, undefined, or empty strings', () => {
			expect(isValidGenericPhone(null)).toBe(false);
			expect(isValidGenericPhone(undefined)).toBe(false);
			expect(isValidGenericPhone('')).toBe(false);
			expect(isValidGenericPhone('   ')).toBe(false);
		});
	});
});
