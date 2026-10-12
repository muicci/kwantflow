import { SUPPORTED_LANGUAGE_LOCALES } from '$lib/constants/index.js';

export type AppLocale = (typeof SUPPORTED_LANGUAGE_LOCALES)[number];

export type AppMessageKey =
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
	| 'quote.paymentTerms';

const DEFAULT_MESSAGES: Record<AppMessageKey, string> = {
	'quote.title': 'QUOTE',
	'quote.contactName': 'Contact name',
	'quote.walkInContact': 'Walk-in contact',
	'quote.businessId': 'Business ID',
	'quote.taxId': 'Tax ID',
	'quote.quoteNumber': 'Quote number',
	'quote.date': 'Date',
	'quote.validUntil': 'Quote valid until',
	'quote.contact': 'Contact',
	'quote.email': 'Email',
	'quote.phone': 'Phone',
	'quote.address': 'Address',
	'quote.currency': 'Currency',
	'quote.description': 'Description',
	'quote.price': 'Price',
	'quote.quantity': 'Quantity',
	'quote.taxPercent': 'Tax %',
	'quote.amount': 'Amount',
	'quote.projectSite': 'PROJECT / SITE',
	'quote.commercialSummary': 'COMMERCIAL SUMMARY',
	'quote.option': 'Option',
	'quote.leadTime': 'Lead time',
	'quote.requirements': 'SUMMARY OF CONTACT REQUIREMENTS',
	'quote.terms': 'TERMS & CONDITIONS',
	'quote.subtotal': 'Subtotal',
	'quote.total': 'TOTAL',
	'quote.paymentTerms': 'Payment Terms: Due on receipt.'
};

const MESSAGE_CATALOGS: Record<AppLocale, Record<AppMessageKey, string>> = {
	'en-AU': DEFAULT_MESSAGES,
	'en-US': {
		...DEFAULT_MESSAGES,
		'quote.paymentTerms': 'Payment Terms: Due on receipt.'
	},
	'en-GB': DEFAULT_MESSAGES
};

export function resolveAppLocale(locale: string | null | undefined): AppLocale {
	return SUPPORTED_LANGUAGE_LOCALES.includes(locale as AppLocale) ? (locale as AppLocale) : 'en-AU';
}

export function getLocaleMessages(
	locale: string | null | undefined
): Record<AppMessageKey, string> {
	return MESSAGE_CATALOGS[resolveAppLocale(locale)];
}

export function getMessage(locale: string | null | undefined, key: AppMessageKey): string {
	return getLocaleMessages(locale)[key];
}
