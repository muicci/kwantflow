import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { globSync } from 'glob';

export const MIGRATION_MANIFEST_PATH = 'src-tauri/migration-manifest.json';

export type MigrationStatus =
	'active' | 'retired' | 'superseded' | 'legacy-not-run' | 'upgrade-only';

export type ManifestMigration = {
	version: number;
	file: string;
	description: string;
	status?: MigrationStatus;
	reason?: string;
};

export type MigrationManifestLayer = {
	database?: string;
	ledger?: string;
	runner?: string;
	contract?: string;
	migrations: ManifestMigration[];
};

export type MigrationManifest = {
	version: number;
	description: string;
	layers: Record<string, MigrationManifestLayer>;
};

const normalizePath = (value: string) => value.replaceAll('\\', '/');

export const loadMigrationManifest = (rootDir = process.cwd()): MigrationManifest => {
	const manifestPath = path.join(rootDir, MIGRATION_MANIFEST_PATH);
	return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as MigrationManifest;
};

export const getActiveManifestMigrations = (
	manifest: MigrationManifest,
	layerName: string
): ManifestMigration[] => {
	const layer = manifest.layers[layerName];
	if (!layer) {
		throw new Error(`Migration manifest layer is missing: ${layerName}`);
	}
	return layer.migrations.filter((migration) => (migration.status ?? 'active') === 'active');
};

const migrationFileVersion = (file: string): number | null => {
	const match = path.basename(file).match(/^(\d+)_/);
	return match ? Number(match[1]) : null;
};

export const validateMigrationManifest = (rootDir = process.cwd()): string[] => {
	const manifest = loadMigrationManifest(rootDir);
	const issues: string[] = [];
	const manifestFiles = new Set<string>();

	for (const [layerName, layer] of Object.entries(manifest.layers)) {
		const activeVersions = new Map<number, ManifestMigration>();

		for (const migration of layer.migrations) {
			const status = migration.status ?? 'active';
			const normalizedFile = normalizePath(migration.file);
			manifestFiles.add(normalizedFile);

			if (!fs.existsSync(path.join(rootDir, normalizedFile))) {
				issues.push(`${layerName}: manifest references missing file ${normalizedFile}.`);
			}

			if (!migration.description?.trim()) {
				issues.push(`${layerName}: ${normalizedFile} is missing a description.`);
			}

			if (status !== 'active' && !migration.reason?.trim()) {
				issues.push(`${layerName}: ${normalizedFile} is ${status} but has no reason.`);
			}

			if (status === 'active') {
				const existing = activeVersions.get(migration.version);
				if (existing) {
					issues.push(
						`${layerName}: active version ${migration.version} is declared twice: ${existing.file} and ${normalizedFile}.`
					);
				} else {
					activeVersions.set(migration.version, migration);
				}
			}
		}
	}

	const sqlFiles = globSync('src-tauri/migrations{,-workspace,-control}/*.sql', {
		cwd: rootDir,
		nodir: true,
		posix: true
	}).map(normalizePath);

	for (const file of sqlFiles) {
		if (!manifestFiles.has(file)) {
			issues.push(
				`unmapped migration file: ${file}. Add it to ${MIGRATION_MANIFEST_PATH} as active, retired, superseded, or legacy-not-run.`
			);
		}
	}

	for (const [layerName, layer] of Object.entries(manifest.layers)) {
		for (const migration of layer.migrations) {
			const fileVersion = migrationFileVersion(migration.file);
			if (
				fileVersion !== null &&
				(migration.status ?? 'active') === 'active' &&
				layerName !== 'control' &&
				fileVersion !== migration.version
			) {
				issues.push(
					`${layerName}: runtime version ${migration.version} does not match file version ${fileVersion} for ${migration.file}.`
				);
			}
		}
	}

	return issues;
};

if (
	process.argv[1] &&
	fs.existsSync(process.argv[1]) &&
	fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(path.resolve(process.argv[1]))
) {
	const issues = validateMigrationManifest();
	if (issues.length === 0) {
		console.log('Migration manifest verified.');
	} else {
		for (const issue of issues) {
			console.error(issue);
		}
		process.exitCode = 1;
	}
}
