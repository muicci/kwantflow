import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { getActiveManifestMigrations, loadMigrationManifest } from './migration-manifest.js';

const repoRoot = resolve(import.meta.dirname!, '..');

function freshDatabase(layer: 'control' | 'workspace'): BetterSqlite3.Database {
	const database = new BetterSqlite3(':memory:');
	database.pragma('foreign_keys = ON');
	for (const migration of getActiveManifestMigrations(loadMigrationManifest(repoRoot), layer)) {
		database.exec(readFileSync(resolve(repoRoot, migration.file), 'utf8'));
	}
	return database;
}

describe('fully local database ownership', () => {
	it('creates a fresh v2 control database without hosted, device or subscription state', () => {
		const database = freshDatabase('control');
		try {
			expect(database.prepare('SELECT schema_version FROM control_contract_state').get()).toEqual({
				schema_version: 2
			});
			const tables = database
				.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
				.all() as { name: string }[];
			expect(tables.map((table) => table.name)).toEqual([
				'control_contract_state',
				'control_customer_identity',
				'onboarding_state',
				'profile_identity',
				'workspace_registry'
			]);
			const customerColumns = database.pragma('table_info(control_customer_identity)') as {
				name: string;
			}[];
			expect(customerColumns.map((column) => column.name)).not.toContain('plan_state');
		} finally {
			database.close();
		}
	});

	it('stores local workspace members by member IDs without hosted account linkage', () => {
		const database = freshDatabase('workspace');
		try {
			database.exec("INSERT INTO workspace_identity (id) VALUES ('local');");
			database.exec(
				"INSERT INTO workspace_members (id, workspace_id, role, email) VALUES ('member', 'local', 'owner', 'owner@example.test');"
			);
			expect(database.prepare('SELECT id, email FROM workspace_members').get()).toEqual({
				id: 'member',
				email: 'owner@example.test'
			});
			for (const table of ['workspace_identity', 'workspace_members']) {
				const columns = database.pragma(`table_info(${table})`) as { name: string }[];
				for (const removed of [
					'mode',
					'cloud_workspace_id',
					'workspace_link_state',
					'account_id'
				]) {
					expect(columns.map((column) => column.name)).not.toContain(removed);
				}
			}
			expect(database.pragma('foreign_key_check')).toEqual([]);
		} finally {
			database.close();
		}
	});

	it('keeps v1 upgrades separate from fresh-baseline generation', () => {
		const manifest = loadMigrationManifest(repoRoot);
		for (const layer of ['control', 'workspace']) {
			expect(getActiveManifestMigrations(manifest, layer)).toHaveLength(1);
			expect(manifest.layers[layer].migrations.find((entry) => entry.version === 2)?.status).toBe(
				'upgrade-only'
			);
		}
	});

	it('pins synthetic v1 schema fixtures without customer data', () => {
		const directory = resolve(repoRoot, 'tests/fixtures/db-upgrades');
		const manifest = JSON.parse(readFileSync(resolve(directory, 'manifest.json'), 'utf8')) as {
			snapshots: { schemaVersion: number; files: Record<string, string> }[];
		};
		expect(manifest.snapshots[0].schemaVersion).toBe(1);
		for (const [file, sha256] of Object.entries(manifest.snapshots[0].files)) {
			const source = readFileSync(resolve(directory, file), 'utf8');
			expect(createHash('sha256').update(source).digest('hex')).toBe(sha256);
			expect(source).not.toMatch(/INSERT\s+INTO\s+(?:projects|files|contacts|profile_identity)\b/i);
		}
	});
});
