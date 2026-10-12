import fs from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { FxRateSnapshotSchema } from '../schemas/index.js';
import { normalizePositiveDecimalString } from '../utils/math.js';
import { WORKSPACE_RUNTIME_SCHEMA } from './db-schema-health.js';

const workspaceBaseline = fs.readFileSync(
	path.resolve(process.cwd(), 'src-tauri/migrations-workspace/001_workspace.sql'),
	'utf8'
);

function createDatabase(): InstanceType<typeof Database> {
	const database = new Database(':memory:');
	database.pragma('foreign_keys = ON');
	database.exec(workspaceBaseline);
	database.exec("INSERT INTO workspace_identity (id) VALUES ('workspace-a')");
	return database;
}

describe('FX rate snapshot foundation', () => {
	it('preserves decimal precision without JavaScript Number conversion', () => {
		expect(normalizePositiveDecimalString('001.2300')).toBe('1.23');
		expect(normalizePositiveDecimalString('0.00000000000000000012345678901234567890')).toBe(
			'0.0000000000000000001234567890123456789'
		);
		expect(() => normalizePositiveDecimalString('0')).toThrow('greater than zero');
		expect(() => normalizePositiveDecimalString('-1')).toThrow('positive');
	});

	it('validates currency pairs and decimal strings with Zod', () => {
		const row = {
			id: 'fx-1',
			workspace_id: 'workspace-a',
			from_currency_code: 'AUD',
			to_currency_code: 'THB',
			rate_decimal: '21.234567890123456789',
			source: 'manual',
			effective_at: '2026-06-11',
			created_at: '2026-06-11T00:00:00.000Z'
		};
		expect(FxRateSnapshotSchema.safeParse(row).success).toBe(true);
		expect(FxRateSnapshotSchema.safeParse({ ...row, from_currency_code: 'XYZ' }).success).toBe(
			false
		);
		expect(FxRateSnapshotSchema.safeParse({ ...row, to_currency_code: 'AUD' }).success).toBe(false);
	});

	it('is part of the workspace runtime contract with exact source-rate naming', () => {
		expect(WORKSPACE_RUNTIME_SCHEMA.tables).toContain('fx_rate_snapshots');
		expect(WORKSPACE_RUNTIME_SCHEMA.columns.fx_rate_snapshots).toEqual(
			expect.arrayContaining([
				'workspace_id',
				'from_currency_code',
				'to_currency_code',
				'rate_decimal'
			])
		);
		expect(WORKSPACE_RUNTIME_SCHEMA.columns.fx_rate_snapshots).not.toContain('rate');
	});

	it('creates an isolated workspace-owned table in the clean baseline', () => {
		const database = createDatabase();
		const columns = database.pragma('table_info(fx_rate_snapshots)') as Array<{
			name: string;
			type: string;
		}>;
		expect(columns.map((column) => column.name)).toEqual([
			'id',
			'workspace_id',
			'from_currency_code',
			'to_currency_code',
			'rate_decimal',
			'source',
			'effective_at',
			'created_at'
		]);
		database
			.prepare(
				'INSERT INTO fx_rate_snapshots (id, workspace_id, from_currency_code, to_currency_code, rate_decimal, effective_at) VALUES (?, ?, ?, ?, ?, ?)'
			)
			.run('fx-1', 'workspace-a', 'AUD', 'THB', '21.234567890123456789', '2026-06-11');
		expect(
			database.prepare('SELECT rate_decimal FROM fx_rate_snapshots WHERE id = ?').get('fx-1')
		).toMatchObject({ rate_decimal: '21.234567890123456789' });
		expect(() =>
			database
				.prepare(
					"INSERT INTO fx_rate_snapshots (id, workspace_id, from_currency_code, to_currency_code, rate_decimal, effective_at) VALUES ('fx-bad', 'workspace-a', 'AUD', 'AUD', '1', '2026-06-11')"
				)
				.run()
		).toThrow();
		database.close();
	});
});
