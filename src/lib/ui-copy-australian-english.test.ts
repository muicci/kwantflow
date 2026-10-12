import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceFiles = [
	'src/routes/+layout.svelte',
	'src/lib/components/app-sidebar.svelte',
	'src/lib/components/labour-rates/labour-rate-dialog.svelte',
	'src/lib/components/labour-rates/labour-rate-table.svelte',
	'src/lib/components/assets/asset-estimate-editor.svelte',
	'src/lib/components/materials/material-dialog.svelte',
	'src/lib/components/materials/material-table.svelte',
	'src/lib/components/onboarding/onboarding-workspace.svelte',
	'src/lib/state/labour-rates.svelte.ts',
	'src/lib/services/db.ts'
];

const bannedVisiblePatterns: RegExp[] = [
	/\bLabor Rates\b/,
	/\bAdd Labor Rate\b/,
	/\bEdit Labor Rate\b/,
	/\bNew Labor Rate\b/,
	/\bSave Labor Rate\b/,
	/\bUpdate Labor Rate\b/,
	/\bDelete Labor Rate\b/,
	/Search labor rates\.\.\./,
	/No labor rates found\./,
	/\bActive Labor Rate\b/,
	/\bAdd Material Catalog\b/,
	/\bmaterial catalog item\b/,
	/\bmaterial catalog\b/,
	/\bLabor rate\b/,
	/\bLabor rates\b/,
	/\bwork center\b/
];

describe('Australian English UI copy', () => {
	it('does not leave key US spellings on user-facing surfaces', () => {
		for (const relativePath of sourceFiles) {
			const source = readFileSync(join(process.cwd(), relativePath), 'utf8');
			for (const pattern of bannedVisiblePatterns) {
				expect(source, `${relativePath} should not match ${pattern}`).not.toMatch(pattern);
			}
		}
	});
});
