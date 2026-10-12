import fs from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { WORKSPACE_RUNTIME_SCHEMA } from './db-schema-health.js';

const workspaceBaseline = fs.readFileSync(
	path.resolve(process.cwd(), 'src-tauri/migrations-workspace/001_workspace.sql'),
	'utf8'
);

describe('cost-component source foundation', () => {
	it('keeps source provenance in the runtime schema contract', () => {
		expect(WORKSPACE_RUNTIME_SCHEMA.columns.cost_components).toEqual(
			expect.arrayContaining([
				'source_type',
				'source_id',
				'source_unit_rate_decimal',
				'source_currency_code',
				'fx_rate_snapshot_id'
			])
		);
	});

	it('creates nullable source fields and the FX reference in the clean baseline', () => {
		const database = new Database(':memory:');
		database.pragma('foreign_keys = ON');
		database.exec(workspaceBaseline);
		const columns = database.pragma('table_info(cost_components)') as Array<{
			name: string;
			type: string;
			notnull: number;
		}>;
		const byName = new Map(columns.map((column) => [column.name, column]));
		for (const name of [
			'source_unit_rate_decimal',
			'source_currency_code',
			'fx_rate_snapshot_id'
		]) {
			expect(byName.get(name)).toMatchObject({ type: 'TEXT', notnull: 0 });
		}
		const foreignKeys = database.pragma('foreign_key_list(cost_components)') as Array<{
			from: string;
			table: string;
			to: string;
			on_delete: string;
		}>;
		expect(foreignKeys).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					from: 'fx_rate_snapshot_id',
					table: 'fx_rate_snapshots',
					to: 'id',
					on_delete: 'SET NULL'
				})
			])
		);
		database.close();
	});

	it('keeps the covering index required by estimate reads', () => {
		const database = new Database(':memory:');
		database.exec(workspaceBaseline);
		const indexes = database
			.prepare(
				"SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'cost_components'"
			)
			.all() as Array<{ name: string }>;
		expect(indexes.map((index) => index.name)).toContain('idx_cost_components_fx_rate_snapshot_id');
		database.close();
	});
});
