import { getContext, setContext } from 'svelte';
import type {
	Asset,
	CostComponent,
	CostComponentPreset,
	Estimate,
	EstimateTemplate,
	CreateQuoteRevisionInput,
	Project,
	QuoteRevision,
	QuoteOption,
	QuoteOptionPreset,
	TakeoffItem
} from '$lib/types/index.js';
import { dbService } from '$lib/services/db.js';
import { createLogger } from '$lib/services/logger.js';
import { SvelteDate, SvelteMap, SvelteSet } from 'svelte/reactivity';
import { dec } from '$lib/utils/math.js';
import { cloneEstimateSnapshot } from '$lib/utils/estimate-snapshot.js';
import { errorState } from './errors.svelte.js';
import type {
	CostComponentPresetFormValues,
	EstimateTemplateFormValues,
	QuoteOptionFormValues,
	QuoteOptionPresetFormValues
} from '$lib/schemas/index.js';

const QUOTE_ENGINE_KEY = Symbol('QUOTE_ENGINE');
const log = createLogger('quoteState');

function blankEstimate(assetId: string): Estimate {
	return {
		asset_id: assetId,
		scope_summary: '',
		notes: '',
		classification_system_id: null,
		wbs_root_node_id: null,
		applied_template_id: null,
		applied_template_name: null,
		takeoff_items: []
	};
}

function cloneEstimate(estimate: Estimate): Estimate {
	return cloneEstimateSnapshot(estimate);
}

function generateId(): string {
	return crypto.randomUUID();
}

function blankQuoteOption(projectId: string): QuoteOption {
	const now = nowIsoString();
	return {
		id: crypto.randomUUID(),
		project_id: projectId,
		label: 'Standard',
		lead_time: '2 weeks',
		markup_percentage: 0,
		material_markup_percentage: null,
		labour_markup_percentage: null,
		equipment_markup_percentage: null,
		subcontract_markup_percentage: null,
		notes: '',
		sort_order: 0,
		is_default: true,
		created_at: now,
		updated_at: now
	};
}

export function clampQuoteOptionMarkupPercentage(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.max(-100, value);
}

function nowIsoString(): string {
	return new SvelteDate().toISOString();
}

function cloneQuoteOptions(options: QuoteOption[]): QuoteOption[] {
	return options.map((option) => ({ ...option }));
}

export function costComponentUnitCost(component: CostComponent): number {
	return dec(component.quantity).mul(component.unit_rate).toNumber();
}

export function operationCost(component: CostComponent): number {
	return costComponentUnitCost(component);
}

export function takeoffItemUnitCost(item: TakeoffItem): number {
	return item.cost_components
		.reduce((sum, component) => sum.plus(costComponentUnitCost(component)), dec(0))
		.toNumber();
}

export function takeoffItemTotal(item: TakeoffItem): number {
	return dec(item.quantity).mul(takeoffItemUnitCost(item)).toNumber();
}

export function estimateTotalCost(est: Estimate): number {
	return est.takeoff_items
		.reduce((sum, item) => sum.plus(takeoffItemTotal(item)), dec(0))
		.toNumber();
}

function estimateCategoryCost(est: Estimate, category: string): number {
	return est.takeoff_items
		.reduce((sum, item) => {
			const unitCost = item.cost_components
				.filter((component) => component.category === category)
				.reduce((cost, component) => cost.plus(costComponentUnitCost(component)), dec(0));
			return sum.plus(unitCost.mul(item.quantity));
		}, dec(0))
		.toNumber();
}

/**
 * Compute the total marked-up price for an estimate using per-category markup rates.
 * Falls back to the general markup when a category has no specific rate set.
 */
export function estimateTotalPrice(
	est: Estimate,
	generalMarkupPercent: number,
	materialMarkupPercent: number | null,
	labourMarkupPercent: number | null,
	equipmentMarkupPercent: number | null,
	subcontractMarkupPercent: number | null
): number {
	const categories: Array<{ key: string; markup: number | null }> = [
		{ key: 'material', markup: materialMarkupPercent },
		{ key: 'labour', markup: labourMarkupPercent },
		{ key: 'equipment', markup: equipmentMarkupPercent },
		{ key: 'subcontract', markup: subcontractMarkupPercent },
		{ key: 'misc', markup: null }
	];

	let total = dec(0);
	for (const { key, markup } of categories) {
		const categoryCost = estimateCategoryCost(est, key);
		if (categoryCost === 0) continue;
		const rate = markup != null ? markup : generalMarkupPercent;
		total = total.plus(dec(categoryCost).mul(dec(1).plus(dec(rate).div(100))));
	}
	return total.toNumber();
}

function takeoffItemHasContent(item: TakeoffItem): boolean {
	return (
		item.name.trim().length > 0 ||
		item.description.trim().length > 0 ||
		item.cost_components.some(
			(component) =>
				component.name.trim().length > 0 ||
				component.description.trim().length > 0 ||
				component.quantity > 0 ||
				component.unit_rate > 0
		)
	);
}

export function estimateHasQuoteContent(est: Estimate): boolean {
	return (
		est.scope_summary.trim().length > 0 ||
		est.notes.trim().length > 0 ||
		est.takeoff_items.some(takeoffItemHasContent)
	);
}

function hasAiMetadata(record: Record<string, unknown> | null | undefined): boolean {
	return Boolean(record && Object.keys(record).some((key) => key.startsWith('ai_')));
}

function estimateHasAiAppliedData(est: Estimate): boolean {
	return est.takeoff_items.some(
		(item) =>
			hasAiMetadata(item.properties) ||
			item.cost_components.some((component) => hasAiMetadata(component.metadata))
	);
}

/**
 * Auto-resolve AI mapping status for components that have valid commercial data.
 * Components with unit_rate > 0 and quantity > 0 are considered "resolved"
 * because the user has provided (or accepted) valid values. Zero-rate components
 * stay unresolved — they still need attention.
 */
function autoResolveAiMappings(est: Estimate): void {
	for (const item of est.takeoff_items) {
		for (const component of item.cost_components) {
			if (component.metadata?.ai_mapping_status === 'unresolved') {
				if (
					Number.isFinite(component.unit_rate) &&
					component.unit_rate > 0 &&
					Number.isFinite(component.quantity) &&
					component.quantity > 0
				) {
					component.metadata.ai_mapping_status = 'resolved';
				}
			}
		}
	}
}

function pushUniqueBlocker(blockers: string[], message: string): void {
	if (!blockers.includes(message)) {
		blockers.push(message);
	}
}

