import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('disposable development reset', () => {
	it('registers only the development reset', () => {
		const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
		expect(packageJson.scripts['dev:reset:fresh-run']).toContain('dev-reset-fresh-run.ts');
		expect(packageJson.scripts['app:reset:installed:fresh']).toBeUndefined();
	});

	it('preserves shared documents, credentials, and installed application state', () => {
		const source = readFileSync('scripts/dev-reset-fresh-run.ts', 'utf8');
		expect(source).toContain("const DEV_APP_IDENTIFIER = 'com.kwantflow.desktop.dev'");
		expect(source).toContain('process.argv.slice(2).length > 0');
		expect(source).not.toContain('TAURI_DEV_USE_INSTALLED_IDENTITY_ENV');
		expect(source).not.toContain("join(home, 'Documents'");
		expect(source).not.toContain('delete-generic-password');
		expect(source).not.toContain('/Applications/Kwantflow.app');
	});
});
