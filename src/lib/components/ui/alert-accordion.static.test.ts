import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const alertIndexPath = join(process.cwd(), 'src/lib/components/ui/alert/index.ts');
describe('shared alert primitives', () => {
	it('exports the alert building blocks', () => {
		expect(existsSync(alertIndexPath)).toBe(true);
		const source = readFileSync(alertIndexPath, 'utf8');

		expect(source).toContain("import Root from './alert.svelte';");
		expect(source).toContain("import Title from './alert-title.svelte';");
		expect(source).toContain("import Description from './alert-description.svelte';");
		expect(source).toContain('Root as Alert');
	});
});
