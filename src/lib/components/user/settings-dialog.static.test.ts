import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const componentPath = join(process.cwd(), 'src/lib/components/user/settings-dialog.svelte');

describe('settings dialog', () => {
	it('keeps locale defaults hidden while deriving tax wording from the workspace country', () => {
		expect(existsSync(componentPath)).toBe(true);

		const source = readFileSync(componentPath, 'utf8');

		expect(source).toContain("import PhoneInput from '$lib/components/phone-input.svelte';");
		expect(source).toContain("import { normaliseEmailValue } from '$lib/services/email.js';");
		expect(source).toContain('getWorkspaceCountryTaxDefaults');
		expect(source).toContain('formatPhoneDraft');
		expect(source).toContain(
			'businessContactEmail: normaliseEmailValue(payload.businessContactEmail)'
		);
		expect(source).toContain('selectedCountryTaxDefaults.taxDisplayLabel');
		expect(source).toContain('Date Format');
		expect(source).toContain('Measurement Unit');
		expect(source).toContain("name: 'User'");
		expect(source).toContain("name: 'Workspace'");
		expect(source).toContain("name: 'Business'");
		expect(source).not.toContain("name: 'Workspace & Business'");
		expect(source).not.toContain("name: 'Business Profile'");
		expect(source).toContain("activeStep === 'business'");
		expect(source).toContain("name: 'General'");
		expect(source).toContain("name: 'Setup Pages'");
		expect(source).toContain("name: 'Backups'");
		expect(source).toContain("name: 'Connections'");
		expect(source).toContain("activeStep === 'general'");
		expect(source).toContain("activeStep === 'setup-pages'");
		expect(source).toContain("activeStep === 'backups'");
		expect(source).toContain("activeStep === 'connections'");
		expect(source).not.toContain('Accounting');
		expect(source).not.toContain('QuickBooks');
		expect(source).not.toContain('ERPs');
		expect(source).toContain('googleLogoUrl');
		expect(source).not.toContain('xeroLogoUrl');
		expect(source).not.toContain('quickbooksLogoUrl');
		expect(source).not.toContain('sageLogoUrl');
		expect(source).not.toContain('Connections are coming soon');
		expect(source).not.toContain('Email connections are not active yet');
		expect(source).not.toContain('Accounting and ERP connections are coming soon');
		expect(source).toContain('loadProviderSettings');
		expect(source).toContain('saveProviderSettings');
		expect(source).toContain("connection.status === 'revoked'");
		expect(source).toContain('connection.lastError');
		expect(source).toContain('promptImportArchive');
		expect(source).toContain('exportPortableBackup');
		expect(source).toContain('{#if backupState.status.retainedRecoveryPaths.length > 0}');
		expect(source).toContain('Original data retained');
		expect(source).toContain('backupState.status.retainedRecoveryPaths as path (path)');
		expect(source).toContain('class="h-32"');
		expect(source).toMatch(
			/viewportProps=\{\{\s*tabindex: 0,\s*role: 'region',\s*'aria-label': 'Retained original data'\s*\}\}/
		);
		expect(source).not.toContain('Restore this backup?');
		expect(source).not.toContain('restoreDialogOpen');
		expect(source).toContain("appState.openLocalDocumentation('help')");
		expect(source).toContain("appState.openLocalDocumentation('license')");
		expect(source).toContain("appState.openLocalDocumentation('notices')");
		expect(source).toContain('appState.exportLocalDiagnostics()');
		expect(source).toContain('Export diagnostic logs');
		expect(source).not.toContain('supportReportState');
		expect(source).not.toContain('cloudWorkspaceId');
		expect(source).not.toContain('shareUsageData');
		expect(source).toContain("name: 'Knowledge'");
		expect(source).toContain('<WorkspaceKnowledgeSettingsPanel');
		expect(source).toContain('FieldLabelRow');
		expect(source).toContain('currencyCode');
		expect(source).toContain('<PhoneInput');
		expect(source).toContain('countryCode={formValues.countryCode}');
		expect(source).toContain(
			'const formattedAccountPhone = formatPhoneDraft(payload.phone, payload.countryCode);'
		);
		expect(source).toContain('phone: formattedAccountPhone');
		expect(source).toContain('<WorkspaceManagerPanel');
		expect(source).not.toContain('Workspace name changes apply to the current workspace.');
		expect(source).toContain('WORKSPACE_COUNTRY_OPTIONS');
		expect(source).toContain("countryCode: 'business'");
		expect(source).toContain('if (!isSaving) closeSettingsDialogImmediately();');
		expect(source).toContain('size="lg"');
		expect(source).toContain('contentWidth="form"');
		expect(source).toContain('ui-choice-card');
		expect(source).toContain('ui-choice-card-active');
		expect(source).toContain('ui-choice-card-inactive');
		expect(source).toContain('ui-choice-card relative items-start');
		expect(source).toContain('helperText="PNG, JPEG, or SVG used on quotes and PDF exports."');
		expect(source).toContain('pickLabel="Upload logo"');
		expect(source).toContain('clearLabel="Remove logo"');
		expect(source).toContain('class="mt-1"');
		expect(source).not.toContain('pt-0.5');
		expect(source).not.toContain('<Text>Workspace logo</Text>');
		expect(source).not.toContain('md:grid-cols-[auto_minmax(0,1fr)]');
		expect(source).not.toContain('handleBusinessContactPhoneInput');
		expect(source).not.toContain('handleAccountPhoneInput');
		expect(source).not.toContain('Account avatar');
		expect(source).not.toContain('handleAvatarPick');
		expect(source).not.toContain('clearAvatar');
		expect(source).not.toContain('stagedAvatarPath');
		expect(source).not.toContain('avatarPreviewUrl');
		expect(source).toContain('primaryOperatorRole');
		expect(source).not.toContain('Upgrade to Pro');
		expect(source).not.toContain('Pro Plan');
		expect(source).not.toContain('Danger Zone');
		expect(source).not.toContain('Language Locale');
		expect(source).not.toContain('Number Locale');
		expect(source).not.toContain("name: 'Preferences'");
		expect(source).not.toContain("activeStep === 'defaults'");
	});
});
