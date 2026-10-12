import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourcePath = join(process.cwd(), 'src/lib/components/workspace-context-rail.svelte');

describe('workspace context rail visual contract', () => {
	it('gives dynamic asset navigation pills enough right padding for long asset names', () => {
		const source = readFileSync(sourcePath, 'utf8');

		expect(source).toContain('flex flex-col gap-0.5 pr-1 pb-2 pl-3');
		expect(source).toContain('ui-workspace-asset-nav-row');
		expect(source).toContain('title={asset.display_name}');
		expect(source).toContain('class="shell-label min-w-0 truncate text-start"');
	});
});
