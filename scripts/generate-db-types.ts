import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { loadMigrationManifest, getActiveManifestMigrations } from './migration-manifest.js';

const CUSTOM_TYPE_OVERRIDES: Record<string, Record<string, string>> = {
	material_catalog_items: {
		unit: 'MaterialUnitCode',
		currency_code: 'SupportedCurrencyCode'
	},
	labour_rate_cards: {
		unit: 'LabourRateUnitCode',
		currency_code: 'SupportedCurrencyCode'
	},
	equipment_rate_cards: {
		unit: 'EquipmentRateUnitCode',
		currency_code: 'SupportedCurrencyCode'
	},
	subcontract_rate_cards: {
		unit: 'SubcontractRateUnitCode',
		currency_code: 'SupportedCurrencyCode'
	},
	assistant_action_audit: {
		status: "'proposed' | 'validated' | 'rejected' | 'approved' | 'executed' | 'failed'"
	},
	ai_evidence_refs: {
		artifact_kind: "'text' | 'pdf' | 'image' | 'cad'"
	}
};

function toInterfaceName(tableName: string, isControl: boolean): string {
	if (isControl && tableName === 'control_customer_identity') {
		return 'ControlCustomerIdentityTable';
	}
	if (tableName === 'material_catalog_items') {
		return 'MaterialCatalogueItemsTable';
	}
	return (
		tableName
			.split('_')
			.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
			.join('') + 'Table'
	);
}

function toRowTypeNames(tableName: string, isControl: boolean) {
	const base = tableName;
	let pascal = base
		.split('_')
		.map((word) => {
			let w = word;
			if (w.endsWith('s')) {
				if (w.endsWith('ies')) {
					w = w.slice(0, -3) + 'y';
				} else if (
					w.endsWith('es') &&
					!w.endsWith('rates') &&
					!w.endsWith('codes') &&
					!w.endsWith('rules')
				) {
					w = w.slice(0, -2);
				} else {
					w = w.slice(0, -1);
				}
			}
			return w.charAt(0).toUpperCase() + w.slice(1);
		})
		.join('');

	if (isControl && tableName === 'customer_identity') {
		pascal = 'ControlCustomerIdentity';
	} else if (tableName === 'material_catalog_items') {
		pascal = 'MaterialCatalogueItem';
	} else if (tableName === 'workspace_integrations') {
		pascal = 'WorkspaceIntegration';
	} else if (tableName === 'workspace_members') {
		pascal = 'WorkspaceMember';
	} else if (tableName === 'runtime_contract_state') {
		pascal = 'RuntimeContractState';
	} else if (tableName === 'fx_rate_snapshots') {
		pascal = 'FxRateSnapshot';
	}

	return {
		row: `${pascal}Row`,
		new: `New${pascal}`,
		update: `${pascal}Update`
	};
}

function shouldSkipTable(tableName: string): boolean {
	const skipSuffixes = [
		'_search_index_config',
		'_search_index_data',
		'_search_index_docsize',
		'_search_index_idx',
		'_search_index_content'
	];
	if (tableName.startsWith('sqlite_') || tableName.startsWith('_')) {
		return true;
	}
	if (tableName.includes('_fts_') && tableName !== 'project_file_page_chunks_fts') {
		return true;
	}
	if (tableName.endsWith('_search_index')) {
		return true;
	}
	return skipSuffixes.some((suffix) => tableName.endsWith(suffix));
}

