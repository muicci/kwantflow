import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import BetterSqlite3 from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DB } from '$lib/types/db.js';
import { seedWorkspaceIdentities } from '../../tests/workspace-database.js';
import { dbService } from '$lib/services/db';

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

let testSqlite: TestDatabase | null = null;

// Intercept Tauri search workspace history call to run against SQLite instance
vi.mock('@tauri-apps/api/core', () => ({
	invoke: vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => {
		if (cmd === 'search_workspace_history_command') {
			if (!testSqlite) return [];
			const query = (args.input as { query?: string })?.query || '';
			const limit = (args.input as { limit?: number })?.limit || 30;
			const scope = (args.input as { scope?: string | null })?.scope ?? null;
			const includeInactive =
				(args.input as { includeInactive?: boolean })?.includeInactive ?? true;
			const workspaceId =
				(args.input as { workspaceId?: string })?.workspaceId ?? 'local-workspace';

			const safeQuery = query.trim().replace(/"/g, '').replace(/'/g, '');
			if (!safeQuery) {
				return [];
			}

			const matchTerm = `${safeQuery}*`;
			const results: unknown[] = [];

			if (!scope || scope === 'projects') {
				try {
					const rows = testSqlite
						.prepare(
							`SELECT id, project_name, rfq_number, rank
							 FROM global_search_index
							 WHERE global_search_index MATCH ?
							 ORDER BY rank ASC LIMIT ?`
						)
						.all(matchTerm, limit) as Record<string, unknown>[];

					for (const row of rows) {
						results.push({
							tableName: 'projects',
							recordType: null,
							scope: 'projects',
							recordId: row.id,
							title: row.project_name || 'Untitled Project',
							subtitle: row.rfq_number,
							rank: row.rank,
							fields: {}
						});
					}
				} catch {
					// Suppressed search error
				}
			}

			if (!scope || scope === 'contacts') {
				try {
					const rows = testSqlite
						.prepare(
							`SELECT idx.id, idx.display_name, idx.company_name, idx.rank, base.kind, base.email, base.phone
							 FROM contacts_search_index idx
							 JOIN contacts base ON base.rowid = idx.rowid
							 WHERE contacts_search_index MATCH ?
							 AND base.workspace_id = ?
							 AND (? OR base.is_active = 1)
							 ORDER BY idx.rank ASC LIMIT ?`
						)
						.all(matchTerm, workspaceId, includeInactive ? 1 : 0, limit) as Record<
						string,
						unknown
					>[];

					for (const row of rows) {
						results.push({
							tableName: 'contacts',
							recordType: 'contacts',
							scope: 'contacts',
							recordId: row.id,
							title: row.display_name,
							subtitle: row.company_name || null,
							rank: row.rank,
							fields: {
								display_name: row.display_name,
								company_name: row.company_name ?? null,
								kind: row.kind,
								email: row.email ?? null,
								phone: row.phone ?? null
							}
						});
					}
				} catch {
					// Suppressed search error
				}
			}

			if (!scope || scope === 'materials') {
				try {
					const rows = testSqlite
						.prepare(
							`SELECT idx.id, idx.name, idx.code, idx.rank, base.category, base.unit,
							        base.default_rate, base.currency_code, base.rate_basis
							 FROM materials_search_index idx
							 JOIN material_catalog_items base ON base.rowid = idx.rowid
							 WHERE materials_search_index MATCH ?
							 AND base.workspace_id = ?
							 AND (? OR base.is_active = 1)
							 ORDER BY idx.rank ASC LIMIT ?`
						)
						.all(matchTerm, workspaceId, includeInactive ? 1 : 0, limit) as Record<
						string,
						unknown
					>[];

					for (const row of rows) {
						results.push({
							tableName: 'material_catalog_items',
							recordType: 'materials',
							scope: 'materials',
							recordId: row.id,
							title: row.name,
							subtitle: row.code || null,
							rank: row.rank,
							fields: {
								category: row.category ?? null,
								unit: row.unit ?? null,
								default_rate: row.default_rate ?? null,
								currency_code: row.currency_code ?? null,
								rate_basis: row.rate_basis ?? null
							}
						});
					}
				} catch {
					// Suppressed search error
				}
			}

			if (!scope || scope === 'labour_rates') {
				try {
					const rows = testSqlite
						.prepare(
							`SELECT idx.id, idx.name, idx.code, idx.rank, base.unit,
							        base.default_rate, base.currency_code, base.rate_basis
							 FROM labour_search_index idx
							 JOIN labour_rate_cards base ON base.rowid = idx.rowid
							 WHERE labour_search_index MATCH ?
							 AND base.workspace_id = ?
							 AND (? OR base.is_active = 1)
							 ORDER BY idx.rank ASC LIMIT ?`
						)
						.all(matchTerm, workspaceId, includeInactive ? 1 : 0, limit) as Record<
						string,
						unknown
					>[];

					for (const row of rows) {
						results.push({
							tableName: 'labour_rate_cards',
							recordType: 'labour_rates',
							scope: 'labour_rates',
							recordId: row.id,
							title: row.name,
							subtitle: row.code || null,
							rank: row.rank,
							fields: {
								unit: row.unit ?? null,
								default_rate: row.default_rate ?? null,
								currency_code: row.currency_code ?? null,
								rate_basis: row.rate_basis ?? null
							}
						});
					}
				} catch {
					// Suppressed search error
				}
			}

			if (!scope || scope === 'classifications') {
				const rows = testSqlite
					.prepare(
						`SELECT id, name, code, classification_type
						 FROM classification_systems
						 WHERE workspace_id = ?
						 AND (name LIKE ? OR code LIKE ? OR classification_type LIKE ?)
						 ORDER BY name ASC LIMIT ?`
					)
					.all(workspaceId, `%${safeQuery}%`, `%${safeQuery}%`, `%${safeQuery}%`, limit) as Record<
					string,
					unknown
				>[];
				for (const row of rows) {
					results.push({
						tableName: 'classification_systems',
						recordType: 'classifications',
						scope: 'classifications',
						recordId: row.id,
						title: row.name,
						subtitle: row.code || null,
						rank: 1000,
						fields: { classification_type: row.classification_type }
					});
				}
			}

			if (!scope || scope === 'cost_codes') {
				const rows = testSqlite
					.prepare(
						`SELECT cc.id, cc.name, cc.code, cc.classification_system_id
						 FROM cost_codes cc
						 JOIN classification_systems cs ON cs.id = cc.classification_system_id
						 WHERE cs.workspace_id = ?
						 AND (cc.name LIKE ? OR cc.code LIKE ? OR cc.description LIKE ?)
						 ORDER BY cc.code ASC LIMIT ?`
					)
					.all(workspaceId, `%${safeQuery}%`, `%${safeQuery}%`, `%${safeQuery}%`, limit) as Record<
					string,
					unknown
				>[];
				for (const row of rows) {
					results.push({
						tableName: 'cost_codes',
						recordType: 'cost_codes',
						scope: 'cost_codes',
						recordId: row.id,
						title: row.name,
						subtitle: row.code || null,
						rank: 1000,
						fields: { classification_system_id: row.classification_system_id }
					});
				}
			}

			if (!scope || scope === 'quote_option_presets') {
				const rows = testSqlite
					.prepare(
						`SELECT id, label, lead_time, markup_percentage
						 FROM quote_option_presets
						 WHERE workspace_id = ?
						 AND (label LIKE ? OR lead_time LIKE ? OR notes LIKE ?)
						 ORDER BY label ASC LIMIT ?`
					)
					.all(workspaceId, `%${safeQuery}%`, `%${safeQuery}%`, `%${safeQuery}%`, limit) as Record<
					string,
					unknown
				>[];
				for (const row of rows) {
					results.push({
						tableName: 'quote_option_presets',
						recordType: 'quote_option_presets',
						scope: 'quote_option_presets',
						recordId: row.id,
						title: row.label,
						subtitle: row.lead_time || null,
						rank: 1000,
						fields: { markup_percentage: row.markup_percentage }
					});
				}
			}

			if (!scope || scope === 'project_structure_templates') {
				const rows = testSqlite
					.prepare(
						`SELECT id, name, code, description
						 FROM project_structure_templates
						 WHERE workspace_id = ?
						 AND (name LIKE ? OR code LIKE ? OR description LIKE ?)
						 ORDER BY name ASC LIMIT ?`
					)
					.all(workspaceId, `%${safeQuery}%`, `%${safeQuery}%`, `%${safeQuery}%`, limit) as Record<
					string,
					unknown
				>[];
				for (const row of rows) {
					results.push({
						tableName: 'project_structure_templates',
						recordType: 'project_structure_templates',
						scope: 'project_structure_templates',
						recordId: row.id,
						title: row.name,
						subtitle: row.code || null,
						rank: 1000,
						fields: { description: row.description }
					});
				}
			}

			if (!scope || scope === 'wbs_nodes') {
				const rows = testSqlite
					.prepare(
						`SELECT node.id, node.name, node.code, node.project_id, node.type
						 FROM wbs_nodes node
						 JOIN projects project ON project.id = node.project_id
						 WHERE project.workspace_id = ?
						 AND (node.name LIKE ? OR node.code LIKE ? OR node.type LIKE ?)
						 ORDER BY node.sort_order ASC, node.name ASC LIMIT ?`
					)
					.all(workspaceId, `%${safeQuery}%`, `%${safeQuery}%`, `%${safeQuery}%`, limit) as Record<
					string,
					unknown
				>[];
				for (const row of rows) {
					results.push({
						tableName: 'wbs_nodes',
						recordType: 'wbs_nodes',
						scope: 'wbs_nodes',
						recordId: row.id,
						title: row.name,
						subtitle: row.code || null,
						rank: 1000,
						fields: { project_id: row.project_id, node_type: row.type }
					});
				}
			}

			if (!scope || scope === 'template_nodes') {
				const rows = testSqlite
					.prepare(
						`SELECT node.id, node.name, node.code, node.template_id, node.type
						 FROM project_structure_template_nodes node
						 JOIN project_structure_templates template ON template.id = node.template_id
						 WHERE template.workspace_id = ?
						 AND (node.name LIKE ? OR node.code LIKE ? OR node.type LIKE ?)
						 ORDER BY node.sort_order ASC, node.name ASC LIMIT ?`
					)
					.all(workspaceId, `%${safeQuery}%`, `%${safeQuery}%`, `%${safeQuery}%`, limit) as Record<
					string,
					unknown
				>[];
				for (const row of rows) {
					results.push({
						tableName: 'project_structure_template_nodes',
						recordType: 'template_nodes',
						scope: 'template_nodes',
						recordId: row.id,
						title: row.name,
						subtitle: row.code || null,
						rank: 1000,
						fields: { template_id: row.template_id, node_type: row.type }
					});
				}
			}

			if (!scope || scope === 'assets') {
				const rows = testSqlite
					.prepare(
						`SELECT asset.id, asset.display_name, asset.project_id
						 FROM assets asset
						 JOIN projects project ON project.id = asset.project_id
						 WHERE project.workspace_id = ?
						 AND asset.display_name LIKE ?
						 ORDER BY asset.display_name ASC LIMIT ?`
					)
					.all(workspaceId, `%${safeQuery}%`, limit) as Record<string, unknown>[];
				for (const row of rows) {
					results.push({
						tableName: 'assets',
						recordType: 'assets',
						scope: 'assets',
						recordId: row.id,
						title: row.display_name,
						subtitle: row.project_id,
						rank: 1000,
						fields: { project_id: row.project_id }
					});
				}
			}

			if (!scope || scope === 'quote_options') {
				const rows = testSqlite
					.prepare(
						`SELECT option.id, option.label, option.lead_time, option.markup_percentage, option.project_id
						 FROM quote_options option
						 JOIN projects project ON project.id = option.project_id
						 WHERE project.workspace_id = ?
						 AND (option.label LIKE ? OR option.lead_time LIKE ? OR option.notes LIKE ?)
						 ORDER BY option.sort_order ASC, option.label ASC LIMIT ?`
					)
					.all(workspaceId, `%${safeQuery}%`, `%${safeQuery}%`, `%${safeQuery}%`, limit) as Record<
					string,
					unknown
				>[];
				for (const row of rows) {
					results.push({
						tableName: 'quote_options',
						recordType: 'quote_options',
						scope: 'quote_options',
						recordId: row.id,
						title: row.label,
						subtitle: row.lead_time,
						rank: 1000,
						fields: { project_id: row.project_id, markup_percentage: row.markup_percentage }
					});
				}
			}

			if (!scope || scope === 'contact_relationships') {
				const rows = testSqlite
					.prepare(
						`SELECT id, from_contact_id, to_contact_id, relationship_type, notes
						 FROM contact_relationships
						 WHERE workspace_id = ?
						 AND (relationship_type LIKE ? OR notes LIKE ?)
						 ORDER BY relationship_type ASC LIMIT ?`
					)
					.all(workspaceId, `%${safeQuery}%`, `%${safeQuery}%`, limit) as Record<string, unknown>[];
				for (const row of rows) {
					results.push({
						tableName: 'contact_relationships',
						recordType: 'contact_relationships',
						scope: 'contact_relationships',
						recordId: row.id,
						title: row.relationship_type,
						subtitle: row.notes || null,
						rank: 1000,
						fields: {
							from_contact_id: row.from_contact_id,
							to_contact_id: row.to_contact_id,
							relationship_type: row.relationship_type
						}
					});
				}
			}

			return results;
		}
		return null;
	})
}));