export function estimateCommercialReadinessBlockers(est: Estimate): string[] {
	if (!estimateHasAiAppliedData(est)) return [];

	const blockers: string[] = [];
	for (const item of est.takeoff_items) {
		for (const component of item.cost_components) {
			if (!hasAiMetadata(component.metadata)) continue;
			if (component.metadata?.ai_mapping_status === 'unresolved') {
				pushUniqueBlocker(blockers, 'Resolve AI source matches before quote');
			}
			if (!Number.isFinite(component.unit_rate) || component.unit_rate <= 0) {
				pushUniqueBlocker(blockers, 'Add rates before quote');
			}
		}
	}
	return blockers;
}

export function estimateDisplaySummary(est: Estimate): string {
	return (
		est.scope_summary.trim() ||
		est.takeoff_items[0]?.description?.trim() ||
		est.takeoff_items[0]?.name?.trim() ||
		''
	);
}

export function getPrimaryTakeoffItem(est: Estimate): TakeoffItem | undefined {
	return est.takeoff_items[0];
}

export function getMaterialComponent(est: Estimate): CostComponent | undefined {
	return getPrimaryTakeoffItem(est)?.cost_components.find(
		(component) => component.category === 'material'
	);
}

export function getOperationComponents(est: Estimate): CostComponent[] {
	return (
		getPrimaryTakeoffItem(est)?.cost_components.filter(
			(component) => component.category !== 'material'
		) ?? []
	);
}

export function rawMaterialCost(est: Estimate): number {
	const component = getMaterialComponent(est);
	return component ? costComponentUnitCost(component) : 0;
}

export function quoteOptionMultiplier(option: Pick<QuoteOption, 'markup_percentage'>): number {
	return dec(1).plus(dec(option.markup_percentage).div(100)).toNumber();
}

export class QuoteEngineState {
	projectId: string = $state('');

	estimates: SvelteMap<string, Estimate> = new SvelteMap();
	savedEstimates: SvelteMap<string, Estimate> = new SvelteMap();
	hydratedEstimateIds: SvelteSet<string> = new SvelteSet();
	selectedIds: SvelteSet<string> = new SvelteSet();
	dirtyIds: SvelteSet<string> = new SvelteSet();
	savedIds: SvelteSet<string> = new SvelteSet();
	savedContentIds: SvelteSet<string> = new SvelteSet();

	quoteOptions: QuoteOption[] = $state([]);
	quoteOptionPresets: QuoteOptionPreset[] = $state([]);
	activeQuoteOptionId: string | null = $state(null);
	quoteRevisions: QuoteRevision[] = $state([]);
	quoteRevisionsHydrated = $state(false);

	quantities: SvelteMap<string, number> = new SvelteMap();
	pdfInclusion: SvelteMap<string, boolean> = new SvelteMap();
	roundPrices: boolean = $state(false);
	private estimateHydrationRequests: SvelteMap<string, Promise<void>> = new SvelteMap();
	private estimateStatusHydrationRequest: Promise<void> | null = null;
	private estimateStatusHydrationProjectId: string | null = null;
	private estimateStatusesHydrated = false;
	private estimateStatusesProjectId: string | null = null;
	private projectBindingVersion = 0;
	private quoteOptionMutationVersion = 0;

	constructor(projectId: string) {
		this.projectId = projectId;
	}

	hydrateProjectPreferences(project: Pick<Project, 'id' | 'quote_round_prices'>): void {
		this.bindProject(project.id);
		this.projectId = project.id;
		this.roundPrices = project.quote_round_prices ?? false;
	}

	private bindProject(projectId: string): void {
		if (this.projectId === projectId) return;

		const previousProjectId = this.projectId;
		this.projectId = projectId;
		this.projectBindingVersion += 1;
		this.estimates.clear();
		this.savedEstimates.clear();
		this.hydratedEstimateIds.clear();
		this.selectedIds.clear();
		this.dirtyIds.clear();
		this.savedIds.clear();
		this.savedContentIds.clear();
		this.quoteOptions = [];
		this.quoteOptionPresets = [];
		this.activeQuoteOptionId = null;
		this.quoteRevisions = [];
		this.quoteRevisionsHydrated = false;
		this.quantities.clear();
		this.pdfInclusion.clear();
		this.estimateHydrationRequests.clear();
		this.estimateStatusHydrationRequest = null;
		this.estimateStatusHydrationProjectId = null;
		this.estimateStatusesHydrated = false;
		this.estimateStatusesProjectId = null;
		log.debug('Rebound quote engine project context', {
			previousProjectId,
			projectId
		});
	}

	hydrateWorkspaceAssets(assets: Asset[]): void {
		this.selectedIds.clear();
		this.quantities.clear();
		this.pdfInclusion.clear();
		for (const asset of assets) {
			if (asset.is_selected) this.selectedIds.add(asset.id);
			this.quantities.set(asset.id, asset.quote_quantity ?? 1);
			this.pdfInclusion.set(asset.id, asset.is_pdf_included ?? true);
		}
	}

	getActiveQuoteOption(): QuoteOption {
		return (
			this.quoteOptions.find((option) => option.id === this.activeQuoteOptionId) ??
			this.quoteOptions.find((option) => option.is_default) ??
			this.quoteOptions[0] ??
			blankQuoteOption(this.projectId)
		);
	}

	getQuoteOption(optionId: string): QuoteOption | undefined {
		return this.quoteOptions.find((option) => option.id === optionId);
	}

	getQuoteOptionPreset(presetId: string): QuoteOptionPreset | undefined {
		return this.quoteOptionPresets.find((preset) => preset.id === presetId);
	}

	async hydrateQuoteOptions(): Promise<void> {
		const options = await dbService.getQuoteOptions(this.projectId);
		this.quoteOptions = options.length > 0 ? options : [blankQuoteOption(this.projectId)];
		this.activeQuoteOptionId =
			this.quoteOptions.find((option) => option.is_default)?.id ?? this.quoteOptions[0]?.id ?? null;
		log.info('Hydrated quote options', {
			projectId: this.projectId,
			optionCount: this.quoteOptions.length,
			activeQuoteOptionId: this.activeQuoteOptionId
		});
	}

	async hydrateQuoteOptionPresets(): Promise<void> {
		this.quoteOptionPresets = (await dbService.getQuoteOptionPresets()).sort((left, right) =>
			left.label.localeCompare(right.label)
		);
		log.info('Hydrated quote option presets', {
			projectId: this.projectId,
			presetCount: this.quoteOptionPresets.length
		});
	}

	async hydrateQuoteRevisions(): Promise<void> {
		this.quoteRevisions = await dbService.getQuoteRevisions(this.projectId);
		this.quoteRevisionsHydrated = true;
		log.info('Hydrated quote revisions', {
			projectId: this.projectId,
			revisionCount: this.quoteRevisions.length
		});
	}

