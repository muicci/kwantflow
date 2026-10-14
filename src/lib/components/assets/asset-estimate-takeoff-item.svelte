<script lang="ts">
	import { formatCurrency } from '$lib/utils/format.js';
	import * as Accordion from '$lib/components/ui/accordion/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { Input, SearchInput } from '$lib/components/ui/input/index.js';
	import { Cluster, FieldLabel, FieldShell, Meta, Text } from '$lib/components/primitives/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import FormHelpTooltip from '$lib/components/form-help-tooltip.svelte';
	import TableHeaderLabel from '../table-header-label.svelte';
	import { filterPickerOptions, rankPickerOptions } from './asset-estimate-editor.helpers';
	import {
		COST_COMPONENT_UNIT_OPTIONS,
		TAKEOFF_ITEM_UNIT_OPTIONS,
		getCostComponentUnitOptions
	} from '$lib/constants/index.js';
	import { costComponentUnitCost, takeoffItemTotal } from '$lib/state/quote.svelte.js';
	import type {
		AiEvidenceRef,
		CostCode,
		CostComponent,
		CostComponentCategory,
		CostComponentPreset,
		EquipmentRateCard,
		LabourRateCard,
		MaterialCatalogueItem,
		SubcontractRateCard,
		TakeoffItem,
		WbsNode
	} from '$lib/types/index.js';

	import CopyIcon from '@lucide/svelte/icons/copy';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
	import LinkIcon from '@lucide/svelte/icons/link';
	import MoreHorizontalIcon from '@lucide/svelte/icons/more-horizontal';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';

	type TakeoffItemField = 'name' | 'description' | 'unit' | 'cost_code_id' | 'wbs_node_id';
	type WorkspaceLinkCategory =
		'material' | 'labour' | 'equipment' | 'subcontract' | 'preset' | 'cost_code' | 'structure';
	type WorkspaceLinkMode =
		'replace_component' | 'add_component' | 'apply_preset' | 'set_item_field';
	type WorkspaceLinkIntent = {
		mode: WorkspaceLinkMode;
		category: WorkspaceLinkCategory;
		itemId: string;
		componentId?: string | null;
		querySeed?: string | null;
	};
	type WorkspaceLinkOption = {
		id: string;
		label: string;
		code: string | null;
		meta: string | null;
		description?: string | null;
		aliases: string[];
		searchText: string;
	};

	let {
		item,
		filteredCostCodes,
		wbsNodes,
		materialCatalogueItems,
		labourRateCards,
		equipmentRateCards,
		subcontractRateCards,
		costComponentPresets,
		showAiHighlights = false,
		showAiReviewSession = false,
		collapsed,
		getNumericInputValue,
		beginNumericInputEdit,
		endNumericInputEdit,
		toggleTakeoffSetup,
		updateTakeoffItemField,
		updateTakeoffItemName,
		updateTakeoffQuantityDraft,
		updateCostComponentField,
		updateCostComponentName,
		updateCostComponentNumberDraft,
		addMaterialFromCatalogue,
		addLabourFromCatalogue,
		addEquipmentFromCatalogue,
		addSubcontractFromCatalogue,
		applyMaterialCatalogueToComponent,
		applyLabourCatalogueToComponent,
		applyEquipmentCatalogueToComponent,
		applySubcontractCatalogueToComponent,
		onPresetPickerChange,
		openSavePreset,
		removeTakeoffItem,
		addManualCostComponent,
		duplicateCostComponent,
		removeCostComponent,
		onAiEvidenceSelect,
		isAiFieldAcknowledged,
		itemNameAckKey,
		componentNameAckKey,
		disabled = false
	}: {
		item: TakeoffItem;
		filteredCostCodes: CostCode[];
		wbsNodes: WbsNode[];
		materialCatalogueItems: MaterialCatalogueItem[];
		labourRateCards: LabourRateCard[];
		equipmentRateCards: EquipmentRateCard[];
		subcontractRateCards: SubcontractRateCard[];
		costComponentPresets: CostComponentPreset[];
		showAiHighlights?: boolean;
		showAiReviewSession?: boolean;
		collapsed: boolean;
		getNumericInputValue: (id: string, field: string, currentValue: number) => string;
		beginNumericInputEdit: (id: string, field: string) => void;
		endNumericInputEdit: (id: string, field: string) => void;
		toggleTakeoffSetup: (itemId: string) => void;
		updateTakeoffItemField: (itemId: string, field: TakeoffItemField, value: string | null) => void;
		updateTakeoffItemName: (itemId: string, value: string) => void;
		updateTakeoffQuantityDraft: (itemId: string, rawValue: string) => void;
		updateCostComponentField: (
			itemId: string,
			componentId: string,
			field: keyof CostComponent,
			value: string | number | null
		) => void;
		updateCostComponentName: (itemId: string, componentId: string, value: string) => void;
		updateCostComponentNumberDraft: (
			itemId: string,
			componentId: string,
			field: 'quantity' | 'unit_rate',
			rawValue: string
		) => void;
		addMaterialFromCatalogue: (itemId: string, catalogueId: string) => Promise<void>;
		addLabourFromCatalogue: (itemId: string, catalogueId: string) => Promise<void>;
		addEquipmentFromCatalogue: (itemId: string, catalogueId: string) => Promise<void>;
		addSubcontractFromCatalogue: (itemId: string, catalogueId: string) => Promise<void>;
		applyMaterialCatalogueToComponent: (
			itemId: string,
			componentId: string,
			catalogueId: string
		) => void;
		applyLabourCatalogueToComponent: (
			itemId: string,
			componentId: string,
			catalogueId: string
		) => void;
		applyEquipmentCatalogueToComponent: (
			itemId: string,
			componentId: string,
			catalogueId: string
		) => void;
		applySubcontractCatalogueToComponent: (
			itemId: string,
			componentId: string,
			catalogueId: string
		) => void;
		onPresetPickerChange: (itemId: string, value: string) => void;
		openSavePreset: (itemId: string) => void;
		removeTakeoffItem: (itemId: string) => void;
		addManualCostComponent: (
			itemId: string,
			category: 'material' | 'labour' | 'equipment' | 'subcontract'
		) => Promise<void>;
		duplicateCostComponent: (itemId: string, componentId: string) => void;
		removeCostComponent: (itemId: string, componentId: string) => void;
		onAiEvidenceSelect: (ref: AiEvidenceRef) => void;
		isAiFieldAcknowledged: (fieldKey: string) => boolean;
		itemNameAckKey: (itemId: string) => string;
		componentNameAckKey: (componentId: string) => string;
		disabled?: boolean;
	} = $props();

	function selectedCostCodeLabel(costCodeId: string | null | undefined) {
		return filteredCostCodes.find((code) => code.id === costCodeId)?.code ?? 'None';
	}

	function selectedWbsLabel(wbsNodeId: string | null | undefined) {
		return wbsNodes.find((node) => node.id === wbsNodeId)?.name ?? 'None';
	}

	function formatConfidence(value: unknown) {
		return typeof value === 'number' && Number.isFinite(value)
			? `${Math.round(value * 100)}%`
			: null;
	}

	function itemAiConfidence(item: TakeoffItem) {
		const value = item.properties?.ai_confidence;
		return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
	}

	function itemAiEvidence(item: TakeoffItem) {
		const value = item.properties?.ai_evidence_refs;
		return Array.isArray(value) ? value : [];
	}

	function itemAiQuestions(item: TakeoffItem) {
		const value = item.properties?.ai_open_questions;
		return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : [];
	}

	const collapsedQuantitySummary = $derived(
		`${item.quantity || 0} ${
			TAKEOFF_ITEM_UNIT_OPTIONS.find((option) => option.value === item.unit)?.label ?? item.unit
		}`
	);

	function componentAiConfidence(component: CostComponent) {
		const value = component.metadata?.ai_confidence;
		return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
	}

	function componentAiMappingStatus(component: CostComponent) {
		const value = component.metadata?.ai_mapping_status;
		return typeof value === 'string' ? value : null;
	}

	function componentAiEvidence(component: CostComponent) {
		const value = component.metadata?.ai_evidence_refs;
		return Array.isArray(value) ? value : [];
	}

	function componentNeedsRateReview(component: CostComponent) {
		return !Number.isFinite(component.unit_rate) || component.unit_rate <= 0;
	}

	function componentNameFieldClass(component: CostComponent) {
		if (!showAiHighlights) {
			return '';
		}
		if (isAiFieldAcknowledged(componentNameAckKey(component.id))) {
			return '';
		}
		if (
			componentNeedsRateReview(component) ||
			componentAiMappingStatus(component) === 'unresolved'
		) {
			return 'status-field-warning';
		}
		if (componentAiEvidence(component).length > 0 || componentAiConfidence(component)) {
			return 'status-field-success';
		}
		return '';
	}

	function componentReviewEntries(currentItem: TakeoffItem) {
		return currentItem.cost_components.filter((component) => {
			return (
				Boolean(componentAiConfidence(component)) ||
				Boolean(componentAiMappingStatus(component)) ||
				componentAiEvidence(component).length > 0 ||
				componentNeedsRateReview(component)
			);
		});
	}

	function itemNameFieldClass(currentItem: TakeoffItem) {
		if (!showAiHighlights) {
			return '';
		}
		if (isAiFieldAcknowledged(itemNameAckKey(currentItem.id))) {
			return '';
		}
		if (
			itemAiQuestions(currentItem).length > 0 ||
			componentReviewEntries(currentItem).some(
				(component) =>
					componentNeedsRateReview(component) ||
					componentAiMappingStatus(component) === 'unresolved' ||
					componentAiMappingStatus(component) === 'manual'
			)
		) {
			return 'status-field-warning';
		}
		if (
			Boolean(itemAiConfidence(currentItem)) ||
			itemAiEvidence(currentItem).length > 0 ||
			componentReviewEntries(currentItem).some(
				(component) =>
					componentAiEvidence(component).length > 0 || Boolean(componentAiConfidence(component))
			)
		) {
			return 'status-field-success';
		}
		return '';
	}

	function hasItemDetailsContent(currentItem: TakeoffItem) {
		return (
			currentItem.description.trim().length > 0 ||
			(showAiReviewSession &&
				(itemAiQuestions(currentItem).length > 0 ||
					itemAiEvidence(currentItem).length > 0 ||
					componentReviewEntries(currentItem).length > 0))
		);
	}

	let detailsMode = $state<'auto' | 'open' | 'closed'>('auto');
	const detailsExpanded = $derived(
		detailsMode === 'open' || (detailsMode === 'auto' && hasItemDetailsContent(item))
	);

	$effect(() => {
		if (!collapsed) return;
		detailsMode = 'auto';
	});

	function toggleItemDetails() {
		detailsMode = detailsExpanded ? 'closed' : 'open';
	}

	function costComponentUnitOptions(category: CostComponentCategory) {
		return getCostComponentUnitOptions(category);
	}

	function hasAiItemHighlight(currentItem: TakeoffItem): boolean {
		return (
			showAiHighlights &&
			(Boolean(itemAiConfidence(currentItem)) ||
				itemAiQuestions(currentItem).length > 0 ||
				itemAiEvidence(currentItem).length > 0)
		);
	}

	function hasAiComponentHighlight(component: CostComponent): boolean {
		return (
			showAiHighlights &&
			(Boolean(componentAiConfidence(component)) ||
				componentAiEvidence(component).length > 0 ||
				Boolean(componentAiMappingStatus(component)) ||
				componentNeedsRateReview(component))
		);
	}

	function reviewDotClass(kind: 'review' | 'success' | 'neutral'): string {
		switch (kind) {
			case 'review':
				return 'bg-warning';
			case 'success':
				return 'bg-success';
			default:
				return 'status-dot-muted';
		}
	}

	function componentReviewTone(component: CostComponent): 'review' | 'success' | 'neutral' {
		if (
			componentNeedsRateReview(component) ||
			componentAiMappingStatus(component) === 'unresolved' ||
			componentAiMappingStatus(component) === 'manual'
		) {
			return 'review';
		}
		if (componentAiEvidence(component).length > 0 || componentAiConfidence(component)) {
			return 'success';
		}
		return 'neutral';
	}

	function componentReviewMeta(component: CostComponent): string {
		const mappingStatus = componentAiMappingStatus(component);
		if (componentNeedsRateReview(component) && mappingStatus === 'unresolved') {
			return 'AI found a likely workspace match, but the rate still needs review before save.';
		}
		if (componentNeedsRateReview(component)) {
			return 'Review the linked rate before saving this estimate.';
		}
		if (mappingStatus === 'unresolved') {
			return 'AI could not finish linking this row. Link it to a workspace source or keep it manual.';
		}
		if (mappingStatus === 'manual') {
			return 'This row still needs a manual link or confirmation before save.';
		}
		if (componentAiEvidence(component).length > 0 || componentAiConfidence(component)) {
			return 'AI used the selected evidence to prepare this row. Review it before saving.';
		}
		return '';
	}

	function evidenceSummaryLabel(ref: AiEvidenceRef): string {
		const parts = [ref.file_name];
		if (ref.page_number) parts.push(`Page ${ref.page_number}`);
		if (ref.view_label) parts.push(ref.view_label);
		return parts.join(' · ');
	}

	function evidenceKey(ref: AiEvidenceRef): string {
		return [ref.file_id ?? ref.file_name, ref.page_number ?? '', ref.view_label ?? ''].join('|');
	}

	function distinctComponentEvidence(
		currentItem: TakeoffItem,
		component: CostComponent
	): AiEvidenceRef[] {
		const itemEvidenceKeys = new Set(
			itemAiEvidence(currentItem).map((ref) => evidenceKey(ref as AiEvidenceRef))
		);
		return componentAiEvidence(component).filter(
			(ref): ref is AiEvidenceRef => !itemEvidenceKeys.has(evidenceKey(ref as AiEvidenceRef))
		);
	}

	function itemReviewActionTitle(question: string): string {
		const normalised = question.toLowerCase();
		if (
			normalised.includes('uploaded in error') ||
			normalised.includes('wrong file') ||
			normalised.includes('does not match') ||
			normalised.includes('contradicts')
		) {
			return 'Check uploaded file';
		}
		if (normalised.includes('rate')) return 'Set rate manually';
		if (normalised.includes('map')) return 'Map this component';
		if (normalised.includes('prepare')) return 'Could not prepare file';
		return 'Manual review needed';
	}

	function itemAiReviewCount(currentItem: TakeoffItem): number {
		return itemAiQuestions(currentItem).length + componentReviewEntries(currentItem).length;
	}

	function componentCanLinkFromWorkspace(component: CostComponent): boolean {
		return (
			component.category === 'material' ||
			component.category === 'labour' ||
			component.category === 'equipment' ||
			component.category === 'subcontract'
		);
	}

	function workspaceLinkCategoryForComponent(
		component: CostComponent
	): Exclude<WorkspaceLinkCategory, 'preset'> | null {
		if (component.category === 'material') return 'material';
		if (component.category === 'labour') return 'labour';
		if (component.category === 'equipment') return 'equipment';
		if (component.category === 'subcontract') return 'subcontract';
		return null;
	}

	function workspaceLinkCategoryLabel(category: WorkspaceLinkCategory): string {
		switch (category) {
			case 'material':
				return 'Material Catalogue';
			case 'labour':
				return 'Labour Rates';
			case 'equipment':
				return 'Equipment Rates';
			case 'subcontract':
				return 'Subcontract Rates';
			case 'preset':
				return 'Cost Presets';
			case 'cost_code':
				return 'Cost Codes';
			case 'structure':
				return 'Project Structure';
		}
	}

	function aliasValues(value: string[] | undefined): string[] {
		return Array.isArray(value) ? value.filter((entry) => entry.trim().length > 0) : [];
	}

	function buildWorkspaceLinkOption(params: {
		id: string;
		label: string;
		code?: string | null;
		meta?: string | null;
		aliases?: string[];
	}): WorkspaceLinkOption {
		const aliases = aliasValues(params.aliases);
		return {
			id: params.id,
			label: params.label,
			code: params.code?.trim() || null,
			meta: params.meta?.trim() || null,
			description: params.meta?.trim() || null,
			aliases,
			searchText: [params.label, params.code ?? '', params.meta ?? '', ...aliases]
				.join(' ')
				.toLowerCase()
		};
	}

	function workspaceLinkOptions(category: WorkspaceLinkCategory): WorkspaceLinkOption[] {
		switch (category) {
			case 'material':
				return materialCatalogueItems.map((catalogue) =>
					buildWorkspaceLinkOption({
						id: catalogue.id,
						label: catalogue.name,
						code: catalogue.code,
						meta: catalogue.specification ?? catalogue.category ?? null,
						aliases: catalogue.aliases
					})
				);
			case 'labour':
				return labourRateCards.map((card) =>
					buildWorkspaceLinkOption({
						id: card.id,
						label: card.name,
						code: card.code,
						meta: card.work_center ?? card.category ?? null,
						aliases: card.aliases
					})
				);
			case 'equipment':
				return equipmentRateCards.map((card) =>
					buildWorkspaceLinkOption({
						id: card.id,
						label: card.name,
						code: card.code,
						meta: card.work_center ?? card.category ?? null,
						aliases: card.aliases
					})
				);
			case 'subcontract':
				return subcontractRateCards.map((card) =>
					buildWorkspaceLinkOption({
						id: card.id,
						label: card.name,
						code: card.code,
						meta: card.category ?? null,
						aliases: card.aliases
					})
				);
			case 'preset':
				return costComponentPresets.map((preset) =>
					buildWorkspaceLinkOption({
						id: preset.id,
						label: preset.name,
						code: preset.code,
						meta: preset.description ?? null,
						aliases: preset.aliases
					})
				);
			case 'cost_code':
				return filteredCostCodes.map((code) =>
					buildWorkspaceLinkOption({
						id: code.id,
						label: code.name,
						code: code.code,
						meta: code.description ?? null
					})
				);
			case 'structure':
				return wbsNodes.map((node) =>
					buildWorkspaceLinkOption({
						id: node.id,
						label: node.name,
						code: node.code,
						meta: node.type ?? null
					})
				);
		}
	}

	let workspaceLinkDialogOpen = $state(false);
	let workspaceLinkSearch = $state('');
	let pendingWorkspaceLinkIntent = $state<WorkspaceLinkIntent | null>(null);

	const availableWorkspaceLinkOptions = $derived.by(() => {
		if (!pendingWorkspaceLinkIntent) return [];
		return workspaceLinkOptions(pendingWorkspaceLinkIntent.category);
	});

	const filteredWorkspaceLinkOptions = $derived.by(() => {
		return rankPickerOptions(
			filterPickerOptions(availableWorkspaceLinkOptions, workspaceLinkSearch),
			workspaceLinkSearch
		);
	});

	function openWorkspaceLinkDialog(intent: WorkspaceLinkIntent): void {
		pendingWorkspaceLinkIntent = intent;
		workspaceLinkSearch = '';
		workspaceLinkDialogOpen = true;
	}

	function closeWorkspaceLinkDialog(): void {
		workspaceLinkDialogOpen = false;
		workspaceLinkSearch = '';
		pendingWorkspaceLinkIntent = null;
	}

	function workspaceLinkDialogTitle(): string {
		if (!pendingWorkspaceLinkIntent) return 'Search workspace data';
		if (pendingWorkspaceLinkIntent.mode === 'replace_component') {
			return `Link from ${workspaceLinkCategoryLabel(pendingWorkspaceLinkIntent.category)}`;
		}
		if (pendingWorkspaceLinkIntent.mode === 'apply_preset') {
			return 'Apply Cost Preset';
		}
		return `Add from ${workspaceLinkCategoryLabel(pendingWorkspaceLinkIntent.category)}`;
	}

	function workspaceLinkDialogDescription(): string {
		if (!pendingWorkspaceLinkIntent) return 'Search by name, code, or alias.';
		if (pendingWorkspaceLinkIntent.mode === 'replace_component') {
			return 'Search by name, code, or alias to relink this cost row from workspace data.';
		}
		if (pendingWorkspaceLinkIntent.mode === 'apply_preset') {
			return 'Search by name, code, or alias to apply a saved cost preset.';
		}
		if (pendingWorkspaceLinkIntent.mode === 'set_item_field') {
			return pendingWorkspaceLinkIntent.category === 'cost_code'
				? 'Search by code, name, or description to set the takeoff cost code.'
				: 'Search by name, code, or structure type to set the takeoff structure node.';
		}
		return 'Search by name, code, or alias to add a workspace record to this takeoff item.';
	}

	function workspaceLinkAllowsClear(intent: WorkspaceLinkIntent | null): boolean {
		return intent?.mode === 'set_item_field';
	}

	function workspaceLinkClearLabel(intent: WorkspaceLinkIntent | null): string {
		if (!intent) return 'None';
		return intent.category === 'cost_code' ? 'No cost code' : 'No structure node';
	}

	function workspaceLinkClearDescription(intent: WorkspaceLinkIntent | null): string {
		if (!intent) return 'Clear the current selection.';
		return intent.category === 'cost_code'
			? 'Leave this takeoff item without a linked cost code.'
			: 'Leave this takeoff item without a linked structure node.';
	}

	function workspaceLinkEmptyStateTitle(): string {
		const intent = pendingWorkspaceLinkIntent;
		if (!intent) return 'No matching records';
		if (intent.category === 'material') return 'No material catalogue items yet';
		if (intent.category === 'labour') return 'No labour rates yet';
		if (intent.category === 'equipment') return 'No equipment rates yet';
		if (intent.category === 'subcontract') return 'No subcontract rates yet';
		if (intent.category === 'cost_code') return 'No cost codes yet';
		if (intent.category === 'structure') return 'No structure nodes yet';
		return 'No cost presets yet';
	}

	function workspaceLinkEmptyStateDescription(): string {
		if (availableWorkspaceLinkOptions.length === 0) {
			return 'Create or activate a workspace record first, then link it here.';
		}
		return 'Try a different name, code, or alias.';
	}

	function selectedWorkspaceLinkOptionId(): string | null {
		const intent = pendingWorkspaceLinkIntent;
		if (!intent) return null;

		if (intent.mode === 'replace_component' && intent.componentId) {
			return (
				item.cost_components.find((component) => component.id === intent.componentId)?.source_id ??
				null
			);
		}

		if (intent.mode === 'set_item_field') {
			if (intent.category === 'cost_code') {
				return item.cost_code_id ?? '';
			}
			if (intent.category === 'structure') {
				return item.wbs_node_id ?? '';
			}
		}

		return null;
	}

	function workspaceLinkOptionSelected(optionId: string): boolean {
		return selectedWorkspaceLinkOptionId() === optionId;
	}

	async function selectWorkspaceLinkOption(optionId: string): Promise<void> {
		const intent = pendingWorkspaceLinkIntent;
		if (!intent) return;

		closeWorkspaceLinkDialog();

		if (intent.mode === 'replace_component') {
			if (!intent.componentId) return;
			switch (intent.category) {
				case 'material':
					applyMaterialCatalogueToComponent(intent.itemId, intent.componentId, optionId);
					return;
				case 'labour':
					applyLabourCatalogueToComponent(intent.itemId, intent.componentId, optionId);
					return;
				case 'equipment':
					applyEquipmentCatalogueToComponent(intent.itemId, intent.componentId, optionId);
					return;
				case 'subcontract':
					applySubcontractCatalogueToComponent(intent.itemId, intent.componentId, optionId);
					return;
				case 'preset':
					return;
			}
		}

		if (intent.mode === 'add_component') {
			switch (intent.category) {
				case 'material':
					await addMaterialFromCatalogue(intent.itemId, optionId);
					return;
				case 'labour':
					await addLabourFromCatalogue(intent.itemId, optionId);
					return;
				case 'equipment':
					await addEquipmentFromCatalogue(intent.itemId, optionId);
					return;
				case 'subcontract':
					await addSubcontractFromCatalogue(intent.itemId, optionId);
					return;
				case 'preset':
					return;
			}
		}

		if (intent.mode === 'apply_preset') {
			onPresetPickerChange(intent.itemId, optionId);
		}

		if (intent.mode === 'set_item_field') {
			if (intent.category === 'cost_code') {
				updateTakeoffItemField(intent.itemId, 'cost_code_id', optionId || null);
				return;
			}
			if (intent.category === 'structure') {
				updateTakeoffItemField(intent.itemId, 'wbs_node_id', optionId || null);
			}
		}
	}

	function tableWidthClass(layoutMode: 'wide' | 'compact' | 'narrow'): string {
		return layoutMode === 'wide' ? 'min-w-xl' : 'min-w-lg';
	}

	function tableCategoryClass(layoutMode: 'wide' | 'compact' | 'narrow'): string {
		return layoutMode === 'wide' ? 'w-32' : 'w-28';
	}

	function tableNameClass(layoutMode: 'wide' | 'compact' | 'narrow'): string {
		return layoutMode === 'wide' ? 'min-w-28' : 'min-w-24';
	}

	function tableQtyClass(layoutMode: 'wide' | 'compact' | 'narrow'): string {
		return layoutMode === 'wide' ? 'w-24 px-0' : 'w-20 px-0';
	}

	function tableUnitClass(layoutMode: 'wide' | 'compact' | 'narrow'): string {
		return layoutMode === 'wide' ? 'w-28' : 'w-24';
	}

	function tableRateClass(layoutMode: 'wide' | 'compact' | 'narrow'): string {
		return layoutMode === 'wide' ? 'w-20 ps-0 pe-2' : 'w-18 ps-0 pe-1';
	}

	function tableTotalClass(layoutMode: 'wide' | 'compact' | 'narrow'): string {
		return layoutMode === 'wide' ? 'w-24 ps-2 pe-0' : 'w-20 ps-1 pe-0';
	}

	function tableActionClass(layoutMode: 'wide' | 'compact' | 'narrow'): string {
		return layoutMode === 'wide' ? 'w-12 px-0' : 'w-10 px-0';
	}

	let itemSetupWidth = $state(0);
	const itemSetupLayoutMode = $derived.by<'wide' | 'compact' | 'narrow'>(() => {
		if (itemSetupWidth >= 672) return 'wide';
		if (itemSetupWidth >= 512) return 'compact';
		return 'narrow';
	});
