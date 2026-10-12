import type { CostComponent, Estimate, TakeoffItem } from '$lib/types/index.js';

function cloneJsonObject(
	value: Record<string, unknown> | null | undefined
): Record<string, unknown> {
	if (!value) return {};
	return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function cloneCostComponent(component: CostComponent): CostComponent {
	return {
		id: component.id,
		takeoff_item_id: component.takeoff_item_id,
		category: component.category,
		source_type: component.source_type,
		source_id: component.source_id ?? null,
		name: component.name,
		description: component.description,
		quantity: component.quantity,
		unit: component.unit,
		unit_rate: component.unit_rate,
		source_unit_rate_decimal: component.source_unit_rate_decimal ?? null,
		source_currency_code: component.source_currency_code ?? null,
		fx_rate_snapshot_id: component.fx_rate_snapshot_id ?? null,
		formula: cloneJsonObject(component.formula),
		metadata: cloneJsonObject(component.metadata),
		sort_order: component.sort_order
	};
}

function cloneTakeoffItem(item: TakeoffItem): TakeoffItem {
	return {
		id: item.id,
		estimate_asset_id: item.estimate_asset_id,
		parent_id: item.parent_id ?? null,
		wbs_node_id: item.wbs_node_id ?? null,
		cost_code_id: item.cost_code_id ?? null,
		applied_preset_id: item.applied_preset_id ?? null,
		applied_preset_name: item.applied_preset_name ?? null,
		name: item.name,
		description: item.description,
		quantity: item.quantity,
		unit: item.unit,
		properties: cloneJsonObject(item.properties),
		sort_order: item.sort_order,
		cost_components: item.cost_components.map(cloneCostComponent)
	};
}

export function cloneEstimateSnapshot(estimate: Estimate): Estimate {
	return {
		asset_id: estimate.asset_id,
		scope_summary: estimate.scope_summary,
		notes: estimate.notes,
		classification_system_id: estimate.classification_system_id ?? null,
		wbs_root_node_id: estimate.wbs_root_node_id ?? null,
		applied_template_id: estimate.applied_template_id ?? null,
		applied_template_name: estimate.applied_template_name ?? null,
		currency_code: estimate.currency_code ?? null,
		takeoff_items: estimate.takeoff_items.map(cloneTakeoffItem)
	};
}
