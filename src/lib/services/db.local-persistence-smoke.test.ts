import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import BetterSqlite3 from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	buildEmptyCostPresetComponents,
	buildEmptyEstimateTemplatePayload
} from '$lib/services/setup-import.js';
import type {
	ClassificationSystemFormValues,
	ContactFormValues,
	CostCodeFormValues,
	CostComponentPresetFormValues,
	EstimateTemplateFormValues,
	MaterialCatalogItemFormValues,
	WbsNodeFormValues
} from '$lib/schemas/index.js';
import type { CreateQuoteRevisionInput, Estimate, QuoteOption } from '$lib/types/index.js';
import type { DB } from '$lib/types/db.js';
import { seedWorkspaceIdentities } from '../../tests/workspace-database.js';

vi.mock('../utils/env', () => ({
	isTauri: () => true
}));

vi.mock('@tauri-apps/plugin-log', () => ({
	trace: vi.fn(),
	debug: vi.fn(),
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn()
}));

const fsMocks = vi.hoisted(() => ({
	copyFile: vi.fn(),
	mkdir: vi.fn(),
	remove: vi.fn()
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
	copyFile: fsMocks.copyFile,
	mkdir: fsMocks.mkdir,
	remove: fsMocks.remove,
	BaseDirectory: {
		Document: 'Document',
		AppLocalData: 'AppLocalData'
	}
}));

vi.mock('./local-documents.js', () => ({
	resolveLocalDocumentPath: async (relativePath: string) => `/qa-documents/${relativePath}`
}));

import { dbService } from '$lib/services/db';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, '../../../src-tauri/migrations-workspace');

type TestDatabase = InstanceType<typeof BetterSqlite3>;
type DbServiceInternals = Record<string, unknown>;

type MockPluginSqlDb = {
	select: (sql: string, params?: unknown[]) => Promise<unknown[]>;
	close: ReturnType<typeof vi.fn>;
};

const companyContact: ContactFormValues = {
	kind: 'company',
	country_code: 'AU',
	display_name: 'Atlas Steel',
	name: 'Atlas Steel',
	company_name: 'Atlas Steel',
	person_first_name: '',
	person_last_name: '',
	role_title: '',
	linked_company_id: '',
	is_primary_company_contact: false,
	contact_name: 'Mia Collins',
	email: 'estimating@atlas.example',
	website: 'https://atlas.example',
	phone: '+61 400 000 000',
	phone_country_code: 'AU',
	phone_e164: '',
	abn: '',
	business_id_label: 'ABN',
	business_id_value: '',
	tax_id_label: 'GST',
	tax_id_value: '',
	address: '14 Foundry Road',
	notes: '',
	custom_role_label: '',
	roles: ['customer'],
	tags: [],
	is_active: true
};

const personContact: ContactFormValues = {
	kind: 'person',
	country_code: 'AU',
	display_name: 'Mia Collins',
	name: 'Mia Collins',
	company_name: '',
	person_first_name: 'Mia',
	person_last_name: 'Collins',
	role_title: 'Estimator',
	linked_company_id: 'company-atlas',
	is_primary_company_contact: true,
	contact_name: '',
	email: 'mia@atlas.example',
	website: '',
	phone: '+61 401 111 111',
	phone_country_code: 'AU',
	phone_e164: '',
	abn: '',
	business_id_label: 'ABN',
	business_id_value: '',
	tax_id_label: 'GST',
	tax_id_value: '',
	address: '',
	notes: '',
	custom_role_label: '',
	roles: ['customer'],
	tags: [],
	is_active: true
};

const classificationData: ClassificationSystemFormValues = {
	name: 'Fabrication',
	code: 'FAB',
	classification_type: 'custom',
	aliases: [],
	is_default: true
};

const materialData: MaterialCatalogItemFormValues = {
	code: 'MAT-PLATE',
	name: 'Plate',
	aliases: [],
	category: 'Steel',
	specification: '250 Grade',
	unit: 'kg',
	default_rate: 12.5,
	is_active: true
};

const presetData: CostComponentPresetFormValues = {
	code: 'PRE-BASE',
	name: 'Base Preset',
	description: 'Default base preset',
	aliases: [],
	is_active: true
};

const templateData: EstimateTemplateFormValues = {
	code: 'TPL-BASE',
	name: 'Base Estimate Template',
	description: 'Default estimate template',
	aliases: [],
	is_active: true
};

