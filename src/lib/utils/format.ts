import { workspaceState } from '../state/workspace.svelte';
import { formatLocalisedCurrency, formatLocalisedDate } from '../services/localisation.js';
import { formatRFQDate } from './date.js';

export function formatCurrency(amount: number): string {
	return formatLocalisedCurrency(amount, {
		countryCode: workspaceState.countryCode,
		currencyCode: workspaceState.currencyCode,
		dateFormat: workspaceState.dateFormat,
		numberLocale: workspaceState.numberLocale
	});
}

export function formatDate(dateStr: string | Date): string {
	if (dateStr instanceof Date) {
		return formatLocalisedDate(dateStr, {
			countryCode: workspaceState.countryCode,
			dateFormat: workspaceState.dateFormat,
			languageLocale: workspaceState.languageLocale,
			numberLocale: workspaceState.numberLocale
		});
	}
	return formatRFQDate(dateStr);
}
