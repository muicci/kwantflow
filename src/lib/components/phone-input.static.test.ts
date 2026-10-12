import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const componentPath = join(process.cwd(), 'src/lib/components/phone-input.svelte');

describe('phone input', () => {
	it('centralises tel semantics and shared phone draft formatting', () => {
		expect(existsSync(componentPath)).toBe(true);

		const source = readFileSync(componentPath, 'utf8');

		expect(source).toContain("import { formatPhoneDraft } from '$lib/services/phone.js';");
		expect(source).toContain('type="tel"');
		expect(source).toContain('inputmode="tel"');
		expect(source).toContain('autocomplete="tel"');
		expect(source).toContain("placeholder = 'Phone number'");
		expect(source).toContain('oninput={handleInput}');
		expect(source).toContain('countryCode');
	});
});
