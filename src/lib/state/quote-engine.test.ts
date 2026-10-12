import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Estimate, QuoteOption, QuoteOptionPreset, QuoteRevision } from '$lib/types/index.js';
import type { QuoteEngineState as QuoteEngineStateType } from './quote.svelte';

const dbServiceMock = {
	getEstimateSummariesForProject: vi.fn(),
	getEstimate: vi.fn(),
	getQuoteOptions: vi.fn(),
	getQuoteOptionPresets: vi.fn(),
	getQuoteOptionPresetById: vi.fn(),
	getQuoteRevisions: vi.fn(),
	createQuoteOption: vi.fn(),
	updateQuoteOption: vi.fn(),
	deleteQuoteOption: vi.fn(),
	setDefaultQuoteOption: vi.fn(),
	addQuoteOptionPreset: vi.fn(),
	updateQuoteOptionPreset: vi.fn(),
	deleteQuoteOptionPreset: vi.fn(),
	createQuoteRevision: vi.fn(),
	updateAsset: vi.fn(),
	updateProjectQuotePreferences: vi.fn(),
	resetQuoteWorkspace: vi.fn(),
	saveEstimate: vi.fn(),
	saveQuoteOptions: vi.fn(),
	deleteEstimate: vi.fn(),
	updateAssetSelection: vi.fn(),
	updateBulkSelection: vi.fn()
};

const errorStateMock = {
	catchError: vi.fn()
};

vi.mock('$lib/services/db.js', () => ({
	dbService: dbServiceMock
}));

vi.mock('./errors.svelte.js', () => ({
	errorState: errorStateMock
}));

const savedEstimate: Estimate = {
	asset_id: 'asset-saved',
	scope_summary: 'Folded bracket assembly',
	notes: '',
	classification_system_id: null,
	wbs_root_node_id: null,
	applied_template_id: null,
	applied_template_name: null,
	currency_code: null,
	takeoff_items: [
		{
			id: 'item-1',
			estimate_asset_id: 'asset-saved',
			parent_id: null,
			wbs_node_id: null,
			cost_code_id: null,
			applied_preset_id: null,
			applied_preset_name: null,
			name: 'Bracket',
			description: '',
			quantity: 2,
			unit: 'ea',
			properties: {},
			sort_order: 0,
			cost_components: [
				{
					id: 'component-1',
					takeoff_item_id: 'item-1',
					category: 'material',
					source_type: 'manual',
					source_id: null,
					name: 'Sheet',
					description: '',
					quantity: 3,
					unit: 'kg',
					unit_rate: 9,
					source_unit_rate_decimal: '9',
					source_currency_code: 'AUD',
					fx_rate_snapshot_id: null,
					formula: {},
					metadata: {}
				}
			]
		}
	]
};

const aiBlockedEstimate: Estimate = {
	...savedEstimate,
	asset_id: 'asset-ai-blocked',
	takeoff_items: [
		{
			...savedEstimate.takeoff_items[0],
			id: 'item-ai-blocked',
			estimate_asset_id: 'asset-ai-blocked',
			properties: {
				ai_open_questions: ['Confirm material rate before quoting.'],
				ai_confidence: { overall: 0.8, extraction: 0.8, mapping: 0.8, quantity: 0.8 }
			},
			cost_components: [
				{
					...savedEstimate.takeoff_items[0].cost_components[0],
					id: 'component-ai-blocked',
					takeoff_item_id: 'item-ai-blocked',
					unit_rate: 0,
					metadata: {
						ai_mapping_status: 'unresolved',
						ai_confidence: { overall: 0.4, extraction: 0.7, mapping: 0.2, quantity: 0.7 },
						ai_evidence_refs: [{ summary: 'AI extracted item from drawing notes.' }]
					}
				}
			]
		}
	]
};

const manualZeroRateEstimate: Estimate = {
	...savedEstimate,
	asset_id: 'asset-manual-zero',
	takeoff_items: [
		{
			...savedEstimate.takeoff_items[0],
			id: 'item-manual-zero',
			estimate_asset_id: 'asset-manual-zero',
			cost_components: [
				{
					...savedEstimate.takeoff_items[0].cost_components[0],
					id: 'component-manual-zero',
					takeoff_item_id: 'item-manual-zero',
					unit_rate: 0,
					metadata: {}
				}
			]
		}
	]
};

const unresolvedValidRateEstimate: Estimate = {
	...savedEstimate,
	asset_id: 'asset-unresolved-valid',
	takeoff_items: [
		{
			...savedEstimate.takeoff_items[0],
			id: 'item-unresolved-valid',
			estimate_asset_id: 'asset-unresolved-valid',
			properties: {
				ai_source_file_id: 'file-1',
				ai_confidence: 0.85
			},
			cost_components: [
				{
					...savedEstimate.takeoff_items[0].cost_components[0],
					id: 'component-unresolved-valid',
					takeoff_item_id: 'item-unresolved-valid',
					unit_rate: 120,
					quantity: 1,
					metadata: {
						ai_mapping_status: 'unresolved',
						ai_source_item_id: 'mat-1',
						ai_confidence: 0.75
					}
				}
			]
		}
	]
};

const quoteOption: QuoteOption = {
	id: 'option-1',
	project_id: 'project-1',
	label: 'Standard',
	lead_time: '2 weeks',
	markup_percentage: 12,
	material_markup_percentage: null,
	labour_markup_percentage: null,
	equipment_markup_percentage: null,
	subcontract_markup_percentage: null,
	notes: '',
	sort_order: 0,
	is_default: true,
	created_at: '2026-03-09T00:00:00.000Z',
	updated_at: '2026-03-09T00:00:00.000Z'
};