function listMigrationFiles(): string[] {
	return fs
		.readdirSync(migrationsDir)
		.filter((name) => name === '001_workspace.sql')
		.sort((left, right) => Number(left.split('_')[0]) - Number(right.split('_')[0]));
}

function createMigratedDatabase(): { sqlite: TestDatabase; kysely: Kysely<DB> } {
	const sqlite = new BetterSqlite3(':memory:');
	sqlite.pragma('foreign_keys = ON');
	for (const name of listMigrationFiles()) {
		sqlite.exec(fs.readFileSync(path.join(migrationsDir, name), 'utf8'));
	}
	seedWorkspaceIdentities(sqlite);
	const kysely = new Kysely<DB>({
		dialect: new SqliteDialect({ database: sqlite })
	});
	return { sqlite, kysely };
}

function createMockPluginSqlDb(sqlite: TestDatabase): MockPluginSqlDb {
	return {
		select: vi.fn(async (sql: string, params: unknown[] = []) => {
			const translatedSql = sql.replace(/\$\d+/g, '?');
			const statement = sqlite.prepare(translatedSql);
			return statement.all(...params);
		}),
		close: vi.fn()
	};
}

function getServiceInternals(): DbServiceInternals {
	return dbService as unknown as DbServiceInternals;
}

function buildEstimate(input: {
	assetId: string;
	classificationSystemId: string | null;
	rootWbsId: string | null;
	itemWbsId: string | null;
	costCodeId: string | null;
	materialId: string | null;
	presetId?: string | null;
	templateId?: string | null;
}): Estimate {
	return {
		asset_id: input.assetId,
		scope_summary: 'Beam package',
		notes: 'Local smoke estimate',
		classification_system_id: input.classificationSystemId,
		wbs_root_node_id: input.rootWbsId,
		applied_template_id: input.templateId ?? null,
		applied_template_name: input.templateId ? 'Base Estimate Template' : null,
		takeoff_items: [
			{
				id: 'takeoff-1',
				estimate_asset_id: input.assetId,
				parent_id: null,
				wbs_node_id: input.itemWbsId,
				cost_code_id: input.costCodeId,
				applied_preset_id: input.presetId ?? null,
				applied_preset_name: input.presetId ? 'Base Preset' : null,
				name: 'Base Plate',
				description: '',
				quantity: 2,
				unit: 'ea',
				properties: {},
				sort_order: 0,
				cost_components: [
					{
						id: 'component-1',
						takeoff_item_id: 'takeoff-1',
						category: 'material',
						source_type: input.materialId ? 'material_catalog' : 'manual',
						source_id: input.materialId,
						name: 'Plate',
						description: '',
						quantity: 3,
						unit: 'kg',
						unit_rate: 12.5,
						formula: {},
						metadata: {},
						sort_order: 0
					}
				]
			}
		]
	};
}

function buildQuoteRevisionInput(
	projectId: string,
	options: QuoteOption[]
): CreateQuoteRevisionInput {
	return {
		project_id: projectId,
		rfq_number: 'RFQ-1001',
		contact_name: 'Atlas Steel',
		contact: {
			countryCode: 'AU',
			businessIdLabel: 'ABN',
			businessIdValue: '12 345 678 901',
			taxIdLabel: 'GST',
			taxIdValue: 'ignored-for-au'
		},
		project_name: 'Workshop upgrade',
		business: {
			name: 'Kwantflow Fabrication',
			countryCode: 'AU',
			businessIdLabel: 'ABN',
			businessIdValue: '98 765 432 109',
			taxIdLabel: 'GST',
			taxIdValue: 'ignored-for-au',
			taxDisplayLabel: 'GST',
			taxRatePercentage: 10,
			address: '14 Foundry Road',
			contactName: 'Sam Owner',
			contactEmail: 'sam@kwantflow.test',
			contactPhone: '+61 400 000 000',
			currency_code: 'AUD',
			currency_symbol: '$'
		},
		issued_date: '29/03/2026',
		valid_until_date: '28/04/2026',
		options: options.map((option) => ({
			source_quote_option_id: option.id,
			label: option.label,
			lead_time: option.lead_time,
			markup_percentage: option.markup_percentage,
			notes: option.notes,
			sort_order: option.sort_order,
			is_default: option.is_default,
			is_selected: option.is_default,
			line_items: [
				{
					file_name: 'spec.pdf',
					description: 'Beam package',
					quantity: 1,
					lead_time: option.lead_time,
					unit_price: 1250,
					line_total: 1250
				}
			],
			subtotal_amount: 1250,
			gst_amount: 125,
			total_amount: 1375
		}))
	};
}