function run() {
	const manifest = loadMigrationManifest(process.cwd());

	// 1. Setup workspace database from the canonical workspace baseline.
	const workspaceDb = new BetterSqlite3(':memory:');
	const workspaceMigrations = getActiveManifestMigrations(manifest, 'workspace');
	for (const m of workspaceMigrations) {
		const sql = readFileSync(resolve(process.cwd(), m.file), 'utf8');
		try {
			workspaceDb.exec(sql);
		} catch (e) {
			console.warn(`Skipping workspace migration ${m.version} in generator: ${e}`);
		}
	}

	// 2. Setup control database (uses control layer migrations)
	const controlDb = new BetterSqlite3(':memory:');
	const controlMigrations = getActiveManifestMigrations(manifest, 'control');
	for (const m of controlMigrations) {
		const sql = readFileSync(resolve(process.cwd(), m.file), 'utf8');
		try {
			controlDb.exec(sql);
		} catch (e) {
			console.warn(`Skipping control migration ${m.version} in generator: ${e}`);
		}
	}

	const workspaceTables = workspaceDb
		.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
		.all() as Array<{ name: string }>;

	const controlTables = controlDb
		.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
		.all() as Array<{ name: string }>;

	let content = `// Generated automatically from SQLite migrations. Do not edit manually.\n\n`;
	content += `import type { Generated, Insertable, Selectable, Updateable } from 'kysely';\n`;
	content += `import type {\n`;
	content += `\tEquipmentRateUnitCode,\n`;
	content += `\tLabourRateUnitCode,\n`;
	content += `\tMaterialUnitCode,\n`;
	content += `\tSubcontractRateUnitCode,\n`;
	content += `\tSupportedCurrencyCode\n`;
	content += `} from '../constants/index.js';\n\n`;

	const printedInterfaces = new Set<string>();

	const printTable = (tName: string, db: BetterSqlite3.Database, isControl: boolean) => {
		const interfaceName = toInterfaceName(tName, isControl);
		if (printedInterfaces.has(interfaceName)) {
			return ''; // Skip duplicate interface output
		}
		printedInterfaces.add(interfaceName);

		let tableStr = `export interface ${interfaceName} {\n`;
		const columns = db.prepare(`PRAGMA table_info(${tName})`).all() as Array<{
			name: string;
			type: string;
			notnull: number;
			dflt_value: unknown;
		}>;

		for (const col of columns) {
			let tsType = 'string';
			const typeUpper = col.type.toUpperCase();
			if (
				typeUpper.includes('INT') ||
				typeUpper.includes('REAL') ||
				typeUpper.includes('DOUBLE') ||
				typeUpper.includes('FLOAT') ||
				typeUpper.includes('NUMERIC')
			) {
				tsType = 'number';
			} else if (typeUpper.includes('BOOLEAN')) {
				tsType = 'number'; // SQLite uses integer 0/1 for booleans
			}

			// Check custom overrides
			if (CUSTOM_TYPE_OVERRIDES[tName]?.[col.name]) {
				tsType = CUSTOM_TYPE_OVERRIDES[tName][col.name];
			}

			let nullable = col.notnull === 0 ? ' | null' : '';
			let isGenerated = col.dflt_value !== null;

			// Special structural overrides for canonical primary keys and metadata timestamps
			if (col.name === 'id') {
				tsType = 'string';
				nullable = '';
				isGenerated = false;
			} else if (col.name === 'created_at' || col.name === 'updated_at') {
				tsType = 'string';
				nullable = '';
				isGenerated = true;
			}

			if (isGenerated) {
				tableStr += `\t${col.name}: Generated<${tsType}${nullable}>;\n`;
			} else {
				tableStr += `\t${col.name}: ${tsType}${nullable};\n`;
			}
		}
		tableStr += `}\n\n`;

		// Exclude search index tables from row/new/update helper aliases
		if (!tName.endsWith('_search_index') && !tName.endsWith('_fts_table')) {
			const aliases = toRowTypeNames(tName, isControl);
			tableStr += `export type ${aliases.row} = Selectable<${interfaceName}>;\n`;
			tableStr += `export type ${aliases.new} = Insertable<${interfaceName}>;\n`;
			// Only generate Update type if it is not custom or omitted
			tableStr += `export type ${aliases.update} = Updateable<${interfaceName}>;\n\n`;
		}

		return tableStr;
	};

	// Output workspace tables
	for (const t of workspaceTables) {
		if (shouldSkipTable(t.name)) continue;
		content += printTable(t.name, workspaceDb, false);
	}

	// Output control tables
	for (const t of controlTables) {
		if (shouldSkipTable(t.name)) continue;
		content += printTable(t.name, controlDb, true);
	}

	// Output ControlDB interface
	content += `export interface ControlDB {\n`;
	for (const t of controlTables) {
		if (shouldSkipTable(t.name)) continue;
		const interfaceName = toInterfaceName(t.name, true);
		content += `\t${t.name}: ${interfaceName};\n`;
	}
	content += `}\n\n`;

	// Output DB interface
	content += `export interface DB {\n`;
	for (const t of workspaceTables) {
		if (shouldSkipTable(t.name)) continue;
		const interfaceName = toInterfaceName(t.name, false);
		content += `\t${t.name}: ${interfaceName};\n`;
	}
	content += `}\n`;

	const outputPath = resolve(process.cwd(), 'src/lib/types/db.ts');
	if (process.argv.includes('--check')) {
		let existingContent = '';
		try {
			existingContent = readFileSync(outputPath, 'utf8');
		} catch {
			// file doesn't exist
		}
		if (existingContent.trim() !== content.trim()) {
			console.error(
				'ERROR: Database type drift detected! Please run `pnpm db:generate-types` to synchronize types.'
			);
			process.exit(1);
		}
		console.log('Database types are synchronized.');
		process.exit(0);
	} else {
		writeFileSync(outputPath, content, 'utf8');
		console.log('Database types generated successfully.');
	}
}

run();
