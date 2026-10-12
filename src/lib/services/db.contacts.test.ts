import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import BetterSqlite3 from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContactFormValues } from '$lib/schemas/index.js';
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

type MockPluginSqlDb = {
	select: (sql: string, params?: unknown[]) => Promise<unknown[]>;
	close: ReturnType<typeof vi.fn>;
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

function getServiceInternals(): DbServiceInternals {
	return dbService as unknown as DbServiceInternals;
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

function insertCompanyContact(sqlite: TestDatabase, id: string): void {
	sqlite
		.prepare(
			`INSERT INTO contacts (
				id,
				workspace_id,
				sort_order,
				kind,
				display_name,
				name,
				company_name,
				country_code,
				roles_json,
				tags_json,
				is_active,
				created_at,
				updated_at
			) VALUES (?, 'local-workspace', 0, 'company', 'Atlas Steel', 'Atlas Steel', 'Atlas Steel', 'AU', '["customer"]', '[]', 1, '2026-03-25T00:00:00Z', '2026-03-25T00:00:00Z')`
		)
		.run(id);
}

const basePersonContact: ContactFormValues = {
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
	phone: '+61 400 000 000',
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

describe('dbService contacts relationship sync', () => {
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
		service.db = { close: vi.fn() };
		service.kysely = kysely;
		service.init = vi.fn(async () => {});
		service.getWorkspaceIdForWrite = vi.fn(async () => 'local-workspace');
		insertCompanyContact(sqlite, 'company-atlas');
	});

	afterEach(async () => {
		service.init = originalInit;
		service.getWorkspaceIdForWrite = originalGetWorkspaceIdForWrite;
		service.db = null;
		service.kysely = null;
		await kysely.destroy();
		sqlite.close();
		vi.clearAllMocks();
	});

	it('creates relationship rows when a person contact is linked to a company', async () => {
		await dbService.addContact('person-mia', basePersonContact);

		const rows = sqlite
			.prepare(
				`SELECT relationship_type, from_contact_id, to_contact_id, is_primary
				FROM contact_relationships
				ORDER BY relationship_type`
			)
			.all() as Array<{
			relationship_type: string;
			from_contact_id: string;
			to_contact_id: string;
			is_primary: number;
		}>;

		expect(rows).toEqual([
			{
				relationship_type: 'primary_contact_for',
				from_contact_id: 'person-mia',
				to_contact_id: 'company-atlas',
				is_primary: 1
			},
			{
				relationship_type: 'works_for',
				from_contact_id: 'person-mia',
				to_contact_id: 'company-atlas',
				is_primary: 1
			}
		]);
	});

	it('removes relationship rows when the linked company is cleared', async () => {
		await dbService.addContact('person-mia', basePersonContact);
		await dbService.updateContact('person-mia', {
			...basePersonContact,
			linked_company_id: '',
			is_primary_company_contact: false
		});

		const rows = sqlite
			.prepare(
				`SELECT relationship_type
				FROM contact_relationships
				WHERE from_contact_id = 'person-mia'`
			)
			.all();

		expect(rows).toEqual([]);
	});

	it('rolls back the contact row when relationship sync fails during create', async () => {
		sqlite.exec(`
			CREATE TRIGGER fail_contact_relationship_insert
			BEFORE INSERT ON contact_relationships
			BEGIN
				SELECT RAISE(ABORT, 'relationship sync failed');
			END;
		`);

		await expect(dbService.addContact('person-fail', basePersonContact)).rejects.toThrow(
			'relationship sync failed'
		);

		const row = sqlite.prepare(`SELECT id FROM contacts WHERE id = 'person-fail'`).get() as
			{ id: string } | undefined;
		expect(row).toBeUndefined();
	});

	it('rolls back contact updates when relationship sync fails during update', async () => {
		await dbService.addContact('person-update-fail', {
			...basePersonContact,
			linked_company_id: '',
			is_primary_company_contact: false
		});

		sqlite.exec(`
			CREATE TRIGGER fail_contact_relationship_insert_on_update
			BEFORE INSERT ON contact_relationships
			WHEN NEW.from_contact_id = 'person-update-fail'
			BEGIN
				SELECT RAISE(ABORT, 'relationship update failed');
			END;
		`);

		await expect(dbService.updateContact('person-update-fail', basePersonContact)).rejects.toThrow(
			'relationship update failed'
		);

		const row = sqlite
			.prepare(
				`SELECT linked_company_id, is_primary_company_contact
				FROM contacts
				WHERE id = 'person-update-fail'`
			)
			.get() as {
			linked_company_id: string | null;
			is_primary_company_contact: number;
		};

		expect(row).toEqual({
			linked_company_id: null,
			is_primary_company_contact: 0
		});

		const relationships = sqlite
			.prepare(
				`SELECT relationship_type
				FROM contact_relationships
				WHERE from_contact_id = 'person-update-fail'`
			)
			.all();
		expect(relationships).toEqual([]);
	});

	it('removes relationship rows and nulls linked project contact references when contacts are deleted', async () => {
		await dbService.addContact('person-mia', basePersonContact);
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
			'Contact cleanup',
			'person-mia',
			'Mia Collins'
		);

		await dbService.deleteContact('person-mia');

		const requesterRow = sqlite
			.prepare(`SELECT requester_contact_id FROM projects WHERE id = 'project-1'`)
			.get() as { requester_contact_id: string | null } | undefined;
		const relationshipRowsAfterPersonDelete = sqlite
			.prepare(`SELECT id FROM contact_relationships WHERE from_contact_id = 'person-mia'`)
			.all();

		expect(requesterRow?.requester_contact_id).toBeNull();
		expect(relationshipRowsAfterPersonDelete).toEqual([]);

		await dbService.deleteContact('company-atlas');

		const companyLinkRow = sqlite
			.prepare(`SELECT contact_id FROM projects WHERE id = 'project-1'`)
			.get() as { contact_id: string | null } | undefined;
		expect(companyLinkRow?.contact_id).toBeNull();
	});

	it('persists company logo file paths on company contacts', async () => {
		await dbService.addContact('company-logo', {
			...basePersonContact,
			kind: 'company',
			display_name: 'Beacon Engineering',
			name: 'Beacon Engineering',
			company_name: 'Beacon Engineering',
			person_first_name: '',
			person_last_name: '',
			linked_company_id: '',
			is_primary_company_contact: false,
			contact_name: 'Mia Collins',
			website: 'https://beacon.example',
			logo_file_path: 'companies/company-logo/logo.png',
			custom_role_label: 'Fabricator'
		});

		const row = sqlite
			.prepare(
				`SELECT website, logo_file_path, custom_role_label FROM contacts WHERE id = 'company-logo'`
			)
			.get() as {
			website: string | null;
			logo_file_path: string | null;
			custom_role_label: string | null;
		};

		expect(row.website).toBe('https://beacon.example');
		expect(row.logo_file_path).toBe('companies/company-logo/logo.png');
		expect(row.custom_role_label).toBe('Fabricator');
	});

	it('clears company-only metadata when saving person contacts', async () => {
		await dbService.addContact('person-clean', {
			...basePersonContact,
			company_name: 'Atlas Steel',
			contact_name: 'Legacy Contact',
			abn: '12345678901',
			business_id_value: '12345678901',
			tax_id_value: 'GST-1',
			website: 'https://atlas.example',
			address: '123 Steel Street',
			notes: 'Legacy company notes',
			logo_file_path: 'companies/company-atlas/logo.png',
			custom_role_label: 'Fabricator',
			tags: ['vip']
		});

		const row = sqlite
			.prepare(
				`SELECT
					company_name,
					contact_name,
					abn,
					business_id_value,
					tax_id_value,
					website,
					address,
					notes,
					logo_file_path,
					custom_role_label,
					tags_json
				FROM contacts
				WHERE id = 'person-clean'`
			)
			.get() as {
			company_name: string | null;
			contact_name: string | null;
			abn: string | null;
			business_id_value: string | null;
			tax_id_value: string | null;
			website: string | null;
			address: string | null;
			notes: string | null;
			logo_file_path: string | null;
			custom_role_label: string | null;
			tags_json: string;
		};

		expect(row).toEqual({
			company_name: null,
			contact_name: null,
			abn: null,
			business_id_value: null,
			tax_id_value: null,
			website: null,
			address: null,
			notes: null,
			logo_file_path: null,
			custom_role_label: null,
			tags_json: '[]'
		});
	});
});

describe('dbService contacts read mapping', () => {
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
		insertCompanyContact(sqlite, 'company-atlas');
	});

	afterEach(async () => {
		service.init = originalInit;
		service.getWorkspaceIdForWrite = originalGetWorkspaceIdForWrite;
		service.db = null;
		service.kysely = null;
		await kysely.destroy();
		sqlite.close();
		vi.clearAllMocks();
	});

	it('maps SQLite contact rows into domain contacts when fetching the full list', async () => {
		const contacts = await dbService.getContacts();

		expect(contacts).toHaveLength(1);
		expect(contacts[0]).toMatchObject({
			id: 'company-atlas',
			kind: 'company',
			display_name: 'Atlas Steel',
			name: 'Atlas Steel',
			roles: ['customer'],
			tags: [],
			is_active: true
		});
	});

	it('maps SQLite contact rows into domain contacts when fetching by id', async () => {
		const contact = await dbService.getContactById('company-atlas');

		expect(contact).not.toBeNull();
		expect(contact).toMatchObject({
			id: 'company-atlas',
			kind: 'company',
			display_name: 'Atlas Steel',
			roles: ['customer'],
			tags: []
		});
	});
});
