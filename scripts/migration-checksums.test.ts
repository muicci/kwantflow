import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { verifyMigrationChecksumLock, writeMigrationChecksumLock } from './migration-checksums.js';

const WORKSPACE_GLOB = 'src-tauri/migrations-workspace/*.sql';
const WORKSPACE_LOCK = 'src-tauri/migrations-workspace.lock.json';

const tmpDirs: string[] = [];

afterEach(() => {
	for (const dir of tmpDirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

function createRoot(): string {
	const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kwantflow-migration-lock-'));
	tmpDirs.push(rootDir);
	fs.mkdirSync(path.join(rootDir, 'src-tauri/migrations-workspace'), { recursive: true });
	return rootDir;
}

describe('migration checksum lock', () => {
	it('passes when the current migrations match the lock file', () => {
		const rootDir = createRoot();
		fs.writeFileSync(
			path.join(rootDir, 'src-tauri/migrations-workspace/001_workspace.sql'),
			'CREATE TABLE sample_a (id TEXT PRIMARY KEY NOT NULL);'
		);
		writeMigrationChecksumLock(rootDir, WORKSPACE_LOCK, WORKSPACE_GLOB);

		expect(verifyMigrationChecksumLock(rootDir, WORKSPACE_LOCK, WORKSPACE_GLOB)).toEqual([]);
		expect(fs.existsSync(path.join(rootDir, WORKSPACE_LOCK))).toBe(true);
	});

	it('fails when a locked migration file has been modified', () => {
		const rootDir = createRoot();
		const migrationPath = path.join(rootDir, 'src-tauri/migrations-workspace/001_workspace.sql');
		fs.writeFileSync(migrationPath, 'CREATE TABLE sample_a (id TEXT PRIMARY KEY NOT NULL);');
		writeMigrationChecksumLock(rootDir, WORKSPACE_LOCK, WORKSPACE_GLOB);

		fs.writeFileSync(
			migrationPath,
			'CREATE TABLE sample_a (id TEXT PRIMARY KEY NOT NULL, note TEXT);'
		);

		expect(verifyMigrationChecksumLock(rootDir, WORKSPACE_LOCK, WORKSPACE_GLOB)).toEqual(
			expect.arrayContaining([expect.stringContaining('001_workspace.sql')])
		);
	});

	it('fails when a migration exists without a checksum-lock entry', () => {
		const rootDir = createRoot();
		fs.writeFileSync(
			path.join(rootDir, 'src-tauri/migrations-workspace/001_workspace.sql'),
			'CREATE TABLE sample_a (id TEXT PRIMARY KEY NOT NULL);'
		);
		writeMigrationChecksumLock(rootDir, WORKSPACE_LOCK, WORKSPACE_GLOB);

		fs.writeFileSync(
			path.join(rootDir, 'src-tauri/migrations-workspace/002_unlocked.sql'),
			'CREATE TABLE sample_c (id TEXT PRIMARY KEY NOT NULL);'
		);

		expect(verifyMigrationChecksumLock(rootDir, WORKSPACE_LOCK, WORKSPACE_GLOB)).toEqual(
			expect.arrayContaining([expect.stringContaining('002_unlocked.sql')])
		);
	});
});
