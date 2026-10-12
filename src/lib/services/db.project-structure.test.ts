import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import BetterSqlite3 from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectStructureTemplateFormValues } from '$lib/schemas/index.js';
import type { ProjectStructureTemplateNode } from '$lib/types/index.js';
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

const baseTemplateData: ProjectStructureTemplateFormValues = {
	code: 'FAB-START',
	name: 'Fabrication Starter',
	description: 'Starter structure for workshop jobs',
	is_active: true
};

const baseTemplateNodes: ProjectStructureTemplateNode[] = [
	{
		id: 'template-root',
		template_id: '__draft__',
		parent_id: null,
		code: '10',
		name: 'Workshop',
		type: 'phase',
		sort_order: 10,
		created_at: '2026-03-11T00:00:00Z'
	},
	{
		id: 'template-child',
		template_id: '__draft__',
		parent_id: 'template-root',
		code: '20',
		name: 'Batch 1',
		type: 'zone',
		sort_order: 20,
		created_at: '2026-03-11T00:00:00Z'
	}
];

const childBeforeParentTemplateNodes: ProjectStructureTemplateNode[] = [
	{
		id: 'template-child-first',
		template_id: '__draft__',
		parent_id: 'template-parent-last',
		code: '20',
		name: 'Child First',
		type: 'zone',
		sort_order: 0,
		created_at: '2026-03-11T00:00:00Z'
	},
	{
		id: 'template-parent-last',
		template_id: '__draft__',
		parent_id: null,
		code: '10',
		name: 'Parent Last',
		type: 'phase',
		sort_order: 10,
		created_at: '2026-03-11T00:00:00Z'
	}
];

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
	seedWorkspaceIdentities(sqlite, ['local-workspace', 'other-workspace']);
	const kysely = new Kysely<DB>({
		dialect: new SqliteDialect({ database: sqlite })
	});
	return { sqlite, kysely };
}

