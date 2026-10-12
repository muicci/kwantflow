import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(relativePath: string): string {
	return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('input consistency contract', () => {
	it('keeps migrated form surfaces on the shared field-primitive contract', () => {
		const onboardingSource = readSource(
			'src/lib/components/onboarding/onboarding-workspace.svelte'
		);
		const wbsNodeSource = readSource('src/lib/components/wbs/wbs-node-dialog.svelte');
		const structureTemplateSource = readSource(
			'src/lib/components/wbs/project-structure-template-editor-dialog.svelte'
		);

		expect(onboardingSource).toContain('FieldShell');
		expect(onboardingSource).toContain('FieldLabel');
		expect(onboardingSource).toContain('FieldError');
		expect(onboardingSource).toContain('workspaceErrors.workspaceName');
		expect(wbsNodeSource).toContain(
			"import { getFieldInvalidTone } from '$lib/utils/field-errors.js';"
		);
		expect(structureTemplateSource).toContain(
			"import { getFieldInvalidTone } from '$lib/utils/field-errors.js';"
		);
		expect(onboardingSource).not.toContain('getFieldErrorInputClass');
		expect(onboardingSource).not.toContain('getFieldErrorMessageClass');
		expect(onboardingSource).not.toContain('caption px-1 text-destructive');
		expect(wbsNodeSource).not.toContain('caption px-1 text-destructive');
		expect(structureTemplateSource).not.toContain('caption px-1 text-destructive');
	});

	it('keeps numeric entry fields visually aligned for business data', () => {
		const settingsSource = readSource('src/lib/components/user/settings-dialog.svelte');
		const subcontractRateSource = readSource(
			'src/lib/components/subcontract-rates/subcontract-rate-dialog.svelte'
		);
		const setupImportSource = readSource('src/lib/components/user/setup-import-dialog.svelte');

		expect(settingsSource).toContain('text-right tabular-nums');
		expect(subcontractRateSource).toContain('text-right tabular-nums');
		expect(setupImportSource).toContain('class="text-right tabular-nums"');
		expect(setupImportSource).not.toContain('text-right text-foreground tabular-nums');
	});

	it('normalises editable email saves through the shared helper', () => {
		const settingsSource = readSource('src/lib/components/user/settings-dialog.svelte');
		const dbSource = readSource('src/lib/services/db.ts');
		const setupImportSource = readSource('src/lib/services/setup-import.ts');

		expect(settingsSource).toContain(
			"import { normaliseEmailValue } from '$lib/services/email.js';"
		);
		expect(settingsSource).toContain(
			'businessContactEmail: normaliseEmailValue(payload.businessContactEmail)'
		);
		expect(dbSource).toContain("import { normaliseEmailValue } from './email.js';");
		expect(setupImportSource).toContain(
			"import { normaliseEmailValue as normalisePersistedEmailValue } from '$lib/services/email.js';"
		);
	});

	it('keeps native email inputs aligned with browser autofill semantics', () => {
		for (const relativePath of [
			'src/lib/components/contacts/contact-dialog.svelte',
			'src/lib/components/onboarding/onboarding-workspace.svelte',
			'src/lib/components/user/settings-dialog.svelte',
			'src/lib/components/quote/quote-email-dialog.svelte'
		]) {
			const source = readSource(relativePath);
			const emailInputCount = (source.match(/type="email"/g) ?? []).length;
			const autocompleteEmailCount = (source.match(/autocomplete="email"/g) ?? []).length;

			expect(autocompleteEmailCount, relativePath).toBeGreaterThanOrEqual(emailInputCount);
		}
	});
});
