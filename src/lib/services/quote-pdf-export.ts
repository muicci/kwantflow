import type { QuotePackageAttachmentOutcome } from '$lib/types/index.js';

export const DEFAULT_QUOTE_PDF_COUNTRY_CODE = 'AU';
export const DEFAULT_QUOTE_PDF_CURRENCY_CODE = 'AUD';
export const DEFAULT_QUOTE_PDF_CURRENCY_SYMBOL = '$';
export const DEFAULT_QUOTE_PDF_DATE_FORMAT = 'en-AU';
export const DEFAULT_QUOTE_PDF_LANGUAGE_LOCALE = 'en-AU';
export const DEFAULT_QUOTE_PDF_NUMBER_LOCALE = 'en-AU';
export const DEFAULT_QUOTE_PDF_VALIDITY_DAYS = 30;
export const DEFAULT_QUOTE_PDF_PAYMENT_TERMS = 'Payment Terms: Due on receipt.';
export const DEFAULT_QUOTE_PDF_TERMS_FALLBACK =
	'This quotation is based on the information provided and is subject to final review of any issued for construction documents, measurements, and site conditions.';

export interface QuotePdfDefaultsInput {
	countryCode?: string | null;
	currencyCode?: string | null;
	currencySymbol?: string | null;
	dateFormat?: string | null;
	languageLocale?: string | null;
	numberLocale?: string | null;
	validityDays?: number | null;
	paymentTerms?: string | null;
	defaultTerms?: string | null;
	defaultInclusions?: string | null;
	defaultExclusions?: string | null;
}

export interface QuotePdfDefaults {
	countryCode: string;
	currencyCode: string;
	currencySymbol: string;
	dateFormat: string;
	languageLocale: string;
	numberLocale: string;
	validityDays: number;
	paymentTerms: string;
	termsFallback: string;
}

function resolveNonEmpty(value: string | null | undefined, fallback: string): string {
	return value?.trim() || fallback;
}

function formatQuotePdfDate(
	timestamp: number,
	locale: Pick<QuotePdfDefaults, 'dateFormat' | 'numberLocale'>
): string {
	return new Intl.DateTimeFormat(locale.numberLocale || locale.dateFormat, {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric'
	}).format(timestamp);
}

export function resolveQuotePdfDefaults(input: QuotePdfDefaultsInput = {}): QuotePdfDefaults {
	return {
		countryCode: resolveNonEmpty(input.countryCode, DEFAULT_QUOTE_PDF_COUNTRY_CODE),
		currencyCode: resolveNonEmpty(input.currencyCode, DEFAULT_QUOTE_PDF_CURRENCY_CODE),
		currencySymbol: resolveNonEmpty(input.currencySymbol, DEFAULT_QUOTE_PDF_CURRENCY_SYMBOL),
		dateFormat: resolveNonEmpty(input.dateFormat, DEFAULT_QUOTE_PDF_DATE_FORMAT),
		languageLocale: resolveNonEmpty(input.languageLocale, DEFAULT_QUOTE_PDF_LANGUAGE_LOCALE),
		numberLocale: resolveNonEmpty(
			input.numberLocale || input.dateFormat,
			DEFAULT_QUOTE_PDF_NUMBER_LOCALE
		),
		validityDays:
			typeof input.validityDays === 'number' && input.validityDays > 0
				? input.validityDays
				: DEFAULT_QUOTE_PDF_VALIDITY_DAYS,
		paymentTerms: resolveNonEmpty(input.paymentTerms, DEFAULT_QUOTE_PDF_PAYMENT_TERMS),
		termsFallback: [
			input.defaultInclusions?.trim() ? `Inclusions:\n${input.defaultInclusions.trim()}` : '',
			input.defaultExclusions?.trim() ? `Exclusions:\n${input.defaultExclusions.trim()}` : '',
			input.defaultTerms?.trim() || DEFAULT_QUOTE_PDF_TERMS_FALLBACK
		]
			.filter(Boolean)
			.join('\n\n')
	};
}

export function createQuotePdfExportDates(
	baseTimestamp: number = Date.now(),
	defaults: Pick<QuotePdfDefaults, 'dateFormat' | 'numberLocale' | 'validityDays'>
): { issuedDate: string; validUntilDate: string } {
	const validUntilTimestamp = baseTimestamp + defaults.validityDays * 24 * 60 * 60 * 1000;
	return {
		issuedDate: formatQuotePdfDate(baseTimestamp, defaults),
		validUntilDate: formatQuotePdfDate(validUntilTimestamp, defaults)
	};
}

export function summariseQuotePackageWarnings(
	attachmentOutcomes: QuotePackageAttachmentOutcome[]
): string[] {
	const omittedCount = attachmentOutcomes.filter((outcome) => outcome.status === 'omitted').length;
	if (omittedCount === 0) return [];
	return [
		`${omittedCount} selected PDF attachment${omittedCount === 1 ? ' was' : 's were'} omitted from the package.`
	];
}
