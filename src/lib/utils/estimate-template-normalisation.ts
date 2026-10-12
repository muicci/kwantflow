import type { CostComponent, Estimate, EstimateTemplatePayload } from '$lib/types/index.js';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stripReusableAiFields(value: unknown): Record<string, unknown> {
	if (!isRecord(value)) return {};

	return Object.fromEntries(Object.entries(value).filter(([key]) => !key.startsWith('ai_')));
}

type ReusableCostComponentLike = Pick<
	CostComponent,
	| 'category'
	| 'source_type'
	| 'source_id'
	| 'name'
	| 'description'
	| 'quantity'
	| 'unit'
	| 'unit_rate'
	| 'formula'
	| 'metadata'
	| 'sort_order'
> &
	Partial<Pick<CostComponent, 'id' | 'takeoff_item_id'>>;

export function normaliseReusablePresetComponents<T extends ReusableCostComponentLike>(
	components: T[]
): T[] {
	return components.map((component, componentIndex) => ({
		...component,
		metadata: stripReusableAiFields(component.metadata),
		sort_order:
			typeof component.sort_order === 'number' && Number.isFinite(component.sort_order)
				? component.sort_order
				: componentIndex
	})) as T[];
}

export function normaliseReusableEstimatePayload<T extends EstimateTemplatePayload>(
	estimate: T
): T {
	return {
		...estimate,
		wbs_root_node_id: null,
		takeoff_items: estimate.takeoff_items.map((item, itemIndex) => ({
			...item,
			wbs_node_id: null,
			properties: stripReusableAiFields(item.properties),
			sort_order:
				typeof item.sort_order === 'number' && Number.isFinite(item.sort_order)
					? item.sort_order
					: itemIndex,
			cost_components: normaliseReusablePresetComponents(item.cost_components)
		}))
	};
}

export function normaliseEstimateTemplatePayloadLike(value: unknown): unknown {
	if (!isRecord(value)) return value;

	const takeoffItems = Array.isArray(value.takeoff_items) ? value.takeoff_items : [];

	return {
		...value,
		scope_summary: typeof value.scope_summary === 'string' ? value.scope_summary : '',
		notes: typeof value.notes === 'string' ? value.notes : '',
		wbs_root_node_id: null,
		takeoff_items: takeoffItems.map((item, itemIndex) => {
			if (!isRecord(item)) return item;
			const costComponents = Array.isArray(item.cost_components) ? item.cost_components : [];

			return {
				...item,
				wbs_node_id: null,
				properties: stripReusableAiFields(item.properties),
				sort_order:
					typeof item.sort_order === 'number' && Number.isFinite(item.sort_order)
						? item.sort_order
						: itemIndex,
				cost_components: costComponents.map((component, componentIndex) => {
					if (!isRecord(component)) return component;
					return {
						...component,
						metadata: stripReusableAiFields(component.metadata),
						sort_order:
							typeof component.sort_order === 'number' && Number.isFinite(component.sort_order)
								? component.sort_order
								: componentIndex
					};
				})
			};
		})
	};
}

export function normaliseEstimateTemplatePayload(estimate: Estimate): EstimateTemplatePayload {
	const normalised = normaliseReusableEstimatePayload({
		scope_summary: estimate.scope_summary,
		notes: estimate.notes,
		classification_system_id: estimate.classification_system_id ?? null,
		wbs_root_node_id: null,
		takeoff_items: estimate.takeoff_items.map((item) => ({
			...item,
			applied_preset_id: item.applied_preset_id ?? null,
			applied_preset_name: item.applied_preset_name ?? null
		}))
	});

	return normalised;
}
