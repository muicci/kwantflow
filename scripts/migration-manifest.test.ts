import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('migration manifest executable entrypoint', () => {
	it('executes validation from a path containing spaces and rejects missing migration files', () => {
		const appRoot = process.cwd();
		const runsRoot = path.join(appRoot, 'runs');
		fs.mkdirSync(runsRoot, { recursive: true });
		const fixtureRoot = fs.mkdtempSync(path.join(runsRoot, 'manifest entrypoint # '));
		const scriptPath = path.join(fixtureRoot, 'migration-manifest.ts');
		try {
			fs.copyFileSync(path.join(appRoot, 'scripts', 'migration-manifest.ts'), scriptPath);
			const migrationDirectory = path.join(fixtureRoot, 'src-tauri', 'migrations-control');
			fs.mkdirSync(migrationDirectory, { recursive: true });
			fs.writeFileSync(
				path.join(fixtureRoot, 'src-tauri', 'migration-manifest.json'),
				JSON.stringify({
					version: 2,
					description: 'Synthetic entrypoint fixture',
					layers: {
						control: {
							migrations: [
								{
									version: 2,
									file: 'src-tauri/migrations-control/0002_control.sql',
									description: 'Synthetic local schema'
								}
							]
						}
					}
				})
			);
			const migrationPath = path.join(migrationDirectory, '0002_control.sql');
			fs.writeFileSync(migrationPath, 'CREATE TABLE synthetic_record (id TEXT PRIMARY KEY);');
			const aliasPath = path.join(fixtureRoot, 'folder alias');
			fs.symlinkSync(fixtureRoot, aliasPath, process.platform === 'win32' ? 'junction' : 'dir');
			const run = (entryPath: string) =>
				spawnSync(process.execPath, ['--import', 'tsx', entryPath], {
					cwd: fixtureRoot,
					encoding: 'utf8',
					timeout: 10_000
				});
			const entryPaths = [scriptPath, path.join(aliasPath, 'migration-manifest.ts')];
			for (const entryPath of entryPaths) {
				const valid = run(entryPath);
				expect(valid.status).toBe(0);
				expect(valid.stdout).toContain('Migration manifest verified.');
			}
			fs.unlinkSync(migrationPath);
			for (const entryPath of entryPaths) {
				const invalid = run(entryPath);
				expect(invalid.status).toBe(1);
				expect(invalid.stderr).toContain('0002_control.sql');
			}
		} finally {
			fs.rmSync(fixtureRoot, { recursive: true, force: true });
		}
	});
});
