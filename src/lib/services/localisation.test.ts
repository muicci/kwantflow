import { describe, expect, it } from 'vitest';
import {
	resolveLocalisationContext,
	formatLocalisedCurrency,
	formatLocalisedPercent,
	parseDocumentDate,
	formatLocalisedDate,
	getQuoteMessage
} from './localisation.js';

describe('localisation service', () => {
	describe('resolveLocalisationContext', () => {
		it('resolves default AU context when no country code provided', () => {
			const ctx = resolveLocalisationContext({});
			expect(ctx.countryCode).toBe('AU');
			expect(ctx.currencyCode).toBe('AUD');
			expect(ctx.dateFormat).toBe('en-AU');
			expect(ctx.languageLocale).toBe('en-AU');
			expect(ctx.numberLocale).toBe('en-AU');
			expect(ctx.taxDisplayLabel).toBe('GST');
			expect(ctx.taxRatePercentage).toBe(10);
		});

		it('resolves US context defaults', () => {
			const ctx = resolveLocalisationContext({ countryCode: 'US' });
			expect(ctx.countryCode).toBe('US');
			expect(ctx.currencyCode).toBe('USD');
			expect(ctx.dateFormat).toBe('en-US');
			expect(ctx.languageLocale).toBe('en-US');
			expect(ctx.taxDisplayLabel).toBe('Sales tax');
			expect(ctx.taxRatePercentage).toBe(0);
		});

		it('allows overriding specific context values', () => {
			const ctx = resolveLocalisationContext({
				countryCode: 'AU',
				currencyCode: 'USD',
				taxRatePercentage: 15,
				taxDisplayLabel: 'VAT'
			});
			expect(ctx.countryCode).toBe('AU');
			expect(ctx.currencyCode).toBe('USD');
			expect(ctx.taxRatePercentage).toBe(15);
			expect(ctx.taxDisplayLabel).toBe('VAT');
		});
	});

	describe('formatLocalisedCurrency', () => {
		it('formats currency according to AU defaults', () => {
			// Replace non-breaking space with normal space or match properly
			const result = formatLocalisedCurrency(1234.56, { countryCode: 'AU' });
			expect(result.replace(/\s/g, ' ')).toMatch(/\$1,234\.56/);
		});

		it('formats currency according to US defaults', () => {
			const result = formatLocalisedCurrency(1234.56, { countryCode: 'US' });
			expect(result.replace(/\s/g, ' ')).toMatch(/\$1,234\.56/);
		});

		it('formats currency according to GB defaults', () => {
			const result = formatLocalisedCurrency(1234.56, { countryCode: 'GB' });
			expect(result.replace(/\s/g, ' ')).toMatch(/£1,234\.56/);
		});

		it('handles zero and non-finite values', () => {
			expect(formatLocalisedCurrency(0, { countryCode: 'AU' }).replace(/\s/g, ' ')).toMatch(
				/\$0\.00/
			);
			expect(formatLocalisedCurrency(NaN, { countryCode: 'AU' }).replace(/\s/g, ' ')).toMatch(
				/\$0\.00/
			);
			expect(formatLocalisedCurrency(Infinity, { countryCode: 'AU' }).replace(/\s/g, ' ')).toMatch(
				/\$0\.00/
			);
		});
	});

	describe('formatLocalisedPercent', () => {
		it('formats whole percentages without decimal places', () => {
			expect(formatLocalisedPercent(15, { countryCode: 'AU' })).toBe('15');
		});

		it('formats fractional percentages with 2 decimal places', () => {
			expect(formatLocalisedPercent(15.5, { countryCode: 'AU' })).toBe('15.50');
		});

		it('handles zero and non-finite values', () => {
			expect(formatLocalisedPercent(0, { countryCode: 'AU' })).toBe('0');
			expect(formatLocalisedPercent(NaN, { countryCode: 'AU' })).toBe('0');
		});
	});

	describe('parseDocumentDate', () => {
		it('parses YYYY-MM-DD ISO format', () => {
			const date = parseDocumentDate('2023-10-25', { countryCode: 'AU' });
			expect(date.getFullYear()).toBe(2023);
			expect(date.getMonth()).toBe(9); // 0-indexed
			expect(date.getDate()).toBe(25);
		});

		it('parses DD/MM/YYYY for AU context', () => {
			const date = parseDocumentDate('25/10/2023', { countryCode: 'AU' });
			expect(date.getFullYear()).toBe(2023);
			expect(date.getMonth()).toBe(9);
			expect(date.getDate()).toBe(25);
		});

		it('parses MM/DD/YYYY for US context', () => {
			const date = parseDocumentDate('10/25/2023', { countryCode: 'US' });
			expect(date.getFullYear()).toBe(2023);
			expect(date.getMonth()).toBe(9);
			expect(date.getDate()).toBe(25);
		});

		it('returns fallback date for invalid input', () => {
			const date = parseDocumentDate('invalid', { countryCode: 'AU' });
			expect(date.getFullYear()).toBe(2000);
			expect(date.getMonth()).toBe(0);
			expect(date.getDate()).toBe(1);
		});

		it('handles fallback date for unparseable dates in expected format', () => {
			const date = parseDocumentDate('99/99/9999', { countryCode: 'AU' });
			expect(date.getFullYear()).toBe(2000);
			expect(date.getMonth()).toBe(0);
			expect(date.getDate()).toBe(1);
		});
	});

	describe('formatLocalisedDate', () => {
		it('formats date string according to AU defaults', () => {
			expect(formatLocalisedDate('2023-10-25', { countryCode: 'AU' })).toMatch(/25 Oct 2023/);
		});

		it('formats date string according to US defaults', () => {
			expect(formatLocalisedDate('2023-10-25', { countryCode: 'US' })).toMatch(/Oct 25, 2023/);
		});

		it('formats Date object', () => {
			const date = new Date('2023-10-25T12:00:00Z');
			expect(formatLocalisedDate(date, { countryCode: 'AU' })).toMatch(/25 Oct 2023/);
		});

		it('formats timestamp number', () => {
			const timestamp = new Date('2023-10-25T12:00:00Z').getTime();
			expect(formatLocalisedDate(timestamp, { countryCode: 'AU' })).toMatch(/25 Oct 2023/);
		});
	});

	describe('getQuoteMessage', () => {
		it('returns default AU messages', () => {
			expect(getQuoteMessage('en-AU', 'quote.total')).toBe('TOTAL');
			expect(getQuoteMessage('en-AU', 'quote.paymentTerms')).toBe('Payment Terms: Due on receipt.');
		});

		it('returns US specific messages', () => {
			expect(getQuoteMessage('en-US', 'quote.paymentTerms')).toBe('Payment Terms: Due on receipt.');
		});

		it('falls back to AU for unknown locales', () => {
			expect(getQuoteMessage('unknown', 'quote.title')).toBe('QUOTE');
		});
	});
});