describe('Workspace Search FTS Index Concurrency and Boundary Tests', () => {
	let sqlite: TestDatabase;
	let kysely: Kysely<DB>;
	let service: DbServiceInternals;
	let originalInit: unknown;
	let originalGetWorkspaceIdForWrite: unknown;

	beforeEach(() => {
		({ sqlite, kysely } = createMigratedDatabase());
		testSqlite = sqlite;
		service = dbService as unknown as DbServiceInternals;
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
		sqlite.close();
		testSqlite = null;
	});

	it('returns immediately empty array for empty search queries without executing SQL FTS MATCH', async () => {
		const emptyInputs = ['', '   ', '\n\t  '];
		for (const input of emptyInputs) {
			const res = await dbService.searchWorkspaceHistory(input);
			expect(res).toEqual([]);
		}
	});

	it('tolerates highly concurrent execution of multiple searches without deadlock or crash', async () => {
		// Populate some contacts into the DB
		sqlite
			.prepare(
				`INSERT INTO contacts (id, workspace_id, sort_order, kind, display_name, name, is_active, created_at, updated_at)
			 VALUES ('c-1', 'local-workspace', 1, 'company', 'Apex Fab', 'Apex Fab', 1, '2026-03-25T00:00:00Z', '2026-03-25T00:00:00Z')`
			)
			.run();

		// Trigger 50 search requests concurrently
		const searches = Array.from({ length: 50 }, (_, i) =>
			dbService.searchWorkspaceHistory(`Apex ${i % 2 === 0 ? 'Fab' : 'Other'}`)
		);

		const allResults = await Promise.all(searches);
		expect(allResults).toHaveLength(50);
		expect(allResults[0]).toBeDefined();
	});

	it('sanitises double quotes and single quotes to prevent FTS5 syntax errors', async () => {
		// FTS5 MATCH will crash if quotes are unclosed. Sanitisation prevents this.
		const maliciousQueries = ['Apex "', "Apex '", 'Apex ""', 'MATCH *', '"Apex Fab" *'];

		for (const query of maliciousQueries) {
			const res = await dbService.searchWorkspaceHistory(query);
			expect(Array.isArray(res)).toBe(true);
		}
	});

	it('uses the shared FTS workspace search for assistant records_search', async () => {
		sqlite
			.prepare(
				`INSERT INTO contacts (id, workspace_id, sort_order, kind, display_name, name, email, phone, is_active, created_at, updated_at)
			 VALUES ('c-fts-lookup', 'local-workspace', 1, 'company', 'Apex Fab', 'Apex Fab Pty Ltd', 'hello@apex.example', '0400000000', 1, '2026-03-25T00:00:00Z', '2026-03-25T00:00:00Z')`
			)
			.run();

		const results = await dbService.searchAssistantRecords({
			scope: 'contacts',
			query: 'Apex',
			limit: 5,
			includeInactive: false
		});

		expect(results).toHaveLength(1);
		expect(results[0]).toMatchObject({
			id: 'c-fts-lookup',
			label: 'Apex Fab',
			subtitle: null
		});
		expect(results[0]?.relevance).toEqual(expect.any(Number));
	});

	it('supports scoped shared search without TypeScript-side global filtering', async () => {
		sqlite
			.prepare(
				`INSERT INTO contacts (id, workspace_id, sort_order, kind, display_name, name, is_active, created_at, updated_at)
			 VALUES ('contact-scope-1', 'local-workspace', 1, 'company', 'Scope Steel Contact', 'Scope Steel Contact', 1, '2026-03-25T00:00:00Z', '2026-03-25T00:00:00Z')`
			)
			.run();
		sqlite
			.prepare(
				`INSERT INTO material_catalog_items (id, workspace_id, name, code, category, unit, default_rate, currency_code, rate_basis, aliases_json, is_active, created_at, updated_at)
			 VALUES ('material-scope-1', 'local-workspace', 'Scope Steel Plate', 'SSP', 'Steel', 'kg', 4.5, 'AUD', 'cost', '["plate steel"]', 1, '2026-03-25T00:00:00Z', '2026-03-25T00:00:00Z')`
			)
			.run();

		const materialResults = await dbService.searchWorkspaceRecords({
			scope: 'materials',
			query: 'Scope',
			limit: 10
		});

		expect(materialResults.map((row) => row.tableName)).toEqual(['material_catalog_items']);
		expect(materialResults[0]).toMatchObject({
			recordType: 'materials',
			scope: 'materials',
			recordId: 'material-scope-1',
			title: 'Scope Steel Plate',
			fields: expect.objectContaining({
				unit: 'kg',
				default_rate: 4.5,
				currency_code: 'AUD',
				rate_basis: 'cost'
			})
		});
	});

	it('applies active filtering inside shared scoped search', async () => {
		sqlite
			.prepare(
				`INSERT INTO material_catalog_items (id, workspace_id, name, code, category, unit, default_rate, is_active, created_at, updated_at)
			 VALUES ('material-active-1', 'local-workspace', 'Active Copper', 'AC', 'Copper', 'kg', 5, 1, '2026-03-25T00:00:00Z', '2026-03-25T00:00:00Z')`
			)
			.run();
		sqlite
			.prepare(
				`INSERT INTO material_catalog_items (id, workspace_id, name, code, category, unit, default_rate, is_active, created_at, updated_at)
			 VALUES ('material-inactive-1', 'local-workspace', 'Inactive Copper', 'IC', 'Copper', 'kg', 2, 0, '2026-03-25T00:00:00Z', '2026-03-25T00:00:00Z')`
			)
			.run();

		const activeOnly = await dbService.searchWorkspaceRecords({
			scope: 'materials',
			query: 'Copper',
			limit: 10,
			includeInactive: false
		});

		expect(activeOnly.map((row) => row.recordId)).toEqual(['material-active-1']);
	});

	it('uses shared scoped search for create duplicate candidates without converting create into update', async () => {
		sqlite
			.prepare(
				`INSERT INTO contacts (id, workspace_id, sort_order, kind, display_name, name, is_active, created_at, updated_at)
			 VALUES ('contact-duplicate-1', 'local-workspace', 1, 'company', 'Duplicate Client', 'Duplicate Client', 1, '2026-03-25T00:00:00Z', '2026-03-25T00:00:00Z')`
			)
			.run();

		const candidates = await dbService.findPotentialDuplicateRecords({
			scope: 'contacts',
			query: 'Duplicate',
			limit: 5
		});

		expect(candidates).toHaveLength(1);
		expect(candidates[0]).toMatchObject({
			recordType: 'contacts',
			scope: 'contacts',
			recordId: 'contact-duplicate-1',
			title: 'Duplicate Client'
		});
	});

	it('supports non-contact catalogue scopes through the same dbService search surface', async () => {
		sqlite
			.prepare(
				`INSERT INTO labour_rate_cards (id, workspace_id, name, code, category, unit, default_rate, is_active, created_at, updated_at)
			 VALUES ('labour-search-1', 'local-workspace', 'Consultation Labour', 'CONS', 'Professional', 'hr', 800, 1, '2026-03-25T00:00:00Z', '2026-03-25T00:00:00Z')`
			)
			.run();

		const results = await dbService.searchWorkspaceRecords({
			scope: 'labour_rates',
			query: 'Consultation',
			limit: 5
		});

		expect(results).toHaveLength(1);
		expect(results[0]).toMatchObject({
			tableName: 'labour_rate_cards',
			recordType: 'labour_rates',
			scope: 'labour_rates',
			recordId: 'labour-search-1',
			title: 'Consultation Labour'
		});
	});

	it('routes all registry lookup scopes through shared search without TypeScript fallback', async () => {
		sqlite
			.prepare(
				`INSERT INTO classification_systems (id, workspace_id, name, code, classification_type, aliases_json, is_default, created_at)
			 VALUES ('class-shared-1', 'local-workspace', 'Shared MasterFormat', 'MF', 'masterformat', '[]', 1, '2026-03-25T00:00:00Z')`
			)
			.run();
		sqlite
			.prepare(
				`INSERT INTO cost_codes (id, classification_system_id, code, name, description, is_active, sort_order, created_at)
			 VALUES ('cost-shared-1', 'class-shared-1', '03-300', 'Shared Concrete', 'Shared concrete works', 1, 1, '2026-03-25T00:00:00Z')`
			)
			.run();
		sqlite
			.prepare(
				`INSERT INTO quote_option_presets (id, workspace_id, label, lead_time, markup_percentage, material_markup_percentage, labour_markup_percentage, equipment_markup_percentage, subcontract_markup_percentage, notes, created_at, updated_at)
			 VALUES ('preset-shared-1', 'local-workspace', 'Shared Premium', '3 weeks', 12, NULL, NULL, NULL, NULL, 'Shared quote preset', '2026-03-25T00:00:00Z', '2026-03-25T00:00:00Z')`
			)
			.run();
		sqlite
			.prepare(
				`INSERT INTO project_structure_templates (id, workspace_id, code, name, description, is_active, created_at, updated_at)
			 VALUES ('template-shared-1', 'local-workspace', 'REN', 'Shared Renovation Template', 'Shared template', 1, '2026-03-25T00:00:00Z', '2026-03-25T00:00:00Z')`
			)
			.run();
		sqlite
			.prepare(
				`INSERT INTO project_structure_template_nodes (id, template_id, parent_id, code, name, type, sort_order, created_at)
			 VALUES ('template-node-shared-1', 'template-shared-1', NULL, 'PH1', 'Shared Template Phase', 'phase', 1, '2026-03-25T00:00:00Z')`
			)
			.run();
		sqlite
			.prepare(
				`INSERT INTO projects (id, workspace_id, sort_order, is_favourite, quote_round_prices, rfq_number, project_name, source_channel, priority, status, created_at, updated_at)
			 VALUES ('project-shared-1', 'local-workspace', 1, 0, 0, 'RFQ-SHARED', 'Shared Project', 'manual', 'Medium', 'draft', '2026-03-25T00:00:00Z', '2026-03-25T00:00:00Z')`
			)
			.run();
		sqlite
			.prepare(
				`INSERT INTO wbs_nodes (id, project_id, parent_id, code, name, type, sort_order, created_at)
			 VALUES ('wbs-shared-1', 'project-shared-1', NULL, 'WBS1', 'Shared WBS Phase', 'phase', 1, '2026-03-25T00:00:00Z')`
			)
			.run();
		sqlite
			.prepare(
				`INSERT INTO assets (id, project_id, display_name, is_selected, quote_quantity, is_pdf_included, created_at)
			 VALUES ('asset-shared-1', 'project-shared-1', 'Shared Asset', 1, 1, 1, '2026-03-25T00:00:00Z')`
			)
			.run();
		sqlite
			.prepare(
				`INSERT INTO quote_options (id, project_id, label, lead_time, markup_percentage, material_markup_percentage, labour_markup_percentage, equipment_markup_percentage, subcontract_markup_percentage, notes, sort_order, is_default, created_at, updated_at)
			 VALUES ('quote-option-shared-1', 'project-shared-1', 'Shared Quote Option', '4 weeks', 9, NULL, NULL, NULL, NULL, 'Shared option', 1, 0, '2026-03-25T00:00:00Z', '2026-03-25T00:00:00Z')`
			)
			.run();
		sqlite
			.prepare(
				`INSERT INTO contacts (id, workspace_id, sort_order, kind, display_name, name, is_active, created_at, updated_at)
			 VALUES ('contact-shared-from', 'local-workspace', 10, 'person', 'Shared Person', 'Shared Person', 1, '2026-03-25T00:00:00Z', '2026-03-25T00:00:00Z'),
			        ('contact-shared-to', 'local-workspace', 11, 'company', 'Shared Company', 'Shared Company', 1, '2026-03-25T00:00:00Z', '2026-03-25T00:00:00Z')`
			)
			.run();
		sqlite
			.prepare(
				`INSERT INTO contact_relationships (id, workspace_id, from_contact_id, to_contact_id, relationship_type, is_primary, notes, created_at, updated_at)
			 VALUES ('relationship-shared-1', 'local-workspace', 'contact-shared-from', 'contact-shared-to', 'works_for', 1, 'Shared relationship', '2026-03-25T00:00:00Z', '2026-03-25T00:00:00Z')`
			)
			.run();

		const cases = [
			['classifications', 'MasterFormat', 'class-shared-1'],
			['cost_codes', 'Concrete', 'cost-shared-1'],
			['quote_option_presets', 'Premium', 'preset-shared-1'],
			['project_structure_templates', 'Renovation', 'template-shared-1'],
			['template_nodes', 'Template Phase', 'template-node-shared-1'],
			['wbs_nodes', 'WBS Phase', 'wbs-shared-1'],
			['assets', 'Asset', 'asset-shared-1'],
			['quote_options', 'Quote Option', 'quote-option-shared-1'],
			['contact_relationships', 'relationship', 'relationship-shared-1']
		] as const;

		for (const [scope, query, expectedId] of cases) {
			const results = await dbService.searchAssistantRecords({
				scope,
				query,
				limit: 5,
				includeInactive: false
			});
			expect(
				results.map((result) => result.id),
				scope
			).toContain(expectedId);
		}
	});

	it('sanitizes search queries to prevent FTS5 syntax errors with punctuation', async () => {
		sqlite
			.prepare(
				`INSERT INTO contacts (id, workspace_id, sort_order, kind, display_name, name, is_active, created_at, updated_at)
			 VALUES ('contact-punctuation-1', 'local-workspace', 20, 'company', 'Punctuation Company', 'Punctuation Company', 1, '2026-03-25T00:00:00Z', '2026-03-25T00:00:00Z')`
			)
			.run();

		// Query with comma, quotes, parentheses, colon, and dashes. This would normally cause FTS5 parser to throw syntax error.
		const results = await dbService.searchWorkspaceRecords({
			scope: 'contacts',
			query: 'Punctuation, Company!',
			limit: 5
		});

		expect(results.length).toBeGreaterThan(0);
		expect(results[0].recordId).toBe('contact-punctuation-1');
	});
});
