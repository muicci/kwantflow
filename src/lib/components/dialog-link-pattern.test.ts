import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dialogFiles = [
	'src/lib/components/user/settings-dialog.svelte',
	'src/lib/components/contacts/contact-dialog.svelte',
	'src/lib/components/intake/intake-dialog.svelte',
	'src/lib/components/materials/material-dialog.svelte',
	'src/lib/components/labour-rates/labour-rate-dialog.svelte',
	'src/lib/components/classification-systems/classification-system-dialog.svelte',
	'src/lib/components/classification-systems/cost-code-dialog.svelte',
	'src/lib/components/wbs/wbs-node-dialog.svelte'
];

describe('dialog navigation markup', () => {
	it('does not use placeholder href values in production dialogs', () => {
		for (const relativePath of dialogFiles) {
			const source = readFileSync(join(process.cwd(), relativePath), 'utf8');
			expect(source, `${relativePath} should not contain href="##"`).not.toContain('href="##"');
		}
	});
});
