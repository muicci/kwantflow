import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('workspace splitter layout', () => {
	it('reuses the shared workspace resize handle style on the estimate workspace splitters', () => {
		const source = readFileSync(
			join(process.cwd(), 'src/routes/project/[id]/+page.svelte'),
			'utf8'
		);

		expect(source).toContain('import { WORKSPACE_RESIZE_HANDLE_CLASS }');
		expect(source).toContain('class={WORKSPACE_RESIZE_HANDLE_CLASS}');
	});

	it('reuses the shared workspace resize handle style in Quote PDF preview', () => {
		const source = readFileSync(
			join(process.cwd(), 'src/routes/project/[id]/quote/pdf/+page.svelte'),
			'utf8'
		);

		expect(source).toContain('WORKSPACE_RESIZE_HANDLE_CLASS');
		expect(source).toContain(
			'<Resizable.Handle withHandle class={WORKSPACE_RESIZE_HANDLE_CLASS} />'
		);
	});

	it('removes the Auto-Group action and helper from the main estimate workspace', () => {
		const source = readFileSync(
			join(process.cwd(), 'src/routes/project/[id]/+page.svelte'),
			'utf8'
		);

		expect(source).not.toContain('Auto-Group');
		expect(source).not.toContain('performAutoGroup');
		expect(source).toContain('GroupAssetsDialog');
		expect(source).toContain('onConfirm={performManualGroup}');
	});

	it('removes the unused auto-group state helper', () => {
		const source = readFileSync(join(process.cwd(), 'src/lib/state/projects.svelte.ts'), 'utf8');

		expect(source).not.toContain('async autoGroupFiles(');
	});
});
