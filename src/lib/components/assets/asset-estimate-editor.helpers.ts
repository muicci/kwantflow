import type { CostComponentPreset, EstimateTemplate } from '$lib/types/index.js';
import {
	isLowSignalReferenceText,
	referenceIdentityQualityScore
} from '$lib/utils/reference-quality.js';
import {
	buildReferenceSearchTerms,
	normaliseReferenceSearchText
} from '$lib/utils/reference-search.js';

export type PendingTemplateApplyIntent = {
	templateId: string;
	templateName: string;
};

export type PendingPresetApplyIntent = {
	itemId: string;
	presetId: string;
	presetName: string;
};

type PendingAiAutoApplyResolutionInput = {
	isDirty: boolean;
	hasRestorableBaseline: boolean;
	currentMatchesRestorableBaseline: boolean;
	hasSavedEstimate: boolean;
	currentMatchesSavedEstimate: boolean;
	isCurrentBlank: boolean;
};

type ConfirmFlowResolution<T> =
	{ kind: 'ignore' } | { kind: 'apply'; intent: T } | { kind: 'confirm'; intent: T };

type RankedPickerOption = {
	label: string;
	code: string | null;
	description?: string | null;
	aliases: string[];
	searchText: string;
};

function trimmedValue(value: string | null | undefined): string {
	return value?.trim() ?? '';
}

function normalisePickerSearchValue(value: string | null | undefined): string {
	return normaliseReferenceSearchText(value);
}

function pickerSearchTerms(value: string | null | undefined): string[] {
	return buildReferenceSearchTerms(value);
}

function qualityScore(option: RankedPickerOption): number {
	return referenceIdentityQualityScore({
		code: option.code,
		name: option.label,
		description: option.description,
		aliases: option.aliases
	});
}

function searchScore(option: RankedPickerOption, rawQuery: string): number {
	const query = normalisePickerSearchValue(rawQuery);
	if (query.length === 0) return qualityScore(option);

	const terms = pickerSearchTerms(rawQuery);
	const label = normalisePickerSearchValue(option.label);
	const code = normalisePickerSearchValue(option.code);
	const description = normalisePickerSearchValue(option.description);
	const aliases = option.aliases.map((entry) => normalisePickerSearchValue(entry));
	const labelTerms = pickerSearchTerms(option.label);
	const codeTerms = pickerSearchTerms(option.code);
	const descriptionTerms = pickerSearchTerms(option.description);
	const aliasTerms = option.aliases.flatMap((entry) => pickerSearchTerms(entry));

	let score = qualityScore(option);
	if (label === query || code === query || aliases.includes(query)) score += 300;
	if (label.includes(query)) score += 120;
	if (code.includes(query)) score += 90;
	if (aliases.some((entry) => entry.includes(query))) score += 110;
	if (description.includes(query)) score += 40;

	for (const term of terms) {
		if (label.includes(term)) score += 30;
		if (code.includes(term)) score += 24;
		if (aliases.some((entry) => entry.includes(term))) score += 28;
		if (description.includes(term)) score += 10;
		if (labelTerms.includes(term)) score += 34;
		if (codeTerms.includes(term)) score += 28;
		if (aliasTerms.includes(term)) score += 32;
		if (descriptionTerms.includes(term)) score += 12;
	}

	return score;
}

export function matchesPickerSearchTerms(searchText: string, rawQuery: string): boolean {
	const queryTerms = pickerSearchTerms(rawQuery);
	if (queryTerms.length === 0) return true;
	const searchTerms = pickerSearchTerms(searchText);
	const normalisedSearchText = normalisePickerSearchValue(searchText);
	return queryTerms.every(
		(term) =>
			searchTerms.some(
				(candidate) => candidate === term || candidate.includes(term) || term.includes(candidate)
			) || normalisedSearchText.includes(term)
	);
}