	private normaliseQuoteOptions(nextOptions: QuoteOption[]): QuoteOption[] {
		if (nextOptions.length === 0) {
			return [blankQuoteOption(this.projectId)];
		}

		const hasDefault = nextOptions.some((option) => option.is_default);
		return nextOptions.map((option, index) => ({
			...option,
			project_id: this.projectId,
			sort_order: index,
			is_default: option.is_default || (!hasDefault && index === 0)
		}));
	}

	private setQuoteOptions(nextOptions: QuoteOption[]): void {
		this.quoteOptions = this.normaliseQuoteOptions(nextOptions);
		if (!this.quoteOptions.some((option) => option.id === this.activeQuoteOptionId)) {
			this.activeQuoteOptionId =
				this.quoteOptions.find((option) => option.is_default)?.id ??
				this.quoteOptions[0]?.id ??
				null;
		}
	}

	private restoreQuoteOptionSnapshot(
		previousOptions: QuoteOption[],
		previousActiveQuoteOptionId: string | null
	): void {
		this.setQuoteOptions(previousOptions);
		if (
			previousActiveQuoteOptionId &&
			this.quoteOptions.some((option) => option.id === previousActiveQuoteOptionId)
		) {
			this.activeQuoteOptionId = previousActiveQuoteOptionId;
		}
	}

	private runQuoteOptionMutation(
		label: string,
		previousOptions: QuoteOption[],
		previousActiveQuoteOptionId: string | null,
		persist: () => Promise<void>
	): void {
		const mutationVersion = ++this.quoteOptionMutationVersion;
		void (async () => {
			try {
				await persist();
			} catch (error) {
				if (this.quoteOptionMutationVersion === mutationVersion) {
					this.restoreQuoteOptionSnapshot(previousOptions, previousActiveQuoteOptionId);
				} else {
					await this.hydrateQuoteOptions();
				}
				await errorState.catchError(error, label);
			}
		})();
	}

	private restoreSelectedIds(previousSelectedIds: string[]): void {
		this.selectedIds.clear();
		for (const assetId of previousSelectedIds) {
			this.selectedIds.add(assetId);
		}
	}

	private runSelectionMutation(previousSelectedIds: string[], persist: () => Promise<void>): void {
		void (async () => {
			try {
				await persist();
			} catch (error) {
				this.restoreSelectedIds(previousSelectedIds);
				await errorState.catchError(error, 'Update asset selection');
			}
		})();
	}

	async addQuoteOption(
		seed: Partial<
			Pick<
				QuoteOptionFormValues,
				| 'label'
				| 'lead_time'
				| 'markup_percentage'
				| 'material_markup_percentage'
				| 'labour_markup_percentage'
				| 'equipment_markup_percentage'
				| 'subcontract_markup_percentage'
				| 'notes'
			>
		> = {}
	): Promise<void> {
		const previousOptions = cloneQuoteOptions(this.quoteOptions);
		const previousActiveQuoteOptionId = this.activeQuoteOptionId;
		const now = nowIsoString();
		const option: QuoteOption = {
			id: generateId(),
			project_id: this.projectId,
			label: seed.label?.trim() || `Option ${this.quoteOptions.length + 1}`,
			lead_time: seed.lead_time?.trim() || this.getActiveQuoteOption().lead_time || '2 weeks',
			markup_percentage: clampQuoteOptionMarkupPercentage(seed.markup_percentage ?? 0),
			material_markup_percentage: seed.material_markup_percentage ?? null,
			labour_markup_percentage: seed.labour_markup_percentage ?? null,
			equipment_markup_percentage: seed.equipment_markup_percentage ?? null,
			subcontract_markup_percentage: seed.subcontract_markup_percentage ?? null,
			notes: seed.notes?.trim() || '',
			sort_order: this.quoteOptions.length,
			is_default: this.quoteOptions.length === 0,
			created_at: now,
			updated_at: now
		};
		this.setQuoteOptions([...this.quoteOptions, option]);
		this.activeQuoteOptionId = option.id;
		this.runQuoteOptionMutation(
			'Add quote option',
			previousOptions,
			previousActiveQuoteOptionId,
			async () => {
				await dbService.createQuoteOption(option);
			}
		);
	}

	updateQuoteOption(optionId: string, updates: Partial<QuoteOptionFormValues>): void {
		const previousOptions = cloneQuoteOptions(this.quoteOptions);
		const previousActiveQuoteOptionId = this.activeQuoteOptionId;
		const now = nowIsoString();
		const currentOption = this.quoteOptions.find((option) => option.id === optionId);
		if (!currentOption) return;
		const persistedOption: QuoteOption = {
			...currentOption,
			label: updates.label !== undefined ? updates.label.trim() : currentOption.label,
			lead_time:
				updates.lead_time !== undefined ? updates.lead_time.trim() : currentOption.lead_time,
			markup_percentage:
				updates.markup_percentage !== undefined
					? clampQuoteOptionMarkupPercentage(updates.markup_percentage)
					: currentOption.markup_percentage,
			material_markup_percentage:
				updates.material_markup_percentage !== undefined
					? updates.material_markup_percentage
					: currentOption.material_markup_percentage,
			labour_markup_percentage:
				updates.labour_markup_percentage !== undefined
					? updates.labour_markup_percentage
					: currentOption.labour_markup_percentage,
			equipment_markup_percentage:
				updates.equipment_markup_percentage !== undefined
					? updates.equipment_markup_percentage
					: currentOption.equipment_markup_percentage,
			subcontract_markup_percentage:
				updates.subcontract_markup_percentage !== undefined
					? updates.subcontract_markup_percentage
					: currentOption.subcontract_markup_percentage,
			notes: updates.notes !== undefined ? updates.notes.trim() : currentOption.notes,
			is_default: updates.is_default ?? currentOption.is_default,
			updated_at: now
		};
		this.setQuoteOptions(
			this.quoteOptions.map((option) => (option.id === optionId ? persistedOption : option))
		);
		this.runQuoteOptionMutation(
			`Update quote option ${currentOption.label}`,
			previousOptions,
			previousActiveQuoteOptionId,
			async () => {
				await dbService.updateQuoteOption(optionId, {
					label: persistedOption.label,
					lead_time: persistedOption.lead_time,
					markup_percentage: persistedOption.markup_percentage,
					material_markup_percentage: persistedOption.material_markup_percentage,
					labour_markup_percentage: persistedOption.labour_markup_percentage,
					equipment_markup_percentage: persistedOption.equipment_markup_percentage,
					subcontract_markup_percentage: persistedOption.subcontract_markup_percentage,
					notes: persistedOption.notes,
					is_default: persistedOption.is_default
				});
			}
		);
	}