describe('dbService local persistence smoke', () => {
	let sqlite: TestDatabase;
	let kysely: Kysely<DB>;
	let service: DbServiceInternals;
	let originalInit: unknown;
	let originalGetWorkspaceIdForWrite: unknown;

	beforeEach(() => {
		({ sqlite, kysely } = createMigratedDatabase());
		service = getServiceInternals();
		originalInit = service.init;
		originalGetWorkspaceIdForWrite = service.getWorkspaceIdForWrite;
		service.db = createMockPluginSqlDb(sqlite);
		service.kysely = kysely;
		service.init = vi.fn(async () => {});
		service.getWorkspaceIdForWrite = vi.fn(async () => 'local-workspace');
		fsMocks.copyFile.mockResolvedValue(undefined);
		fsMocks.mkdir.mockResolvedValue(undefined);
		fsMocks.remove.mockResolvedValue(undefined);
	});

	afterEach(async () => {
		service.init = originalInit;
		service.getWorkspaceIdForWrite = originalGetWorkspaceIdForWrite;
		service.db = null;
		service.kysely = null;
		await kysely.destroy();
		sqlite.close();
		vi.restoreAllMocks();
		vi.clearAllMocks();
	});

	it('walks the primary local CRM, RFQ, estimate, quote, and duplication flow through the live SQLite service contract', async () => {
		await dbService.addContact('company-atlas', companyContact);
		await dbService.addContact('person-mia', personContact);

		const contacts = await dbService.getContacts();
		expect(contacts.map((contact) => contact.id)).toEqual(['company-atlas', 'person-mia']);

		await dbService.addProject(
			'project-1',
			'RFQ-1001',
			'company-atlas',
			'Atlas Steel',
			'Workshop upgrade',
			'2026-04-30',
			undefined,
			undefined,
			'Please quote beam package',
			'Local smoke note',
			'person-mia',
			'Mia Collins',
			'email',
			'RFQ-EMAIL-1',
			'2026-04-01',
			'2026-04-30T15:30',
			'Lead Estimator',
			'TENDER-42',
			'Addendum 1',
			'2026-04-02',
			'Clarified finish schedule',
			'1 Site Street',
			'2 Delivery Road'
		);
		await dbService.addProjectFile(
			'file-1',
			'project-1',
			'workspace/project-1/spec.pdf',
			'spec.pdf'
		);
		await dbService.createAssetFromFiles('asset-1', 'project-1', 'Beam Bundle', ['file-1']);
		await dbService.updateAsset('asset-1', {
			quote_quantity: 3,
			is_pdf_included: false
		});
		await dbService.updateProjectQuotePreferences('project-1', {
			quote_round_prices: true
		});
		await dbService.addClassificationSystem('class-1', classificationData);
		await dbService.addCostCode('cost-root', 'class-1', {
			parent_id: null,
			code: '01',
			name: 'Fabrication',
			description: '',
			is_active: true,
			sort_order: 0
		} satisfies CostCodeFormValues);
		await dbService.addWbsNode('wbs-root', 'project-1', {
			parent_id: null,
			code: '10',
			name: 'Workshop',
			type: 'phase',
			sort_order: 0
		} satisfies WbsNodeFormValues);
		await dbService.addMaterialCatalogueItem('material-1', materialData);

		await dbService.saveEstimate(
			'asset-1',
			buildEstimate({
				assetId: 'asset-1',
				classificationSystemId: 'class-1',
				rootWbsId: 'wbs-root',
				itemWbsId: 'wbs-root',
				costCodeId: 'cost-root',
				materialId: 'material-1'
			})
		);

		const savedEstimate = await dbService.getEstimate('asset-1');
		expect(savedEstimate).toMatchObject({
			asset_id: 'asset-1',
			classification_system_id: 'class-1',
			wbs_root_node_id: 'wbs-root'
		});
		expect(savedEstimate?.takeoff_items[0]).toMatchObject({
			cost_code_id: 'cost-root',
			wbs_node_id: 'wbs-root'
		});
		expect(savedEstimate?.takeoff_items[0]?.cost_components[0]).toMatchObject({
			source_type: 'material_catalog',
			source_id: 'material-1'
		});

		const quoteProject = await dbService.getProjectById('project-1');
		const quoteAssets = await dbService.getAssetsForProject('project-1');
		expect(quoteProject?.quote_round_prices).toBe(true);
		expect(quoteAssets[0]).toMatchObject({
			quote_quantity: 3,
			is_pdf_included: false
		});

		const defaultOptions = await dbService.getQuoteOptions('project-1');
		expect(defaultOptions).toHaveLength(1);
		expect(defaultOptions[0]?.is_default).toBe(true);

		await dbService.createQuoteOption({
			id: 'quote-option-rush',
			project_id: 'project-1',
			label: 'Rush',
			lead_time: '1 week',
			markup_percentage: 12,
			material_markup_percentage: null,
			labour_markup_percentage: null,
			equipment_markup_percentage: null,
			subcontract_markup_percentage: null,
			notes: 'Rush option',
			sort_order: 1,
			is_default: false,
			created_at: '2026-03-29T00:00:00Z',
			updated_at: '2026-03-29T00:00:00Z'
		});
		await dbService.setDefaultQuoteOption('quote-option-rush');

		const quoteOptions = await dbService.getQuoteOptions('project-1');
		expect(quoteOptions).toHaveLength(2);
		expect(quoteOptions.find((option) => option.id === 'quote-option-rush')?.is_default).toBe(true);

		const revision = await dbService.createQuoteRevision(
			buildQuoteRevisionInput('project-1', quoteOptions)
		);
		expect(revision.revision_number).toBe(1);
		expect(revision.options).toHaveLength(2);

		const revisionHistory = await dbService.getQuoteRevisions('project-1');
		expect(revisionHistory).toHaveLength(1);
		expect(revisionHistory[0]?.options).toHaveLength(2);

		let uuidCounter = 100;
		vi.spyOn(crypto, 'randomUUID').mockImplementation(
			() =>
				`00000000-0000-4000-8000-${String(uuidCounter++).padStart(12, '0')}` as `${string}-${string}-${string}-${string}-${string}`
		);

		const duplicatedProjectId = await dbService.duplicateProject('project-1', 'RFQ-1002');
		const duplicatedProject = await dbService.getProjectById(duplicatedProjectId);
		const duplicatedAssets = await dbService.getAssetsForProject(duplicatedProjectId);
		const duplicatedEstimate = await dbService.getEstimate(duplicatedAssets[0]!.id);
		const duplicatedQuoteOptions = await dbService.getQuoteOptions(duplicatedProjectId);

		expect(duplicatedProject).toMatchObject({
			rfq_number: 'RFQ-1002',
			contact_id: 'company-atlas',
			requester_contact_id: 'person-mia',
			received_date: '2026-04-01',
			submission_deadline_at: '2026-04-30T15:30',
			estimator_name: 'Lead Estimator',
			customer_tender_reference: 'TENDER-42',
			addendum_label: 'Addendum 1',
			addendum_date: '2026-04-02',
			addendum_notes: 'Clarified finish schedule',
			site_address: '1 Site Street',
			delivery_address: '2 Delivery Road'
		});
		expect(duplicatedAssets).toHaveLength(1);
		expect(duplicatedAssets[0]?.files).toHaveLength(1);
		expect(duplicatedAssets[0]).toMatchObject({
			quote_quantity: 3,
			is_pdf_included: false
		});
		expect(duplicatedEstimate?.takeoff_items).toHaveLength(1);
		expect(duplicatedQuoteOptions).toHaveLength(2);
		expect(duplicatedProject?.quote_round_prices).toBe(true);
		expect(fsMocks.copyFile).toHaveBeenCalled();
	});

	it('resets quote workspace preferences and saved estimates for the whole RFQ in one local SQLite flow', async () => {
		await dbService.addProject('project-reset', 'RFQ-RESET');
		await dbService.addAsset('asset-reset', 'project-reset', 'Reset Asset');
		await dbService.updateAsset('asset-reset', {
			quote_quantity: 5,
			is_pdf_included: false
		});
		await dbService.updateProjectQuotePreferences('project-reset', {
			quote_round_prices: true
		});
		await dbService.createQuoteOption({
			id: 'quote-reset-rush',
			project_id: 'project-reset',
			label: 'Rush',
			lead_time: '1 week',
			markup_percentage: 20,
			material_markup_percentage: null,
			labour_markup_percentage: null,
			equipment_markup_percentage: null,
			subcontract_markup_percentage: null,
			notes: '',
			sort_order: 1,
			is_default: false,
			created_at: '2026-03-29T00:00:00Z',
			updated_at: '2026-03-29T00:00:00Z'
		});
		await dbService.saveEstimate(
			'asset-reset',
			buildEstimate({
				assetId: 'asset-reset',
				classificationSystemId: null,
				rootWbsId: null,
				itemWbsId: null,
				costCodeId: null,
				materialId: null
			})
		);

		await dbService.resetQuoteWorkspace('project-reset', [
			{
				id: 'quote-reset-standard',
				project_id: 'project-reset',
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
				created_at: '2026-03-29T00:00:00Z',
				updated_at: '2026-03-29T00:00:00Z'
			}
		]);

		const resetProject = await dbService.getProjectById('project-reset');
		const resetAssets = await dbService.getAssetsForProject('project-reset');
		const resetEstimate = await dbService.getEstimate('asset-reset');
		const resetOptions = await dbService.getQuoteOptions('project-reset');

		expect(resetProject?.quote_round_prices).toBe(false);
		expect(resetAssets[0]).toMatchObject({
			quote_quantity: 1,
			is_pdf_included: true
		});
		expect(resetEstimate).toBeNull();
		expect(resetOptions).toHaveLength(1);
		expect(resetOptions[0]?.label).toBe('Standard');
		expect(resetOptions[0]?.is_default).toBe(true);
	});

	it('persists negative quote-option markup as a discount and clamps it at -100 percent', async () => {
		await dbService.addProject('project-discount', 'RFQ-DISCOUNT');

		await dbService.createQuoteOption({
			id: 'quote-option-discount',
			project_id: 'project-discount',
			label: 'Discount',
			lead_time: '2 weeks',
			markup_percentage: -10,
			material_markup_percentage: null,
			labour_markup_percentage: null,
			equipment_markup_percentage: null,
			subcontract_markup_percentage: null,
			notes: 'Preferred-customer discount',
			sort_order: 1,
			is_default: false,
			created_at: '2026-03-29T00:00:00Z',
			updated_at: '2026-03-29T00:00:00Z'
		});

		await dbService.updateQuoteOption('quote-option-discount', {
			label: 'Discounted',
			lead_time: '10 days',
			markup_percentage: -150,
			notes: 'Clamped discount',
			is_default: false
		});

		const quoteOptions = await dbService.getQuoteOptions('project-discount');
		const savedDiscount = quoteOptions.find((option) => option.id === 'quote-option-discount');

		expect(savedDiscount).toMatchObject({
			label: 'Discounted',
			lead_time: '10 days',
			markup_percentage: -100,
			notes: 'Clamped discount'
		});
	});

	it('persists reusable quote option presets at workspace scope without mutating project options', async () => {
		await dbService.addProject('project-presets', 'RFQ-PRESETS');

		const initialQuoteOptions = await dbService.getQuoteOptions('project-presets');
		expect(initialQuoteOptions).toHaveLength(1);

		await dbService.addQuoteOptionPreset('preset-preferred-customer', {
			label: 'Preferred Customer -10%',
			lead_time: '2 weeks',
			markup_percentage: -10,
			notes: 'Preferred customer discount'
		});

		const presets = await dbService.getQuoteOptionPresets();
		expect(presets).toHaveLength(1);
		expect(presets[0]).toMatchObject({
			workspace_id: 'local-workspace',
			label: 'Preferred Customer -10%',
			markup_percentage: -10
		});

		await dbService.updateQuoteOptionPreset('preset-preferred-customer', {
			label: 'Preferred Customer -12%',
			lead_time: '10 days',
			markup_percentage: -12,
			notes: 'Updated discount'
		});

		const updatedPreset = await dbService.getQuoteOptionPresetById('preset-preferred-customer');
		expect(updatedPreset).toMatchObject({
			label: 'Preferred Customer -12%',
			lead_time: '10 days',
			markup_percentage: -12,
			notes: 'Updated discount'
		});

		const unchangedQuoteOptions = await dbService.getQuoteOptions('project-presets');
		expect(unchangedQuoteOptions).toEqual(initialQuoteOptions);

		await dbService.deleteQuoteOptionPreset('preset-preferred-customer');
		expect(await dbService.getQuoteOptionPresets()).toEqual([]);
	});

	it('nulls linked references or cascades descendants when admin and tree records are deleted', async () => {
		await dbService.addProject('project-cleanup', 'RFQ-CLEAN');
		await dbService.addAsset('asset-cleanup', 'project-cleanup', 'Cleanup Asset');
		await dbService.addClassificationSystem('class-cleanup', classificationData);
		await dbService.addCostCode('cost-parent', 'class-cleanup', {
			parent_id: null,
			code: '10',
			name: 'Parent Code',
			description: '',
			is_active: true,
			sort_order: 0
		} satisfies CostCodeFormValues);
		await dbService.addCostCode('cost-child', 'class-cleanup', {
			parent_id: 'cost-parent',
			code: '10.1',
			name: 'Child Code',
			description: '',
			is_active: true,
			sort_order: 1
		} satisfies CostCodeFormValues);
		await dbService.addWbsNode('wbs-parent', 'project-cleanup', {
			parent_id: null,
			code: '10',
			name: 'Parent WBS',
			type: 'phase',
			sort_order: 0
		} satisfies WbsNodeFormValues);
		await dbService.addWbsNode('wbs-child', 'project-cleanup', {
			parent_id: 'wbs-parent',
			code: '10.1',
			name: 'Child WBS',
			type: 'zone',
			sort_order: 1
		} satisfies WbsNodeFormValues);
		await dbService.addMaterialCatalogueItem('material-cleanup', {
			...materialData,
			code: 'MAT-CLEAN'
		});
		await dbService.addCostComponentPreset(
			'preset-cleanup',
			presetData,
			buildEmptyCostPresetComponents()
		);
		await dbService.addEstimateTemplate(
			'template-cleanup',
			templateData,
			buildEmptyEstimateTemplatePayload()
		);

		await dbService.saveEstimate(
			'asset-cleanup',
			buildEstimate({
				assetId: 'asset-cleanup',
				classificationSystemId: 'class-cleanup',
				rootWbsId: 'wbs-parent',
				itemWbsId: 'wbs-child',
				costCodeId: 'cost-child',
				materialId: 'material-cleanup',
				presetId: 'preset-cleanup',
				templateId: 'template-cleanup'
			})
		);

		await dbService.deleteMaterialCatalogueItem('material-cleanup');
		await dbService.deleteCostComponentPreset('preset-cleanup');
		await dbService.deleteEstimateTemplate('template-cleanup');
		await dbService.deleteCostCode('cost-parent');
		await dbService.deleteWbsNode('wbs-parent');
		await dbService.deleteClassificationSystem('class-cleanup');

		const estimateAfterCleanup = await dbService.getEstimate('asset-cleanup');
		expect(estimateAfterCleanup).toMatchObject({
			classification_system_id: null,
			wbs_root_node_id: null,
			applied_template_id: null,
			applied_template_name: null
		});
		expect(estimateAfterCleanup?.takeoff_items[0]).toMatchObject({
			wbs_node_id: null,
			cost_code_id: null,
			applied_preset_id: null,
			applied_preset_name: null
		});
		expect(estimateAfterCleanup?.takeoff_items[0]?.cost_components[0]).toMatchObject({
			source_type: 'manual',
			source_id: null
		});

		expect(await dbService.getCostCodes('class-cleanup')).toEqual([]);
		expect(await dbService.getWbsNodes('project-cleanup')).toEqual([]);
		expect(await dbService.getClassificationSystems()).toEqual([]);
		expect(await dbService.getMaterialCatalogueItems()).toEqual([]);
		expect(await dbService.getCostComponentPresetById('preset-cleanup')).toBeNull();
		expect(await dbService.getEstimateTemplateById('template-cleanup')).toBeNull();
	});

	it('reports optional setup page record counts from the live SQLite tables', async () => {
		await dbService.addContact('company-counts', {
			...companyContact,
			name: 'Counts Steel',
			display_name: 'Counts Steel',
			company_name: 'Counts Steel',
			contact_name: 'Counts Contact',
			email: 'counts@steel.example'
		});

		await dbService.addMaterialCatalogueItem('material-counts', {
			...materialData,
			code: 'MAT-COUNTS',
			name: 'Counts Plate'
		});
		await dbService.addMaterialCatalogueItem('material-inactive-counts', {
			...materialData,
			code: 'MAT-INACTIVE-COUNTS',
			name: 'Inactive Counts Plate',
			is_active: false
		});

		const counts = await dbService.getOptionalSetupPageRecordCounts();

		expect(counts.materials).toBe(2);
		expect(counts['labour-rates']).toBe(0);
		expect(counts['equipment-rates']).toBe(0);
		expect(counts['subcontract-rates']).toBe(0);
		expect(counts['cost-presets']).toBe(0);
		expect(counts['estimate-templates']).toBe(0);
	});

	it('reports workspace overview counts from the live SQLite tables', async () => {
		await dbService.addContact('company-counts-overview', {
			...companyContact,
			name: 'Overview Steel',
			display_name: 'Overview Steel',
			company_name: 'Overview Steel',
			contact_name: 'Overview Contact',
			email: 'overview@steel.example'
		});

		await dbService.addMaterialCatalogueItem('material-counts-overview', {
			...materialData,
			code: 'MAT-OVERVIEW',
			name: 'Overview Plate'
		});

		await dbService.addProject('project-counts-overview', 'RFQ-OVERVIEW');

		const counts = await dbService.getWorkspaceOverviewCounts();

		expect(counts.projectCount).toBeGreaterThanOrEqual(1);
		expect(counts.contactCount).toBeGreaterThanOrEqual(1);
		expect(counts.materialsCount).toBeGreaterThanOrEqual(1);
		expect(counts.labourRateCount).toBe(0);
		expect(counts.equipmentRateCount).toBe(0);
		expect(counts.subcontractRateCount).toBe(0);
		expect(counts.costPresetCount).toBe(0);
		expect(counts.estimateTemplateCount).toBe(0);
	});

	it('persists asset regrouping, quote-option transitions, and manual ordering through the live SQLite contract', async () => {
		await dbService.addContact('company-alpha', {
			...companyContact,
			display_name: 'Alpha Steel',
			name: 'Alpha Steel',
			company_name: 'Alpha Steel',
			email: 'alpha@steel.example'
		});
		await dbService.addContact('company-beta', {
			...companyContact,
			display_name: 'Beta Fabrication',
			name: 'Beta Fabrication',
			company_name: 'Beta Fabrication',
			email: 'beta@steel.example'
		});
		await dbService.reorderContacts(['company-beta', 'company-alpha']);

		const reorderedContacts = await dbService.getContacts();
		expect(reorderedContacts.map((contact) => contact.id)).toEqual([
			'company-beta',
			'company-alpha'
		]);

		await dbService.addProject('project-alpha', 'RFQ-2001', 'company-alpha', 'Alpha Steel');
		await dbService.addProject('project-beta', 'RFQ-2002', 'company-beta', 'Beta Fabrication');
		await dbService.reorderProjects(['project-beta', 'project-alpha']);

		const reorderedProjects = await dbService.getProjects();
		expect(reorderedProjects.map((project) => project.id)).toEqual([
			'project-beta',
			'project-alpha'
		]);

		await dbService.addProjectFile(
			'file-alpha-1',
			'project-alpha',
			'workspace/project-alpha/spec-a.pdf',
			'spec-a.pdf'
		);
		await dbService.addProjectFile(
			'file-alpha-2',
			'project-alpha',
			'workspace/project-alpha/spec-b.pdf',
			'spec-b.pdf'
		);
		await dbService.createAssetFromFiles('asset-alpha', 'project-alpha', 'Primary Bundle', [
			'file-alpha-1'
		]);
		await dbService.assignFilesToAsset('asset-alpha', 'project-alpha', ['file-alpha-2']);
		await dbService.updateAsset('asset-alpha', {
			display_name: 'Renamed Bundle',
			is_selected: false
		});

		let assetShell = await dbService.getWorkspaceShell('project-alpha');
		expect(assetShell.assets).toHaveLength(1);
		const groupedAsset = assetShell.assets[0];
		expect(groupedAsset).toMatchObject({
			id: 'asset-alpha',
			display_name: 'Renamed Bundle',
			is_selected: false
		});
		expect(groupedAsset?.files?.map((file) => file.id)).toEqual(['file-alpha-1', 'file-alpha-2']);
		expect(assetShell.unassignedFiles).toEqual([]);

		await dbService.removeFileFromAsset('file-alpha-2');
		assetShell = await dbService.getWorkspaceShell('project-alpha');
		const regroupedAsset = assetShell.assets[0];
		expect(regroupedAsset?.files?.map((file) => file.id)).toEqual(['file-alpha-1']);
		expect(assetShell.unassignedFiles.map((file) => file.id)).toEqual(['file-alpha-2']);

		const initialOptions = await dbService.getQuoteOptions('project-alpha');
		expect(initialOptions).toHaveLength(1);
		expect(initialOptions[0]?.is_default).toBe(true);

		await dbService.createQuoteOption({
			id: 'quote-option-expedite',
			project_id: 'project-alpha',
			label: 'Expedite',
			lead_time: '5 days',
			markup_percentage: 18,
			material_markup_percentage: null,
			labour_markup_percentage: null,
			equipment_markup_percentage: null,
			subcontract_markup_percentage: null,
			notes: 'Rush fabrication',
			sort_order: 1,
			is_default: false,
			created_at: '2026-03-29T00:00:00Z',
			updated_at: '2026-03-29T00:00:00Z'
		});
		await dbService.updateQuoteOption('quote-option-expedite', {
			label: 'Expedite Updated',
			lead_time: '4 days',
			markup_percentage: 20,
			notes: 'Updated rush fabrication',
			is_default: false
		});
		await dbService.setDefaultQuoteOption('quote-option-expedite');
		await dbService.deleteQuoteOption(initialOptions[0]!.id);

		const remainingOptions = await dbService.getQuoteOptions('project-alpha');
		expect(remainingOptions).toHaveLength(1);
		expect(remainingOptions[0]).toMatchObject({
			id: 'quote-option-expedite',
			label: 'Expedite Updated',
			lead_time: '4 days',
			markup_percentage: 20,
			is_default: true,
			sort_order: 0
		});
	});

	it('prunes old AI runs and runs VACUUM successfully', async () => {
		// 1. Seed some old completed AI runs and some new ones
		const oldDate = new Date();
		oldDate.setDate(oldDate.getDate() - 35);
		const oldDateIso = oldDate.toISOString();

		const newDate = new Date();
		const newDateIso = newDate.toISOString();

		// Seed a project and asset first to satisfy foreign keys
		await kysely
			.insertInto('projects')
			.values({
				id: 'project-prune-test',
				workspace_id: 'local-workspace',
				rfq_number: 'RFQ-PRUNE',
				project_name: 'Prune Test Project',
				created_at: newDateIso,
				updated_at: newDateIso
			})
			.execute();

		await kysely
			.insertInto('assets')
			.values({
				id: 'asset-prune-test',
				project_id: 'project-prune-test',
				display_name: 'test.pdf'
			})
			.execute();

		// Seed 2 runs: one old, one new
		await kysely
			.insertInto('ai_runs')
			.values({
				id: 'run-old',
				asset_id: 'asset-prune-test',
				provider: 'litert',
				model_id: 'gemma4',
				status: 'completed',
				trigger_source: 'user',
				started_at: oldDateIso,
				completed_at: oldDateIso,
				created_at: oldDateIso,
				updated_at: oldDateIso
			})
			.execute();

		await kysely
			.insertInto('ai_runs')
			.values({
				id: 'run-new',
				asset_id: 'asset-prune-test',
				provider: 'litert',
				model_id: 'gemma4',
				status: 'completed',
				trigger_source: 'user',
				started_at: newDateIso,
				completed_at: newDateIso,
				created_at: newDateIso,
				updated_at: newDateIso
			})
			.execute();

		// Also seed dependent ai_evidence_refs and verify cascade delete
		await kysely
			.insertInto('ai_evidence_refs')
			.values({
				id: 'ref-old',
				run_id: 'run-old',
				asset_id: 'asset-prune-test',
				file_name: 'test.pdf',
				quote_path: '$.text',
				summary: 'Old summary',
				created_at: oldDateIso
			})
			.execute();

		await kysely
			.insertInto('ai_evidence_refs')
			.values({
				id: 'ref-new',
				run_id: 'run-new',
				asset_id: 'asset-prune-test',
				file_name: 'test.pdf',
				quote_path: '$.text',
				summary: 'New summary',
				created_at: newDateIso
			})
			.execute();

		// Pre-prune counts
		const runsBefore = await kysely.selectFrom('ai_runs').selectAll().execute();
		expect(runsBefore).toHaveLength(2);
		const refsBefore = await kysely.selectFrom('ai_evidence_refs').selectAll().execute();
		expect(refsBefore).toHaveLength(2);

		// Execute prune
		const internals = getServiceInternals();
		// Intercept the execution to use our sqlite test instance
		const dbMock = {
			execute: vi.fn(async (sql: string) => {
				sqlite.exec(sql);
				return { rowsAffected: 0 };
			})
		};
		const originalDb = internals['db'];
		internals['db'] = dbMock;

		await dbService.pruneOldAiRunsAndVacuum();

		// Restore original db connection
		internals['db'] = originalDb;

		// Post-prune counts: run-old and ref-old should be pruned, run-new and ref-new should remain
		const runsAfter = await kysely.selectFrom('ai_runs').selectAll().execute();
		expect(runsAfter).toHaveLength(1);
		expect(runsAfter[0].id).toBe('run-new');

		const refsAfter = await kysely.selectFrom('ai_evidence_refs').selectAll().execute();
		expect(refsAfter).toHaveLength(1);
		expect(refsAfter[0].id).toBe('ref-new');
		expect(dbMock.execute).toHaveBeenCalledWith('VACUUM');
	});
});
