import { describe, expect, it } from 'vitest';
import {
	formatEstimateGroupedNumber,
	normaliseEstimateNumericDraft
} from '$lib/utils/estimate-numeric-inputs.js';

describe('estimate numeric inputs', () => {
	it('formats grouped numeric inputs with thousands separators', () => {
		expect(formatEstimateGroupedNumber(1000)).toBe('1,000');
		expect(formatEstimateGroupedNumber(11010.5)).toBe('11,010.5');
	});

	it('normalises pasted grouped values back into raw numeric drafts', () => {
		expect(normaliseEstimateNumericDraft('1,000')).toBe('1000');
		expect(normaliseEstimateNumericDraft('11,010.50')).toBe('11010.50');
		expect(normaliseEstimateNumericDraft('')).toBe('');
	});
});
