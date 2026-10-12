import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import BetterSqlite3 from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { projectWorkspacePath } from '$lib/constants/index.js';
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

const { copyFileMock, mkdirMock, removeMock } = vi.hoisted(() => ({
	copyFileMock: vi.fn(),
	mkdirMock: vi.fn(),
	removeMock: vi.fn()
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
	copyFile: copyFileMock,
	mkdir: mkdirMock,
	remove: removeMock,
	BaseDirectory: {
		Document: 'Document',
		AppLocalData: 'AppLocalData'
	}
}));

vi.mock('@tauri-apps/api/core', () => ({
	invoke: async (command: string, args?: { input?: Record<string, unknown> }) => {
		if (command === 'get_local_documents_root') return '/qa-documents';
		const { invokeTypedRustCommandForTests } = await import('../../tests/typed-rust-command-shim');
		return invokeTypedRustCommandForTests(command, args?.input ?? {});
	}
}));

vi.mock('@tauri-apps/api/path', () => ({
	join: async (root: string, relativePath: string) => `${root}/${relativePath}`
}));

import { dbService } from '$lib/services/db';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, '../../../src-tauri/migrations-workspace');
const duplicatedProjectId = '00000000-0000-4000-8000-000000000001';

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

function insertProject(sqlite: TestDatabase, id: string): void {
	sqlite
		.prepare(
			`INSERT INTO projects (
				id,
				workspace_id,
				sort_order,
				is_favourite,
				rfq_number,
				contact_id,
				contact_name_snapshot,
				requester_contact_id,
				requester_name_snapshot,
				project_name,
				due_date,
				source_channel,
				source_reference,
				priority,
				status,
				content,
				note,
				created_at,
				updated_at
			) VALUES (
				?,
				'local-workspace',
				0,
				0,
				?,
				NULL,
				NULL,
				NULL,
				NULL,
				NULL,
				NULL,
				'manual',
				NULL,
				'Medium',
				'draft',
				NULL,
				NULL,
				'2026-03-25T00:00:00Z',
				'2026-03-25T00:00:00Z'
			)`
		)
		.run(id, `RFQ-${id}`);
}

function insertAsset(sqlite: TestDatabase, id: string, projectId: string): void {
	sqlite
		.prepare(
			`INSERT INTO assets (
				id,
				project_id,
				display_name,
				thumbnail_file_id,
				is_selected,
				created_at
			) VALUES (?, ?, 'Source Asset', NULL, 1, '2026-03-25T00:00:00Z')`
		)
		.run(id, projectId);
}

function insertFile(
	sqlite: TestDatabase,
	id: string,
	projectId: string,
	assetId: string | null
): void {
	sqlite
		.prepare(
			`INSERT INTO files (
				id,
				project_id,
				asset_id,
				file_path,
				original_name,
				mime_type,
				created_at
			) VALUES (?, ?, ?, ?, 'source.pdf', 'application/pdf', '2026-03-25T00:00:00Z')`
		)
		.run(id, projectId, assetId, `workspace/${projectId}/source.pdf`);
}

function insertAiRun(sqlite: TestDatabase, id: string, assetId: string): void {
	sqlite
		.prepare(
			`INSERT INTO ai_runs (
				id,
				asset_id,
				provider,
				model_id,
				status,
				trigger_source,
				started_at
			) VALUES (?, ?, 'local_litert_lm', 'local-ai', 'completed', 'estimate_card', '2026-03-25T00:00:00Z')`
		)
		.run(id, assetId);
}

function insertWorkspaceAiFeedback(
	sqlite: TestDatabase,
	id: string,
	runId: string,
	assetId: string
): void {
	sqlite
		.prepare(
			`INSERT INTO workspace_ai_feedback_entries (
				id,
				workspace_id,
				run_id,
				asset_id,
				estimate_id,
				feedback_text,
				created_at
			) VALUES (?, 'local-workspace', ?, ?, ?, 'Use this correction next time.', '2026-03-25T00:00:00Z')`
		)
		.run(id, runId, assetId, assetId);
}

