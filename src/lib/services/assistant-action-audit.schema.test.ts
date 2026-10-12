import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, '../../..');

function migrationFiles(directory: string): string[] {
	return fs
		.readdirSync(directory)
		.filter((name) => name === '001_workspace.sql')
		.sort((left, right) => Number(left.split('_')[0]) - Number(right.split('_')[0]));
}

type TestDatabase = {
	pragma: (statement: string) => void;
	exec: (sql: string) => unknown;
	prepare: (sql: string) => {
		all: () => unknown[];
		get: () => unknown;
		run: (...params: unknown[]) => unknown;
	};
};

function applyMigrations(sqlite: TestDatabase, directory: string): void {
	for (const fileName of migrationFiles(directory)) {
		sqlite.exec(fs.readFileSync(path.join(directory, fileName), 'utf8'));
	}
}

describe('assistant action audit migration', () => {
	it('creates a durable audit table in the workspace baseline', () => {
		const sqlite = new Database(':memory:') as TestDatabase;
		sqlite.pragma('foreign_keys = ON');
		applyMigrations(sqlite, path.join(appRoot, 'src-tauri/migrations-workspace'));

		const columns = sqlite
			.prepare("PRAGMA table_info('assistant_action_audit')")
			.all()
			.map((row: unknown) => (row as { name: string }).name);

		expect(columns).toContain('workspace_id');
		expect(columns).toContain('proposal_id');
		expect(columns).toContain('payload_json');
		expect(columns).toContain('error_message');
	});

	it('keeps failed assistant audit rows when no contact rows are committed', () => {
		const sqlite = new Database(':memory:') as TestDatabase;
		sqlite.pragma('foreign_keys = ON');
		applyMigrations(sqlite, path.join(appRoot, 'src-tauri/migrations-workspace'));

		sqlite.prepare("INSERT INTO workspace_identity (id) VALUES ('local-workspace')").run();
		sqlite
			.prepare(
				`INSERT INTO assistant_action_audit (
					id,
					workspace_id,
					turn_id,
					action_id,
					proposal_id,
					tool_name,
					status,
					item_count,
					error_count,
					payload_json,
					error_message
				) VALUES (?, ?, ?, ?, ?, ?, 'failed', 2, 1, ?, ?)`
			)
			.run(
				'audit-failed-1',
				'local-workspace',
				'turn-1',
				'proposal-1',
				'proposal-1',
				'records.propose_upsert',
				'[]',
				'Contact duplicate'
			);

		expect(sqlite.prepare('SELECT COUNT(*) AS count FROM contacts').get()).toMatchObject({
			count: 0
		});
		expect(
			sqlite.prepare('SELECT status, error_count FROM assistant_action_audit').get()
		).toMatchObject({ status: 'failed', error_count: 1 });
	});

	it('stores verification uncertainty as executed audit payload, not a durable status enum', () => {
		const sqlite = new Database(':memory:') as TestDatabase;
		sqlite.pragma('foreign_keys = ON');
		applyMigrations(sqlite, path.join(appRoot, 'src-tauri/migrations-workspace'));

		sqlite.prepare("INSERT INTO workspace_identity (id) VALUES ('local-workspace')").run();

		expect(() =>
			sqlite
				.prepare(
					`INSERT INTO assistant_action_audit (
						id,
						workspace_id,
						turn_id,
						action_id,
						proposal_id,
						tool_name,
						status,
						item_count,
						error_count,
						payload_json,
						error_message
					) VALUES (?, ?, ?, ?, ?, ?, 'persisted_unverified', 1, 1, ?, ?)`
				)
				.run(
					'audit-unverified-bad',
					'local-workspace',
					'turn-1',
					'proposal-1',
					'proposal-1',
					'records.propose_upsert',
					'{"verificationStatus":"persisted_unverified"}',
					'Persisted row not found'
				)
		).toThrow();

		sqlite
			.prepare(
				`INSERT INTO assistant_action_audit (
					id,
					workspace_id,
					turn_id,
					action_id,
					proposal_id,
					tool_name,
					status,
					item_count,
					error_count,
					payload_json,
					error_message
				) VALUES (?, ?, ?, ?, ?, ?, 'executed', 1, 1, ?, ?)`
			)
			.run(
				'audit-unverified-good',
				'local-workspace',
				'turn-1',
				'proposal-1',
				'proposal-1',
				'records.propose_upsert',
				'{"verificationStatus":"persisted_unverified"}',
				'Persisted row not found'
			);

		expect(
			sqlite.prepare('SELECT status, error_count, payload_json FROM assistant_action_audit').get()
		).toMatchObject({
			status: 'executed',
			error_count: 1,
			payload_json: '{"verificationStatus":"persisted_unverified"}'
		});
	});
});