	removeQuoteOption(optionId: string): void {
		if (this.quoteOptions.length <= 1) return;
		const previousOptions = cloneQuoteOptions(this.quoteOptions);
		const previousActiveQuoteOptionId = this.activeQuoteOptionId;
		const removed = this.quoteOptions.find((option) => option.id === optionId);
		const remaining = this.quoteOptions.filter((option) => option.id !== optionId);
		if (removed?.is_default && remaining.length > 0) {
			remaining[0] = { ...remaining[0], is_default: true };
		}
		this.setQuoteOptions(remaining);
		this.runQuoteOptionMutation(
			`Delete quote option ${removed?.label ?? optionId}`,
			previousOptions,
			previousActiveQuoteOptionId,
			async () => {
				await dbService.deleteQuoteOption(optionId);
			}
		);
	}

	setActiveQuoteOption(optionId: string): void {
		if (!this.quoteOptions.some((option) => option.id === optionId)) return;
		this.activeQuoteOptionId = optionId;
	}

	setDefaultQuoteOption(optionId: string): void {
		const previousOptions = cloneQuoteOptions(this.quoteOptions);
		const previousActiveQuoteOptionId = this.activeQuoteOptionId;
		const now = nowIsoString();
		const targetOption = this.quoteOptions.find((option) => option.id === optionId);
		this.setQuoteOptions(
			this.quoteOptions.map((option) => ({
				...option,
				is_default: option.id === optionId,
				updated_at: option.id === optionId ? now : option.updated_at
			}))
		);
		this.activeQuoteOptionId = optionId;
		this.runQuoteOptionMutation(
			`Set default quote option ${targetOption?.label ?? optionId}`,
			previousOptions,
			previousActiveQuoteOptionId,
			async () => {
				await dbService.setDefaultQuoteOption(optionId);
			}
		);
	}

	async addQuoteOptionFromPreset(presetId: string): Promise<void> {
		const preset = this.getQuoteOptionPreset(presetId);
		if (!preset) return;
		await this.addQuoteOption({
			label: preset.label,
			lead_time: preset.lead_time,
			markup_percentage: preset.markup_percentage,
			material_markup_percentage: preset.material_markup_percentage,
			labour_markup_percentage: preset.labour_markup_percentage,
			equipment_markup_percentage: preset.equipment_markup_percentage,
			subcontract_markup_percentage: preset.subcontract_markup_percentage,
			notes: preset.notes
		});
	}

	async saveQuoteOptionAsPreset(
		optionId: string,
		overrides: Partial<QuoteOptionPresetFormValues> = {}
	): Promise<void> {
		const option = this.getQuoteOption(optionId);
		if (!option) return;
		try {
			const presetId = generateId();
			await dbService.addQuoteOptionPreset(presetId, {
				label: overrides.label?.trim() || option.label,
				lead_time: overrides.lead_time?.trim() || option.lead_time,
				markup_percentage:
					overrides.markup_percentage ?? clampQuoteOptionMarkupPercentage(option.markup_percentage),
				material_markup_percentage:
					overrides.material_markup_percentage !== undefined
						? overrides.material_markup_percentage
						: option.material_markup_percentage,
				labour_markup_percentage:
					overrides.labour_markup_percentage !== undefined
						? overrides.labour_markup_percentage
						: option.labour_markup_percentage,
				equipment_markup_percentage:
					overrides.equipment_markup_percentage !== undefined
						? overrides.equipment_markup_percentage
						: option.equipment_markup_percentage,
				subcontract_markup_percentage:
					overrides.subcontract_markup_percentage !== undefined
						? overrides.subcontract_markup_percentage
						: option.subcontract_markup_percentage,
				notes: overrides.notes?.trim() ?? option.notes
			});
			const createdPreset = await dbService.getQuoteOptionPresetById(presetId);
			if (createdPreset) {
				this.quoteOptionPresets = [...this.quoteOptionPresets, createdPreset].sort((left, right) =>
					left.label.localeCompare(right.label)
				);
				return;
			}
			await this.hydrateQuoteOptionPresets();
		} catch (error) {
			await errorState.catchError(error, `Save quote option preset ${option.label}`);
			throw error;
		}
	}

	async updateQuoteOptionPreset(
		presetId: string,
		updates: QuoteOptionPresetFormValues
	): Promise<void> {
		const previousPresets = [...this.quoteOptionPresets];
		const presetLabel = this.getQuoteOptionPreset(presetId)?.label ?? presetId;
		try {
			await dbService.updateQuoteOptionPreset(presetId, updates);
			const updatedPreset = await dbService.getQuoteOptionPresetById(presetId);
			if (updatedPreset) {
				this.quoteOptionPresets = this.quoteOptionPresets
					.filter((preset) => preset.id !== presetId)
					.concat(updatedPreset)
					.sort((left, right) => left.label.localeCompare(right.label));
				return;
			}
			await this.hydrateQuoteOptionPresets();
		} catch (error) {
			this.quoteOptionPresets = previousPresets;
			await errorState.catchError(error, `Update quote option preset ${presetLabel}`);
			throw error;
		}
	}

	async deleteQuoteOptionPreset(presetId: string): Promise<void> {
		const previousPresets = [...this.quoteOptionPresets];
		const presetLabel = this.getQuoteOptionPreset(presetId)?.label ?? presetId;
		this.quoteOptionPresets = this.quoteOptionPresets.filter((preset) => preset.id !== presetId);
		try {
			await dbService.deleteQuoteOptionPreset(presetId);
		} catch (error) {
			this.quoteOptionPresets = previousPresets;
			await errorState.catchError(error, `Delete quote option preset ${presetLabel}`);
			throw error;
		}
	}

	async createQuoteRevision(input: CreateQuoteRevisionInput): Promise<QuoteRevision> {
		log.info('Creating quote revision', {
			projectId: this.projectId,
			rfqNumber: input.rfq_number,
			optionCount: input.options.length
		});
		const revision = await dbService.createQuoteRevision({
			...input,
			project_id: this.projectId
		});
		this.quoteRevisions = [
			revision,
			...this.quoteRevisions.filter((existing) => existing.id !== revision.id)
		];
		this.quoteRevisionsHydrated = true;
		log.info('Created quote revision', {
			projectId: this.projectId,
			revisionId: revision.id,
			revisionNumber: revision.revision_number
		});
		return revision;
	}

	getQuantity(assetId: string): number {
		return this.quantities.get(assetId) ?? 1;
	}

	setQuantity(assetId: string, qty: number): void {
		const nextQty = Math.max(1, Math.trunc(qty));
		const previousQty = this.getQuantity(assetId);
		this.quantities.set(assetId, nextQty);
		void (async () => {
			try {
				await dbService.updateAsset(assetId, { quote_quantity: nextQty });
			} catch (error) {
				this.quantities.set(assetId, previousQty);
				await errorState.catchError(error, 'Update quote quantity');
			}
		})();
	}

