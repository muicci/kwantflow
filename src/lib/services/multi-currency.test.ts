import fs from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { CURRENCY_OPTIONS, SUPPORTED_CURRENCY_CODES } from '$lib/constants/index.js';
import {
	EquipmentRateCardRowSchema,
	EstimateRowSchema,
	LabourRateCardRowSchema,
	MaterialCatalogueItemRowSchema,
	SubcontractRateCardRowSchema,
	equipmentRateCardFormSchema,
	labourRateCardFormSchema,
	materialCatalogItemFormSchema,
	subcontractRateCardFormSchema
} from '$lib/schemas/index.js';
import { WORKSPACE_RUNTIME_SCHEMA } from '$lib/services/db-schema-health.js';
import type { Estimate } from '$lib/types/index.js';
import { cloneEstimateSnapshot } from '$lib/utils/estimate-snapshot.js';

const workspaceBaseline = fs.readFileSync(
	path.resolve(process.cwd(), 'src-tauri/migrations-workspace/001_workspace.sql'),
	'utf8'
);

function createWorkspaceDatabase(): InstanceType<typeof Database> {
	const database = new Database(':memory:');
	database.pragma('foreign_keys = ON');
	database.exec(workspaceBaseline);
	database.exec(`
		INSERT INTO workspace_identity (id) VALUES ('workspace-a');
		INSERT INTO workspace_profile (workspace_id, display_name, currency_code)
		VALUES ('workspace-a', 'Workspace A', 'AUD');
	`);
	return database;
}

describe('multi-currency workspace contract', () => {
	const rateTables = [
		'material_catalog_items',
		'labour_rate_cards',
		'equipment_rate_cards',
		'subcontract_rate_cards'
	] as const;

	it('uses one canonical supported-currency list for UI options', () => {
		expect(new Set(CURRENCY_OPTIONS.map((option) => option.code))).toEqual(
			new Set(SUPPORTED_CURRENCY_CODES)
		);
	});

	it('keeps workspace currency constrained to the canonical list', () => {
		const match = workspaceBaseline.match(
			/CREATE TABLE "workspace_profile"[\s\S]*?currency_code TEXT NOT NULL DEFAULT 'AUD' CHECK \(\s*currency_code IN \(([\s\S]*?)\)\s*\)/
		);
		expect(match).not.toBeNull();
		const codes = [...(match?.[1].matchAll(/'([A-Z]{3})'/g) ?? [])].map((entry) => entry[1]);
		expect(codes).toEqual([...SUPPORTED_CURRENCY_CODES]);
	});

	for (const table of rateTables) {
		it(`${table} exposes currency_code in runtime health`, () => {
			expect(WORKSPACE_RUNTIME_SCHEMA.columns[table]).toContain('currency_code');
		});

		it(`${table} stores an explicit currency in a fresh workspace`, () => {
			const database = createWorkspaceDatabase();
			const tableInfo = database.pragma(`table_info(${table})`) as Array<{ name: string }>;
			expect(tableInfo.map((column) => column.name)).toContain('currency_code');
			database.close();
		});
	}

	const rowSchemas = [
		['materials', MaterialCatalogueItemRowSchema, 'ea', { specification: null }],
		['labour', LabourRateCardRowSchema, 'hr', { work_center: null }],
		['equipment', EquipmentRateCardRowSchema, 'hr', { work_center: null }],
		['subcontract', SubcontractRateCardRowSchema, 'lot', {}]
	] as const;

	for (const [name, schema, unit, extra] of rowSchemas) {
		const base = {
			id: 'rate-1',
			workspace_id: 'workspace-a',
			contact_id: null,
			code: null,
			name: 'Rate',
			category: null,
			unit,
			default_rate: 100,
			aliases_json: '[]',
			metadata_json: '{}',
			rate_basis: 'cost',
			lead_time: '',
			availability: '',
			reference: '',
			is_active: 1,
			created_at: '2026-01-01',
			updated_at: '2026-01-01',
			...extra
		};

		it(`${name} row accepts a supported currency`, () => {
			expect(schema.safeParse({ ...base, currency_code: 'THB' }).success).toBe(true);
		});

		it(`${name} row rejects an unsupported currency`, () => {
			expect(schema.safeParse({ ...base, currency_code: 'XYZ' }).success).toBe(false);
		});
	}

	const formSchemas = [
		['materials', materialCatalogItemFormSchema, 'ea'],
		['labour', labourRateCardFormSchema, 'hr'],
		['equipment', equipmentRateCardFormSchema, 'hr'],
		['subcontract', subcontractRateCardFormSchema, 'lot']
	] as const;

	for (const [name, schema, unit] of formSchemas) {
		it(`${name} form accepts supported or omitted currency`, () => {
			expect(
				schema.safeParse({
					name: 'Rate',
					unit,
					default_rate: 100,
					currency_code: 'THB',
					is_active: true
				}).success
			).toBe(true);
			expect(
				schema.safeParse({ name: 'Rate', unit, default_rate: 100, is_active: true }).success
			).toBe(true);
		});
	}

	it('estimates expose and persist reporting currency', () => {
		expect(WORKSPACE_RUNTIME_SCHEMA.columns.estimates).toContain('currency_code');
		const database = createWorkspaceDatabase();
		const columns = database.pragma('table_info(estimates)') as Array<{ name: string }>;
		expect(columns.map((column) => column.name)).toContain('currency_code');
		database.close();
	});

	it('EstimateRowSchema accepts supported and null reporting currencies', () => {
		const base = {
			asset_id: 'asset-1',
			scope_summary: '',
			notes: '',
			classification_system_id: null,
			wbs_root_node_id: null,
			applied_template_id: null,
			applied_template_name: null,
			created_at: '2026-01-01',
			updated_at: '2026-01-01'
		};
		expect(EstimateRowSchema.safeParse({ ...base, currency_code: 'AUD' }).success).toBe(true);
		expect(EstimateRowSchema.safeParse({ ...base, currency_code: null }).success).toBe(true);
	});

	it('estimate snapshots preserve explicit and null currency', () => {
		const base = {
			asset_id: 'asset-1',
			scope_summary: '',
			notes: '',
			classification_system_id: null,
			wbs_root_node_id: null,
			applied_template_id: null,
			applied_template_name: null,
			takeoff_items: []
		};
		expect(cloneEstimateSnapshot({ ...base, currency_code: 'EUR' } as Estimate).currency_code).toBe(
			'EUR'
		);
		expect(
			cloneEstimateSnapshot({ ...base, currency_code: null } as Estimate).currency_code
		).toBeNull();
	});
});
