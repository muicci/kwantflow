import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, '../../../src-tauri/migrations-control');
function createControlDatabase() {
	const db = new Database(':memory:');
	db.pragma('foreign_keys = ON');
	db.exec(fs.readFileSync(path.join(migrationsDir, '001_control.sql'), 'utf8'));
	return db;
}

describe('control database schema', () => {
	it('creates the machine-level control tables and structured profile name columns', () => {
		const db = createControlDatabase();

		const tables = db
			.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
			.all() as Array<{ name: string }>;
		const profileColumns = db.prepare(`PRAGMA table_info(profile_identity)`).all() as Array<{
			name: string;
		}>;

		expect(tables.map((table) => table.name)).toEqual([
			'control_contract_state',
			'control_customer_identity',
			'onboarding_state',
			'profile_identity',
			'workspace_registry'
		]);
		expect(tables.map((table) => table.name)).not.toContain('local_ai_install_state');
		expect(tables.map((table) => table.name)).not.toContain('account_auth_session');
		expect(profileColumns.map((column) => column.name)).toEqual(
			expect.arrayContaining(['display_name', 'first_name', 'last_name', 'email', 'phone'])
		);
		expect(db.prepare('SELECT schema_version FROM control_contract_state').pluck().get()).toBe(2);
		expect(db.prepare('PRAGMA quick_check').pluck().get()).toBe('ok');
		expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
		db.close();
	});
});
