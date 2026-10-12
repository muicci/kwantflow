import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, '../../..');
const controlBaseline = path.join(appRoot, 'src-tauri/migrations-control/001_control.sql');
const workspaceBaseline = path.join(appRoot, 'src-tauri/migrations-workspace/001_workspace.sql');

function applyBaseline(filePath: string) {
	const db = new Database(':memory:');
	db.pragma('foreign_keys = ON');
	db.exec(fs.readFileSync(filePath, 'utf8'));
	return db;
}

function applyControlSchema() {
	return applyBaseline(controlBaseline);
}

type TestDb = ReturnType<typeof applyBaseline>;

function tableNames(db: TestDb) {
	return db
		.prepare(
			`SELECT name FROM sqlite_master
			 WHERE type = 'table'
			   AND name NOT LIKE 'sqlite_%'
			 ORDER BY name`
		)
		.all()
		.map((row: unknown) => (row as { name: string }).name);
}

function columnNames(db: TestDb, table: string) {
	return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
		(column) => column.name
	);
}

function assertHealthy(db: TestDb) {
	expect(db.prepare('PRAGMA quick_check').pluck().get()).toBe('ok');
	expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
}

describe('clean SQLite baselines', () => {
	it('keeps control and workspace table ownership disjoint', () => {
		const control = applyBaseline(controlBaseline);
		const workspace = applyBaseline(workspaceBaseline);

		expect(tableNames(control)).toEqual([
			'control_contract_state',
			'control_customer_identity',
			'onboarding_state',
			'profile_identity',
			'workspace_registry'
		]);
		expect(tableNames(workspace)).toEqual(
			expect.arrayContaining([
				'workspace_identity',
				'workspace_profile',
				'workspace_members',
				'workspace_integrations',
				'email_rfq_classifications',
				'contacts',
				'material_catalog_items',
				'labour_rate_cards',
				'equipment_rate_cards',
				'subcontract_rate_cards',
				'projects',
				'estimates',
				'quote_options',
				'assets',
				'ai_evidence_cache',
				'wbs_nodes'
			])
		);

		for (const forbidden of [
			'account_identity',
			'account_auth_session',
			'auth_audit_events',
			'customer_identity',
			'control_customer_identity',
			'account_entitlement_cache',
			'workspace_registry'
		]) {
			expect(tableNames(workspace)).not.toContain(forbidden);
		}
		for (const forbidden of ['projects', 'contacts', 'material_catalog_items', 'estimates']) {
			expect(tableNames(control)).not.toContain(forbidden);
		}

		assertHealthy(control);
		assertHealthy(workspace);
		control.close();
		workspace.close();
	});

	it('keeps core workspace records scoped and searchable', () => {
		const db = applyBaseline(workspaceBaseline);

		for (const table of [
			'projects',
			'contacts',
			'material_catalog_items',
			'labour_rate_cards',
			'equipment_rate_cards',
			'subcontract_rate_cards',
			'workspace_integrations'
		]) {
			expect(columnNames(db, table)).toContain('workspace_id');
		}
		expect(columnNames(db, 'email_rfq_classifications')).toEqual(
			expect.arrayContaining(['integration_id', 'provider_message_id', 'classifier_version'])
		);

		const contactIndexes = (
			db.prepare('PRAGMA index_list(contacts)').all() as Array<{ name: string }>
		).map((index) => index.name);
		expect(contactIndexes).toContain('idx_contacts_workspace_company_name_unique');
		expect(contactIndexes).toContain('idx_contacts_workspace_person_company_name_unique');

		const materialColumns = columnNames(db, 'material_catalog_items');
		expect(materialColumns).toEqual(
			expect.arrayContaining(['default_rate', 'currency_code', 'rate_basis', 'unit'])
		);
		expect(materialColumns).not.toContain('contact_id');
		expect(columnNames(db, 'subcontract_rate_cards')).not.toContain('supplier_name');

		for (const table of [
			'company_material_links',
			'company_labour_rate_links',
			'company_equipment_rate_links',
			'company_subcontract_rate_links'
		]) {
			expect(tableNames(db)).toContain(table);
		}

		assertHealthy(db);
		db.close();
	});

	it('keeps setup import audit metadata workspace-scoped and content-free', () => {
		const db = applyBaseline(workspaceBaseline);

		expect(columnNames(db, 'setup_import_audit')).toEqual([
			'id',
			'workspace_id',
			'source_file_name',
			'source_content_hash',
			'imported_sheet_ids_json',
			'duplicate_modes_json',
			'created_count',
			'updated_count',
			'skipped_count',
			'failure_summary',
			'created_at'
		]);
		expect(columnNames(db, 'setup_import_audit')).not.toContain('workbook_content');

		assertHealthy(db);
		db.close();
	});

	it('keeps local identity without hosted account or entitlement state', () => {
		const db = applyControlSchema();

		expect(columnNames(db, 'control_customer_identity')).not.toContain('plan_state');
		for (const table of [
			'account_entitlement_cache',
			'install_identity',
			'background_maintenance_state'
		]) {
			expect(tableNames(db)).not.toContain(table);
		}
		db.exec("INSERT INTO onboarding_state (id) VALUES ('primary-onboarding')");
		expect(db.prepare('SELECT current_step FROM onboarding_state').pluck().get()).toBe(
			'workspace_setup'
		);
		expect(() => db.exec("UPDATE onboarding_state SET current_step = 'account_link'")).toThrow();

		assertHealthy(db);
		db.close();
	});

	it('supports multiple companies per catalogue record with cascading links', () => {
		const db = applyBaseline(workspaceBaseline);
		db.exec(`
			INSERT INTO workspace_identity (id, bootstrap_completed_at, onboarding_version)
			VALUES ('workspace-1', '2026-01-01T00:00:00.000Z', 1);
			INSERT INTO contacts (id, workspace_id, name, kind, display_name)
			VALUES
				('company-1', 'workspace-1', 'Supplier One', 'company', 'Supplier One'),
				('company-2', 'workspace-1', 'Supplier Two', 'company', 'Supplier Two');
			INSERT INTO material_catalog_items (id, workspace_id, name, unit)
			VALUES ('material-1', 'workspace-1', 'Steel Plate', 'kg');
			INSERT INTO company_material_links (company_id, material_id)
			VALUES ('company-1', 'material-1'), ('company-2', 'material-1');
		`);

		expect(
			db
				.prepare('SELECT COUNT(*) FROM company_material_links WHERE material_id = ?')
				.pluck()
				.get('material-1')
		).toBe(2);
		db.prepare('DELETE FROM contacts WHERE id = ?').run('company-1');
		expect(db.prepare('SELECT COUNT(*) FROM material_catalog_items').pluck().get()).toBe(1);
		expect(db.prepare('SELECT COUNT(*) FROM company_material_links').pluck().get()).toBe(1);
		db.prepare('DELETE FROM material_catalog_items WHERE id = ?').run('material-1');
		expect(db.prepare('SELECT COUNT(*) FROM company_material_links').pluck().get()).toBe(0);
		assertHealthy(db);
		db.close();
	});

	it('keeps project files when an asset is deleted while cascading estimate-owned rows', () => {
		const db = applyBaseline(workspaceBaseline);
		db.exec(`
			INSERT INTO workspace_identity (id, bootstrap_completed_at, onboarding_version)
			VALUES ('workspace-1', '2026-01-01T00:00:00.000Z', 1);
			INSERT INTO projects (id, workspace_id, rfq_number, project_name)
			VALUES ('project-1', 'workspace-1', 'RFQ-1', 'Project One');
			INSERT INTO assets (id, project_id, display_name)
			VALUES ('asset-1', 'project-1', 'Asset One');
			INSERT INTO files (id, project_id, asset_id, file_path, original_name)
			VALUES ('file-1', 'project-1', 'asset-1', 'workspace/project-1/file.pdf', 'file.pdf');
			INSERT INTO estimates (asset_id, scope_summary)
			VALUES ('asset-1', 'Scope');
			INSERT INTO takeoff_items (id, estimate_asset_id, name, quantity, unit)
			VALUES ('takeoff-1', 'asset-1', 'Plate', 1, 'ea');
		`);

		db.prepare('DELETE FROM assets WHERE id = ?').run('asset-1');

		expect(db.prepare('SELECT COUNT(*) FROM files').pluck().get()).toBe(1);
		expect(db.prepare('SELECT asset_id FROM files WHERE id = ?').pluck().get('file-1')).toBeNull();
		expect(db.prepare('SELECT COUNT(*) FROM estimates').pluck().get()).toBe(0);
		expect(db.prepare('SELECT COUNT(*) FROM takeoff_items').pluck().get()).toBe(0);
		assertHealthy(db);
		db.close();
	});
});
