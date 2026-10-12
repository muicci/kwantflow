import type {
	AiIssue,
	AiRunStatus,
	CostComponent,
	CostComponentCategory,
	CostComponentSourceType,
	Estimate
} from '$lib/types/index.js';
import { getCostComponentUnitOptions, type UnitCode } from '$lib/constants/index.js';

function linkedSourceTypeForCategory(
	category: CostComponentCategory
): Exclude<CostComponentSourceType, 'manual'> | null {
	switch (category) {
		case 'material':
			return 'material_catalog';
		case 'labour':
			return 'labour_rate_card';
		case 'equipment':
			return 'equipment_rate_card';
		case 'subcontract':
			return 'subcontract_rate_card';
		default:
			return null;
	}
}

function normaliseText(value: string | null | undefined): string {
	return (value ?? '').trim().toLowerCase();
}

export function formatDisplayedAiIssueMessage(message: string): string {
	const trimmedMessage = message.trim();
	const simplifiedMessage = trimmedMessage.replace(
		/\s+before this estimate is commercially usable\.$/i,
		'.'
	);
	const componentRateMatch = simplifiedMessage.match(/^(.*?) needs a rate review\.$/i);
	if (componentRateMatch?.[1]?.trim()) {
		return `${componentRateMatch[1].trim()} needs a rate review.`;
	}
	return simplifiedMessage;
}

function parseRateReviewName(message: string): string | null {
	const match = message.match(
		/^(.*?) needs a rate review(?: before this estimate is commercially usable)?\.$/
	);
	return match?.[1]?.trim() || null;
}

function parseMissingSourceParts(
	message: string
): { componentName: string; itemName: string } | null {
	const match = message.match(/^The linked source for (.*?) on (.*?) is not available locally\.$/);
	if (!match) return null;
	return {
		componentName: match[1]?.trim() ?? '',
		itemName: match[2]?.trim() ?? ''
	};
}

function parseSourceCategoryName(message: string): string | null {
	const match = message.match(
		/^(.*?) is linked to a source type that does not fit the .* category\.$/
	);
	return match?.[1]?.trim() || null;
}

function parseInvalidUnitName(message: string): string | null {
	const match = message.match(/^(.*?) uses a unit that does not fit the .* category\.$/);
	return match?.[1]?.trim() || null;
}

function isAllowedUnit(category: CostComponentCategory, unit: UnitCode): boolean {
	return getCostComponentUnitOptions(category).some((option) => option.value === unit);
}

function componentNeedsRateReview(component: CostComponent): boolean {
	return !Number.isFinite(component.unit_rate) || component.unit_rate <= 0;
}

function componentHasInvalidSourceCategory(component: CostComponent): boolean {
	if (component.source_type === 'manual') return false;
	const linkedSourceType = linkedSourceTypeForCategory(component.category);
	if (!linkedSourceType) return false;
	return component.source_type !== linkedSourceType;
}

function componentHasMissingLinkedSource(component: CostComponent): boolean {
	return component.source_type !== 'manual' && !component.source_id;
}

function shouldKeepAppliedIssue(issue: AiIssue, estimate: Estimate): boolean {
	switch (issue.code) {
		case 'missing_component_rate': {
			const componentName = parseRateReviewName(issue.message);
			if (!componentName) return true;
			return estimate.takeoff_items.some((item) =>
				item.cost_components.some(
					(component) =>
						normaliseText(component.name) === normaliseText(componentName) &&
						componentNeedsRateReview(component)
				)
			);
		}
		case 'invalid_component_source_category': {
			const componentName = parseSourceCategoryName(issue.message);
			if (!componentName) return true;
			return estimate.takeoff_items.some((item) =>
				item.cost_components.some(
					(component) =>
						normaliseText(component.name) === normaliseText(componentName) &&
						componentHasInvalidSourceCategory(component)
				)
			);
		}
		case 'invalid_material_catalog_source':
		case 'invalid_labour_rate_card_source':
		case 'invalid_equipment_rate_card_source':
		case 'invalid_subcontract_rate_card_source': {
			const parts = parseMissingSourceParts(issue.message);
			if (!parts) return true;
			return estimate.takeoff_items.some(
				(item) =>
					normaliseText(item.name) === normaliseText(parts.itemName) &&
					item.cost_components.some(
						(component) =>
							normaliseText(component.name) === normaliseText(parts.componentName) &&
							componentHasMissingLinkedSource(component)
					)
			);
		}
		case 'invalid_component_unit_category': {
			const componentName = parseInvalidUnitName(issue.message);
			if (!componentName) return true;
			return estimate.takeoff_items.some((item) =>
				item.cost_components.some(
					(component) =>
						normaliseText(component.name) === normaliseText(componentName) &&
						!isAllowedUnit(component.category, component.unit)
				)
			);
		}
		default:
			return true;
	}
}

export function resolveDisplayedAiIssues(params: {
	status: AiRunStatus | 'idle';
	issues: AiIssue[];
	estimate: Estimate;
}): AiIssue[] {
	if (params.status !== 'applied') {
		return params.issues;
	}
	return params.issues.filter((issue) => shouldKeepAppliedIssue(issue, params.estimate));
}
