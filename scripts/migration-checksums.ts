import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { globSync } from 'glob';

export const MIGRATION_CHECKSUM_LOCKS = [
	{
		name: 'control database migrations',
		glob: 'src-tauri/migrations-control/*.sql',
		lockPath: 'src-tauri/migrations-control.lock.json'
	},
	{
		name: 'per-workspace database migrations',
		glob: 'src-tauri/migrations-workspace/*.sql',
		lockPath: 'src-tauri/migrations-workspace.lock.json'
	}
] as const;

export type MigrationChecksumEntry = {
	version: number;
	file: string;
	sha256: string;
};

export type MigrationChecksumLock = {
	entries: MigrationChecksumEntry[];
};

const normalizePath = (value: string) => value.replaceAll('\\', '/');

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

const collectMigrationFiles = (
	rootDir = process.cwd(),
	globPattern = 'src-tauri/migrations-workspace/*.sql'
) =>
	globSync(globPattern, {
		cwd: rootDir,
		nodir: true,
		posix: true
	})
		.map((file) => {
			const match = path.basename(file).match(/^(\d+)_/);
			return match ? { file, version: Number(match[1]) } : null;
		})
		.filter((entry): entry is { file: string; version: number } => entry !== null)
		.sort((a, b) => a.version - b.version);

export const collectMigrationChecksumEntries = (
	rootDir = process.cwd(),
	globPattern = 'src-tauri/migrations-workspace/*.sql'
): MigrationChecksumEntry[] =>
	collectMigrationFiles(rootDir, globPattern).map(({ file, version }) => ({
		version,
		file: normalizePath(file),
		sha256: sha256(fs.readFileSync(path.join(rootDir, file), 'utf8'))
	}));

export const loadMigrationChecksumLock = (
	rootDir = process.cwd(),
	lockPath = 'src-tauri/migrations-workspace.lock.json'
): MigrationChecksumLock | null => {
	const fullPath = path.join(rootDir, lockPath);
	if (!fs.existsSync(fullPath)) return null;
	return JSON.parse(fs.readFileSync(fullPath, 'utf8')) as MigrationChecksumLock;
};

export const writeMigrationChecksumLock = (
	rootDir = process.cwd(),
	lockPath = 'src-tauri/migrations-workspace.lock.json',
	globPattern = 'src-tauri/migrations-workspace/*.sql'
) => {
	const payload: MigrationChecksumLock = {
		entries: collectMigrationChecksumEntries(rootDir, globPattern)
	};
	// Use tab indentation to match Prettier project config
	fs.writeFileSync(path.join(rootDir, lockPath), `${JSON.stringify(payload, null, '\t')}\n`);
	return payload;
};

export const writeAllMigrationChecksumLocks = (rootDir = process.cwd()) => {
	for (const config of MIGRATION_CHECKSUM_LOCKS) {
		writeMigrationChecksumLock(rootDir, config.lockPath, config.glob);
	}
};

export const verifyMigrationChecksumLock = (
	rootDir = process.cwd(),
	lockPath = 'src-tauri/migrations-workspace.lock.json',
	globPattern = 'src-tauri/migrations-workspace/*.sql'
): string[] => {
	const issues: string[] = [];
	const currentEntries = collectMigrationChecksumEntries(rootDir, globPattern);
	const currentByFile = new Map(currentEntries.map((entry) => [entry.file, entry]));
	const locked = loadMigrationChecksumLock(rootDir, lockPath);

	if (!locked) {
		return [`Migration checksum lock is missing: ${lockPath}`];
	}

	const lockedByFile = new Map(locked.entries.map((entry) => [normalizePath(entry.file), entry]));

	for (const current of currentEntries) {
		const lockedEntry = lockedByFile.get(current.file);
		if (!lockedEntry) {
			issues.push(`Migration checksum lock is missing an entry for ${current.file}.`);
			continue;
		}

		if (lockedEntry.sha256 !== current.sha256) {
			issues.push(
				`Migration checksum mismatch for ${current.file}. Shipped migrations are immutable; add a new numbered migration instead of editing history.`
			);
		}
	}

	for (const lockedEntry of locked.entries) {
		if (!currentByFile.has(normalizePath(lockedEntry.file))) {
			issues.push(
				`Migration checksum lock references a missing migration file: ${lockedEntry.file}.`
			);
		}
	}

	return issues;
};

export const verifyAllMigrationChecksumLocks = (rootDir = process.cwd()): string[] =>
	MIGRATION_CHECKSUM_LOCKS.flatMap((config) =>
		verifyMigrationChecksumLock(rootDir, config.lockPath, config.glob).map(
			(issue) => `${config.name}: ${issue}`
		)
	);

const isDirectRun = Boolean(
	process.argv[1] &&
	fs.existsSync(process.argv[1]) &&
	fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(path.resolve(process.argv[1]))
);

if (isDirectRun) {
	if (process.argv.includes('--write')) {
		writeAllMigrationChecksumLocks();
		for (const config of MIGRATION_CHECKSUM_LOCKS) {
			console.log(`Wrote migration checksum lock to ${config.lockPath}.`);
		}
	} else {
		const issues = verifyAllMigrationChecksumLocks();
		if (issues.length === 0) {
			console.log('Migration checksum locks verified.');
		} else {
			for (const issue of issues) {
				console.error(issue);
			}
			process.exitCode = 1;
		}
	}
}