	isPdfIncluded(assetId: string): boolean {
		return this.pdfInclusion.get(assetId) ?? true;
	}

	setPdfInclusion(assetId: string, included: boolean): void {
		const previousIncluded = this.isPdfIncluded(assetId);
		this.pdfInclusion.set(assetId, included);
		void (async () => {
			try {
				await dbService.updateAsset(assetId, { is_pdf_included: included });
			} catch (error) {
				this.pdfInclusion.set(assetId, previousIncluded);
				await errorState.catchError(error, 'Update quote PDF inclusion');
			}
		})();
	}

	setRoundPrices(enabled: boolean): void {
		const previousValue = this.roundPrices;
		this.roundPrices = enabled;
		void (async () => {
			try {
				await dbService.updateProjectQuotePreferences(this.projectId, {
					quote_round_prices: enabled
				});
			} catch (error) {
				this.roundPrices = previousValue;
				await errorState.catchError(error, 'Update quote rounding');
			}
		})();
	}

	isSelected(assetId: string): boolean {
		return this.selectedIds.has(assetId);
	}

	get selectedCount(): number {
		return this.selectedIds.size;
	}

	toggleSelection(assetId: string): void {
		const previousSelectedIds = [...this.selectedIds];
		if (this.selectedIds.has(assetId)) {
			this.selectedIds.delete(assetId);
			this.runSelectionMutation(previousSelectedIds, async () => {
				await dbService.updateAssetSelection(assetId, false);
			});
		} else {
			this.selectedIds.add(assetId);
			this.runSelectionMutation(previousSelectedIds, async () => {
				await dbService.updateAssetSelection(assetId, true);
			});
		}
	}

	selectAll(assetIds: string[]): void {
		const previousSelectedIds = [...this.selectedIds];
		for (const id of assetIds) this.selectedIds.add(id);
		this.runSelectionMutation(previousSelectedIds, async () => {
			await dbService.updateBulkSelection(this.projectId, true);
		});
	}

	deselectAll(): void {
		const previousSelectedIds = [...this.selectedIds];
		this.selectedIds.clear();
		this.runSelectionMutation(previousSelectedIds, async () => {
			await dbService.updateBulkSelection(this.projectId, false);
		});
	}

	hydrateSelection(assets: Asset[]): void {
		this.hydrateWorkspaceAssets(assets);
	}

	isDirty(assetId: string): boolean {
		return this.dirtyIds.has(assetId);
	}

	getEstimateStatus(assetId: string): 'not_started' | 'dirty' | 'saved' {
		if (this.dirtyIds.has(assetId)) return 'dirty';
		if (this.savedIds.has(assetId)) return 'saved';
		return 'not_started';
	}

	hasSavedQuoteContent(assetId: string): boolean {
		return this.savedContentIds.has(assetId);
	}

	getSavedEstimate(assetId: string): Estimate | null {
		return this.savedEstimates.get(assetId) ?? null;
	}

	getPdfReadinessBlockers(assetId: string): string[] {
		const savedEstimate = this.savedEstimates.get(assetId);
		return savedEstimate ? estimateCommercialReadinessBlockers(savedEstimate) : [];
	}

	isPdfExportReady(assetId: string): boolean {
		const savedEstimate = this.savedEstimates.get(assetId);
		if (!savedEstimate) return false;
		return (
			this.isPdfIncluded(assetId) &&
			this.hasSavedQuoteContent(assetId) &&
			!this.dirtyIds.has(assetId)
		);
	}

	isEstimateHydrated(assetId: string): boolean {
		return this.hydratedEstimateIds.has(assetId);
	}

	async saveEstimate(assetId: string): Promise<void> {
		const est = this.estimates.get(assetId);
		if (!est) {
			log.warn('Skipped estimate save because no in-memory estimate exists', { assetId });
			return;
		}
		// Auto-resolve AI mappings for components with valid commercial data
		// before persisting — resolved status is saved to DB and in-memory state
		autoResolveAiMappings(est);

		const hasQuoteContent = estimateHasQuoteContent(est);
		log.info('Saving estimate', {
			assetId,
			takeoffItemCount: est.takeoff_items.length,
			hasQuoteContent
		});
		await dbService.saveEstimate(assetId, est);
		this.savedEstimates.set(assetId, cloneEstimate(est));
		this.dirtyIds.delete(assetId);
		this.savedIds.add(assetId);
		this.hydratedEstimateIds.add(assetId);
		if (hasQuoteContent) {
			this.savedContentIds.add(assetId);
		} else {
			this.savedContentIds.delete(assetId);
		}
		log.info('Saved estimate', {
			assetId,
			takeoffItemCount: est.takeoff_items.length,
			hasQuoteContent
		});
	}

	async discardChanges(assetId: string): Promise<void> {
		if (this.savedIds.has(assetId)) {
			const saved = await dbService.getEstimate(assetId);
			if (saved) {
				this.estimates.set(assetId, saved);
				this.savedEstimates.set(assetId, cloneEstimate(saved));
				this.hydratedEstimateIds.add(assetId);
				if (estimateHasQuoteContent(saved)) {
					this.savedContentIds.add(assetId);
				} else {
					this.savedContentIds.delete(assetId);
				}
				log.info('Discarded estimate changes and restored saved estimate', {
					assetId,
					takeoffItemCount: saved.takeoff_items.length,
					hasQuoteContent: estimateHasQuoteContent(saved)
				});
			}
		} else {
			this.estimates.set(assetId, blankEstimate(assetId));
			this.hydratedEstimateIds.add(assetId);
			this.savedEstimates.delete(assetId);
			this.savedContentIds.delete(assetId);
			log.info('Discarded estimate changes and restored blank estimate', { assetId });
		}
		this.dirtyIds.delete(assetId);
	}

	async resetEstimate(assetId: string): Promise<void> {
		await dbService.deleteEstimate(assetId);
		this.estimates.set(assetId, blankEstimate(assetId));
		this.hydratedEstimateIds.add(assetId);
		this.savedEstimates.delete(assetId);
		this.savedIds.delete(assetId);
		this.savedContentIds.delete(assetId);
		this.dirtyIds.delete(assetId);
		log.info('Reset estimate and cleared persisted state', { assetId });
	}