function insertProject(sqlite: TestDatabase, id: string, workspaceId = 'local-workspace'): void {
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
			) VALUES (?, ?, 0, ?, 'Atlas Steel', ?, 'Medium', 'draft', '2026-03-11T00:00:00Z', '2026-03-11T00:00:00Z')`
		)
		.run(id, workspaceId, `RFQ-${id}`, `Project ${id}`);
}

function getServiceInternals(): DbServiceInternals {
	return dbService as unknown as DbServiceInternals;
}

describe('dbService project structure templates', () => {
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

	it('creates, updates, and deletes project structure templates with persisted nodes', async () => {
		await dbService.addProjectStructureTemplate('template-1', baseTemplateData, baseTemplateNodes);

		const created = await dbService.getProjectStructureTemplateById('template-1');
		expect(created).toMatchObject({
			id: 'template-1',
			workspace_id: 'local-workspace',
			code: 'FAB-START',
			name: 'Fabrication Starter',
			description: 'Starter structure for workshop jobs',
			is_active: true
		});
		expect(created?.nodes.map((node) => node.id)).toEqual(['template-root', 'template-child']);
		expect(created?.nodes.map((node) => node.parent_id)).toEqual([null, 'template-root']);

		await dbService.updateProjectStructureTemplate(
			'template-1',
			{
				code: 'FAB-REV2',
				name: 'Fabrication Starter Rev 2',
				description: 'Updated template',
				is_active: false
			},
			[
				{
					id: 'template-area',
					template_id: 'template-1',
					parent_id: null,
					code: '30',
					name: 'Assembly Area',
					type: 'zone',
					sort_order: 30,
					created_at: '2026-03-11T00:00:00Z'
				}
			]
		);

		const updated = await dbService.getProjectStructureTemplateById('template-1');
		expect(updated).toMatchObject({
			code: 'FAB-REV2',
			name: 'Fabrication Starter Rev 2',
			description: 'Updated template',
			is_active: false
		});
		expect(updated?.nodes).toHaveLength(1);
		expect(updated?.nodes[0]).toMatchObject({
			id: 'template-area',
			parent_id: null,
			name: 'Assembly Area'
		});

		await dbService.deleteProjectStructureTemplate('template-1');

		const deleted = await dbService.getProjectStructureTemplateById('template-1');
		expect(deleted).toBeNull();
		const remainingNodeCount = sqlite
			.prepare(`SELECT COUNT(*) AS count FROM project_structure_template_nodes`)
			.get() as { count: number };
		expect(remainingNodeCount.count).toBe(0);
	});

	it('creates a template even when a child sorts before its parent', async () => {
		await expect(
			dbService.addProjectStructureTemplate(
				'template-child-first',
				baseTemplateData,
				childBeforeParentTemplateNodes
			)
		).resolves.toBeUndefined();

		const created = await dbService.getProjectStructureTemplateById('template-child-first');
		expect(created?.nodes).toHaveLength(2);
		expect(created?.nodes.find((node) => node.id === 'template-child-first')?.parent_id).toBe(
			'template-parent-last'
		);
	});

	it('applies a template into an empty project with remapped ids and preserved hierarchy', async () => {
		insertProject(sqlite, 'project-empty');
		await dbService.addProjectStructureTemplate(
			'template-apply',
			baseTemplateData,
			baseTemplateNodes
		);

		await dbService.applyProjectStructureTemplateToProject('template-apply', 'project-empty');

		const appliedNodes = sqlite
			.prepare(
				`SELECT id, parent_id, code, name, type, sort_order
				FROM wbs_nodes
				WHERE project_id = 'project-empty'
				ORDER BY sort_order ASC, name ASC`
			)
			.all() as Array<{
			id: string;
			parent_id: string | null;
			code: string | null;
			name: string;
			type: string;
			sort_order: number;
		}>;

		expect(appliedNodes).toHaveLength(2);
		expect(appliedNodes.map((node) => node.name)).toEqual(['Workshop', 'Batch 1']);
		expect(appliedNodes[0]?.id).not.toBe('template-root');
		expect(appliedNodes[1]?.id).not.toBe('template-child');
		expect(appliedNodes[1]?.parent_id).toBe(appliedNodes[0]?.id ?? null);
		expect(appliedNodes.map((node) => node.sort_order)).toEqual([10, 20]);
	});

	it('applies a template even when retrieved nodes sort before their parent', async () => {
		insertProject(sqlite, 'project-unsorted');
		sqlite
			.prepare(
				`INSERT INTO project_structure_templates (
					id,
					workspace_id,
					code,
					name,
					description,
					is_active,
					created_at,
					updated_at
				) VALUES (
					'template-unsorted',
					'local-workspace',
					'UNSORTED',
					'Unsorted Template',
					'Nodes sort child-first',
					1,
					'2026-03-11T00:00:00Z',
					'2026-03-11T00:00:00Z'
				)`
			)
			.run();
		sqlite
			.prepare(
				`INSERT INTO project_structure_template_nodes (
					id,
					template_id,
					parent_id,
					code,
					name,
					type,
					sort_order,
					created_at
				) VALUES (
					'template-parent-last',
					'template-unsorted',
					NULL,
					'10',
					'Parent Last',
					'phase',
					10,
					'2026-03-11T00:00:00Z'
				)`
			)
			.run();
		sqlite
			.prepare(
				`INSERT INTO project_structure_template_nodes (
					id,
					template_id,
					parent_id,
					code,
					name,
					type,
					sort_order,
					created_at
				) VALUES (
					'template-child-first',
					'template-unsorted',
					'template-parent-last',
					'20',
					'Child First',
					'zone',
					0,
					'2026-03-11T00:00:00Z'
				)`
			)
			.run();

		await expect(
			dbService.applyProjectStructureTemplateToProject('template-unsorted', 'project-unsorted')
		).resolves.toBeUndefined();

		const appliedNodes = sqlite
			.prepare(
				`SELECT id, parent_id, name
				FROM wbs_nodes
				WHERE project_id = 'project-unsorted'
				ORDER BY sort_order ASC, name ASC`
			)
			.all() as Array<{
			id: string;
			parent_id: string | null;
			name: string;
		}>;

		expect(appliedNodes).toHaveLength(2);
		expect(appliedNodes[0]?.name).toBe('Child First');
		expect(appliedNodes[1]?.name).toBe('Parent Last');
		expect(appliedNodes[0]?.parent_id).toBe(appliedNodes[1]?.id ?? null);
	});

	it('blocks apply when the target project already has structure', async () => {
		insertProject(sqlite, 'project-with-structure');
		sqlite
			.prepare(
				`INSERT INTO wbs_nodes (
					id,
					project_id,
					parent_id,
					code,
					name,
					type,
					sort_order,
					created_at
				) VALUES (
					'existing-node',
					'project-with-structure',
					NULL,
					'EX',
					'Existing',
					'custom',
					0,
					'2026-03-11T00:00:00Z'
				)`
			)
			.run();
		await dbService.addProjectStructureTemplate(
			'template-blocked',
			baseTemplateData,
			baseTemplateNodes
		);

		await expect(
			dbService.applyProjectStructureTemplateToProject('template-blocked', 'project-with-structure')
		).rejects.toThrow('Project structure templates can only be applied to empty projects');
	});

	it('rejects update and delete when the template is outside the active owner scope', async () => {
		await dbService.addProjectStructureTemplate(
			'template-owned-by-local-user',
			baseTemplateData,
			baseTemplateNodes
		);
		service.getWorkspaceIdForWrite = vi.fn(async () => 'other-workspace');

		await expect(
			dbService.updateProjectStructureTemplate(
				'template-owned-by-local-user',
				baseTemplateData,
				baseTemplateNodes
			)
		).rejects.toThrow('Selected project structure template could not be found');
		await expect(
			dbService.deleteProjectStructureTemplate('template-owned-by-local-user')
		).rejects.toThrow('Selected project structure template could not be found');
	});

	it('rolls back create when node persistence fails', async () => {
		const invalidNodes = [
			{
				...baseTemplateNodes[0],
				id: 'template-invalid-node',
				type: 'invalid-type'
			}
		] as unknown as ProjectStructureTemplateNode[];

		await expect(
			dbService.addProjectStructureTemplate('template-invalid', baseTemplateData, invalidNodes)
		).rejects.toThrow();

		expect(await dbService.getProjectStructureTemplateById('template-invalid')).toBeNull();
	});

	it('rolls back update when replacement node persistence fails', async () => {
		await dbService.addProjectStructureTemplate(
			'template-update-failure',
			baseTemplateData,
			baseTemplateNodes
		);
		const invalidNodes = [
			{
				...baseTemplateNodes[0],
				id: 'template-update-invalid',
				type: 'invalid-type'
			}
		] as unknown as ProjectStructureTemplateNode[];

		await expect(
			dbService.updateProjectStructureTemplate(
				'template-update-failure',
				{
					...baseTemplateData,
					name: 'Template Update Failure'
				},
				invalidNodes
			)
		).rejects.toThrow();

		const persisted = await dbService.getProjectStructureTemplateById('template-update-failure');
		expect(persisted).toMatchObject({
			name: 'Fabrication Starter'
		});
		expect(persisted?.nodes.map((node) => node.id)).toEqual(['template-root', 'template-child']);
	});
});
