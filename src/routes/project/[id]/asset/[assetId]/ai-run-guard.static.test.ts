import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const routePath = join(process.cwd(), 'src/routes/project/[id]/asset/[assetId]/+page.svelte');

describe('asset route AI run guard', () => {
	it('allows background AI runs and keeps only the dirty-estimate guard', () => {
		const source = readFileSync(routePath, 'utf8');

		expect(source).toContain('aiState.isRunActive(asset.id)');
		expect(source).toContain('aiState.hasPendingAppliedEstimate(asset.id)');
		expect(source).toContain('aiState.getEstimateBeforeApply(asset.id)');
		expect(source).toContain('aiState.revertAutoAppliedEstimate(asset.id)');
		expect(source).not.toContain('Cancel AI draft and leave?');
		expect(source).not.toContain('Cancel AI and leave');
		expect(source).toContain('Discard changes');
		expect(source).toContain('Cancel');
		expect(source).toContain('Discard unsaved estimate changes?');
	});
});