	async hydrateEstimateStatuses(): Promise<void> {
		const requestProjectId = this.projectId.trim();
		const requestVersion = this.projectBindingVersion;
		if (!requestProjectId) {
			log.debug('Skipped estimate status hydration because quote engine is not bound to a project');
			return;
		}

		if (this.estimateStatusesHydrated && this.estimateStatusesProjectId === requestProjectId) {
			return;
		}

		if (
			this.estimateStatusHydrationRequest &&
			this.estimateStatusHydrationProjectId === requestProjectId
		) {
			log.debug('Joined in-flight estimate status hydration request', {
				projectId: this.projectId
			});
			await this.estimateStatusHydrationRequest;
			return;
		}

		const request = Promise.resolve()
			.then(async () => {
				const summaries = await dbService.getEstimateSummariesForProject(requestProjectId);
				if (requestVersion !== this.projectBindingVersion || requestProjectId !== this.projectId) {
					log.debug('Discarded stale estimate status hydration result', {
						requestProjectId,
						currentProjectId: this.projectId
					});
					return;
				}

				this.savedIds.clear();
				this.savedContentIds.clear();
				for (const summary of summaries) {
					this.savedIds.add(summary.asset_id);
					if (summary.has_quote_content) {
						this.savedContentIds.add(summary.asset_id);
					}
				}
				this.dirtyIds.clear();
				this.estimateStatusesHydrated = true;
				this.estimateStatusesProjectId = requestProjectId;
				log.info('Hydrated estimate statuses', {
					projectId: requestProjectId,
					savedEstimateCount: this.savedIds.size,
					savedContentCount: this.savedContentIds.size
				});
			})
			.finally(() => {
				if (this.estimateStatusHydrationRequest === request) {
					this.estimateStatusHydrationRequest = null;
					this.estimateStatusHydrationProjectId = null;
				}
			});

		this.estimateStatusHydrationRequest = request;
		this.estimateStatusHydrationProjectId = requestProjectId;
		await request;
	}

	async hydrateEstimates(): Promise<void> {
		const saved = await dbService.getEstimatesForProject(this.projectId);
		for (const [assetId, estimate] of saved) {
			this.estimates.set(assetId, estimate);
			this.savedEstimates.set(assetId, cloneEstimate(estimate));
			this.hydratedEstimateIds.add(assetId);
			this.savedIds.add(assetId);
			if (estimateHasQuoteContent(estimate)) {
				this.savedContentIds.add(assetId);
			}
		}
		this.dirtyIds.clear();
	}

	async hydrateEstimate(assetId: string): Promise<void> {
		const requestProjectId = this.projectId.trim();
		if (!requestProjectId) {
			log.debug('Skipped estimate hydration because quote engine is not bound to a project', {
				assetId
			});
			return;
		}

		if (this.hydratedEstimateIds.has(assetId)) {
			log.debug('Skipped estimate hydration because asset is already hydrated', { assetId });
			return;
		}

		const requestVersion = this.projectBindingVersion;
		if (!this.estimateStatusesHydrated || this.estimateStatusesProjectId !== requestProjectId) {
			log.debug('Waiting for estimate statuses before hydrating estimate', {
				projectId: requestProjectId,
				assetId
			});
			await this.hydrateEstimateStatuses();
		}

		if (requestVersion !== this.projectBindingVersion || requestProjectId !== this.projectId) {
			log.debug('Restarting estimate hydration after project binding changed', {
				assetId,
				requestProjectId,
				currentProjectId: this.projectId
			});
			await this.hydrateEstimate(assetId);
			return;
		}

		if (this.hydratedEstimateIds.has(assetId)) {
			log.debug('Skipped estimate hydration because asset became hydrated while waiting', {
				assetId
			});
			return;
		}

		const existing = this.estimateHydrationRequests.get(assetId);
		if (existing) {
			log.debug('Joined in-flight estimate hydration request', { assetId });
			await existing;
			return;
		}

		if (!this.savedIds.has(assetId)) {
			this.ensureEstimate(assetId);
			log.info('Hydrated blank estimate for unsaved asset', { assetId });
			return;
		}

		const request = (async () => {
			const saved = await dbService.getEstimate(assetId);
			if (requestVersion !== this.projectBindingVersion || requestProjectId !== this.projectId) {
				log.debug('Discarded stale estimate hydration result', {
					assetId,
					requestProjectId,
					currentProjectId: this.projectId
				});
				return;
			}

			if (saved) {
				this.estimates.set(assetId, saved);
				this.savedEstimates.set(assetId, cloneEstimate(saved));
				this.savedIds.add(assetId);
				if (estimateHasQuoteContent(saved)) {
					this.savedContentIds.add(assetId);
				} else {
					this.savedContentIds.delete(assetId);
				}
			} else {
				this.savedIds.delete(assetId);
				this.savedEstimates.delete(assetId);
				this.savedContentIds.delete(assetId);
				this.estimates.set(assetId, blankEstimate(assetId));
			}
			this.hydratedEstimateIds.add(assetId);
			log.info('Hydrated estimate', {
				assetId,
				foundSavedEstimate: Boolean(saved)
			});
		})().finally(() => {
			if (this.estimateHydrationRequests.get(assetId) === request) {
				this.estimateHydrationRequests.delete(assetId);
			}
		});

		this.estimateHydrationRequests.set(assetId, request);
		await request;
	}

	async hydrateEstimatesForAssets(assetIds: string[]): Promise<void> {
		if (assetIds.length === 0) return;
		if (!this.estimateStatusesHydrated) {
			await this.hydrateEstimateStatuses();
		}
		await Promise.all(assetIds.map((assetId) => this.hydrateEstimate(assetId)));
	}

	getEstimate(assetId: string): Estimate {
		return this.estimates.get(assetId) ?? blankEstimate(assetId);
	}

	ensureEstimate(assetId: string): void {
		if (!this.estimates.has(assetId)) {
			this.estimates.set(assetId, blankEstimate(assetId));
		}
		this.hydratedEstimateIds.add(assetId);
	}

	updateEstimate(assetId: string, updates: Partial<Estimate>): void {
		const current = this.getEstimate(assetId);
		this.estimates.set(assetId, { ...current, ...updates });
		this.dirtyIds.add(assetId);
	}

	replaceEstimate(assetId: string, estimate: Estimate): void {
		this.estimates.set(assetId, {
			...estimate,
			asset_id: assetId
		});
		this.hydratedEstimateIds.add(assetId);
		this.dirtyIds.add(assetId);
	}

	restoreEstimateContext(assetId: string, estimate: Estimate): void {
		this.estimates.set(assetId, {
			...estimate,
			asset_id: assetId
		});
		this.hydratedEstimateIds.add(assetId);
	}

	private ensurePrimaryTakeoffItem(assetId: string): TakeoffItem {
		const est = this.getEstimate(assetId);
		const primary = getPrimaryTakeoffItem(est);
		if (primary) return primary;

		const item: TakeoffItem = {
			id: `${assetId}:item:primary`,
			estimate_asset_id: assetId,
			parent_id: null,
			wbs_node_id: null,
			cost_code_id: null,
			applied_preset_id: null,
			applied_preset_name: null,
			name: '',
			description: '',
			quantity: 1,
			unit: 'ea',
			properties: {},
			sort_order: 0,
			cost_components: []
		};
		this.estimates.set(assetId, { ...est, takeoff_items: [item] });
		this.dirtyIds.add(assetId);
		return item;
	}

