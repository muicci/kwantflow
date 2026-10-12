import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, '../../../src-tauri/migrations-workspace');
const workspaceMigrations = fs
	.readdirSync(migrationsDir)
	.filter((file) => file === '001_workspace.sql')
	.sort();

function createWorkspaceDatabase(migrations = workspaceMigrations) {
	const db = new Database(':memory:') as {
		pragma: (statement: string) => void;
		exec: (sql: string) => unknown;
		prepare: (sql: string) => {
			all: () => unknown[];
		};
	};
	db.pragma('foreign_keys = ON');
	for (const migration of migrations) {
		db.exec(fs.readFileSync(path.join(migrationsDir, migration), 'utf8'));
	}
	return db;
}

describe('workspace database schema', () => {
	it('creates only workspace-scoped operational tables and structured workspace name columns', () => {
		const db = createWorkspaceDatabase();
		const tables = db
			.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
			.all() as Array<{ name: string }>;
		const workspaceProfileColumns = db
			.prepare(`PRAGMA table_info(workspace_profile)`)
			.all() as Array<{ name: string }>;
		const workspaceMemberColumns = db
			.prepare(`PRAGMA table_info(workspace_members)`)
			.all() as Array<{ name: string }>;
		const projectColumns = db.prepare(`PRAGMA table_info(projects)`).all() as Array<{
			name: string;
		}>;
		const fileColumns = db.prepare(`PRAGMA table_info(files)`).all() as Array<{ name: string }>;
		const materialColumns = db.prepare(`PRAGMA table_info(material_catalog_items)`).all() as Array<{
			name: string;
		}>;
		const quoteRevisionColumns = db.prepare(`PRAGMA table_info(quote_revisions)`).all() as Array<{
			name: string;
		}>;

		expect(tables.map((table) => table.name)).toEqual(
			expect.arrayContaining([
				'workspace_identity',
				'workspace_profile',
				'workspace_onboarding_profile',
				'workspace_members',
				'contacts',
				'contact_relationships',
				'projects',
				'files',
				'assets',
				'estimates',
				'takeoff_items',
				'cost_components',
				'material_catalog_items',
				'labour_rate_cards',
				'equipment_rate_cards',
				'subcontract_rate_cards',
				'classification_systems',
				'cost_codes',
				'cost_component_presets',
				'estimate_templates',
				'quote_option_presets',
				'project_structure_templates',
				'project_structure_template_nodes',
				'quote_options',
				'quote_revisions',
				'quote_revision_options',
				'ai_runs',
				'ai_run_inputs',
				'ai_run_outputs',
				'ai_evidence_cache',
				'ai_evidence_refs',
				'ai_review_events',
				'ai_override_events',
				'workspace_ai_knowledge_files',
				'workspace_ai_feedback_entries',
				'runtime_contract_state'
			])
		);

		expect(workspaceProfileColumns.map((column) => column.name)).toEqual(
			expect.arrayContaining([
				'business_contact_name',
				'business_contact_first_name',
				'business_contact_last_name',
				'quote_payment_terms',
				'quote_validity_days',
				'quote_default_inclusions',
				'quote_default_exclusions',
				'quote_default_terms',
				'quote_number_prefix',
				'quote_number_format'
			])
		);
		expect(workspaceMemberColumns.map((column) => column.name)).toEqual(
			expect.arrayContaining(['display_name', 'first_name', 'last_name', 'email'])
		);
		expect(projectColumns.map((column) => column.name)).toEqual(
			expect.arrayContaining([
				'received_date',
				'submission_deadline_at',
				'estimator_name',
				'customer_tender_reference',
				'addendum_label',
				'addendum_date',
				'addendum_notes',
				'site_address',
				'delivery_address'
			])
		);
		expect(fileColumns.map((column) => column.name)).toEqual(
			expect.arrayContaining([
				'byte_size',
				'content_hash',
				'checksum_algorithm',
				'document_type',
				'revision_label',
				'received_at',
				'source_label',
				'source_metadata_json'
			])
		);
		expect(materialColumns.map((column) => column.name)).toEqual(
			expect.arrayContaining([
				'effective_date',
				'verified_date',
				'rate_basis',
				'lead_time',
				'availability',
				'reference'
			])
		);
		expect(quoteRevisionColumns.map((column) => column.name)).toEqual(
			expect.arrayContaining([
				'sent_status',
				'sent_date',
				'sent_method',
				'recipient_snapshot_json',
				'terms_snapshot_json'
			])
		);
	});

	it('cascades reusable AI evidence cache rows with their source file', () => {
		const db = createWorkspaceDatabase();
		db.exec(`
			INSERT INTO workspace_identity (id) VALUES ('workspace-1');
			INSERT INTO projects (id, workspace_id, rfq_number)
			VALUES ('project-1', 'workspace-1', 'RFQ-1');
			INSERT INTO files (id, project_id, file_path, original_name)
			VALUES ('file-1', 'project-1', 'workspace/project-1/spec.pdf', 'spec.pdf');
			INSERT INTO ai_evidence_cache (
				id, file_id, cache_kind, source_content_hash, evidence_unit_key,
				evidence_unit_hash, preparation_version, extraction_version,
				synthesis_version, model_runtime_id, payload_json
			) VALUES (
				'cache-1', 'file-1', 'unit_extraction', 'source-hash', 'pdf:page:1',
				'unit-hash', 'prepare-v1', 'extract-v1', '', 'gemma-test', '{}'
			);
			DELETE FROM files WHERE id = 'file-1';
		`);

		const rows = db.prepare('SELECT id FROM ai_evidence_cache').all();
		expect(rows).toEqual([]);
	});

	it('scopes contact name uniqueness by company and company-linked people for fresh workspace databases', () => {
		const db = createWorkspaceDatabase();

		const indexes = db.prepare(`PRAGMA index_list(contacts)`).all() as Array<{ name: string }>;
		expect(indexes.map((index) => index.name)).toEqual(
			expect.arrayContaining([
				'idx_contacts_workspace_company_name_unique',
				'idx_contacts_workspace_person_company_name_unique'
			])
		);
		expect(indexes.map((index) => index.name)).not.toContain('idx_contacts_workspace_name_unique');

		db.exec(`
			INSERT INTO workspace_identity (id, onboarding_version, workspace_role)
			VALUES ('local-workspace', 1, 'owner');
			INSERT INTO contacts (id, workspace_id, sort_order, kind, display_name, name, company_name, country_code)
			VALUES ('company-1', 'local-workspace', 1, 'company', 'Test Test', 'Test Test', 'Test Test', 'AU');
			INSERT INTO contacts (id, workspace_id, sort_order, kind, display_name, name, linked_company_id, country_code)
			VALUES ('person-1', 'local-workspace', 2, 'person', 'Test Test', 'Test Test', 'company-1', 'AU');
			INSERT INTO contacts (id, workspace_id, sort_order, kind, display_name, name, company_name, country_code)
			VALUES ('company-2', 'local-workspace', 3, 'company', 'Other Co', 'Other Co', 'Other Co', 'AU');
			INSERT INTO contacts (id, workspace_id, sort_order, kind, display_name, name, linked_company_id, country_code)
			VALUES ('person-2', 'local-workspace', 4, 'person', 'Test Test', 'Test Test', 'company-2', 'AU');
		`);

		expect(() =>
			db.exec(`
				INSERT INTO contacts (id, workspace_id, sort_order, kind, display_name, name, company_name, country_code)
				VALUES ('company-duplicate', 'local-workspace', 5, 'company', 'test test', 'test test', 'test test', 'AU');
			`)
		).toThrow();
		expect(() =>
			db.exec(`
				INSERT INTO contacts (id, workspace_id, sort_order, kind, display_name, name, linked_company_id, country_code)
				VALUES ('person-duplicate', 'local-workspace', 6, 'person', 'test test', 'test test', 'company-1', 'AU');
			`)
		).toThrow();
	});
});
