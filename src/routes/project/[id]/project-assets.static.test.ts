import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const pagePath = join(process.cwd(), 'src/routes/project/[id]/+page.svelte');

describe('project asset workspace copy', () => {
	it('keeps the asset delete confirmation explicit about whether files return to review', () => {
		const source = readFileSync(pagePath, 'utf8');

		expect(source).toContain('Delete asset and return files to review?');
		expect(source).toContain('Delete file-less asset?');
		expect(source).not.toContain('<AlertDialog.Title>Delete asset?</AlertDialog.Title>');
	});
});