	updatePrimaryTakeoffItem(assetId: string, updates: Partial<TakeoffItem>): void {
		const est = this.getEstimate(assetId);
		const primary = this.ensurePrimaryTakeoffItem(assetId);
		this.estimates.set(assetId, {
			...est,
			takeoff_items:
				est.takeoff_items.length > 0
					? est.takeoff_items.map((item, index) =>
							index === 0 ? { ...primary, ...updates } : item
						)
					: [{ ...primary, ...updates }]
		});
		this.dirtyIds.add(assetId);
	}

	updateMaterialComponent(
		assetId: string,
		updates: Partial<
			Pick<CostComponent, 'name' | 'description' | 'quantity' | 'unit' | 'unit_rate'>
		>
	): void {
		const est = this.getEstimate(assetId);
		const primary = this.ensurePrimaryTakeoffItem(assetId);
		const existing = primary.cost_components.find((component) => component.category === 'material');
		const material: CostComponent = {
			...(existing ?? {
				id: `${primary.id}:component:material`,
				takeoff_item_id: primary.id,
				category: 'material',
				source_type: 'manual',
				source_id: null,
				name: '',
				description: '',
				quantity: 0,
				unit: 'ea',
				unit_rate: 0,
				formula: {},
				metadata: {}
			}),
			...updates
		};
		const otherComponents = primary.cost_components.filter(
			(component) => component.category !== 'material'
		);
		const nextComponents =
			material.name.trim().length === 0 && material.quantity === 0 && material.unit_rate === 0
				? otherComponents
				: [material, ...otherComponents];

		this.estimates.set(assetId, {
			...est,
			takeoff_items:
				est.takeoff_items.length > 0
					? est.takeoff_items.map((item, index) =>
							index === 0 ? { ...primary, cost_components: nextComponents } : item
						)
					: [{ ...primary, cost_components: nextComponents }]
		});
		this.dirtyIds.add(assetId);
	}

	async addOperation(assetId: string, name: string = 'New Operation'): Promise<void> {
		const primary = this.ensurePrimaryTakeoffItem(assetId);
		await this.addCostComponent(assetId, primary.id, 'labour');
		const est = this.getEstimate(assetId);
		const refreshedPrimary = getPrimaryTakeoffItem(est);
		const target = refreshedPrimary?.cost_components[refreshedPrimary.cost_components.length - 1];
		if (!target) return;
		this.updateCostComponent(assetId, primary.id, target.id, { name, unit: 'hr' });
	}

	removeOperation(assetId: string, operationId: string): void {
		const primary = getPrimaryTakeoffItem(this.getEstimate(assetId));
		if (!primary) return;
		this.removeCostComponent(assetId, primary.id, operationId);
	}

	async duplicateOperation(assetId: string, operationId: string): Promise<void> {
		const primary = getPrimaryTakeoffItem(this.getEstimate(assetId));
		if (!primary) return;
		await this.duplicateCostComponent(assetId, primary.id, operationId);
	}

	updateOperation(
		assetId: string,
		operationId: string,
		updates: Partial<{
			name: string;
			quantity: number;
			unit: CostComponent['unit'];
			unit_rate: number;
		}>
	): void {
		const primary = getPrimaryTakeoffItem(this.getEstimate(assetId));
		if (!primary) return;
		this.updateCostComponent(assetId, primary.id, operationId, updates);
	}

	reorderOperations(assetId: string, operations: CostComponent[]): void {
		const est = this.getEstimate(assetId);
		const primary = this.ensurePrimaryTakeoffItem(assetId);
		const material = primary.cost_components.find((component) => component.category === 'material');
		const nextComponents = material ? [material, ...operations] : operations;
		this.estimates.set(assetId, {
			...est,
			takeoff_items:
				est.takeoff_items.length > 0
					? est.takeoff_items.map((item, index) =>
							index === 0 ? { ...primary, cost_components: nextComponents } : item
						)
					: [{ ...primary, cost_components: nextComponents }]
		});
		this.dirtyIds.add(assetId);
	}

	async addTakeoffItem(assetId: string, name: string = 'Asset'): Promise<void> {
		const est = this.getEstimate(assetId);
		const id = generateId();
		const item: TakeoffItem = {
			id,
			estimate_asset_id: assetId,
			parent_id: null,
			wbs_node_id: null,
			cost_code_id: null,
			applied_preset_id: null,
			applied_preset_name: null,
			name,
			description: '',
			quantity: 1,
			unit: 'ea',
			properties: {},
			sort_order: est.takeoff_items.length,
			cost_components: []
		};
		this.estimates.set(assetId, { ...est, takeoff_items: [...est.takeoff_items, item] });
		this.dirtyIds.add(assetId);
	}

	removeTakeoffItem(assetId: string, takeoffItemId: string): void {
		const est = this.getEstimate(assetId);
		this.estimates.set(assetId, {
			...est,
			takeoff_items: est.takeoff_items.filter((item) => item.id !== takeoffItemId)
		});
		this.dirtyIds.add(assetId);
	}

	updateTakeoffItem(assetId: string, takeoffItemId: string, updates: Partial<TakeoffItem>): void {
		const est = this.getEstimate(assetId);
		this.estimates.set(assetId, {
			...est,
			takeoff_items: est.takeoff_items.map((item) =>
				item.id === takeoffItemId ? { ...item, ...updates } : item
			)
		});
		this.dirtyIds.add(assetId);
	}

	reorderTakeoffItems(assetId: string, takeoffItems: TakeoffItem[]): void {
		const est = this.getEstimate(assetId);
		this.estimates.set(assetId, { ...est, takeoff_items: takeoffItems });
		this.dirtyIds.add(assetId);
	}

	async addCostComponent(
		assetId: string,
		takeoffItemId: string,
		category: CostComponent['category'] = 'material'
	): Promise<void> {
		const est = this.getEstimate(assetId);
		const componentId = generateId();
		const defaults: Record<
			CostComponent['category'],
			{ name: string; unit: CostComponent['unit'] }
		> = {
			material: { name: 'Material', unit: 'ea' },
			labour: { name: 'Operation', unit: 'hr' },
			equipment: { name: 'Equipment', unit: 'hr' },
			subcontract: { name: 'Subcontract', unit: 'lot' },
			misc: { name: 'Miscellaneous', unit: 'ea' }
		};
		const component: CostComponent = {
			id: componentId,
			takeoff_item_id: takeoffItemId,
			category,
			source_type: 'manual',
			source_id: null,
			name: defaults[category].name,
			description: '',
			quantity: 0,
			unit: defaults[category].unit,
			unit_rate: 0,
			source_unit_rate_decimal: null,
			source_currency_code: est.currency_code ?? null,
			fx_rate_snapshot_id: null,
			formula: {},
			metadata: {},
			sort_order:
				est.takeoff_items.find((item) => item.id === takeoffItemId)?.cost_components.length ?? 0
		};

		this.estimates.set(assetId, {
			...est,
			takeoff_items: est.takeoff_items.map((item) =>
				item.id === takeoffItemId
					? { ...item, cost_components: [...item.cost_components, component] }
					: item
			)
		});
		this.dirtyIds.add(assetId);
	}

