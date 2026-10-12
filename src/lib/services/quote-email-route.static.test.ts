import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('quote email route fallback', () => {
	it('keeps the canonical deterministic draft when AI rewriting fails', () => {
		const source = readFileSync(
			join(process.cwd(), 'src/routes/project/[id]/quote/pdf/+page.svelte'),
			'utf8'
		);

		expect(source).toContain('deterministicFallbackDraft = currentDraft;');
		expect(source).toContain('sendQuoteDraft = deterministicFallbackDraft;');
		expect(source).not.toContain('fallbackTotal');
	});
});
