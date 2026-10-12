import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import BetterSqlite3 from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EstimateTemplateFormValues } from '$lib/schemas/index.js';
import type { CostComponentPreset, Estimate } from '$lib/types/index.js';
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

vi.mock('@tauri-apps/plugin-fs', () => ({
	copyFile: vi.fn(),
	mkdir: vi.fn(),
	remove: vi.fn(),
	BaseDirectory: {
		Document: 'Document',
		AppLocalData: 'AppLocalData'
	}
}));

import { dbService } from '$lib/services/db';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, '../../../src-tauri/migrations-workspace');

type TestDatabase = InstanceType<typeof BetterSqlite3>;
type DbServiceInternals = Record<string, unknown>;

const baseTemplateData: EstimateTemplateFormValues = {
	code: 'EST-BASE',
	name: 'Starter estimate',
	description: 'Starter estimate template',
	aliases: [],
	is_active: true
};

const baseEstimate: Estimate = {
	asset_id: 'asset-1',
	scope_summary: 'Base estimate',
	notes: '',
	classification_system_id: 'class-steel',
	wbs_root_node_id: null,
	applied_template_id: null,
	applied_template_name: null,
	currency_code: null,
	takeoff_items: [
		{
			id: 'item-1',
			estimate_asset_id: 'asset-1',
			parent_id: null,
			wbs_node_id: null,
			cost_code_id: 'cost-steel',
			applied_preset_id: null,
			applied_preset_name: null,
			name: 'Bracket',
			description: '',
			quantity: 1,
			unit: 'ea',
			properties: {},
			sort_order: 0,
			cost_components: [
				{
					id: 'component-1',
					takeoff_item_id: 'item-1',
					category: 'labour',
					source_type: 'labour_rate_card',
					source_id: 'labour-valid',
					name: 'Workshop labour',
					description: '',
					quantity: 1,
					unit: 'hr',
					unit_rate: 95,
					formula: {},
					metadata: {},
					sort_order: 0
				}
			]
		}
	]
};

const basePreset: CostComponentPreset['components'] = [
	{
		category: 'equipment',
		source_type: 'equipment_rate_card',
		source_id: 'equipment-valid',
		name: 'Welder',
		description: '',
		quantity: 1,
		unit: 'hr',
		unit_rate: 40,
		formula: {},
		metadata: {},
		sort_order: 0
	}
];

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

function getServiceInternals(): DbServiceInternals {
	return dbService as unknown as DbServiceInternals;
}

function seedProject(sqlite: TestDatabase): void {
	sqlite
		.prepare(
			`INSERT INTO projects (
				id,
				workspace_id,
				sort_order,
				rfq_number,
				contact_name_snapshot,
				project_name,
				priority,
				status,
				created_at,
				updated_at
			) VALUES ('project-1', 'local-workspace', 0, 'RFQ-1', 'Atlas Steel', 'Project 1', 'Medium', 'draft', '2026-03-11T00:00:00Z', '2026-03-11T00:00:00Z')`
		)
		.run();
}

function seedAsset(sqlite: TestDatabase): void {
	sqlite
		.prepare(
			`INSERT INTO assets (id, project_id, display_name, thumbnail_file_id, is_selected, created_at)
			 VALUES ('asset-1', 'project-1', 'Asset 1', NULL, 1, '2026-03-11T00:00:00Z')`
		)
		.run();
}