	async createCostComponentPreset(
		data: CostComponentPresetFormValues,
		components: CostComponentPreset['components']
	): Promise<void> {
		const id = generateId();
		await dbService.addCostComponentPreset(id, data, components);
	}

	async createEstimateTemplate(
		data: EstimateTemplateFormValues,
		estimate: EstimateTemplate['estimate']
	): Promise<void> {
		const id = generateId();
		await dbService.addEstimateTemplate(id, data, estimate);
	}

	removeCostComponent(assetId: string, takeoffItemId: string, componentId: string): void {
		const est = this.getEstimate(assetId);
		this.estimates.set(assetId, {
			...est,
			takeoff_items: est.takeoff_items.map((item) =>
				item.id === takeoffItemId
					? {
							...item,
							cost_components: item.cost_components.filter(
								(component) => component.id !== componentId
							)
						}
					: item
			)
		});
		this.dirtyIds.add(assetId);
	}

	async duplicateCostComponent(
		assetId: string,
		takeoffItemId: string,
		componentId: string
	): Promise<void> {
		const est = this.getEstimate(assetId);
		const nextId = generateId();
		this.estimates.set(assetId, {
			...est,
			takeoff_items: est.takeoff_items.map((item) => {
				if (item.id !== takeoffItemId) return item;
				const index = item.cost_components.findIndex((component) => component.id === componentId);
				if (index === -1) return item;
				const copy = { ...item.cost_components[index], id: nextId };
				const costComponents = [...item.cost_components];
				costComponents.splice(index + 1, 0, copy);
				return { ...item, cost_components: costComponents };
			})
		});
		this.dirtyIds.add(assetId);
	}

	updateCostComponent(
		assetId: string,
		takeoffItemId: string,
		componentId: string,
		updates: Partial<CostComponent>
	): void {
		const est = this.getEstimate(assetId);
		this.estimates.set(assetId, {
			...est,
			takeoff_items: est.takeoff_items.map((item) =>
				item.id === takeoffItemId
					? {
							...item,
							cost_components: item.cost_components.map((component) => {
								if (component.id !== componentId) return component;
								const next = { ...component, ...updates };
								const hasCommercialEdit =
									'name' in updates ||
									'quantity' in updates ||
									'unit' in updates ||
									'unit_rate' in updates;

								if (hasCommercialEdit && next.metadata?.ai_mapping_status === 'unresolved') {
									next.metadata = {
										...next.metadata,
										ai_mapping_status: 'manual'
									};
								}
								return next;
							})
						}
					: item
			)
		});
		this.dirtyIds.add(assetId);
	}

	reorderCostComponents(
		assetId: string,
		takeoffItemId: string,
		costComponents: CostComponent[]
	): void {
		const est = this.getEstimate(assetId);
		this.estimates.set(assetId, {
			...est,
			takeoff_items: est.takeoff_items.map((item) =>
				item.id === takeoffItemId ? { ...item, cost_components: costComponents } : item
			)
		});
		this.dirtyIds.add(assetId);
	}

	async resetAll(): Promise<void> {
		const resetQuoteOptions = [blankQuoteOption(this.projectId)];
		const previousQuoteOptions = cloneQuoteOptions(this.quoteOptions);
		const previousActiveQuoteOptionId = this.activeQuoteOptionId;
		const previousQuoteRevisions = this.quoteRevisions.map((revision) => structuredClone(revision));
		const previousQuoteRevisionsHydrated = this.quoteRevisionsHydrated;
		const previousEstimates = new SvelteMap(
			[...this.estimates.entries()].map(([assetId, estimate]) => [assetId, cloneEstimate(estimate)])
		);
		const previousSavedEstimates = new SvelteMap(
			[...this.savedEstimates.entries()].map(([assetId, estimate]) => [
				assetId,
				cloneEstimate(estimate)
			])
		);
		const previousHydratedIds = [...this.hydratedEstimateIds];
		const previousDirtyIds = [...this.dirtyIds];
		const previousSavedIds = [...this.savedIds];
		const previousSavedContentIds = [...this.savedContentIds];
		const previousQuantities = new SvelteMap(this.quantities);
		const previousPdfInclusion = new SvelteMap(this.pdfInclusion);
		const previousRoundPrices = this.roundPrices;

		try {
			await dbService.resetQuoteWorkspace(this.projectId, resetQuoteOptions);
		} catch (error) {
			this.estimates = previousEstimates;
			this.savedEstimates = previousSavedEstimates;
			this.hydratedEstimateIds = new SvelteSet(previousHydratedIds);
			this.dirtyIds = new SvelteSet(previousDirtyIds);
			this.savedIds = new SvelteSet(previousSavedIds);
			this.savedContentIds = new SvelteSet(previousSavedContentIds);
			this.restoreQuoteOptionSnapshot(previousQuoteOptions, previousActiveQuoteOptionId);
			this.quoteRevisions = previousQuoteRevisions;
			this.quoteRevisionsHydrated = previousQuoteRevisionsHydrated;
			this.quantities = previousQuantities;
			this.pdfInclusion = previousPdfInclusion;
			this.roundPrices = previousRoundPrices;
			await errorState.catchError(error, 'Reset quote workspace');
			return;
		}

		this.estimates.clear();
		this.savedEstimates.clear();
		this.hydratedEstimateIds.clear();
		this.dirtyIds.clear();
		this.savedIds.clear();
		this.savedContentIds.clear();
		this.estimateHydrationRequests.clear();
		this.quoteOptions = resetQuoteOptions;
		this.activeQuoteOptionId = this.quoteOptions[0]?.id ?? null;
		this.quoteRevisions = [];
		this.quoteRevisionsHydrated = false;
		this.quantities.clear();
		this.pdfInclusion.clear();
		this.roundPrices = false;
	}
}

export function setQuoteEngine(engine: QuoteEngineState) {
	setContext(QUOTE_ENGINE_KEY, engine);
}

export function getQuoteEngine(): QuoteEngineState {
	return getContext<QuoteEngineState>(QUOTE_ENGINE_KEY);
}
