import { describe, it, expect } from 'vitest';
import { resolveAppLocale, getLocaleMessages, getMessage } from './messages.js';

describe('resolveAppLocale', () => {
	it('resolves supported locale (en-AU)', () => {
		expect(resolveAppLocale('en-AU')).toBe('en-AU');
	});

	it('resolves supported locale (en-US)', () => {
		expect(resolveAppLocale('en-US')).toBe('en-US');
	});

	it('resolves supported locale (en-GB)', () => {
		expect(resolveAppLocale('en-GB')).toBe('en-GB');
	});

	it('defaults to en-AU for unsupported locale', () => {
		expect(resolveAppLocale('fr-FR')).toBe('en-AU');
	});

	it('defaults to en-AU for null', () => {
		expect(resolveAppLocale(null)).toBe('en-AU');
	});

	it('defaults to en-AU for undefined', () => {
		expect(resolveAppLocale(undefined)).toBe('en-AU');
	});
});

describe('getLocaleMessages', () => {
	it('returns correct messages for en-AU', () => {
		const messages = getLocaleMessages('en-AU');
		expect(messages['quote.title']).toBe('QUOTE');
		expect(messages['quote.paymentTerms']).toBe('Payment Terms: Due on receipt.');
	});

	it('returns correct messages for en-US', () => {
		const messages = getLocaleMessages('en-US');
		expect(messages['quote.title']).toBe('QUOTE');
		expect(messages['quote.paymentTerms']).toBe('Payment Terms: Due on receipt.');
	});

	it('defaults to en-AU messages for unknown locale', () => {
		const messages = getLocaleMessages('es-ES');
		expect(messages['quote.title']).toBe('QUOTE');
		expect(messages['quote.paymentTerms']).toBe('Payment Terms: Due on receipt.');
	});
});

describe('getMessage', () => {
	it('returns specific message for locale', () => {
		expect(getMessage('en-AU', 'quote.title')).toBe('QUOTE');
		expect(getMessage('en-US', 'quote.paymentTerms')).toBe('Payment Terms: Due on receipt.');
	});

	it('falls back to en-AU for unknown locale', () => {
		expect(getMessage('it-IT', 'quote.title')).toBe('QUOTE');
		expect(getMessage('it-IT', 'quote.paymentTerms')).toBe('Payment Terms: Due on receipt.');
	});
});
