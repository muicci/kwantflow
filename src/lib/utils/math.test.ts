import { describe, it, expect } from 'vitest';
import { Decimal } from 'decimal.js';
import { dec, normalizePositiveDecimalString } from './math.js';

describe('math utils', () => {
	describe('dec', () => {
		it('should create a Decimal instance from a number', () => {
			const result = dec(10);
			expect(result).toBeInstanceOf(Decimal);
			expect(result.toNumber()).toBe(10);
		});

		it('should create a Decimal instance from a string', () => {
			const result = dec('10.5');
			expect(result).toBeInstanceOf(Decimal);
			expect(result.toNumber()).toBe(10.5);
		});

		it('should create a Decimal instance from another Decimal', () => {
			const original = new Decimal('42');
			const result = dec(original);
			expect(result).toBeInstanceOf(Decimal);
			expect(result.toNumber()).toBe(42);
		});
	});

	describe('normalizePositiveDecimalString', () => {
		it('should parse and normalize a valid integer string', () => {
			expect(normalizePositiveDecimalString('42')).toBe('42');
		});

		it('should parse and normalize a valid decimal string', () => {
			expect(normalizePositiveDecimalString('3.14159')).toBe('3.14159');
		});

		it('should remove leading and trailing whitespace', () => {
			expect(normalizePositiveDecimalString('  100.50  ')).toBe('100.5');
		});

		it('should strip trailing zeros after the decimal point', () => {
			expect(normalizePositiveDecimalString('10.5000')).toBe('10.5');
			expect(normalizePositiveDecimalString('42.0')).toBe('42');
		});

		it('should strip leading zeros', () => {
			expect(normalizePositiveDecimalString('0007.5')).toBe('7.5');
			expect(normalizePositiveDecimalString('0042')).toBe('42');
		});

		it('should expand exponential notation to plain decimal form', () => {
			expect(normalizePositiveDecimalString('1e-6')).toBe('0.000001');
			expect(normalizePositiveDecimalString('1.5e3')).toBe('1500');
		});

		it('should handle large positive numbers', () => {
			expect(normalizePositiveDecimalString('9999999999999999.99')).toBe('9999999999999999.99');
		});

		it('should throw an error for non-string input', () => {
			// @ts-expect-error - testing invalid input type
			expect(() => normalizePositiveDecimalString(42)).toThrow('Value must be a non-empty string.');
			// @ts-expect-error - testing invalid input type
			expect(() => normalizePositiveDecimalString(null)).toThrow(
				'Value must be a non-empty string.'
			);
			// @ts-expect-error - testing invalid input type
			expect(() => normalizePositiveDecimalString(undefined)).toThrow(
				'Value must be a non-empty string.'
			);
		});

		it('should throw an error for empty or whitespace-only string', () => {
			expect(() => normalizePositiveDecimalString('')).toThrow('Value must be a non-empty string.');
			expect(() => normalizePositiveDecimalString('   ')).toThrow(
				'Value must be a non-empty string.'
			);
		});

		it('should throw an error for unparseable strings', () => {
			expect(() => normalizePositiveDecimalString('abc')).toThrow('Invalid decimal value: "abc".');
			expect(() => normalizePositiveDecimalString('12,34')).toThrow(
				'Invalid decimal value: "12,34".'
			);
		});

		it('should throw an error for NaN', () => {
			expect(() => normalizePositiveDecimalString('NaN')).toThrow('Value must be finite: "NaN".');
		});

		it('should throw an error for Infinity', () => {
			expect(() => normalizePositiveDecimalString('Infinity')).toThrow(
				'Value must be finite: "Infinity".'
			);
			expect(() => normalizePositiveDecimalString('+Infinity')).toThrow(
				'Value must be finite: "+Infinity".'
			);
		});

		it('should throw an error for zero', () => {
			expect(() => normalizePositiveDecimalString('0')).toThrow(
				'Value must be positive (greater than zero): "0".'
			);
			expect(() => normalizePositiveDecimalString('0.000')).toThrow(
				'Value must be positive (greater than zero): "0.000".'
			);
		});

		it('should throw an error for negative numbers', () => {
			expect(() => normalizePositiveDecimalString('-10')).toThrow('Value must be positive: "-10".');
			expect(() => normalizePositiveDecimalString('-0.5')).toThrow(
				'Value must be positive: "-0.5".'
			);
			expect(() => normalizePositiveDecimalString('-0')).toThrow(
				'Value must be positive (greater than zero): "-0".'
			); // decimal.js preserves negative zero
		});
	});
});
