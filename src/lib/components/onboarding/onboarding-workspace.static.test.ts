import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const componentPath = join(
	process.cwd(),
	'src/lib/components/onboarding/onboarding-workspace.svelte'
);

describe('onboarding workspace', () => {
	it('renders the preserved onboarding pages with the local-first steps', () => {
		expect(existsSync(componentPath)).toBe(true);

		const source = readFileSync(componentPath, 'utf8');

		expect(source).not.toContain('Link your account');
		expect(source).toContain('Workspace name');
		expect(source).toContain('Business profile');
		expect(source).not.toContain('Your profile');
		expect(source).not.toContain('About your business');
		expect(source).toContain('Import your setup data');
		expect(source).toContain('Bring in companies, rates, templates, and codes.');
		expect(source).toContain('Choose setup spreadsheet');
		expect(source).toContain('CSV or XLSX. Review mappings before import.');
		expect(source).toContain('Set up Kwantflow AI');
		expect(source).toContain('<LocalAiSetupCard compact />');
		expect(source).toContain('Step 1 of 3');
		expect(source).toContain('Step 2 of 3');
		expect(source).toContain('Step 3 of 3');
		expect(source).not.toContain('Step 4 of 4');
		expect(source).not.toContain('Step 5 of 5');
		expect(source).not.toContain('Step 5 of 6');
		expect(source).not.toContain('Step 6 of 6');
		expect(source).toContain("onboardingState.currentStep === 'workspace_creation_failed'");
		expect(source).toContain("workspaceFormStep = 'name'");
		expect(source).toContain('Role');
		expect(source).toContain('Industry');
		expect(source).toContain('Create workspace');
		expect(source).toContain('Continue');
		expect(source).toContain('Skip for now');
		expect(source).toContain('placeholder="e.g. Acme Fabrication"');
		expect(source).toContain('FieldLabel for="contact-first-name">First Name</FieldLabel>');
		expect(source).toContain('FieldLabel for="contact-last-name">Last Name</FieldLabel>');
		expect(source).toContain('FieldLabel for="contact-email">Contact email</FieldLabel>');
		expect(source).toContain('bind:value={workspaceValues.businessContactEmail}');
		expect(source).toContain('<SetupImportDialog');
		expect(source).toContain('PhoneInput');
		expect(source).not.toContain('Continue with email');
		expect(source).not.toContain('Open email sign-in');
		expect(source).not.toContain('Continue in your browser');
		expect(source).not.toContain('Hosted account setup is still required.');
		expect(source).not.toContain('Select a workspace');
		expect(source).not.toContain(
			'Optionally import companies, rates, templates, and classifications now so this workspace is ready before you enter the app.'
		);
	});

	it('keeps the preserved split onboarding shell and artwork', () => {
		const source = readFileSync(componentPath, 'utf8');

		expect(source).toContain('ui-onboarding-split');
		expect(source).toContain('ui-onboarding-pane');
		expect(source).toContain('ui-onboarding-pane-content');
		expect(source).toContain('onboardingSidebarMarkUrl');
		expect(source).toContain('/images/login-hero-industrial.jpg');
		expect(source).not.toContain('ui-boot-center');
		expect(source).not.toContain('ui-pane-card max-w-xl');
	});
});