const quoteOptionPreset: QuoteOptionPreset = {
	id: 'preset-1',
	workspace_id: 'local-workspace',
	label: 'Preferred Customer -10%',
	lead_time: '2 weeks',
	markup_percentage: -10,
	material_markup_percentage: null,
	labour_markup_percentage: null,
	equipment_markup_percentage: null,
	subcontract_markup_percentage: null,
	notes: 'Preferred customer discount',
	created_at: '2026-03-09T00:00:00.000Z',
	updated_at: '2026-03-09T00:00:00.000Z'
};

const quoteRevision: QuoteRevision = {
	id: 'rev-1',
	project_id: 'project-1',
	revision_number: 1,
	revision_label: 'Rev 1',
	rfq_number_snapshot: 'RFQ-1001',
	contact_name_snapshot: 'Atlas Structural',
	project_name_snapshot: 'Warehouse Package',
	business_name_snapshot: 'Southern Estimating',
	business_abn_snapshot: '51 824 753 556',
	business_address_snapshot: '14 Foundry Road',
	business_email_snapshot: 'estimating@example.test',
	currency_code_snapshot: 'AUD',
	currency_symbol_snapshot: '$',
	issued_date: '10/03/2026',
	valid_until_date: '09/04/2026',
	package_attachments: [],
	options: [],
	created_at: '2026-03-10T00:00:00.000Z',
	updated_at: '2026-03-10T00:00:00.000Z'
};

type LazyQuoteEngine = {
	hydrateEstimateStatuses(): Promise<void>;
	hydrateEstimate(assetId: string): Promise<void>;
	isEstimateHydrated(assetId: string): boolean;
	getEstimateStatus(assetId: string): 'not_started' | 'dirty' | 'saved';
	hasSavedQuoteContent(assetId: string): boolean;
	isPdfExportReady(assetId: string): boolean;
	getEstimate(assetId: string): Estimate;
	getSavedEstimate(assetId: string): Estimate | null;
	resetEstimate(assetId: string): Promise<void>;
};

