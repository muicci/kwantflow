import { describe, expect, it } from 'vitest';
import {
	hasMeaningfulReferenceIdentity,
	isLowSignalReferenceText,
	referenceIdentityQualityScore
} from './reference-quality.js';

describe('isLowSignalReferenceText', () => {
	it('returns false for falsy values', () => {
		expect(isLowSignalReferenceText(null)).toBe(false);
		expect(isLowSignalReferenceText('')).toBe(false);
		expect(isLowSignalReferenceText(undefined)).toBe(false);
	});

	it('returns true for known placeholder terms', () => {
		expect(isLowSignalReferenceText('name')).toBe(true);
		expect(isLowSignalReferenceText('test')).toBe(true);
		expect(isLowSignalReferenceText('tmp')).toBe(true);
	});

	it('returns true for repeated characters (collapsed)', () => {
		expect(isLowSignalReferenceText('a a a')).toBe(true);
		expect(isLowSignalReferenceText('x x x x')).toBe(true);
		expect(isLowSignalReferenceText('1 1 1')).toBe(true);
	});

	it('returns true for long strings with low unique alphabet characters and no spaces', () => {
		expect(isLowSignalReferenceText('abcabc')).toBe(true);
		expect(isLowSignalReferenceText('xyzxyz')).toBe(true);
	});

	it('returns true for long strings with low unique digits and no spaces', () => {
		expect(isLowSignalReferenceText('123123')).toBe(true);
		expect(isLowSignalReferenceText('987987')).toBe(true);
	});

	it('returns false for short alpha strings that are not placeholders', () => {
		expect(isLowSignalReferenceText('short')).toBe(false);
	});

	it('returns true if the vowel ratio is too low and no spaces', () => {
		expect(isLowSignalReferenceText('strngth')).toBe(true); // 0 vowels
		expect(isLowSignalReferenceText('rhythm')).toBe(true); // 0 vowels
	});

	it('returns false for meaningful words', () => {
		expect(isLowSignalReferenceText('steel plate')).toBe(false);
		expect(isLowSignalReferenceText('crane hire')).toBe(false);
		expect(isLowSignalReferenceText('meaningful')).toBe(false);
	});
});

describe('hasMeaningfulReferenceIdentity', () => {
	it('returns true if the name is meaningful', () => {
		expect(hasMeaningfulReferenceIdentity({ name: 'Steel Plate 10mm' })).toBe(true);
	});

	it('returns true if any alias is meaningful', () => {
		expect(hasMeaningfulReferenceIdentity({ name: 'test', aliases: ['Steel Plate 10mm'] })).toBe(
			true
		);
	});

	it('returns false if the name is low signal and no meaningful aliases exist', () => {
		expect(hasMeaningfulReferenceIdentity({ name: 'test', code: 'A123' })).toBe(false);
	});

	it('returns true if no name or aliases exist but code contains letters', () => {
		expect(hasMeaningfulReferenceIdentity({ code: 'A123' })).toBe(true);
	});

	it('returns false if no name or aliases exist and code contains only digits', () => {
		expect(hasMeaningfulReferenceIdentity({ code: '12345' })).toBe(false);
	});

	it('returns false if the object is empty', () => {
		expect(hasMeaningfulReferenceIdentity({})).toBe(false);
	});

	it('returns false if all fields are null or empty', () => {
		expect(hasMeaningfulReferenceIdentity({ name: null, code: '', aliases: [] })).toBe(false);
	});
});

describe('referenceIdentityQualityScore', () => {
	it('returns a positive score for a fully meaningful reference', () => {
		const score = referenceIdentityQualityScore({
			name: 'Steel Plate',
			code: 'SP-10',
			description: '10mm thickness',
			aliases: ['Plate 10mm']
		});
		expect(score).toBe(44); // 20 (alias) + 10 (desc) + 8 (code) + 6 (name with space)
	});

	it('returns a negative score for low signal name', () => {
		const score = referenceIdentityQualityScore({
			name: 'test'
		});
		expect(score).toBe(-80);
	});

	it('returns a negative score for low signal code', () => {
		const score = referenceIdentityQualityScore({
			code: '111'
		});
		expect(score).toBe(-40);
	});

	it('accumulates negative scores if both are low signal', () => {
		const score = referenceIdentityQualityScore({
			name: 'test',
			code: '111'
		});
		expect(score).toBe(-120);
	});

	it('returns 0 for an empty object', () => {
		const score = referenceIdentityQualityScore({});
		expect(score).toBe(0);
	});
});