function seedClassification(sqlite: TestDatabase): void {
	sqlite
		.prepare(
			`INSERT INTO classification_systems (id, workspace_id, name, code, classification_type, is_default, created_at)
			 VALUES ('class-steel', 'local-workspace', 'Steel Codes', 'STEEL', 'custom', 1, '2026-03-11T00:00:00Z')`
		)
		.run();
	sqlite
		.prepare(
			`INSERT INTO classification_systems (id, workspace_id, name, code, classification_type, is_default, created_at)
			 VALUES ('class-other', 'local-workspace', 'Other Codes', 'OTHER', 'custom', 0, '2026-03-11T00:00:00Z')`
		)
		.run();
	sqlite
		.prepare(
			`INSERT INTO cost_codes (
				id,
				classification_system_id,
				parent_id,
				code,
				name,
				description,
				is_active,
				sort_order,
				created_at
			) VALUES ('cost-steel', 'class-steel', NULL, '100', 'Steel fabrication', '', 1, 0, '2026-03-11T00:00:00Z')`
		)
		.run();
	sqlite
		.prepare(
			`INSERT INTO cost_codes (
				id,
				classification_system_id,
				parent_id,
				code,
				name,
				description,
				is_active,
				sort_order,
				created_at
			) VALUES ('cost-other', 'class-other', NULL, '200', 'Other trade', '', 1, 0, '2026-03-11T00:00:00Z')`
		)
		.run();
}

function seedRateCards(sqlite: TestDatabase): void {
	sqlite
		.prepare(
			`INSERT INTO labour_rate_cards (
				id,
				workspace_id,
				code,
				name,
				category,
				work_center,
				unit,
				default_rate,
				metadata_json,
				is_active,
				created_at,
				updated_at
			) VALUES ('labour-valid', 'local-workspace', NULL, 'Workshop labour', 'fabrication', NULL, 'hr', 95, '{}', 1, '2026-03-11T00:00:00Z', '2026-03-11T00:00:00Z')`
		)
		.run();
	sqlite
		.prepare(
			`INSERT INTO equipment_rate_cards (
				id,
				workspace_id,
				code,
				name,
				category,
				work_center,
				unit,
				default_rate,
				metadata_json,
				is_active,
				created_at,
				updated_at
			) VALUES ('equipment-valid', 'local-workspace', NULL, 'Welder', 'fabrication', NULL, 'hr', 40, '{}', 1, '2026-03-11T00:00:00Z', '2026-03-11T00:00:00Z')`
		)
		.run();
}

