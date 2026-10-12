import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const componentPath = join(process.cwd(), 'src/lib/components/assets/MultiFileViewer.svelte');

describe('multi file viewer AI eligibility indicator', () => {
	it('renders the tab dot from runtime file eligibility with user-facing tooltip copy', () => {
		const source = readFileSync(componentPath, 'utf8');

		expect(source).toContain('resolveEstimateAiFileEligibilities');
		expect(source).toContain('resolveAiIndicator(file.id)');
		expect(source).toContain('const eligibility = fileEligibilityById[fileId];');
		expect(source).toContain('tooltipLabel');
		expect(source).toContain('tooltipDetail');
		expect(source).toContain(
			"eligibility.status === 'eligible' ? 'status-dot-success' : 'status-dot-warning'"
		);
		expect(source).not.toContain('native image input');
		expect(source).not.toContain('Sent as a native image input');
	});
});
