import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const componentPath = join(process.cwd(), 'src/lib/components/user/workspace-manager-panel.svelte');

describe('workspace manager panel', () => {
	it('keeps the workspace list clean without redundant one-workspace helper copy', () => {
		expect(existsSync(componentPath)).toBe(true);

		const source = readFileSync(componentPath, 'utf8');

		expect(source).toContain('Workspace Manager');
		expect(source).toContain('New workspace');
		expect(source).not.toContain('At least one workspace must remain on this device.');
		expect(source).not.toContain('At least one workspace must remain.');
	});
});
