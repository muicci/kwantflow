import { describe, expect, it } from 'vitest';

import {
	createQuotePdfExportDates,
	resolveQuotePdfDefaults,
	summariseQuotePackageWarnings
} from './quote-pdf-export';

describe('quote pdf export helpers', () => {
	it('resolves workspace-backed defaults and MVP fallbacks in one place', () => {
		expect(
			resolveQuotePdfDefaults({
				countryCode: '',
				currencyCode: '',
				currencySymbol: '',
				dateFormat: '',
				languageLocale: '',
				numberLocale: '',
				validityDays: 0
			})
		).toEqual({
			countryCode: 'AU',
			currencyCode: 'AUD',
			currencySymbol: '$',
			dateFormat: 'en-AU',
			languageLocale: 'en-AU',
			numberLocale: 'en-AU',
			validityDays: 30,
			paymentTerms: 'Payment Terms: Due on receipt.',
			termsFallback:
				'This quotation is based on the information provided and is subject to final review of any issued for construction documents, measurements, and site conditions.'
		});
	});

	it('combines workspace quote terms, inclusions, and exclusions for PDF preview and export', () => {
		expect(
			resolveQuotePdfDefaults({
				validityDays: 14,
				paymentTerms: '20% deposit, balance on completion.',
				defaultInclusions: 'Shop drawings\nPowder coating',
				defaultExclusions: 'Site cranage',
				defaultTerms: 'Subject to site measure.'
			})
		).toMatchObject({
			validityDays: 14,
			paymentTerms: '20% deposit, balance on completion.',
			termsFallback:
				'Inclusions:\nShop drawings\nPowder coating\n\nExclusions:\nSite cranage\n\nSubject to site measure.'
		});
	});

	it('creates quote export dates from the resolved validity period', () => {
		const dates = createQuotePdfExportDates(0, {
			numberLocale: 'en-AU',
			dateFormat: 'en-AU',
			validityDays: 30
		});

		expect(dates).toEqual({
			issuedDate: '01/01/1970',
			validUntilDate: '31/01/1970'
		});
	});

	it('summarises omitted attachment outcomes into one user-facing warning', () => {
		expect(
			summariseQuotePackageWarnings([
				{
					file_id: 'file-1',
					file_name: 'Drawing A.pdf',
					status: 'appended',
					reason: null
				},
				{
					file_id: 'file-2',
					file_name: 'Drawing B.pdf',
					status: 'omitted',
					reason: 'Could not read or append the selected PDF.'
				}
			])
		).toEqual(['1 selected PDF attachment was omitted from the package.']);
	});
});