describe('dbService project persistence', () => {
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
		copyFileMock.mockResolvedValue(undefined);
		mkdirMock.mockResolvedValue(undefined);
		removeMock.mockResolvedValue(undefined);
	});

	afterEach(async () => {
		service.init = originalInit;
		service.getWorkspaceIdForWrite = originalGetWorkspaceIdForWrite;
		service.db = null;
		service.kysely = null;
		await kysely.destroy();
		sqlite.close();
		vi.restoreAllMocks();
		vi.clearAllMocks();
	});

	it('rolls back project creation when default quote option creation fails', async () => {
		sqlite.exec(`
			CREATE TRIGGER fail_default_quote_option
			BEFORE INSERT ON quote_options
			WHEN NEW.project_id = 'project-fail'
			BEGIN
				SELECT RAISE(ABORT, 'quote option insert failed');
			END;
		`);

		await expect(dbService.addProject('project-fail', 'RFQ-FAIL')).rejects.toThrow(
			'quote option insert failed'
		);

		const projectRow = sqlite.prepare(`SELECT id FROM projects WHERE id = 'project-fail'`).get() as
			{ id: string } | undefined;
		expect(projectRow).toBeUndefined();
	});

	it('rolls back createProjectWorkspace when file row insertion fails', async () => {
		sqlite.exec(`
			CREATE TRIGGER fail_project_workspace_file_insert
			BEFORE INSERT ON files
			WHEN NEW.project_id = 'project-workspace-fail'
			BEGIN
				SELECT RAISE(ABORT, 'project workspace file insert failed');
			END;
		`);

		await expect(
			dbService.createProjectWorkspace({
				id: 'project-workspace-fail',
				rfqNumber: 'RFQ-WORKSPACE-FAIL',
				files: [
					{
						id: 'file-workspace-fail',
						file_path: 'workspace/project-workspace-fail/source.pdf',
						original_name: 'source.pdf'
					}
				]
			})
		).rejects.toThrow('project workspace file insert failed');

		const projectRow = sqlite
			.prepare(`SELECT id FROM projects WHERE id = 'project-workspace-fail'`)
			.get() as { id: string } | undefined;
		const fileRow = sqlite
			.prepare(`SELECT id FROM files WHERE id = 'file-workspace-fail'`)
			.get() as { id: string } | undefined;

		expect(projectRow).toBeUndefined();
		expect(fileRow).toBeUndefined();
	});

	it('rolls back updateProjectWorkspace when staged file insertion fails after the project update begins', async () => {
		insertProject(sqlite, 'project-update-fail');
		insertFile(sqlite, 'file-keep', 'project-update-fail', null);

		sqlite.exec(`
			CREATE TRIGGER fail_project_update_workspace_file_insert
			BEFORE INSERT ON files
			WHEN NEW.project_id = 'project-update-fail'
			BEGIN
				SELECT RAISE(ABORT, 'update workspace file insert failed');
			END;
		`);

		await expect(
			dbService.updateProjectWorkspace({
				id: 'project-update-fail',
				rfqNumber: 'RFQ-UPDATED',
				projectName: 'Updated name',
				keepFileIds: ['file-keep'],
				newFiles: [
					{
						id: 'file-new',
						file_path: 'workspace/project-update-fail/new.pdf',
						original_name: 'new.pdf'
					}
				]
			})
		).rejects.toThrow('update workspace file insert failed');

		const projectRow = sqlite
			.prepare(`SELECT rfq_number, project_name FROM projects WHERE id = 'project-update-fail'`)
			.get() as { rfq_number: string; project_name: string | null } | undefined;
		const fileRow = sqlite.prepare(`SELECT id FROM files WHERE id = 'file-new'`).get() as
			{ id: string } | undefined;

		expect(projectRow).toEqual({
			rfq_number: 'RFQ-project-update-fail',
			project_name: null
		});
		expect(fileRow).toBeUndefined();
	});

	it('keeps the workspace folder untouched when project deletion fails in SQLite', async () => {
		insertProject(sqlite, 'project-delete');
		insertAsset(sqlite, 'asset-delete', 'project-delete');
		insertFile(sqlite, 'file-delete', 'project-delete', 'asset-delete');

		sqlite.exec(`
			CREATE TRIGGER fail_project_delete
			BEFORE DELETE ON projects
			WHEN OLD.id = 'project-delete'
			BEGIN
				SELECT RAISE(ABORT, 'project delete blocked');
			END;
		`);

		await expect(dbService.deleteProject('project-delete')).rejects.toThrow(
			'project delete blocked'
		);

		expect(removeMock).not.toHaveBeenCalledWith(
			`/qa-documents/${projectWorkspacePath('local-workspace', 'project-delete')}`,
			expect.anything()
		);

		const projectRow = sqlite
			.prepare(`SELECT id FROM projects WHERE id = 'project-delete'`)
			.get() as { id: string } | undefined;
		expect(projectRow?.id).toBe('project-delete');
	});

	it('removes workspace AI feedback notes tied to a deleted project', async () => {
		insertProject(sqlite, 'project-with-feedback');
		insertAsset(sqlite, 'asset-with-feedback', 'project-with-feedback');
		insertFile(sqlite, 'file-with-feedback', 'project-with-feedback', 'asset-with-feedback');
		insertAiRun(sqlite, 'run-with-feedback', 'asset-with-feedback');
		insertWorkspaceAiFeedback(
			sqlite,
			'feedback-delete',
			'run-with-feedback',
			'asset-with-feedback'
		);

		await dbService.deleteProject('project-with-feedback');

		const feedbackRow = sqlite
			.prepare(`SELECT id FROM workspace_ai_feedback_entries WHERE id = 'feedback-delete'`)
			.get() as { id: string } | undefined;
		expect(feedbackRow).toBeUndefined();
	});

	it('excludes orphan workspace AI feedback notes from future guidance', async () => {
		insertProject(sqlite, 'project-live-feedback');
		insertAsset(sqlite, 'asset-live-feedback', 'project-live-feedback');
		insertAiRun(sqlite, 'run-live-feedback', 'asset-live-feedback');
		insertWorkspaceAiFeedback(sqlite, 'feedback-live', 'run-live-feedback', 'asset-live-feedback');
		sqlite
			.prepare(
				`INSERT INTO workspace_ai_feedback_entries (
					id,
					workspace_id,
					run_id,
					asset_id,
					estimate_id,
					feedback_text,
					created_at
				) VALUES ('feedback-orphan', 'local-workspace', 'run-missing', 'asset-missing', 'asset-missing', 'Ignore orphaned notes.', '2026-03-24T00:00:00Z')`
			)
			.run();

		const feedbackEntries = await dbService.getWorkspaceAiFeedbackEntries();

		expect(feedbackEntries.map((entry) => entry.id)).toEqual(['feedback-live']);
	});

	it.each(['/', '\\'])(
		'duplicates stored %j vault paths without rewriting source records or losing stored filenames',
		async (separator) => {
			insertProject(sqlite, 'project-source');
			insertAsset(sqlite, 'asset-source', 'project-source');
			insertFile(sqlite, 'file-source-1', 'project-source', 'asset-source');
			insertFile(sqlite, 'file-source-2', 'project-source', 'asset-source');
			const sourceRoot = 'workspaces/local-workspace/vault/workspace/project-source';
			const sourcePaths = [
				`${sourceRoot}/file-source-1-source.pdf`,
				`${sourceRoot}/file-source-2-source.pdf`
			].map((relativePath) => relativePath.replace(/\//g, separator));
			for (const [index, storedPath] of sourcePaths.entries()) {
				sqlite
					.prepare('UPDATE files SET file_path = ? WHERE id = ?')
					.run(storedPath, `file-source-${index + 1}`);
			}
			sqlite
				.prepare('UPDATE assets SET thumbnail_file_id = ? WHERE id = ?')
				.run('file-source-1', 'asset-source');
			vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce(duplicatedProjectId);

			await expect(dbService.duplicateProject('project-source', 'RFQ-COPY')).resolves.toBe(
				duplicatedProjectId
			);

			for (let index = 1; index <= 2; index += 1) {
				expect(copyFileMock).toHaveBeenCalledWith(
					`/qa-documents/Kwantflow/${sourceRoot}/file-source-${index}-source.pdf`,
					`/qa-documents/${projectWorkspacePath('local-workspace', duplicatedProjectId)}/file-source-${index}-source.pdf`
				);
			}
			const sourceRows = sqlite
				.prepare('SELECT file_path FROM files WHERE project_id = ? ORDER BY id')
				.all('project-source') as Array<{ file_path: string }>;
			expect(sourceRows.map((row) => row.file_path)).toEqual(sourcePaths);
			const duplicatedRows = sqlite
				.prepare(
					'SELECT id, asset_id, file_path, original_name FROM files WHERE project_id = ? ORDER BY file_path'
				)
				.all(duplicatedProjectId) as Array<{
				id: string;
				asset_id: string;
				file_path: string;
				original_name: string;
			}>;
			expect(duplicatedRows.map((row) => row.file_path)).toEqual([
				`workspaces/local-workspace/vault/workspace/${duplicatedProjectId}/file-source-1-source.pdf`,
				`workspaces/local-workspace/vault/workspace/${duplicatedProjectId}/file-source-2-source.pdf`
			]);
			expect(duplicatedRows.every((row) => row.original_name === 'source.pdf')).toBe(true);
			const duplicatedAsset = sqlite
				.prepare('SELECT id, thumbnail_file_id FROM assets WHERE project_id = ?')
				.get(duplicatedProjectId) as { id: string; thumbnail_file_id: string };
			expect(duplicatedRows.every((row) => row.asset_id === duplicatedAsset.id)).toBe(true);
			expect(duplicatedAsset.thumbnail_file_id).toBe(duplicatedRows[0].id);
		}
	);

	it('preserves literal backslashes in Unix filenames when duplicating a project', async () => {
		insertProject(sqlite, 'project-source');
		insertAsset(sqlite, 'asset-source', 'project-source');
		insertFile(sqlite, 'file-source', 'project-source', 'asset-source');
		const storedPath = String.raw`workspaces/local-workspace/vault/workspace/project-source/part\A.pdf`;
		sqlite.prepare('UPDATE files SET file_path = ? WHERE id = ?').run(storedPath, 'file-source');
		vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce(duplicatedProjectId);

		await dbService.duplicateProject('project-source', 'RFQ-COPY');

		const expectedNewPath = `workspaces/local-workspace/vault/workspace/${duplicatedProjectId}/part\\A.pdf`;
		expect(copyFileMock).toHaveBeenCalledWith(
			`/qa-documents/Kwantflow/${storedPath}`,
			`/qa-documents/Kwantflow/${expectedNewPath}`
		);
		const duplicatedRow = sqlite
			.prepare('SELECT file_path FROM files WHERE project_id = ?')
			.get(duplicatedProjectId) as { file_path: string };
		expect(duplicatedRow.file_path).toBe(expectedNewPath);
		const sourceRow = sqlite
			.prepare('SELECT file_path FROM files WHERE id = ?')
			.get('file-source') as { file_path: string };
		expect(sourceRow.file_path).toBe(storedPath);
	});

	it('cleans the staged workspace copy when duplicateProject fails during the transactional insert phase', async () => {
		insertProject(sqlite, 'project-source');
		insertAsset(sqlite, 'asset-source', 'project-source');
		insertFile(sqlite, 'file-source', 'project-source', 'asset-source');

		sqlite.exec(`
			CREATE TRIGGER fail_duplicate_file_insert
			BEFORE INSERT ON files
			WHEN NEW.project_id = '${duplicatedProjectId}'
			BEGIN
				SELECT RAISE(ABORT, 'duplicate file insert failed');
			END;
		`);

		vi.spyOn(crypto, 'randomUUID')
			.mockReturnValueOnce(duplicatedProjectId)
			.mockReturnValueOnce('00000000-0000-4000-8000-000000000002')
			.mockReturnValueOnce('00000000-0000-4000-8000-000000000003')
			.mockReturnValueOnce('00000000-0000-4000-8000-000000000004');

		await expect(dbService.duplicateProject('project-source', 'RFQ-COPY')).rejects.toThrow(
			'duplicate file insert failed'
		);

		expect(copyFileMock).toHaveBeenCalledWith(
			'/qa-documents/Kwantflow/workspace/project-source/source.pdf',
			`/qa-documents/${projectWorkspacePath('local-workspace', duplicatedProjectId)}/source.pdf`
		);
		expect(removeMock).toHaveBeenCalledWith(
			`/qa-documents/${projectWorkspacePath('local-workspace', duplicatedProjectId)}`,
			{
				recursive: true
			}
		);

		const duplicatedProjectRow = sqlite
			.prepare(`SELECT id FROM projects WHERE id = ?`)
			.get(duplicatedProjectId) as { id: string } | undefined;
		expect(duplicatedProjectRow).toBeUndefined();
	});

	it('performs FTS search across multiple workspace estimating tables', async () => {
		sqlite
			.prepare(
				`
			INSERT INTO contacts (
				id, workspace_id, kind, display_name, name, company_name, email, phone, is_active, created_at, updated_at
			) VALUES (
				'contact-fts-1', 'local-workspace', 'company', 'John Doe Subcontracting', 'John Doe', 'Doe Corp', 'john@doe.com', '12345678', 1, '2026-03-25T00:00:00Z', '2026-03-25T00:00:00Z'
			)
		`
			)
			.run();

		sqlite
			.prepare(
				`
			INSERT INTO material_catalog_items (
				id, workspace_id, name, code, category, unit, default_rate, is_active, created_at, updated_at
			) VALUES (
				'material-fts-1', 'local-workspace', 'Stainless Steel Bolts 10mm', 'SSB-10', 'Hardware', 'ea', 5.5, 1, '2026-03-25T00:00:00Z', '2026-03-25T00:00:00Z'
			)
		`
			)
			.run();

		insertProject(sqlite, 'project-fts-1');
		sqlite
			.prepare(
				`
			UPDATE projects SET project_name = 'Bridge Refurbishment Project' WHERE id = 'project-fts-1'
		`
			)
			.run();
		const results = await dbService.searchWorkspaceHistory('Bridge');
		expect(results.length).toBeGreaterThan(0);
		expect(results[0].tableName).toBe('projects');
		expect(results[0].title).toBe('Bridge Refurbishment Project');

		const contactResults = await dbService.searchWorkspaceHistory('John');
		expect(contactResults.length).toBeGreaterThan(0);
		expect(contactResults[0].tableName).toBe('contacts');
		expect(contactResults[0].title).toBe('John Doe Subcontracting');

		const materialResults = await dbService.searchWorkspaceHistory('Bolts');
		expect(materialResults.length).toBeGreaterThan(0);
		expect(materialResults[0].tableName).toBe('material_catalog_items');
		expect(materialResults[0].title).toBe('Stainless Steel Bolts 10mm');
	});

	it('rejects cost-code and WBS ancestor cycles during updates', async () => {
		sqlite
			.prepare(
				`INSERT INTO classification_systems (id, workspace_id, name, code, classification_type, aliases_json, is_default)
			VALUES ('classification-cycle', 'local-workspace', 'Cycle test', 'CYCLE', 'custom', '[]', 0)`
			)
			.run();
		sqlite
			.prepare(
				`INSERT INTO cost_codes (id, classification_system_id, parent_id, code, name, sort_order)
			VALUES ('cost-a', 'classification-cycle', NULL, 'A', 'A', 0), ('cost-b', 'classification-cycle', 'cost-a', 'B', 'B', 1), ('cost-c', 'classification-cycle', 'cost-b', 'C', 'C', 2)`
			)
			.run();

		await expect(
			dbService.updateCostCode('cost-a', {
				parent_id: 'cost-c',
				code: 'A',
				name: 'A',
				description: '',
				is_active: true,
				sort_order: 0
			})
		).rejects.toThrow(/cycle|ancestor|descendant/i);

		insertProject(sqlite, 'project-cycle');
		sqlite
			.prepare(
				`INSERT INTO wbs_nodes (id, project_id, parent_id, code, name, type, sort_order)
			VALUES ('wbs-a', 'project-cycle', NULL, 'A', 'A', 'phase', 0), ('wbs-b', 'project-cycle', 'wbs-a', 'B', 'B', 'level', 1), ('wbs-c', 'project-cycle', 'wbs-b', 'C', 'C', 'level', 2)`
			)
			.run();

		await expect(
			dbService.updateWbsNode('wbs-a', {
				parent_id: 'wbs-c',
				code: 'A',
				name: 'A',
				type: 'phase',
				sort_order: 0
			})
		).rejects.toThrow(/cycle|ancestor|descendant/i);
	});
});