</script>

<div
	bind:offsetWidth={itemSetupWidth}
	class={`ui-section-surface min-w-0 overflow-hidden border ${hasAiItemHighlight(item) ? 'status-field-success' : ''}`}
>
	<div class={`ui-section-header-row px-4 py-2.5 ${collapsed ? '' : 'border-b-0'}`}>
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div class="flex min-w-0 flex-1 flex-wrap items-center gap-2">
				<Text>Takeoff Item</Text>
				<Meta class="opacity-60">
					{item.cost_components.length} cost row{item.cost_components.length === 1 ? '' : 's'}
				</Meta>
			</div>
			<div class="flex items-center gap-2">
				<div class="flex items-center gap-2 text-right">
					<Meta>Item Total</Meta>
					<Text class="tabular-nums">
						{formatCurrency(takeoffItemTotal(item))}
					</Text>
				</div>
				<Button
					variant="ghost"
					size="icon-sm"
					{disabled}
					aria-label="Delete takeoff item"
					title="Delete takeoff item"
					onclick={() => removeTakeoffItem(item.id)}
				>
					<Trash2Icon class="size-3.5" />
				</Button>
				<Button
					variant="ghost"
					size="sm"
					class="shrink-0 gap-1.5"
					onclick={() => toggleTakeoffSetup(item.id)}
				>
					{#if !collapsed}
						<ChevronUpIcon class="size-3.5" />
						Hide setup
					{:else}
						<ChevronDownIcon class="size-3.5" />
						Edit item
					{/if}
				</Button>
			</div>
		</div>

		{#if collapsed}
			<div class="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 pt-3">
				<div title={item.name.trim() || 'Scope item'} class="min-w-0 flex-1">
					<Text class="truncate">{item.name.trim() || 'Scope item'}</Text>
				</div>
				<div class="flex shrink-0 items-baseline gap-2">
					<Meta>Quantity</Meta>
					<Text>{collapsedQuantitySummary}</Text>
				</div>
				{#if itemSetupLayoutMode === 'wide'}
					{#if item.cost_code_id}
						<Meta>Cost Code: {selectedCostCodeLabel(item.cost_code_id)}</Meta>
					{/if}
					{#if item.wbs_node_id}
						<Meta>Structure: {selectedWbsLabel(item.wbs_node_id)}</Meta>
					{/if}
					{#if item.applied_preset_name}
						<Meta>Preset: {item.applied_preset_name}</Meta>
					{/if}
					{#if showAiHighlights && formatConfidence(itemAiConfidence(item)?.overall)}
						<Meta>AI Confidence: {formatConfidence(itemAiConfidence(item)?.overall)}</Meta>
					{/if}
					{#if showAiReviewSession && itemAiQuestions(item).length > 0}
						<Meta>Review items: {itemAiQuestions(item).length}</Meta>
					{/if}
				{/if}
			</div>
		{:else}
			<div class="space-y-3 pt-3">
				{#if itemSetupLayoutMode === 'wide'}
					<div class="grid grid-cols-[minmax(0,1.45fr)_minmax(0,0.7fr)_minmax(0,0.85fr)] gap-3">
						<FieldShell class="min-w-0">
							<FieldLabel>Item Name</FieldLabel>
							<Input
								type="text"
								size="sm"
								{disabled}
								class={itemNameFieldClass(item)}
								value={item.name}
								placeholder="Scope item"
								oninput={(e) => updateTakeoffItemName(item.id, e.currentTarget.value)}
							/>
						</FieldShell>
						<FieldShell class="min-w-0">
							<FieldLabel>Qty</FieldLabel>
							<Input
								type="text"
								size="sm"
								{disabled}
								inputmode="decimal"
								class="text-right tabular-nums"
								placeholder="1"
								value={getNumericInputValue(item.id, 'quantity', item.quantity)}
								oninput={(e) => updateTakeoffQuantityDraft(item.id, e.currentTarget.value)}
								onfocus={() => beginNumericInputEdit(item.id, 'quantity')}
								onblur={() => endNumericInputEdit(item.id, 'quantity')}
							/>
						</FieldShell>
						<FieldShell class="min-w-0">
							<FieldLabel>Unit</FieldLabel>
							<Select.Root
								type="single"
								{disabled}
								value={item.unit}
								onValueChange={(value: string) =>
									updateTakeoffItemField(item.id, 'unit', value || item.unit)}
							>
								<Select.Trigger size="sm" class="w-full">
									{TAKEOFF_ITEM_UNIT_OPTIONS.find((option) => option.value === item.unit)?.label ??
										item.unit}
								</Select.Trigger>
								<Select.Content>
									{#each TAKEOFF_ITEM_UNIT_OPTIONS as option (option.value)}
										<Select.Item value={option.value}>{option.label}</Select.Item>
									{/each}
								</Select.Content>
							</Select.Root>
						</FieldShell>
					</div>
					<div class="grid grid-cols-2 gap-3">
						<FieldShell class="min-w-0">
							<div class="flex items-center gap-1.5">
								<FieldLabel class="px-0">Cost Code</FieldLabel>
							</div>
							<Button
								type="button"
								variant="secondary"
								size="sm"
								{disabled}
								class="ui-field-trigger-button w-full justify-between gap-2 overflow-hidden text-left"
								onclick={() =>
									openWorkspaceLinkDialog({
										mode: 'set_item_field',
										category: 'cost_code',
										itemId: item.id,
										querySeed: selectedCostCodeLabel(item.cost_code_id)
									})}
							>
								<span class="min-w-0 truncate">{selectedCostCodeLabel(item.cost_code_id)}</span>
								<ChevronDownIcon class="muted size-3.5 shrink-0" />
							</Button>
						</FieldShell>
						<FieldShell class="min-w-0">
							<div class="flex items-center gap-1.5">
								<FieldLabel class="px-0">Structure</FieldLabel>
								<FormHelpTooltip
									content="Optional. Use Project Structure (WBS) when this takeoff item belongs to a specific project phase, level, room, or zone."
								/>
							</div>
							<Button
								type="button"
								variant="secondary"
								size="sm"
								{disabled}
								class="ui-field-trigger-button w-full justify-between gap-2 overflow-hidden text-left"
								onclick={() =>
									openWorkspaceLinkDialog({
										mode: 'set_item_field',
										category: 'structure',
										itemId: item.id,
										querySeed: selectedWbsLabel(item.wbs_node_id)
									})}
							>
								<span class="min-w-0 truncate">{selectedWbsLabel(item.wbs_node_id)}</span>
								<ChevronDownIcon class="muted size-3.5 shrink-0" />
							</Button>
						</FieldShell>
					</div>
				{:else if itemSetupLayoutMode === 'compact'}
					<div class="grid gap-3">
						<div class="grid grid-cols-[minmax(0,1.1fr)_minmax(0,0.6fr)_minmax(0,0.8fr)] gap-3">
							<FieldShell class="min-w-0">
								<FieldLabel>Item Name</FieldLabel>
								<Input
									type="text"
									size="sm"
									{disabled}
									class={itemNameFieldClass(item)}
									value={item.name}
									placeholder="Scope item"
									oninput={(e) => updateTakeoffItemName(item.id, e.currentTarget.value)}
								/>
							</FieldShell>
							<FieldShell class="min-w-0">
								<FieldLabel>Qty</FieldLabel>
								<Input
									type="text"
									size="sm"
									{disabled}
									inputmode="decimal"
									class="text-right tabular-nums"
									placeholder="1"
									value={getNumericInputValue(item.id, 'quantity', item.quantity)}
									oninput={(e) => updateTakeoffQuantityDraft(item.id, e.currentTarget.value)}
									onfocus={() => beginNumericInputEdit(item.id, 'quantity')}
									onblur={() => endNumericInputEdit(item.id, 'quantity')}
								/>
							</FieldShell>
							<FieldShell class="min-w-0">
								<FieldLabel>Unit</FieldLabel>
								<Select.Root
									type="single"
									{disabled}
									value={item.unit}
									onValueChange={(value: string) =>
										updateTakeoffItemField(item.id, 'unit', value || item.unit)}
								>
									<Select.Trigger size="sm" class="w-full">
										{TAKEOFF_ITEM_UNIT_OPTIONS.find((option) => option.value === item.unit)
											?.label ?? item.unit}
									</Select.Trigger>
									<Select.Content>
										{#each TAKEOFF_ITEM_UNIT_OPTIONS as option (option.value)}
											<Select.Item value={option.value}>{option.label}</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
							</FieldShell>
						</div>
						<div class="grid grid-cols-2 gap-3">
							<FieldShell class="min-w-0">
								<div class="flex items-center gap-1.5">
									<FieldLabel class="px-0">Cost Code</FieldLabel>
								</div>
								<Button
									type="button"
									variant="secondary"
									size="sm"
									{disabled}
									class="ui-field-trigger-button w-full justify-between gap-2 overflow-hidden text-left"
									onclick={() =>
										openWorkspaceLinkDialog({
											mode: 'set_item_field',
											category: 'cost_code',
											itemId: item.id,
											querySeed: selectedCostCodeLabel(item.cost_code_id)
										})}
								>
									<span class="min-w-0 truncate">{selectedCostCodeLabel(item.cost_code_id)}</span>
									<ChevronDownIcon class="muted size-3.5 shrink-0" />
								</Button>
							</FieldShell>
							<FieldShell class="min-w-0">
								<div class="flex items-center gap-1.5">
									<FieldLabel class="px-0">Structure</FieldLabel>
									<FormHelpTooltip
										content="Optional. Use Project Structure (WBS) when this takeoff item belongs to a specific project phase, level, room, or zone."
									/>
								</div>
								<Button
									type="button"
									variant="secondary"
									size="sm"
									{disabled}
									class="ui-field-trigger-button w-full justify-between gap-2 overflow-hidden text-left"
									onclick={() =>
										openWorkspaceLinkDialog({
											mode: 'set_item_field',
											category: 'structure',
											itemId: item.id,
											querySeed: selectedWbsLabel(item.wbs_node_id)
										})}
								>
									<span class="min-w-0 truncate">{selectedWbsLabel(item.wbs_node_id)}</span>
									<ChevronDownIcon class="muted size-3.5 shrink-0" />
								</Button>
							</FieldShell>
						</div>
					</div>
				{:else}
					<div class="grid gap-3">
						<FieldShell class="min-w-0">
							<FieldLabel>Item Name</FieldLabel>
							<Input
								type="text"
								size="sm"
								{disabled}
								class={itemNameFieldClass(item)}
								value={item.name}
								placeholder="Scope item"
								oninput={(e) => updateTakeoffItemName(item.id, e.currentTarget.value)}
							/>
						</FieldShell>
						<FieldShell class="min-w-0">
							<FieldLabel>Qty</FieldLabel>
							<Input
								type="text"
								size="sm"
								{disabled}
								inputmode="decimal"
								class="text-right tabular-nums"
								placeholder="1"
								value={getNumericInputValue(item.id, 'quantity', item.quantity)}
								oninput={(e) => updateTakeoffQuantityDraft(item.id, e.currentTarget.value)}
								onfocus={() => beginNumericInputEdit(item.id, 'quantity')}
								onblur={() => endNumericInputEdit(item.id, 'quantity')}
							/>
						</FieldShell>
						<FieldShell class="min-w-0">
							<FieldLabel>Unit</FieldLabel>
							<Select.Root
								type="single"
								{disabled}
								value={item.unit}
								onValueChange={(value: string) =>
									updateTakeoffItemField(item.id, 'unit', value || item.unit)}
							>
								<Select.Trigger size="sm" class="w-full">
									{TAKEOFF_ITEM_UNIT_OPTIONS.find((option) => option.value === item.unit)?.label ??
										item.unit}
								</Select.Trigger>
								<Select.Content>
									{#each TAKEOFF_ITEM_UNIT_OPTIONS as option (option.value)}
										<Select.Item value={option.value}>{option.label}</Select.Item>
									{/each}
								</Select.Content>
							</Select.Root>
						</FieldShell>
						<FieldShell class="min-w-0">
							<div class="flex items-center gap-1.5">
								<FieldLabel class="px-0">Cost Code</FieldLabel>
							</div>
							<Button
								type="button"
								variant="secondary"
								size="sm"
								{disabled}
								class="ui-field-trigger-button w-full justify-between gap-2 overflow-hidden text-left"
								onclick={() =>
									openWorkspaceLinkDialog({
										mode: 'set_item_field',
										category: 'cost_code',
										itemId: item.id,
										querySeed: selectedCostCodeLabel(item.cost_code_id)
									})}
							>
								<span class="min-w-0 truncate">{selectedCostCodeLabel(item.cost_code_id)}</span>
								<ChevronDownIcon class="muted size-3.5 shrink-0" />
							</Button>
						</FieldShell>
						<FieldShell class="min-w-0">
							<div class="flex items-center gap-1.5">
								<FieldLabel class="px-0">Structure</FieldLabel>
								<FormHelpTooltip
									content="Optional. Use Project Structure (WBS) when this takeoff item belongs to a specific project phase, level, room, or zone."
								/>
							</div>
							<Button
								type="button"
								variant="secondary"
								size="sm"
								{disabled}
								class="ui-field-trigger-button w-full justify-between gap-2 overflow-hidden text-left"
								onclick={() =>
									openWorkspaceLinkDialog({
										mode: 'set_item_field',
										category: 'structure',
										itemId: item.id,
										querySeed: selectedWbsLabel(item.wbs_node_id)
									})}
							>
								<span class="min-w-0 truncate">{selectedWbsLabel(item.wbs_node_id)}</span>
								<ChevronDownIcon class="muted size-3.5 shrink-0" />
							</Button>
						</FieldShell>
					</div>
				{/if}
			</div>
		{/if}
	</div>

	{#if !collapsed}
		<div class="space-y-3 px-4 py-4">
			<div class="space-y-3">
				<div class="space-y-2">
					<div class="flex flex-wrap items-center justify-between gap-2">
						<Text>Item details</Text>
						<div class="flex flex-wrap items-center gap-2">
							<Button
								variant={detailsExpanded ? 'ghost' : 'outline'}
								size="sm"
								{disabled}
								onclick={toggleItemDetails}
							>
								{detailsExpanded
									? 'Hide details'
									: item.description.trim()
										? 'Edit details'
										: 'Add details'}
							</Button>
							<Button
								variant="ghost"
								size="sm"
								disabled={disabled || item.cost_components.length === 0}
								onclick={() => openSavePreset(item.id)}
							>
								Save Preset
							</Button>
							<DropdownMenu.Root>
								<DropdownMenu.Trigger>
									{#snippet child({ props })}
										<Button {...props} size="sm" class="gap-2" {disabled}>
											<PlusIcon class="size-4" />
											{itemSetupLayoutMode === 'narrow' ? 'Add row' : 'Add cost row'}
										</Button>
									{/snippet}
								</DropdownMenu.Trigger>
								<DropdownMenu.Content align="start" class="ui-radius-lg w-64">
									<DropdownMenu.Label>From workspace data</DropdownMenu.Label>
									<DropdownMenu.Item
										onclick={() =>
											openWorkspaceLinkDialog({
												mode: 'add_component',
												category: 'material',
												itemId: item.id
											})}
									>
										Search Material Catalogue
									</DropdownMenu.Item>
									<DropdownMenu.Item
										onclick={() =>
											openWorkspaceLinkDialog({
												mode: 'add_component',
												category: 'labour',
												itemId: item.id
											})}
									>
										Search Labour Rates
									</DropdownMenu.Item>
									<DropdownMenu.Item
										onclick={() =>
											openWorkspaceLinkDialog({
												mode: 'add_component',
												category: 'equipment',
												itemId: item.id
											})}
									>
										Search Equipment Rates
									</DropdownMenu.Item>
									<DropdownMenu.Item
										onclick={() =>
											openWorkspaceLinkDialog({
												mode: 'add_component',
												category: 'subcontract',
												itemId: item.id
											})}
									>
										Search Subcontract Rates
									</DropdownMenu.Item>
									<DropdownMenu.Item
										onclick={() =>
											openWorkspaceLinkDialog({
												mode: 'apply_preset',
												category: 'preset',
												itemId: item.id,
												querySeed: item.name
											})}
									>
										Search Cost Presets
									</DropdownMenu.Item>
									<DropdownMenu.Separator />
									<DropdownMenu.Label>Manual row</DropdownMenu.Label>
									<DropdownMenu.Item
										onclick={() => void addManualCostComponent(item.id, 'material')}
									>
										Material
									</DropdownMenu.Item>
									<DropdownMenu.Item onclick={() => void addManualCostComponent(item.id, 'labour')}>
										Labour
									</DropdownMenu.Item>
									<DropdownMenu.Item
										onclick={() => void addManualCostComponent(item.id, 'equipment')}
									>
										Equipment
									</DropdownMenu.Item>
									<DropdownMenu.Item
										onclick={() => void addManualCostComponent(item.id, 'subcontract')}
									>
										Subcontract
									</DropdownMenu.Item>
								</DropdownMenu.Content>
							</DropdownMenu.Root>
						</div>
					</div>
					{#if detailsExpanded}
						<Input
							type="text"
							size="sm"
							value={item.description}
							placeholder="Describe what is being measured or installed"
							oninput={(e) => updateTakeoffItemField(item.id, 'description', e.currentTarget.value)}
						/>
					{/if}
				</div>

				{#if detailsExpanded}
					{#if showAiReviewSession && (itemAiQuestions(item).length > 0 || itemAiEvidence(item).length > 0 || componentReviewEntries(item).length > 0)}
						<Accordion.Root type="multiple" class="ui-radius-md overflow-hidden border">
							<Accordion.Item value="ai-review">
								<Accordion.Header>
									<Accordion.Trigger>
										<div class="flex min-w-0 flex-1 items-center gap-2">
											<Text as="span" class="shell-label-strong">AI review</Text>
											<FormHelpTooltip
												content="AI has filled parts of this estimate from the attached evidence. Review items and highlighted fields show what still needs your attention."
											/>
											<Meta
												>{itemAiReviewCount(item)} review item{itemAiReviewCount(item) === 1
													? ''
													: 's'}</Meta
											>
										</div>
										<ChevronDownIcon class="muted size-4 shrink-0" data-accordion-chevron />
									</Accordion.Trigger>
								</Accordion.Header>
								<Accordion.Content>
									<div class="space-y-3 px-4 py-3">
										{#if itemAiQuestions(item).length > 0}
											<div class="space-y-2">
												<Meta>Review actions</Meta>
												<div class="ui-radius-sm overflow-hidden border bg-background">
													{#each itemAiQuestions(item) as question, questionIndex (`${item.id}-${question}`)}
														<div
															class={`flex items-start gap-2 px-3 py-2.5 ${questionIndex > 0 ? 'border-t' : ''}`}
														>
															<span
																class={`ui-radius-pill mt-1 size-1.5 shrink-0 ${reviewDotClass('review')}`}
															></span>
															<div class="min-w-0 space-y-1">
																<Text>{itemReviewActionTitle(question)}</Text>
																<Meta>{question}</Meta>
															</div>
														</div>
													{/each}
												</div>
											</div>
										{/if}
										{#if itemAiEvidence(item).length > 0}
											<div class="space-y-2">
												<Meta>Evidence used</Meta>
												{#each itemAiEvidence(item) as ref, evidenceIndex (`${item.id}-${evidenceIndex}`)}
													<button
														class="ui-picker-option"
														onclick={() => onAiEvidenceSelect(ref as AiEvidenceRef)}
													>
														<Text>{evidenceSummaryLabel(ref as AiEvidenceRef)}</Text>
														<Meta class="pt-1">{ref.summary}</Meta>
													</button>
												{/each}
											</div>
										{/if}
										{#if componentReviewEntries(item).length > 0}
											<div class="space-y-2">
												<Meta>Component review</Meta>
												<div class="ui-radius-sm overflow-hidden border bg-background">
													{#each componentReviewEntries(item) as component, componentIndex (`${item.id}-${component.id}`)}
														<div
															class={`space-y-1 px-3 py-2.5 ${componentIndex > 0 ? 'border-t' : ''}`}
														>
															<div class="flex items-center gap-2">
																<span
																	class={`ui-radius-pill size-1.5 shrink-0 ${reviewDotClass(componentReviewTone(component))}`}
																></span>
																<Text>{component.name}</Text>
																{#if componentReviewMeta(component)}
																	<FormHelpTooltip content={componentReviewMeta(component)} />
																{/if}
															</div>
															{#if distinctComponentEvidence(item, component).length > 0}
																<div class="space-y-2 pt-1">
																	{#each distinctComponentEvidence(item, component) as ref, evidenceIndex (`${component.id}-${evidenceIndex}`)}
																		<button
																			class="ui-picker-option"
																			onclick={() => onAiEvidenceSelect(ref)}
																		>
																			<Meta>{evidenceSummaryLabel(ref)}</Meta>
																			<Meta class="pt-1">{ref.summary}</Meta>
																		</button>
																	{/each}
																</div>
															{/if}
														</div>
													{/each}
												</div>
											</div>
										{/if}
									</div>
								</Accordion.Content>
							</Accordion.Item>
						</Accordion.Root>
					{/if}
				{/if}
			</div>
		</div>
	{/if}

	<div class={`overflow-x-auto ${collapsed ? '' : 'border-t'}`}>
		<div class={tableWidthClass(itemSetupLayoutMode)}>
			<Table.Root>
				<Table.Header class="ui-table-header-surface">
					<Table.Row>
						<Table.Head class={tableCategoryClass(itemSetupLayoutMode)}
							><TableHeaderLabel text="Category" /></Table.Head
						>
						<Table.Head class={tableNameClass(itemSetupLayoutMode)}
							><TableHeaderLabel text="Name" /></Table.Head
						>
						<Table.Head class={tableQtyClass(itemSetupLayoutMode)}>
							<TableHeaderLabel text="Qty" align="right" />
						</Table.Head>
						<Table.Head class={tableUnitClass(itemSetupLayoutMode)}
							><TableHeaderLabel text="Unit" /></Table.Head
						>
						<Table.Head class={tableRateClass(itemSetupLayoutMode)}>
							<TableHeaderLabel text="Rate" align="right" />
						</Table.Head>
						<Table.Head class={tableTotalClass(itemSetupLayoutMode)}>
							<TableHeaderLabel text="Total" align="right" />
						</Table.Head>
						<Table.Head class={tableActionClass(itemSetupLayoutMode)}></Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each item.cost_components as component (component.id)}
						<Table.Row class={hasAiComponentHighlight(component) ? 'status-tint-success' : ''}>
							<Table.Cell>
								<Select.Root
									type="single"
									{disabled}
									value={component.category}
									onValueChange={(value: string) =>
										updateCostComponentField(
											item.id,
											component.id,
											'category',
											(value || component.category) as CostComponentCategory
										)}
								>
									<Select.Trigger size="sm" class="w-full capitalize">
										{component.category}
									</Select.Trigger>
									<Select.Content>
										{#each ['material', 'labour', 'equipment', 'subcontract', 'misc'] as category (category)}
											<Select.Item value={category} class="capitalize">{category}</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
							</Table.Cell>
							<Table.Cell class={tableNameClass(itemSetupLayoutMode)}>
								<Input
									type="text"
									size="sm"
									{disabled}
									class={`${tableNameClass(itemSetupLayoutMode)} ${componentNameFieldClass(component)}`}
									value={component.name}
									oninput={(e) =>
										updateCostComponentName(item.id, component.id, e.currentTarget.value)}
								/>
							</Table.Cell>
							<Table.Cell class={`${tableQtyClass(itemSetupLayoutMode)} text-right`}>
								<Input
									type="text"
									size="sm"
									{disabled}
									inputmode="decimal"
									class={`${itemSetupLayoutMode === 'wide' ? 'min-w-20' : 'min-w-16'} text-right tabular-nums`}
									placeholder="1"
									value={getNumericInputValue(component.id, 'quantity', component.quantity)}
									oninput={(e) =>
										updateCostComponentNumberDraft(
											item.id,
											component.id,
											'quantity',
											e.currentTarget.value
										)}
									onfocus={() => beginNumericInputEdit(component.id, 'quantity')}
									onblur={() => endNumericInputEdit(component.id, 'quantity')}
								/>
							</Table.Cell>
							<Table.Cell class={tableUnitClass(itemSetupLayoutMode)}>
								<Select.Root
									type="single"
									{disabled}
									value={component.unit}
									onValueChange={(value: string) =>
										updateCostComponentField(
											item.id,
											component.id,
											'unit',
											value || component.unit
										)}
								>
									<Select.Trigger size="sm" class="w-full">
										{costComponentUnitOptions(component.category).find(
											(option) => option.value === component.unit
										)?.label ??
											COST_COMPONENT_UNIT_OPTIONS.find((option) => option.value === component.unit)
												?.label ??
											component.unit}
									</Select.Trigger>
									<Select.Content>
										{#each costComponentUnitOptions(component.category) as option (option.value)}
											<Select.Item value={option.value}>{option.label}</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
							</Table.Cell>
							<Table.Cell class={`${tableRateClass(itemSetupLayoutMode)} text-right`}>
								<Input
									type="text"
									size="sm"
									{disabled}
									inputmode="decimal"
									class={`${itemSetupLayoutMode === 'wide' ? 'min-w-20' : 'min-w-16'} text-right tabular-nums`}
									placeholder="0.00"
									value={getNumericInputValue(component.id, 'unit_rate', component.unit_rate)}
									oninput={(e) =>
										updateCostComponentNumberDraft(
											item.id,
											component.id,
											'unit_rate',
											e.currentTarget.value
										)}
									onfocus={() => beginNumericInputEdit(component.id, 'unit_rate')}
									onblur={() => endNumericInputEdit(component.id, 'unit_rate')}
								/>
							</Table.Cell>
							<Table.Cell class={`${tableTotalClass(itemSetupLayoutMode)} text-right`}>
								<Text as="span" class="tabular-nums">
									{formatCurrency(costComponentUnitCost(component))}
								</Text>
							</Table.Cell>
							<Table.Cell class={`${tableActionClass(itemSetupLayoutMode)} ps-0 pe-2 text-right`}>
								<div class="flex justify-end">
									<DropdownMenu.Root>
										<DropdownMenu.Trigger>
											{#snippet child({ props })}
												<Button
													{...props}
													variant="ghost"
													size="icon"
													{disabled}
													class="size-6"
													aria-label={`Open cost row actions for ${component.name || 'component'}`}
												>
													<span class="sr-only">Open cost row actions</span>
													<MoreHorizontalIcon class="size-3.5" />
												</Button>
											{/snippet}
										</DropdownMenu.Trigger>
										<DropdownMenu.Content align="end" class="ui-menu-width-sm">
											{#if componentCanLinkFromWorkspace(component)}
												{@const linkCategory = workspaceLinkCategoryForComponent(component)}
												<DropdownMenu.Item
													class="gap-2"
													onclick={() => {
														if (!linkCategory) return;
														openWorkspaceLinkDialog({
															mode: 'replace_component',
															category: linkCategory,
															itemId: item.id,
															componentId: component.id,
															querySeed: component.name
														});
													}}
												>
													<LinkIcon class="muted size-3.5" />
													<span>Link from workspace</span>
												</DropdownMenu.Item>
											{/if}
											<DropdownMenu.Item
												class="gap-2"
												onclick={() => duplicateCostComponent(item.id, component.id)}
											>
												<CopyIcon class="muted size-3.5" />
												<span>Duplicate cost row</span>
											</DropdownMenu.Item>
											<DropdownMenu.Item
												class="menu-item-destructive gap-2"
												onclick={() => removeCostComponent(item.id, component.id)}
											>
												<Trash2Icon class="size-3.5" />
												<span>Delete cost row</span>
											</DropdownMenu.Item>
										</DropdownMenu.Content>
									</DropdownMenu.Root>
								</div>
							</Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row>
							<Table.Cell colspan={7} class="h-16 text-center">
								<Text as="span">
									Add a catalogue item, apply a preset, or create a manual cost row.
								</Text>
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</div>
	</div>
</div>

<Dialog.Root bind:open={workspaceLinkDialogOpen}>
	<Dialog.FormFrame
		title={workspaceLinkDialogTitle()}
		description={workspaceLinkDialogDescription()}
		class="ui-dialog-size-md"
	>
		<div class="space-y-3">
			<FieldShell>
				<Cluster gap="var(--space-1-5)" align="center">
					<FieldLabel for="workspace-link-search">Search</FieldLabel>
					<FormHelpTooltip
						content="Type estimator shorthand, supplier wording, or alternate record names."
					/>
				</Cluster>
				<SearchInput
					id="workspace-link-search"
					size="sm"
					bind:value={workspaceLinkSearch}
					autofocus
					placeholder="Search name, code, or alias"
				/>
			</FieldShell>
			<div class="ui-picker-surface ui-scroll-panel">
				{#if workspaceLinkAllowsClear(pendingWorkspaceLinkIntent)}
					<button
						class="ui-picker-option"
						role="option"
						data-selected={workspaceLinkOptionSelected('')}
						aria-selected={workspaceLinkOptionSelected('')}
						onclick={() => void selectWorkspaceLinkOption('')}
					>
						<div class="flex items-start justify-between gap-3">
							<div class="min-w-0 flex-1">
								<Text>{workspaceLinkClearLabel(pendingWorkspaceLinkIntent)}</Text>
								<Meta>
									{workspaceLinkClearDescription(pendingWorkspaceLinkIntent)}
								</Meta>
							</div>
							{#if workspaceLinkOptionSelected('')}
								<CheckIcon class="mt-0.5 size-4 shrink-0 text-primary" />
							{/if}
						</div>
					</button>
				{/if}
				{#if filteredWorkspaceLinkOptions.length > 0}
					{#each filteredWorkspaceLinkOptions as option (option.id)}
						{@const selected = workspaceLinkOptionSelected(option.id)}
						<button
							class="ui-picker-option"
							role="option"
							data-selected={selected}
							aria-selected={selected}
							onclick={() => void selectWorkspaceLinkOption(option.id)}
						>
							<div class="flex items-start justify-between gap-3">
								<div class="min-w-0 flex-1">
									<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
										<Text>{option.label}</Text>
										{#if option.code}
											<Meta>{option.code}</Meta>
										{/if}
									</div>
									{#if option.meta || option.aliases.length > 0}
										<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
											{#if option.meta}
												<Meta>{option.meta}</Meta>
											{/if}
											{#if option.aliases.length > 0}
												<FormHelpTooltip content={`Aliases: ${option.aliases.join(', ')}`} />
											{/if}
										</div>
									{/if}
								</div>
								{#if selected}
									<CheckIcon class="mt-0.5 size-4 shrink-0 text-primary" />
								{/if}
							</div>
						</button>
					{/each}
				{:else}
					<div class="ui-picker-empty">
						<Text>{workspaceLinkEmptyStateTitle()}</Text>
						<Meta>{workspaceLinkEmptyStateDescription()}</Meta>
					</div>
				{/if}
			</div>
		</div>

		{#snippet footer()}
			<Button variant="secondary" onclick={closeWorkspaceLinkDialog}>Cancel</Button>
		{/snippet}
	</Dialog.FormFrame>
</Dialog.Root>