function hasDirectPickerMatch(option: RankedPickerOption, rawQuery: string): boolean {
	const query = normalisePickerSearchValue(rawQuery);
	if (query.length === 0) return false;

	const label = normalisePickerSearchValue(option.label);
	const code = normalisePickerSearchValue(option.code);
	const aliases = option.aliases.map((entry) => normalisePickerSearchValue(entry));

	return (
		label === query ||
		code === query ||
		aliases.includes(query) ||
		label.includes(query) ||
		code.includes(query) ||
		aliases.some((entry) => entry.includes(query))
	);
}

function isLowSignalPickerOption(option: RankedPickerOption): boolean {
	return isLowSignalReferenceText(option.label) || isLowSignalReferenceText(option.code);
}

export function filterPickerOptions<T extends RankedPickerOption>(
	options: T[],
	rawQuery = ''
): T[] {
	const query = normalisePickerSearchValue(rawQuery);
	return options.filter((option) => {
		if (!matchesPickerSearchTerms(option.searchText, rawQuery)) {
			return false;
		}

		if (!isLowSignalPickerOption(option)) {
			return true;
		}

		if (query.length === 0) {
			return false;
		}

		return hasDirectPickerMatch(option, rawQuery);
	});
}

export function rankPickerOptions<T extends RankedPickerOption>(options: T[], rawQuery = ''): T[] {
	return [...options].sort((left, right) => {
		const scoreDelta = searchScore(right, rawQuery) - searchScore(left, rawQuery);
		if (scoreDelta !== 0) return scoreDelta;

		const labelDelta = left.label.localeCompare(right.label, undefined, { sensitivity: 'base' });
		if (labelDelta !== 0) return labelDelta;

		return (left.code ?? '').localeCompare(right.code ?? '', undefined, { sensitivity: 'base' });
	});
}

export function resolveEstimateTemplateTriggerLabel(
	appliedTemplateName: string | null | undefined
): string {
	const templateName = trimmedValue(appliedTemplateName);
	return templateName || 'Apply Template';
}

export function resolveTemplateApplySelection(
	templateId: string,
	templates: Pick<EstimateTemplate, 'id' | 'name'>[],
	hasReplaceableContent: boolean
): ConfirmFlowResolution<PendingTemplateApplyIntent> {
	const selectedTemplateId = trimmedValue(templateId);
	if (!selectedTemplateId) {
		return { kind: 'ignore' };
	}

	const template = templates.find((item) => item.id === selectedTemplateId);
	if (!template) {
		return { kind: 'ignore' };
	}

	return {
		kind: hasReplaceableContent ? 'confirm' : 'apply',
		intent: {
			templateId: template.id,
			templateName: trimmedValue(template.name) || 'Untitled template'
		}
	};
}

export function resolvePresetApplySelection(
	itemId: string,
	presetId: string,
	presets: Pick<CostComponentPreset, 'id' | 'name'>[],
	hasExistingCostRows: boolean
): ConfirmFlowResolution<PendingPresetApplyIntent> {
	const takeoffItemId = trimmedValue(itemId);
	const selectedPresetId = trimmedValue(presetId);
	if (!takeoffItemId || !selectedPresetId) {
		return { kind: 'ignore' };
	}

	const preset = presets.find((item) => item.id === selectedPresetId);
	if (!preset) {
		return { kind: 'ignore' };
	}

	return {
		kind: hasExistingCostRows ? 'confirm' : 'apply',
		intent: {
			itemId: takeoffItemId,
			presetId: preset.id,
			presetName: trimmedValue(preset.name) || 'Untitled preset'
		}
	};
}

export function shouldAutoApplyPendingAiEstimate({
	isDirty,
	hasRestorableBaseline,
	currentMatchesRestorableBaseline,
	hasSavedEstimate,
	currentMatchesSavedEstimate,
	isCurrentBlank
}: PendingAiAutoApplyResolutionInput): boolean {
	if (isDirty) {
		return false;
	}

	if (currentMatchesRestorableBaseline) {
		return true;
	}

	if (currentMatchesSavedEstimate) {
		return true;
	}

	if (!hasSavedEstimate && isCurrentBlank) {
		return true;
	}

	return !hasRestorableBaseline;
}
