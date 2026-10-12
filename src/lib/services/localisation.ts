import {
	getWorkspaceCountryLanguageLocale,
	getWorkspaceCountryMeasurementUnit,
	getWorkspaceCountryNumberLocale,
	getWorkspaceCountryProfile,
	getWorkspaceCountryTaxDefaults
} from '$lib/constants/index.js';
import { getMessage } from '$lib/i18n/messages.js';

type LocalisationContext = {
	countryCode?: string | null;
	currencyCode?: string | null;
	dateFormat?: string | null;
	languageLocale?: string | null;
	numberLocale?: string | null;
	taxDisplayLabel?: string | null;
	taxRatePercentage?: number | null;
};

function normalizeCountryCode(countryCode: string | null | undefined): string {
	const normalized = (countryCode ?? '').trim().toUpperCase();
	return /^[A-Z]{2}$/.test(normalized) ? normalized : 'AU';
}

export function resolveLocalisationContext(context: LocalisationContext) {
	const countryCode = normalizeCountryCode(context.countryCode);
	const countryProfile = getWorkspaceCountryProfile(countryCode);
	const taxDefaults = getWorkspaceCountryTaxDefaults(countryCode);
	return {
		countryCode,
		currencyCode: context.currencyCode || countryProfile.currencyCode,
		dateFormat: context.dateFormat || countryProfile.dateFormat,
		languageLocale: context.languageLocale || getWorkspaceCountryLanguageLocale(countryCode),
		numberLocale: context.numberLocale || getWorkspaceCountryNumberLocale(countryCode),
		measurementUnit: getWorkspaceCountryMeasurementUnit(countryCode),
		taxDisplayLabel: context.taxDisplayLabel || taxDefaults.taxDisplayLabel,
		taxRatePercentage:
			typeof context.taxRatePercentage === 'number'
				? context.taxRatePercentage
				: taxDefaults.taxRatePercentage
	};
}

export function formatLocalisedCurrency(
	value: number,
	context: Pick<LocalisationContext, 'countryCode' | 'currencyCode' | 'dateFormat' | 'numberLocale'>
): string {
	const resolved = resolveLocalisationContext(context);
	return new Intl.NumberFormat(resolved.numberLocale || resolved.dateFormat, {
		style: 'currency',
		currency: resolved.currencyCode,
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
		useGrouping: true
	}).format(Number.isFinite(value) ? value : 0);
}

export function formatLocalisedPercent(
	value: number,
	context: Pick<LocalisationContext, 'countryCode' | 'dateFormat' | 'numberLocale'>
): string {
	const resolved = resolveLocalisationContext(context);
	const safeValue = Number.isFinite(value) ? value : 0;
	return new Intl.NumberFormat(resolved.numberLocale || resolved.dateFormat, {
		maximumFractionDigits: safeValue % 1 === 0 ? 0 : 2,
		minimumFractionDigits: safeValue % 1 === 0 ? 0 : 2
	}).format(safeValue);
}

export function parseDocumentDate(
	value: string,
	context: Pick<LocalisationContext, 'countryCode' | 'dateFormat'>
): Date {
	const resolved = resolveLocalisationContext(context);
	if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		const parsed = new Date(`${value}T12:00:00.000Z`);
		const yearStr = value.substring(0, 4);
		const isValidDate = !Number.isNaN(parsed.getTime()) && parsed.getFullYear() === Number(yearStr);
		return isValidDate ? parsed : new Date('2000-01-01T12:00:00.000Z');
	}

	const [day = '1', month = '1', year = '2000'] = value.split('/');
	const isUs = resolved.dateFormat === 'en-US';
	const parsed = new Date(
		Number(year),
		Number((isUs ? day : month) || '1') - 1,
		Number((isUs ? month : day) || '1'),
		12,
		0,
		0,
		0
	);
	const isValidDate = !Number.isNaN(parsed.getTime()) && parsed.getFullYear() === Number(year);
	return isValidDate ? parsed : new Date('2000-01-01T12:00:00.000Z');
}

export function formatLocalisedDate(
	value: string | number | Date,
	context: Pick<
		LocalisationContext,
		'countryCode' | 'dateFormat' | 'languageLocale' | 'numberLocale'
	>
): string {
	const resolved = resolveLocalisationContext(context);
	const date =
		typeof value === 'string'
			? parseDocumentDate(value, resolved)
			: value instanceof Date
				? value
				: new Date(value);
	return new Intl.DateTimeFormat(resolved.numberLocale || resolved.languageLocale, {
		day: '2-digit',
		month: 'short',
		year: 'numeric'
	}).format(date);
}

export function getQuoteMessage(
	locale: string | null | undefined,
	key:
		| 'quote.title'
		| 'quote.contactName'
		| 'quote.walkInContact'
		| 'quote.businessId'
		| 'quote.taxId'
		| 'quote.quoteNumber'
		| 'quote.date'
		| 'quote.validUntil'
		| 'quote.contact'
		| 'quote.email'
		| 'quote.phone'
		| 'quote.address'
		| 'quote.currency'
		| 'quote.description'
		| 'quote.price'
		| 'quote.quantity'
		| 'quote.taxPercent'
		| 'quote.amount'
		| 'quote.projectSite'
		| 'quote.commercialSummary'
		| 'quote.option'
		| 'quote.leadTime'
		| 'quote.requirements'
		| 'quote.terms'
		| 'quote.subtotal'
		| 'quote.total'
		| 'quote.paymentTerms'
): string {
	return getMessage(locale, key);
}
