import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import BetterSqlite3 from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateQuoteRevisionInput } from '$lib/types/index.js';
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

describe('dbService quote revision persistence', () => {
	let sqlite: TestDatabase;
	let kysely: Kysely<DB>;
	let service: DbServiceInternals;
	let originalInit: unknown;

	beforeEach(() => {
		({ sqlite, kysely } = createMigratedDatabase());
		service = getServiceInternals();
		originalInit = service.init;
		service.db = {
			execute: vi.fn(),
			close: vi.fn()
		};
		service.kysely = kysely;
		service.init = vi.fn(async () => {});

		seedProject(sqlite);
	});

	afterEach(async () => {
		service.init = originalInit;
		service.db = null;
		service.kysely = null;
		await kysely.destroy();
		sqlite.close();
		vi.clearAllMocks();
	});

	it('suppresses AU contact and business tax-id snapshots even when legacy values are provided', async () => {
		const input: CreateQuoteRevisionInput = {
			project_id: 'project-1',
			rfq_number: 'RFQ-1002',
			contact_name: 'Acme Fabrication Pty Ltd',
			contact: {
				countryCode: null,
				businessIdLabel: 'ABN',
				businessIdValue: 'CUST-001',
				taxIdLabel: 'GST',
				taxIdValue: '51 123 456 789'
			},
			project_name: 'Factory upgrade',
			business: {
				name: 'Bangkok Pty Ltd',
				countryCode: 'AU',
				businessIdLabel: 'ABN',
				businessIdValue: '12 345 678 901',
				taxIdLabel: 'GST',
				taxIdValue: '11 222 333 444',
				taxDisplayLabel: 'GST',
				taxRatePercentage: 10,
				address: '14 Foundry Road',
				contactName: 'Harry Potter',
				contactEmail: 'quotes@example.test',
				contactPhone: '+61 400 000 000',
				currency_code: 'AUD',
				currency_symbol: '$'
			},
			issued_date: '28/03/2026',
			valid_until_date: '27/04/2026',
			options: []
		};

		await dbService.createQuoteRevision(input);

		const row = sqlite
			.prepare(
				`SELECT
					contact_country_code_snapshot,
					contact_tax_id_label_snapshot,
					contact_tax_id_value_snapshot,
					tax_id_label_snapshot,
					tax_id_value_snapshot
				FROM quote_revisions
				WHERE project_id = ?`
			)
			.get('project-1') as
			| {
					contact_country_code_snapshot: string | null;
					contact_tax_id_label_snapshot: string | null;
					contact_tax_id_value_snapshot: string | null;
					tax_id_label_snapshot: string | null;
					tax_id_value_snapshot: string | null;
			  }
			| undefined;

		expect(row).toMatchObject({
			contact_country_code_snapshot: 'AU',
			contact_tax_id_label_snapshot: null,
			contact_tax_id_value_snapshot: null,
			tax_id_label_snapshot: null,
			tax_id_value_snapshot: null
		});
	});
});
