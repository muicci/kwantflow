import { describe, expect, it } from 'vitest';

import { formatPhoneDraft, normalisePhoneValue } from './phone.js';

describe('phone service', () => {
	it('formats phone drafts by the selected workspace country', () => {
		expect(formatPhoneDraft('0414077617', 'AU')).toBe('0414 077 617');
		expect(formatPhoneDraft('4155552671', 'US')).toBe('(415) 555-2671');
		expect(formatPhoneDraft('07123456789', 'GB')).toBe('07123 456789');
	});

	it('keeps partial drafts editable while still applying country-aware grouping', () => {
		expect(formatPhoneDraft('041407716', 'AU')).toBe('0414 077 16');
	});

	it('normalises phone values into formatted display and E.164 output', () => {
		expect(normalisePhoneValue('0414077617', 'AU')).toEqual({
			displayPhone: '0414 077 617',
			e164: '+61414077617',
			phoneCountryCode: 'AU'
		});
		expect(normalisePhoneValue('4155552671', 'US')).toEqual({
			displayPhone: '(415) 555-2671',
			e164: '+14155552671',
			phoneCountryCode: 'US'
		});
	});

	it('returns a formatted display value without inventing E.164 for invalid input', () => {
		expect(normalisePhoneValue('not a phone', 'AU')).toEqual({
			displayPhone: 'not a phone',
			e164: '',
			phoneCountryCode: 'AU'
		});
	});
});