describe('dbService estimate integrity', () => {
	let sqlite: TestDatabase;
	let kysely: Kysely<DB>;
	let service: DbServiceInternals;
	let originalInit: unknown;
	let originalGetWorkspaceIdForWrite: unknown;
	let originalGetAssetProjectId: unknown;

	beforeEach(() => {
		({ sqlite, kysely } = createMigratedDatabase());
		service = getServiceInternals();
		originalInit = service.init;
		originalGetWorkspaceIdForWrite = service.getWorkspaceIdForWrite;
		originalGetAssetProjectId = service.getAssetProjectId;
		service.db = {
			execute: vi.fn((sql: string, bindValues?: unknown[]) => {
				sqlite.prepare(sql.replace(/\$\d+/g, '?')).run(...(bindValues ?? []));
			}),
			close: vi.fn()
		};
		service.kysely = kysely;
		service.init = vi.fn(async () => {});
		service.getWorkspaceIdForWrite = vi.fn(async () => 'local-workspace');
		service.getAssetProjectId = vi.fn(async () => 'project-1');

		seedProject(sqlite);
		seedAsset(sqlite);
		seedClassification(sqlite);
		seedRateCards(sqlite);
	});

	afterEach(async () => {
		service.init = originalInit;
		service.getWorkspaceIdForWrite = originalGetWorkspaceIdForWrite;
		service.getAssetProjectId = originalGetAssetProjectId;
		service.db = null;
		service.kysely = null;
		await kysely.destroy();
		sqlite.close();
		vi.clearAllMocks();
	});

	it('rejects saving an estimate when a takeoff item cost code does not belong to the selected classification system', async () => {
		const invalidEstimate: Estimate = {
			...baseEstimate,
			takeoff_items: [
				{
					...baseEstimate.takeoff_items[0],
					cost_code_id: 'cost-other'
				}
			]
		};

		await expect(dbService.saveEstimate('asset-1', invalidEstimate)).rejects.toThrow(
			'Takeoff cost code must belong to the selected classification system'
		);
	});

	it('rolls back the previous saved estimate when rebuilding child rows fails mid-save', async () => {
		await dbService.saveEstimate('asset-1', baseEstimate);

		sqlite.exec(`
			CREATE TRIGGER fail_cost_component_insert
			BEFORE INSERT ON cost_components
			WHEN NEW.id = 'component-fail'
			BEGIN
				SELECT RAISE(ABORT, 'component insert blocked');
			END;
		`);

		const failedEstimate: Estimate = {
			...baseEstimate,
			scope_summary: 'Updated estimate that should roll back',
			takeoff_items: [
				{
					...baseEstimate.takeoff_items[0],
					name: 'Updated bracket',
					cost_components: [
						{
							...baseEstimate.takeoff_items[0].cost_components[0],
							id: 'component-fail',
							name: 'Blocked labour row'
						}
					]
				}
			]
		};

		await expect(dbService.saveEstimate('asset-1', failedEstimate)).rejects.toThrow(
			'component insert blocked'
		);

		const persisted = await dbService.getEstimate('asset-1');
		// Compare all fields except currency_code (first save resolved null -> AUD)
		expect(persisted).toBeTruthy();
		expect(persisted!.asset_id).toBe(baseEstimate.asset_id);
		expect(persisted!.scope_summary).toBe(baseEstimate.scope_summary);
		expect(persisted!.currency_code).toBe('AUD');
	});

	it('sanitises invalid estimate-template references before persisting them', async () => {
		await dbService.addEstimateTemplate('template-1', baseTemplateData, {
			...baseEstimate,
			classification_system_id: 'missing-classification',
			takeoff_items: [
				{
					...baseEstimate.takeoff_items[0],
					cost_code_id: 'missing-cost-code',
					cost_components: [
						{
							...baseEstimate.takeoff_items[0].cost_components[0],
							source_type: 'labour_rate_card',
							source_id: 'missing-rate-card'
						}
					]
				}
			]
		});

		const persisted = await dbService.getEstimateTemplateById('template-1');
		expect(persisted?.estimate.classification_system_id).toBeNull();
		expect(persisted?.estimate.takeoff_items[0]?.cost_code_id).toBeNull();
		expect(persisted?.estimate.takeoff_items[0]?.cost_components[0]).toMatchObject({
			source_type: 'manual',
			source_id: null
		});
	});

	it('preserves valid takeoff preset links when saving estimate templates', async () => {
		await dbService.addCostComponentPreset(
			'preset-1',
			{
				code: 'PRESET-1',
				name: 'Fabrication starter',
				description: '',
				aliases: [],
				is_active: true
			},
			basePreset
		);

		await dbService.addEstimateTemplate('template-1', baseTemplateData, {
			...baseEstimate,
			takeoff_items: [
				{
					...baseEstimate.takeoff_items[0],
					applied_preset_id: 'preset-1',
					applied_preset_name: 'Fabrication starter'
				}
			]
		});

		const persisted = await dbService.getEstimateTemplateById('template-1');
		expect(persisted?.estimate.takeoff_items[0]).toMatchObject({
			applied_preset_id: 'preset-1',
			applied_preset_name: 'Fabrication starter'
		});
	});

	it('strips AI provenance from reusable templates and presets when persisting them', async () => {
		await dbService.addCostComponentPreset(
			'preset-1',
			{
				code: 'PRESET-1',
				name: 'Fabrication starter',
				description: '',
				aliases: [],
				is_active: true
			},
			[
				{
					...basePreset[0],
					metadata: {
						ai_confidence: { overall: 0.6 },
						ai_mapping_status: 'linked',
						ai_evidence_refs: [{ summary: 'legacy preset evidence' }],
						keep: 'preset'
					}
				}
			]
		);

		await dbService.addEstimateTemplate('template-1', baseTemplateData, {
			...baseEstimate,
			takeoff_items: [
				{
					...baseEstimate.takeoff_items[0],
					properties: {
						ai_confidence: { overall: 0.4 },
						ai_open_questions: ['Confirm steel size'],
						keep: 'item'
					},
					cost_components: [
						{
							...baseEstimate.takeoff_items[0].cost_components[0],
							metadata: {
								ai_confidence: { overall: 0.3 },
								ai_mapping_status: 'unresolved',
								ai_evidence_refs: [{ summary: 'legacy template evidence' }],
								keep: 'component'
							}
						}
					]
				}
			]
		});

		const rawTemplate = sqlite
			.prepare('SELECT estimate_json FROM estimate_templates WHERE id = ?')
			.get('template-1') as { estimate_json: string };
		const rawPreset = sqlite
			.prepare('SELECT components_json FROM cost_component_presets WHERE id = ?')
			.get('preset-1') as { components_json: string };

		expect(rawTemplate.estimate_json).not.toContain('ai_confidence');
		expect(rawTemplate.estimate_json).not.toContain('ai_open_questions');
		expect(rawTemplate.estimate_json).not.toContain('ai_evidence_refs');
		expect(rawTemplate.estimate_json).not.toContain('ai_mapping_status');
		expect(rawPreset.components_json).not.toContain('ai_confidence');
		expect(rawPreset.components_json).not.toContain('ai_evidence_refs');
		expect(rawPreset.components_json).not.toContain('ai_mapping_status');

		const persistedTemplate = await dbService.getEstimateTemplateById('template-1');
		const persistedPreset = await dbService.getCostComponentPresetById('preset-1');

		expect(persistedTemplate?.estimate.takeoff_items[0]?.properties).toEqual({ keep: 'item' });
		expect(persistedTemplate?.estimate.takeoff_items[0]?.cost_components[0]?.metadata).toEqual({
			keep: 'component'
		});
		expect(persistedPreset?.components[0]?.metadata).toEqual({ keep: 'preset' });
	});

	it('sanitises invalid preset source links before persisting them', async () => {
		await dbService.addCostComponentPreset(
			'preset-1',
			{
				code: 'PRESET-1',
				name: 'Fabrication starter',
				description: '',
				aliases: [],
				is_active: true
			},
			[
				{
					...basePreset[0],
					source_id: 'missing-equipment-rate'
				}
			]
		);

		const persisted = await dbService.getCostComponentPresetById('preset-1');
		expect(persisted?.components[0]).toMatchObject({
			source_type: 'manual',
			source_id: null
		});
	});

	it('sanitises stale persisted estimate, template, and preset references when they are read back', async () => {
		await dbService.addEstimateTemplate('template-raw', baseTemplateData, {
			...baseEstimate,
			takeoff_items: [
				{
					...baseEstimate.takeoff_items[0],
					applied_preset_id: 'preset-raw',
					applied_preset_name: 'Raw preset',
					cost_components: [
						{
							...baseEstimate.takeoff_items[0].cost_components[0],
							category: 'equipment',
							source_type: 'equipment_rate_card',
							source_id: 'equipment-valid'
						}
					]
				}
			]
		});
		await dbService.addCostComponentPreset(
			'preset-raw',
			{
				code: 'PRESET-RAW',
				name: 'Raw preset',
				description: '',
				aliases: [],
				is_active: true
			},
			basePreset
		);
		await dbService.addCostComponentPreset(
			'preset-source-raw',
			{
				code: 'PRESET-SOURCE-RAW',
				name: 'Raw source preset',
				description: '',
				aliases: [],
				is_active: true
			},
			basePreset
		);
		await dbService.saveEstimate('asset-1', {
			...baseEstimate,
			applied_template_id: 'template-raw',
			applied_template_name: 'Raw template',
			takeoff_items: [
				{
					...baseEstimate.takeoff_items[0],
					applied_preset_id: 'preset-raw',
					applied_preset_name: 'Raw preset'
				}
			]
		});

		sqlite.pragma('foreign_keys = OFF');
		sqlite.prepare("DELETE FROM classification_systems WHERE id = 'class-steel'").run();
		sqlite.prepare("DELETE FROM cost_codes WHERE id = 'cost-steel'").run();
		sqlite.prepare("DELETE FROM labour_rate_cards WHERE id = 'labour-valid'").run();
		sqlite.prepare("DELETE FROM equipment_rate_cards WHERE id = 'equipment-valid'").run();
		sqlite.prepare("DELETE FROM cost_component_presets WHERE id = 'preset-raw'").run();
		sqlite.pragma('foreign_keys = ON');

		const estimate = await dbService.getEstimate('asset-1');
		const template = await dbService.getEstimateTemplateById('template-raw');
		const preset = await dbService.getCostComponentPresetById('preset-source-raw');

		expect(estimate?.classification_system_id).toBeNull();
		expect(estimate?.takeoff_items[0]).toMatchObject({
			cost_code_id: null,
			applied_preset_id: null,
			applied_preset_name: null
		});
		expect(estimate?.takeoff_items[0]?.cost_components[0]).toMatchObject({
			source_type: 'manual',
			source_id: null
		});
		expect(template?.estimate.classification_system_id).toBeNull();
		expect(template?.estimate.takeoff_items[0]).toMatchObject({
			cost_code_id: null,
			applied_preset_id: null,
			applied_preset_name: null
		});
		expect(template?.estimate.takeoff_items[0]?.cost_components[0]).toMatchObject({
			source_type: 'manual',
			source_id: null
		});
		expect(preset?.components[0]).toMatchObject({
			source_type: 'manual',
			source_id: null
		});
	});

	it('strips legacy AI provenance from saved templates and presets when they are read back', async () => {
		await dbService.addEstimateTemplate('template-raw', baseTemplateData, baseEstimate);
		await dbService.addCostComponentPreset(
			'preset-raw',
			{
				code: 'PRESET-RAW',
				name: 'Raw preset',
				description: '',
				aliases: [],
				is_active: true
			},
			basePreset
		);

		sqlite
			.prepare(
				`UPDATE estimate_templates
				 SET estimate_json = json_set(
					estimate_json,
					'$.takeoff_items[0].properties.ai_confidence',
					json('{"overall":0.2}'),
					'$.takeoff_items[0].properties.ai_open_questions',
					json('["Confirm quantity"]'),
					'$.takeoff_items[0].properties.keep',
					'item',
					'$.takeoff_items[0].cost_components[0].metadata.ai_mapping_status',
					'unresolved',
					'$.takeoff_items[0].cost_components[0].metadata.ai_evidence_refs',
					json('[{"summary":"legacy"}]'),
					'$.takeoff_items[0].cost_components[0].metadata.keep',
					'component'
				 )
				 WHERE id = 'template-raw'`
			)
			.run();
		sqlite
			.prepare(
				`UPDATE cost_component_presets
				 SET components_json = json_set(
					components_json,
					'$[0].metadata.ai_confidence',
					json('{"overall":0.4}'),
					'$[0].metadata.ai_mapping_status',
					'linked',
					'$[0].metadata.keep',
					'preset'
				 )
				 WHERE id = 'preset-raw'`
			)
			.run();

		const template = await dbService.getEstimateTemplateById('template-raw');
		const preset = await dbService.getCostComponentPresetById('preset-raw');

		expect(template?.estimate.takeoff_items[0]?.properties).toEqual({ keep: 'item' });
		expect(template?.estimate.takeoff_items[0]?.cost_components[0]?.metadata).toEqual({
			keep: 'component'
		});
		expect(preset?.components[0]?.metadata).toEqual({ keep: 'preset' });
	});

	it('clears persisted estimate references when linked catalogues, presets, templates, or codes are deleted', async () => {
		await dbService.addEstimateTemplate('template-1', baseTemplateData, baseEstimate);
		await dbService.addCostComponentPreset(
			'preset-1',
			{
				code: 'PRESET-1',
				name: 'Fabrication starter',
				description: '',
				aliases: [],
				is_active: true
			},
			basePreset
		);
		await dbService.saveEstimate('asset-1', {
			...baseEstimate,
			applied_template_id: 'template-1',
			applied_template_name: 'Starter estimate',
			takeoff_items: [
				{
					...baseEstimate.takeoff_items[0],
					applied_preset_id: 'preset-1',
					applied_preset_name: 'Fabrication starter'
				}
			]
		});

		await dbService.deleteCostCode('cost-steel');
		await dbService.deleteLabourRateCard('labour-valid');
		await dbService.deleteCostComponentPreset('preset-1');
		await dbService.deleteEstimateTemplate('template-1');

		const estimateRow = sqlite
			.prepare(
				'SELECT classification_system_id, applied_template_id, applied_template_name FROM estimates WHERE asset_id = ?'
			)
			.get('asset-1') as
			| {
					classification_system_id: string | null;
					applied_template_id: string | null;
					applied_template_name: string | null;
			  }
			| undefined;
		const takeoffRow = sqlite
			.prepare(
				'SELECT cost_code_id, applied_preset_id, applied_preset_name FROM takeoff_items WHERE id = ?'
			)
			.get('item-1') as
			| {
					cost_code_id: string | null;
					applied_preset_id: string | null;
					applied_preset_name: string | null;
			  }
			| undefined;
		const componentRow = sqlite
			.prepare('SELECT source_type, source_id FROM cost_components WHERE id = ?')
			.get('component-1') as
			| {
					source_type: string;
					source_id: string | null;
			  }
			| undefined;

		expect(estimateRow).toMatchObject({
			applied_template_id: null,
			applied_template_name: null
		});
		expect(takeoffRow).toMatchObject({
			cost_code_id: null,
			applied_preset_id: null,
			applied_preset_name: null
		});
		expect(componentRow).toMatchObject({
			source_type: 'manual',
			source_id: null
		});
	});

	it('persists child takeoff items after their parents even when the payload order is reversed', async () => {
		const nestedEstimate: Estimate = {
			...baseEstimate,
			takeoff_items: [
				{
					id: 'item-child',
					estimate_asset_id: 'asset-1',
					parent_id: 'item-parent',
					wbs_node_id: null,
					cost_code_id: 'cost-steel',
					applied_preset_id: null,
					applied_preset_name: null,
					name: 'Child operation',
					description: '',
					quantity: 2,
					unit: 'ea',
					properties: {},
					sort_order: 1,
					cost_components: []
				},
				{
					id: 'item-parent',
					estimate_asset_id: 'asset-1',
					parent_id: null,
					wbs_node_id: null,
					cost_code_id: 'cost-steel',
					applied_preset_id: null,
					applied_preset_name: null,
					name: 'Parent assembly',
					description: '',
					quantity: 1,
					unit: 'ea',
					properties: {},
					sort_order: 0,
					cost_components: []
				}
			]
		};

		await expect(dbService.saveEstimate('asset-1', nestedEstimate)).resolves.toBeUndefined();

		const persistedRows = sqlite
			.prepare('SELECT id, parent_id, sort_order FROM takeoff_items WHERE estimate_asset_id = ?')
			.all('asset-1') as Array<{
			id: string;
			parent_id: string | null;
			sort_order: number;
		}>;

		expect(persistedRows).toEqual(
			expect.arrayContaining([
				{ id: 'item-parent', parent_id: null, sort_order: 1 },
				{ id: 'item-child', parent_id: 'item-parent', sort_order: 0 }
			])
		);

		const persistedEstimate = await dbService.getEstimate('asset-1');
		expect(persistedEstimate?.takeoff_items.map((item) => item.id)).toEqual([
			'item-child',
			'item-parent'
		]);
	});
});