describe('QuoteEngineState lazy hydration', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.resetAllMocks();
		dbServiceMock.getEstimateSummariesForProject.mockResolvedValue([
			{ asset_id: 'asset-saved', has_quote_content: true },
			{ asset_id: 'asset-empty', has_quote_content: false }
		]);
		dbServiceMock.getEstimate.mockResolvedValue(savedEstimate);
		dbServiceMock.getQuoteOptions.mockResolvedValue([quoteOption]);
		dbServiceMock.getQuoteOptionPresets.mockResolvedValue([quoteOptionPreset]);
		dbServiceMock.getQuoteOptionPresetById.mockResolvedValue(quoteOptionPreset);
		dbServiceMock.getQuoteRevisions.mockResolvedValue([quoteRevision]);
		dbServiceMock.createQuoteOption.mockResolvedValue(undefined);
		dbServiceMock.updateQuoteOption.mockResolvedValue(undefined);
		dbServiceMock.deleteQuoteOption.mockResolvedValue(undefined);
		dbServiceMock.setDefaultQuoteOption.mockResolvedValue(undefined);
		dbServiceMock.addQuoteOptionPreset.mockResolvedValue(undefined);
		dbServiceMock.updateQuoteOptionPreset.mockResolvedValue(undefined);
		dbServiceMock.deleteQuoteOptionPreset.mockResolvedValue(undefined);
		dbServiceMock.createQuoteRevision.mockResolvedValue(quoteRevision);
		dbServiceMock.updateAsset.mockResolvedValue(undefined);
		dbServiceMock.updateProjectQuotePreferences.mockResolvedValue(undefined);
		dbServiceMock.resetQuoteWorkspace.mockResolvedValue(undefined);
		dbServiceMock.saveEstimate.mockResolvedValue(undefined);
		dbServiceMock.saveQuoteOptions.mockResolvedValue(undefined);
		dbServiceMock.deleteEstimate.mockResolvedValue(undefined);
		dbServiceMock.updateAssetSelection.mockResolvedValue(undefined);
		dbServiceMock.updateBulkSelection.mockResolvedValue(undefined);
		errorStateMock.catchError.mockResolvedValue(undefined);
	});

	it('waits for estimate statuses before deciding whether a reopened asset is unsaved', async () => {
		let resolveStatuses:
			((value: Array<{ asset_id: string; has_quote_content: boolean }>) => void) | undefined;
		const statusesPromise = new Promise<Array<{ asset_id: string; has_quote_content: boolean }>>(
			(resolve) => {
				resolveStatuses = resolve;
			}
		);
		dbServiceMock.getEstimateSummariesForProject.mockReturnValueOnce(statusesPromise);

		const { QuoteEngineState } = await import('./quote.svelte');
		const engine = new QuoteEngineState('project-1') as QuoteEngineStateType & LazyQuoteEngine;

		const hydrateStatusesTask = engine.hydrateEstimateStatuses();
		const hydrateEstimateTask = engine.hydrateEstimate('asset-saved');

		resolveStatuses?.([{ asset_id: 'asset-saved', has_quote_content: true }]);
		await Promise.all([hydrateStatusesTask, hydrateEstimateTask]);

		expect(dbServiceMock.getEstimate).toHaveBeenCalledWith('asset-saved');
		expect(engine.getEstimate('asset-saved')).toEqual(savedEstimate);
		expect(engine.hasSavedQuoteContent('asset-saved')).toBe(true);
		expect(engine.isEstimateHydrated('asset-saved')).toBe(true);
	});

	it('joins concurrent estimate status hydration requests', async () => {
		let resolveStatuses:
			((value: Array<{ asset_id: string; has_quote_content: boolean }>) => void) | undefined;
		const statusesPromise = new Promise<Array<{ asset_id: string; has_quote_content: boolean }>>(
			(resolve) => {
				resolveStatuses = resolve;
			}
		);
		dbServiceMock.getEstimateSummariesForProject.mockReturnValueOnce(statusesPromise);

		const { QuoteEngineState } = await import('./quote.svelte');
		const engine = new QuoteEngineState('project-1') as QuoteEngineStateType & LazyQuoteEngine;

		const first = engine.hydrateEstimateStatuses();
		const second = engine.hydrateEstimateStatuses();

		resolveStatuses?.([{ asset_id: 'asset-saved', has_quote_content: true }]);
		await Promise.all([first, second]);

		expect(dbServiceMock.getEstimateSummariesForProject).toHaveBeenCalledTimes(1);
		expect(engine.hasSavedQuoteContent('asset-saved')).toBe(true);
	});

	it('registers status hydration as in-flight before the service call can re-enter', async () => {
		const { QuoteEngineState } = await import('./quote.svelte');
		const engine = new QuoteEngineState('project-1') as QuoteEngineStateType & LazyQuoteEngine;
		let nestedHydration: Promise<void> | undefined;
		let serviceCalls = 0;

		dbServiceMock.getEstimateSummariesForProject.mockImplementation(() => {
			serviceCalls += 1;
			if (serviceCalls === 1) {
				nestedHydration = engine.hydrateEstimateStatuses();
			}
			return Promise.resolve([{ asset_id: 'asset-saved', has_quote_content: true }]);
		});

		await engine.hydrateEstimateStatuses();
		await nestedHydration;

		expect(dbServiceMock.getEstimateSummariesForProject).toHaveBeenCalledTimes(1);
		expect(engine.hasSavedQuoteContent('asset-saved')).toBe(true);
	});

	it('discards stale estimate status snapshots after the engine is rebound to a different project', async () => {
		let resolveStaleStatuses:
			((value: Array<{ asset_id: string; has_quote_content: boolean }>) => void) | undefined;
		const staleStatusesPromise = new Promise<
			Array<{ asset_id: string; has_quote_content: boolean }>
		>((resolve) => {
			resolveStaleStatuses = resolve;
		});
		dbServiceMock.getEstimateSummariesForProject
			.mockReturnValueOnce(staleStatusesPromise)
			.mockResolvedValueOnce([{ asset_id: 'asset-saved', has_quote_content: true }]);

		const { QuoteEngineState } = await import('./quote.svelte');
		const engine = new QuoteEngineState('project-stale') as QuoteEngineStateType & LazyQuoteEngine;

		const staleTask = engine.hydrateEstimateStatuses();
		engine.hydrateProjectPreferences({
			id: 'project-1',
			quote_round_prices: false
		});
		const freshTask = engine.hydrateEstimateStatuses();

		resolveStaleStatuses?.([]);
		await Promise.all([staleTask, freshTask]);

		expect(dbServiceMock.getEstimateSummariesForProject).toHaveBeenNthCalledWith(
			1,
			'project-stale'
		);
		expect(dbServiceMock.getEstimateSummariesForProject).toHaveBeenNthCalledWith(2, 'project-1');
		expect(engine.getEstimateStatus('asset-saved')).toBe('saved');
		expect(engine.hasSavedQuoteContent('asset-saved')).toBe(true);
	});

	it('restarts estimate hydration under the rebound project and restores the saved estimate', async () => {
		let resolveStaleStatuses:
			((value: Array<{ asset_id: string; has_quote_content: boolean }>) => void) | undefined;
		const staleStatusesPromise = new Promise<
			Array<{ asset_id: string; has_quote_content: boolean }>
		>((resolve) => {
			resolveStaleStatuses = resolve;
		});
		dbServiceMock.getEstimateSummariesForProject
			.mockReturnValueOnce(staleStatusesPromise)
			.mockResolvedValueOnce([{ asset_id: 'asset-saved', has_quote_content: true }]);

		const { QuoteEngineState } = await import('./quote.svelte');
		const engine = new QuoteEngineState('project-stale') as QuoteEngineStateType & LazyQuoteEngine;

		const hydrateTask = engine.hydrateEstimate('asset-saved');
		engine.hydrateProjectPreferences({
			id: 'project-1',
			quote_round_prices: false
		});

		resolveStaleStatuses?.([]);
		await hydrateTask;

		expect(dbServiceMock.getEstimateSummariesForProject).toHaveBeenNthCalledWith(
			1,
			'project-stale'
		);
		expect(dbServiceMock.getEstimateSummariesForProject).toHaveBeenNthCalledWith(2, 'project-1');
		expect(dbServiceMock.getEstimate).toHaveBeenCalledWith('asset-saved');
		expect(engine.isEstimateHydrated('asset-saved')).toBe(true);
		expect(engine.getEstimate('asset-saved')).toEqual(savedEstimate);
		expect(engine.hasSavedQuoteContent('asset-saved')).toBe(true);
	});

	it('hydrates saved status and quote-content flags without loading full estimate bodies', async () => {
		const { QuoteEngineState } = await import('./quote.svelte');
		const engine = new QuoteEngineState('project-1') as QuoteEngineStateType & LazyQuoteEngine;

		await engine.hydrateEstimateStatuses();

		expect(dbServiceMock.getEstimateSummariesForProject).toHaveBeenCalledWith('project-1');
		expect(dbServiceMock.getEstimate).not.toHaveBeenCalled();
		expect(engine.getEstimateStatus('asset-saved')).toBe('saved');
		expect(engine.getEstimateStatus('asset-empty')).toBe('saved');
		expect(engine.getEstimateStatus('asset-missing')).toBe('not_started');
		expect(engine.hasSavedQuoteContent('asset-saved')).toBe(true);
		expect(engine.hasSavedQuoteContent('asset-empty')).toBe(false);
		expect(engine.isEstimateHydrated('asset-saved')).toBe(false);
	});

	it('treats an asset as pdf-export-ready only when it is included and has saved quote content', async () => {
		const { QuoteEngineState } = await import('./quote.svelte');
		const engine = new QuoteEngineState('project-1') as QuoteEngineStateType & LazyQuoteEngine;

		await engine.hydrateEstimateStatuses();
		await engine.hydrateEstimate('asset-saved');

		expect(engine.isPdfExportReady('asset-saved')).toBe(true);
		expect(engine.isPdfExportReady('asset-empty')).toBe(false);

		engine.setPdfInclusion('asset-saved', false);
		expect(engine.isPdfExportReady('asset-saved')).toBe(false);
	});

	it('no longer blocks pdf export for AI commercial blockers — blockers are UI warnings', async () => {
		dbServiceMock.getEstimateSummariesForProject.mockResolvedValueOnce([
			{ asset_id: 'asset-ai-blocked', has_quote_content: true }
		]);
		dbServiceMock.getEstimate.mockResolvedValueOnce(aiBlockedEstimate);
		const { QuoteEngineState } = await import('./quote.svelte');
		const engine = new QuoteEngineState('project-1') as QuoteEngineStateType & LazyQuoteEngine;

		await engine.hydrateEstimateStatuses();
		await engine.hydrateEstimate('asset-ai-blocked');

		expect(engine.hasSavedQuoteContent('asset-ai-blocked')).toBe(true);
		// PDF Preview should be enabled for saved estimates. AI blockers are UI warnings, not gates.
		expect(engine.isPdfExportReady('asset-ai-blocked')).toBe(true);
		// Blockers are still available for UI display
		expect(engine.getPdfReadinessBlockers('asset-ai-blocked')).toEqual([
			'Resolve AI source matches before quote',
			'Add rates before quote'
		]);
	});

	it('does not apply AI commercial blockers to manual zero-rate estimates', async () => {
		dbServiceMock.getEstimateSummariesForProject.mockResolvedValueOnce([
			{ asset_id: 'asset-manual-zero', has_quote_content: true }
		]);
		dbServiceMock.getEstimate.mockResolvedValueOnce(manualZeroRateEstimate);
		const { QuoteEngineState } = await import('./quote.svelte');
		const engine = new QuoteEngineState('project-1') as QuoteEngineStateType & LazyQuoteEngine;

		await engine.hydrateEstimateStatuses();
		await engine.hydrateEstimate('asset-manual-zero');

		expect(engine.isPdfExportReady('asset-manual-zero')).toBe(true);
	});

	it('auto-resolves unresolved AI mappings when components have valid rates on save', async () => {
		const { QuoteEngineState } = await import('./quote.svelte');
		const engine = new QuoteEngineState('project-1') as QuoteEngineStateType & LazyQuoteEngine;

		// Set up an estimate with an unresolved AI component that already has valid rates
		engine.estimates.set('asset-unresolved-valid', {
			...unresolvedValidRateEstimate
		});
		engine.hydratedEstimateIds.add('asset-unresolved-valid');
		engine.dirtyIds.add('asset-unresolved-valid');

		await engine.saveEstimate('asset-unresolved-valid');

		// Should have been auto-resolved to 'resolved'
		const savedComponent =
			engine.getEstimate('asset-unresolved-valid').takeoff_items[0].cost_components[0];
		expect(savedComponent.metadata?.ai_mapping_status).toBe('resolved');

		// PDF should now be export-ready (valid rates, resolved status, saved)
		expect(engine.isPdfExportReady('asset-unresolved-valid')).toBe(true);
	});

	it('does NOT auto-resolve unresolved AI mappings when components have zero rates on save', async () => {
		const { QuoteEngineState } = await import('./quote.svelte');
		const engine = new QuoteEngineState('project-1') as QuoteEngineStateType & LazyQuoteEngine;

		// Set up an estimate with an unresolved AI component that has zero rate
		engine.estimates.set('asset-ai-blocked', {
			...aiBlockedEstimate
		});
		engine.hydratedEstimateIds.add('asset-ai-blocked');
		engine.dirtyIds.add('asset-ai-blocked');

		await engine.saveEstimate('asset-ai-blocked');

		// Should stay 'unresolved' because rate is 0
		const savedComponent =
			engine.getEstimate('asset-ai-blocked').takeoff_items[0].cost_components[0];
		expect(savedComponent.metadata?.ai_mapping_status).toBe('unresolved');

		// PDF Preview should be enabled for saved estimates. AI blockers are UI warnings.
		expect(engine.isPdfExportReady('asset-ai-blocked')).toBe(true);
	});

	it('hydrates persisted project and asset quote preferences from the workspace shell snapshot', async () => {
		const { QuoteEngineState } = await import('./quote.svelte');
		const engine = new QuoteEngineState('project-1');

		engine.hydrateProjectPreferences({
			id: 'project-1',
			quote_round_prices: true
		});
		engine.hydrateWorkspaceAssets([
			{
				id: 'asset-1',
				project_id: 'project-1',
				display_name: 'Frame',
				thumbnail_file_id: null,
				is_selected: true,
				quote_quantity: 3,
				is_pdf_included: false,
				created_at: '2026-03-09T00:00:00.000Z'
			}
		]);

		expect(engine.roundPrices).toBe(true);
		expect(engine.selectedIds.has('asset-1')).toBe(true);
		expect(engine.getQuantity('asset-1')).toBe(3);
		expect(engine.isPdfIncluded('asset-1')).toBe(false);
	});

	it('blocks pdf export for dirty estimates and keeps the last saved snapshot separate from live edits', async () => {
		const { QuoteEngineState } = await import('./quote.svelte');
		const engine = new QuoteEngineState('project-1') as QuoteEngineStateType & LazyQuoteEngine;

		await engine.hydrateEstimateStatuses();
		await engine.hydrateEstimate('asset-saved');

		expect(engine.getSavedEstimate('asset-saved')).toEqual(savedEstimate);
		expect(engine.isPdfExportReady('asset-saved')).toBe(true);

		engine.updateEstimate('asset-saved', {
			scope_summary: 'Unsaved summary change'
		});

		expect(engine.getEstimate('asset-saved').scope_summary).toBe('Unsaved summary change');
		expect(engine.getSavedEstimate('asset-saved')).toEqual(savedEstimate);
		expect(engine.hasSavedQuoteContent('asset-saved')).toBe(true);
		expect(engine.isPdfExportReady('asset-saved')).toBe(false);
	});

	it('resets a saved estimate persistently so reload keeps the editor blank', async () => {
		const { QuoteEngineState } = await import('./quote.svelte');
		const engine = new QuoteEngineState('project-1') as QuoteEngineStateType & LazyQuoteEngine;

		await engine.hydrateEstimateStatuses();
		await engine.hydrateEstimate('asset-saved');

		dbServiceMock.getEstimate.mockResolvedValueOnce(null);
		dbServiceMock.getEstimateSummariesForProject.mockResolvedValueOnce([]);

		await engine.resetEstimate('asset-saved');

		expect(dbServiceMock.deleteEstimate).toHaveBeenCalledWith('asset-saved');
		expect(engine.getEstimate('asset-saved')).toMatchObject({
			asset_id: 'asset-saved',
			scope_summary: '',
			notes: '',
			takeoff_items: []
		});
		expect(engine.getSavedEstimate('asset-saved')).toBeNull();
		expect(engine.getEstimateStatus('asset-saved')).toBe('not_started');
		expect(engine.hasSavedQuoteContent('asset-saved')).toBe(false);
		expect(engine.isPdfExportReady('asset-saved')).toBe(false);

		await engine.hydrateEstimateStatuses();
		await engine.hydrateEstimate('asset-saved');

		expect(engine.getEstimate('asset-saved')).toMatchObject({
			asset_id: 'asset-saved',
			scope_summary: '',
			notes: '',
			takeoff_items: []
		});
		expect(engine.getEstimateStatus('asset-saved')).toBe('not_started');
	});

	it('hydrates one saved estimate on demand and reuses the in-flight request', async () => {
		const { QuoteEngineState } = await import('./quote.svelte');
		const engine = new QuoteEngineState('project-1') as QuoteEngineStateType & LazyQuoteEngine;

		await engine.hydrateEstimateStatuses();
		await Promise.all([
			engine.hydrateEstimate('asset-saved'),
			engine.hydrateEstimate('asset-saved')
		]);

		expect(dbServiceMock.getEstimate).toHaveBeenCalledTimes(1);
		expect(dbServiceMock.getEstimate).toHaveBeenCalledWith('asset-saved');
		expect(engine.isEstimateHydrated('asset-saved')).toBe(true);
		expect(engine.getEstimate('asset-saved')).toEqual(savedEstimate);
	});

	it('treats an unsaved asset as ready without requesting SQLite', async () => {
		const { QuoteEngineState } = await import('./quote.svelte');
		const engine = new QuoteEngineState('project-1') as QuoteEngineStateType & LazyQuoteEngine;

		await engine.hydrateEstimateStatuses();
		await engine.hydrateEstimate('asset-new');

		expect(dbServiceMock.getEstimate).not.toHaveBeenCalled();
		expect(engine.isEstimateHydrated('asset-new')).toBe(true);
		expect(engine.getEstimateStatus('asset-new')).toBe('not_started');
		expect(engine.getEstimate('asset-new')).toMatchObject({
			asset_id: 'asset-new',
			scope_summary: '',
			takeoff_items: []
		});
	});

	it('persists quote-option add, update, remove, and default changes through narrow DB writes', async () => {
		const { QuoteEngineState } = await import('./quote.svelte');
		const engine = new QuoteEngineState('project-1');

		await engine.hydrateQuoteOptions();
		await engine.addQuoteOption({ label: 'Express' });
		expect(dbServiceMock.createQuoteOption).toHaveBeenCalledTimes(1);
		expect(dbServiceMock.saveQuoteOptions).not.toHaveBeenCalled();

		const addedOptionId = engine.quoteOptions.find((option) => option.label === 'Express')?.id;
		expect(addedOptionId).toBeTruthy();

		engine.updateQuoteOption(quoteOption.id, {
			label: 'Standard Updated',
			markup_percentage: 18
		});
		expect(dbServiceMock.updateQuoteOption).toHaveBeenCalledWith(quoteOption.id, {
			label: 'Standard Updated',
			lead_time: quoteOption.lead_time,
			markup_percentage: 18,
			material_markup_percentage: null,
			labour_markup_percentage: null,
			equipment_markup_percentage: null,
			subcontract_markup_percentage: null,
			notes: quoteOption.notes,
			is_default: quoteOption.is_default
		});
		expect(dbServiceMock.saveQuoteOptions).not.toHaveBeenCalled();

		engine.setDefaultQuoteOption(addedOptionId!);
		expect(dbServiceMock.setDefaultQuoteOption).toHaveBeenCalledWith(addedOptionId!);
		expect(dbServiceMock.saveQuoteOptions).not.toHaveBeenCalled();

		engine.removeQuoteOption(quoteOption.id);
		expect(dbServiceMock.deleteQuoteOption).toHaveBeenCalledWith(quoteOption.id);
		expect(dbServiceMock.saveQuoteOptions).not.toHaveBeenCalled();
	});

	it('hydrates quote option presets and applies them as independent project options', async () => {
		const { QuoteEngineState } = await import('./quote.svelte');
		const engine = new QuoteEngineState('project-1');

		await engine.hydrateQuoteOptions();
		await engine.hydrateQuoteOptionPresets();
		await engine.addQuoteOptionFromPreset(quoteOptionPreset.id);

		expect(dbServiceMock.getQuoteOptionPresets).toHaveBeenCalledTimes(1);
		expect(dbServiceMock.createQuoteOption).toHaveBeenCalledTimes(1);
		expect(engine.quoteOptionPresets).toEqual([quoteOptionPreset]);
		expect(engine.quoteOptions).toHaveLength(2);
		expect(engine.quoteOptions[1]).toMatchObject({
			project_id: 'project-1',
			label: quoteOptionPreset.label,
			lead_time: quoteOptionPreset.lead_time,
			markup_percentage: quoteOptionPreset.markup_percentage,
			notes: quoteOptionPreset.notes
		});
		expect(engine.quoteOptions[1]?.id).not.toBe(quoteOptionPreset.id);
	});

	it('saves the active quote option as a reusable preset without mutating the project option', async () => {
		const { QuoteEngineState } = await import('./quote.svelte');
		const engine = new QuoteEngineState('project-1');

		await engine.hydrateQuoteOptions();
		await engine.hydrateQuoteOptionPresets();

		const beforeSave = engine.quoteOptions.map((option) => ({ ...option }));
		await engine.saveQuoteOptionAsPreset(quoteOption.id);

		expect(dbServiceMock.addQuoteOptionPreset).toHaveBeenCalledTimes(1);
		expect(dbServiceMock.addQuoteOptionPreset).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({
				label: quoteOption.label,
				lead_time: quoteOption.lead_time,
				markup_percentage: quoteOption.markup_percentage,
				notes: quoteOption.notes
			})
		);
		expect(engine.quoteOptions).toEqual(beforeSave);
	});

	it('allows negative quote-option markup for discounts down to -100 percent', async () => {
		const { QuoteEngineState } = await import('./quote.svelte');
		const engine = new QuoteEngineState('project-1');

		await engine.hydrateQuoteOptions();
		engine.updateQuoteOption(quoteOption.id, {
			markup_percentage: -10
		});

		expect(dbServiceMock.updateQuoteOption).toHaveBeenCalledWith(quoteOption.id, {
			label: quoteOption.label,
			lead_time: quoteOption.lead_time,
			markup_percentage: -10,
			material_markup_percentage: null,
			labour_markup_percentage: null,
			equipment_markup_percentage: null,
			subcontract_markup_percentage: null,
			notes: quoteOption.notes,
			is_default: quoteOption.is_default
		});
		expect(engine.getQuoteOption(quoteOption.id)?.markup_percentage).toBe(-10);

		engine.updateQuoteOption(quoteOption.id, {
			markup_percentage: -150
		});

		expect(dbServiceMock.updateQuoteOption).toHaveBeenLastCalledWith(quoteOption.id, {
			label: quoteOption.label,
			lead_time: quoteOption.lead_time,
			markup_percentage: -100,
			material_markup_percentage: null,
			labour_markup_percentage: null,
			equipment_markup_percentage: null,
			subcontract_markup_percentage: null,
			notes: quoteOption.notes,
			is_default: quoteOption.is_default
		});
		expect(engine.getQuoteOption(quoteOption.id)?.markup_percentage).toBe(-100);
	});

	it('restores quote options and routes user-facing errors when quote-option persistence fails', async () => {
		const { QuoteEngineState } = await import('./quote.svelte');
		const engine = new QuoteEngineState('project-1');

		await engine.hydrateQuoteOptions();
		const initialOptions = engine.quoteOptions.map((option) => ({ ...option }));
		const initialActiveQuoteOptionId = engine.activeQuoteOptionId;

		dbServiceMock.createQuoteOption.mockRejectedValueOnce(new Error('create failed'));
		await engine.addQuoteOption({ label: 'Express' });
		await vi.waitFor(() =>
			expect(errorStateMock.catchError).toHaveBeenCalledWith(expect.any(Error), 'Add quote option')
		);

		expect(engine.quoteOptions).toEqual(initialOptions);
		expect(engine.activeQuoteOptionId).toBe(initialActiveQuoteOptionId);

		dbServiceMock.updateQuoteOption.mockRejectedValueOnce(new Error('update failed'));
		engine.updateQuoteOption(quoteOption.id, { label: 'Broken Label' });
		await vi.waitFor(() =>
			expect(errorStateMock.catchError).toHaveBeenCalledWith(
				expect.any(Error),
				`Update quote option ${quoteOption.label}`
			)
		);

		expect(engine.getQuoteOption(quoteOption.id)?.label).toBe(quoteOption.label);

		await engine.addQuoteOption({ label: 'Express' });
		const addedOptionId = engine.quoteOptions.find((option) => option.label === 'Express')?.id;
		expect(addedOptionId).toBeTruthy();
		await vi.waitFor(() => expect(dbServiceMock.createQuoteOption).toHaveBeenCalledTimes(2));

		dbServiceMock.setDefaultQuoteOption.mockRejectedValueOnce(new Error('default failed'));
		engine.setDefaultQuoteOption(addedOptionId!);
		await vi.waitFor(() =>
			expect(errorStateMock.catchError).toHaveBeenCalledWith(
				expect.any(Error),
				'Set default quote option Express'
			)
		);

		expect(engine.getActiveQuoteOption().id).toBe(addedOptionId);
		expect(engine.getQuoteOption(quoteOption.id)?.is_default).toBe(true);
		expect(engine.getQuoteOption(addedOptionId!)?.is_default).toBe(false);

		dbServiceMock.deleteQuoteOption.mockRejectedValueOnce(new Error('delete failed'));
		engine.removeQuoteOption(addedOptionId!);
		await vi.waitFor(() =>
			expect(errorStateMock.catchError).toHaveBeenCalledWith(
				expect.any(Error),
				'Delete quote option Express'
			)
		);

		expect(engine.quoteOptions.map((option) => option.label)).toEqual(['Standard', 'Express']);
	});

	it('restores asset selection state and routes user-facing errors when selection persistence fails', async () => {
		const { QuoteEngineState } = await import('./quote.svelte');
		const engine = new QuoteEngineState('project-1');

		dbServiceMock.updateAssetSelection.mockRejectedValueOnce(new Error('selection failed'));
		engine.toggleSelection('asset-1');
		await vi.waitFor(() =>
			expect(errorStateMock.catchError).toHaveBeenCalledWith(
				expect.any(Error),
				'Update asset selection'
			)
		);

		expect(engine.selectedIds.has('asset-1')).toBe(false);

		engine.selectedIds.add('asset-1');
		dbServiceMock.updateAssetSelection.mockRejectedValueOnce(new Error('selection failed'));
		engine.toggleSelection('asset-1');
		await vi.waitFor(() => expect(engine.selectedIds.has('asset-1')).toBe(true));
	});

	it('restores bulk selection state and routes user-facing errors when bulk selection persistence fails', async () => {
		const { QuoteEngineState } = await import('./quote.svelte');
		const engine = new QuoteEngineState('project-1');

		dbServiceMock.updateBulkSelection.mockRejectedValueOnce(new Error('bulk selection failed'));
		engine.selectAll(['asset-1', 'asset-2']);
		await vi.waitFor(() =>
			expect(errorStateMock.catchError).toHaveBeenCalledWith(
				expect.any(Error),
				'Update asset selection'
			)
		);

		expect([...engine.selectedIds]).toEqual([]);

		engine.selectedIds.add('asset-1');
		engine.selectedIds.add('asset-2');
		dbServiceMock.updateBulkSelection.mockRejectedValueOnce(new Error('bulk selection failed'));
		engine.deselectAll();
		await vi.waitFor(() => expect([...engine.selectedIds]).toEqual(['asset-1', 'asset-2']));
	});

	it('restores asset quote preferences when quantity, pdf inclusion, or rounding persistence fails', async () => {
		const { QuoteEngineState } = await import('./quote.svelte');
		const engine = new QuoteEngineState('project-1');

		engine.hydrateProjectPreferences({
			id: 'project-1',
			quote_round_prices: false
		});
		engine.hydrateWorkspaceAssets([
			{
				id: 'asset-1',
				project_id: 'project-1',
				display_name: 'Frame',
				thumbnail_file_id: null,
				is_selected: true,
				quote_quantity: 1,
				is_pdf_included: true,
				created_at: '2026-03-09T00:00:00.000Z'
			}
		]);

		dbServiceMock.updateAsset.mockRejectedValueOnce(new Error('quantity failed'));
		engine.setQuantity('asset-1', 4);
		await vi.waitFor(() =>
			expect(errorStateMock.catchError).toHaveBeenCalledWith(
				expect.any(Error),
				'Update quote quantity'
			)
		);
		expect(engine.getQuantity('asset-1')).toBe(1);

		dbServiceMock.updateAsset.mockRejectedValueOnce(new Error('pdf failed'));
		engine.setPdfInclusion('asset-1', false);
		await vi.waitFor(() =>
			expect(errorStateMock.catchError).toHaveBeenCalledWith(
				expect.any(Error),
				'Update quote PDF inclusion'
			)
		);
		expect(engine.isPdfIncluded('asset-1')).toBe(true);

		dbServiceMock.updateProjectQuotePreferences.mockRejectedValueOnce(new Error('round failed'));
		engine.setRoundPrices(true);
		await vi.waitFor(() =>
			expect(errorStateMock.catchError).toHaveBeenCalledWith(
				expect.any(Error),
				'Update quote rounding'
			)
		);
		expect(engine.roundPrices).toBe(false);
	});

	it('restores the quote workspace snapshot and routes user-facing errors when reset persistence fails', async () => {
		const { QuoteEngineState } = await import('./quote.svelte');
		const engine = new QuoteEngineState('project-1');

		engine.estimates.set('asset-1', savedEstimate);
		engine.savedEstimates.set('asset-1', savedEstimate);
		engine.hydratedEstimateIds.add('asset-1');
		engine.dirtyIds.add('asset-1');
		engine.savedIds.add('asset-1');
		engine.savedContentIds.add('asset-1');
		engine.quantities.set('asset-1', 2);
		engine.pdfInclusion.set('asset-1', true);
		engine.roundPrices = true;
		await engine.hydrateQuoteOptions();
		await engine.addQuoteOption({ label: 'Express' });
		await vi.waitFor(() => expect(dbServiceMock.createQuoteOption).toHaveBeenCalledTimes(1));

		const previousQuoteOptions = engine.quoteOptions.map((option) => ({ ...option }));
		const previousActiveQuoteOptionId = engine.activeQuoteOptionId;

		dbServiceMock.resetQuoteWorkspace.mockRejectedValueOnce(new Error('reset failed'));
		await engine.resetAll();
		await vi.waitFor(() =>
			expect(errorStateMock.catchError).toHaveBeenCalledWith(
				expect.any(Error),
				'Reset quote workspace'
			)
		);

		expect(engine.quoteOptions).toEqual(previousQuoteOptions);
		expect(engine.activeQuoteOptionId).toBe(previousActiveQuoteOptionId);
		expect(engine.savedEstimates.get('asset-1')).toEqual(savedEstimate);
		expect(engine.dirtyIds.has('asset-1')).toBe(true);
		expect(engine.quantities.get('asset-1')).toBe(2);
		expect(engine.roundPrices).toBe(true);
	});

	it('hydrates quote revisions through the quote state authority', async () => {
		const { QuoteEngineState } = await import('./quote.svelte');
		const engine = new QuoteEngineState('project-1');

		await engine.hydrateQuoteRevisions();

		expect(dbServiceMock.getQuoteRevisions).toHaveBeenCalledWith('project-1');
		expect(engine.quoteRevisions).toEqual([quoteRevision]);
		expect(engine.quoteRevisionsHydrated).toBe(true);
	});

	it('creates quote revisions through the quote state authority', async () => {
		const { QuoteEngineState } = await import('./quote.svelte');
		const engine = new QuoteEngineState('project-1');

		const result = await engine.createQuoteRevision({
			project_id: 'ignored-project-id',
			rfq_number: 'RFQ-1001',
			contact_name: 'Atlas Structural',
			project_name: 'Warehouse Package',
			business: {
				name: 'Southern Estimating',
				abn: '51 824 753 556',
				address: '14 Foundry Road',
				contactName: 'Sam Owner',
				contactEmail: 'estimating@example.test',
				contactPhone: '0400 111 222',
				currency_code: 'AUD',
				currency_symbol: '$'
			},
			issued_date: '10/03/2026',
			valid_until_date: '09/04/2026',
			package_attachments: [
				{
					file_id: 'file-1',
					file_name: 'Drawing A.pdf',
					status: 'appended',
					reason: null
				}
			],
			options: []
		});

		expect(dbServiceMock.createQuoteRevision).toHaveBeenCalledWith({
			project_id: 'project-1',
			rfq_number: 'RFQ-1001',
			contact_name: 'Atlas Structural',
			project_name: 'Warehouse Package',
			business: {
				name: 'Southern Estimating',
				abn: '51 824 753 556',
				address: '14 Foundry Road',
				contactName: 'Sam Owner',
				contactEmail: 'estimating@example.test',
				contactPhone: '0400 111 222',
				currency_code: 'AUD',
				currency_symbol: '$'
			},
			issued_date: '10/03/2026',
			valid_until_date: '09/04/2026',
			package_attachments: [
				{
					file_id: 'file-1',
					file_name: 'Drawing A.pdf',
					status: 'appended',
					reason: null
				}
			],
			options: []
		});
		expect(result).toEqual(quoteRevision);
		expect(engine.quoteRevisions).toEqual([quoteRevision]);
		expect(engine.quoteRevisionsHydrated).toBe(true);
	});

	it('automatically transitions ai_mapping_status from unresolved to manual on edit', async () => {
		const assetId = 'asset-1';
		const itemId = 'item-1';
		const componentId = 'comp-1';

		// Setup estimate with unresolved component
		const { QuoteEngineState } = await import('./quote.svelte');
		const engine = new QuoteEngineState('project-1');
		engine.estimates.set(assetId, {
			...savedEstimate,
			asset_id: assetId,
			takeoff_items: [
				{
					...savedEstimate.takeoff_items[0],
					id: itemId,
					cost_components: [
						{
							...savedEstimate.takeoff_items[0].cost_components[0],
							id: componentId,
							unit_rate: 0,
							metadata: { ai_mapping_status: 'unresolved' }
						}
					]
				}
			]
		});

		// Perform edit
		engine.updateCostComponent(assetId, itemId, componentId, { unit_rate: 100 });

		const updated = engine.getEstimate(assetId).takeoff_items[0].cost_components[0];
		expect(updated.unit_rate).toBe(100);
		expect(updated.metadata?.ai_mapping_status).toBe('manual');
	});
});
