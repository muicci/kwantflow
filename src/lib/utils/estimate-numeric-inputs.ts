import { workspaceState } from '../state/workspace.svelte';

export function normaliseEstimateNumericDraft(value: string): string {
	return value.replaceAll(',', '').trim();
}

export function formatEstimateGroupedNumber(value: number): string {
	if (!Number.isFinite(value)) return '';
	return new Intl.NumberFormat(workspaceState.numberLocale || 'en-AU', {
		maximumFractionDigits: 20,
		useGrouping: true
	}).format(value);
}
