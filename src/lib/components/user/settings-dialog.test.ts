import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsDialog from './test-settings-dialog-host.svelte';

const mocks = vi.hoisted(() => ({
	app: {
		settingsDialogRequestedTab: 'business',
		hiddenSetupPageIds: [],
		optionalSetupPageRecordCounts: {},
		hasInternet: true,
		closeSettingsDialog: vi.fn(),
		openLocalDocumentation: vi.fn().mockResolvedValue(undefined),
		refreshOptionalSetupPageRecordCounts: vi.fn().mockResolvedValue(undefined),
		setVisibleSetupPageIds: vi.fn().mockResolvedValue(undefined)
	},
	account: {
		accountEmail: '',
		phone: '',
		avatarPath: '',
		update: vi.fn().mockResolvedValue(undefined)
	},
	workspace: {
		id: 'synthetic-qa',
		displayName: 'Synthetic Workspace',
		countryCode: 'AU',
		businessName: 'Synthetic Fabrication',
		businessContactFirstName: 'Synthetic',
		businessContactLastName: 'Operator',
		businessContactEmail: 'operator@example.test',
		businessContactPhone: '',
		businessIdValue: '',
		businessAddress: '',
		emailSignature: 'Synthetic signature',
		logoFilePath: 'workspaces/synthetic-qa/logo-old.png',
		primaryOperatorRole: 'owner_founder',
		industry: '',
		currencyCode: 'AUD',
		currencySymbol: '$',
		measurementUnit: 'Metric',
		dateFormat: 'en-AU',
		languageLocale: 'en-AU',
		numberLocale: 'en-AU',
		taxRatePercentage: 10,
		quotePaymentTerms: 'Due on receipt',
		quoteValidityDays: 30,
		quoteDefaultInclusions: '',
		quoteDefaultExclusions: '',
		quoteDefaultTerms: '',
		quoteNumberPrefix: 'Q',
		quoteNumberFormat: '{prefix}-{yyyy}-{seq}',
		updateProfile: vi.fn(),
		updateOnboardingProfile: vi.fn().mockResolvedValue(undefined),
		updateDefaults: vi.fn().mockResolvedValue(undefined)
	},
	backup: {
		status: { recentSnapshots: [], retainedRecoveryPaths: [] },
		automaticCadenceLabel: 'Weekly',
		lastBackupSummary: null,
		isCreatingAutomaticBackup: false,
		isCreatingManualBackup: false,
		isExportingBackup: false,
		isInspectingArchive: false,
		get isBusy() {
			return this.isCreatingAutomaticBackup || this.isCreatingManualBackup;
		},
		createManualBackup: vi.fn(),
		exportPortableBackup: vi.fn(),
		promptImportArchive: vi.fn()
	},
	integrations: {
		connections: [],
		isGoogleConnected: false,
		isMicrosoftConnected: false,
		connectedGoogle: { id: 'synthetic-google', label: 'Synthetic Gmail' },
		connectedMicrosoft: { id: 'synthetic-microsoft', label: 'Synthetic Outlook' },
		status: { google_gmail: 'idle', microsoft_outlook: 'idle' },
		providerSettings: { googleClientId: '', microsoftClientId: '', microsoftTenant: 'common' },
		providerSettingsLoading: false,
		providerSettingsSaving: false,
		loadProviderSettings: vi.fn().mockResolvedValue(undefined),
		saveProviderSettings: vi.fn().mockResolvedValue(undefined),
		cancelGoogleOAuth: vi.fn().mockResolvedValue(undefined),
		cancelMicrosoftOAuth: vi.fn().mockResolvedValue(undefined)
	},
	openDialog: vi.fn(),
	storeWorkspaceLogo: vi.fn(),
	removeVaultFile: vi.fn(),
	catchError: vi.fn().mockResolvedValue(undefined),
	captureLayoutWarning: vi.fn(),
	logger: { warn: vi.fn() },
	toast: { error: vi.fn(), success: vi.fn() }
}));

vi.mock('$lib/state/app.svelte.js', () => ({ appState: mocks.app }));
vi.mock('$lib/state/account.svelte.js', () => ({ accountState: mocks.account }));
vi.mock('$lib/state/workspace.svelte.js', () => ({ workspaceState: mocks.workspace }));
vi.mock('$lib/state/backup.svelte.js', () => ({ backupState: mocks.backup }));
vi.mock('$lib/state/integrations.svelte.js', () => ({ integrationsState: mocks.integrations }));
vi.mock('$lib/state/errors.svelte.js', () => ({
	errorState: { catchError: mocks.catchError, captureLayoutWarning: mocks.captureLayoutWarning }
}));
vi.mock('$lib/state/app-tabs.svelte.js', () => ({ APP_SHELL_PAGE_DESTINATIONS: [] }));
vi.mock('$lib/services/logger.js', () => ({ createLogger: () => mocks.logger }));
vi.mock('$lib/utils/env.js', () => ({ isTauri: () => true }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.openDialog }));
vi.mock('svelte-sonner', () => ({ toast: mocks.toast }));
vi.mock('$lib/services/assets.js', () => ({
	getAppLocalFileUrl: vi.fn().mockResolvedValue('blob:synthetic-new'),
	getVaultImagePreviewUrl: vi.fn().mockResolvedValue('blob:synthetic-old'),
	storeWorkspaceLogo: mocks.storeWorkspaceLogo,
	removeVaultFile: mocks.removeVaultFile
}));
vi.mock('./ai-settings-panel.svelte', () => ({ default: () => {} }));
vi.mock('./workspace-knowledge-settings-panel.svelte', () => ({ default: () => {} }));
vi.mock('./workspace-manager-panel.svelte', () => ({ default: () => {} }));

describe('consumer Settings operation failures', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.app.settingsDialogRequestedTab = 'business';
		mocks.app.hasInternet = true;
		mocks.workspace.logoFilePath = 'workspaces/synthetic-qa/logo-old.png';
		mocks.workspace.businessName = 'Synthetic Fabrication';
		mocks.workspace.updateProfile.mockReset().mockImplementation(async (updates) => {
			Object.assign(mocks.workspace, updates);
		});
		mocks.backup.isCreatingAutomaticBackup = false;
		mocks.integrations.isGoogleConnected = false;
		mocks.integrations.isMicrosoftConnected = false;
		mocks.integrations.status.google_gmail = 'idle';
		mocks.integrations.status.microsoft_outlook = 'idle';
		mocks.integrations.providerSettings = {
			googleClientId: '',
			microsoftClientId: '',
			microsoftTenant: 'common'
		};
		mocks.integrations.providerSettingsLoading = false;
		mocks.integrations.providerSettingsSaving = false;
		mocks.integrations.loadProviderSettings.mockReset().mockResolvedValue(undefined);
		mocks.integrations.saveProviderSettings.mockReset().mockResolvedValue(undefined);
		mocks.openDialog.mockResolvedValue('/synthetic/new-logo.png');
		mocks.storeWorkspaceLogo.mockResolvedValue('workspaces/synthetic-qa/logo-new.png');
		mocks.removeVaultFile.mockReset().mockResolvedValue(undefined);
		vi.stubGlobal('matchMedia', () => ({
			matches: false,
			addEventListener() {},
			removeEventListener() {}
		}));
		vi.stubGlobal(
			'ResizeObserver',
			class {
				observe() {}
				disconnect() {}
			}
		);
		vi.stubGlobal(
			'IntersectionObserver',
			class {
				observe() {}
				disconnect() {}
			}
		);
		vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('disables every backup action while the weekly automatic backup is running', async () => {
		mocks.app.settingsDialogRequestedTab = 'backups';
		mocks.backup.isCreatingAutomaticBackup = true;
		const view = render(SettingsDialog, { open: true });
		for (const name of ['Back Up Now', 'Export backup', 'Import backup']) {
			const button = await view.findByRole('button', { name });
			expect(button.hasAttribute('disabled')).toBe(true);
		}
	});

	it('opens the bundled email setup guide while offline with mailboxes unconfigured', async () => {
		mocks.app.settingsDialogRequestedTab = 'connections';
		mocks.app.hasInternet = false;
		const view = render(SettingsDialog, { open: true });
		await fireEvent.click(await view.findByRole('button', { name: 'Email setup guide' }));
		expect(mocks.app.openLocalDocumentation).toHaveBeenCalledExactlyOnceWith('email_setup');
		expect(view.getByRole('button', { name: 'Connect with Gmail' }).hasAttribute('disabled')).toBe(
			true
		);
		expect(
			view.getByRole('button', { name: 'Connect with Outlook' }).hasAttribute('disabled')
		).toBe(true);
		expect(mocks.toast.error).not.toHaveBeenCalled();
	});

	it('shows the native String error when local email registration settings cannot load', async () => {
		mocks.app.settingsDialogRequestedTab = 'connections';
		mocks.integrations.loadProviderSettings.mockRejectedValueOnce(
			'Email provider settings are invalid. Reconfigure them in Settings.'
		);
		const view = render(SettingsDialog, { open: true });
		expect(
			await view.findByText('Email provider settings are invalid. Reconfigure them in Settings.')
		).toBeTruthy();
	});

	it('preserves the native String validation error and entered client ID after a rejected save', async () => {
		mocks.app.settingsDialogRequestedTab = 'connections';
		mocks.integrations.saveProviderSettings.mockRejectedValueOnce(
			'Google setup requires a Desktop OAuth client ID ending in .apps.googleusercontent.com.'
		);
		const view = render(SettingsDialog, { open: true });
		await waitFor(() => expect(mocks.integrations.loadProviderSettings).toHaveBeenCalledOnce());
		const input = view.getByRole('textbox', { name: 'Google Desktop client ID' });
		await fireEvent.input(input, { target: { value: 'wrong-client-id' } });
		await fireEvent.click(view.getByRole('button', { name: 'Save email registrations' }));
		expect(
			await view.findByText(
				'Google setup requires a Desktop OAuth client ID ending in .apps.googleusercontent.com.'
			)
		).toBeTruthy();
		expect(mocks.integrations.saveProviderSettings).toHaveBeenCalledExactlyOnceWith({
			googleClientId: 'wrong-client-id',
			microsoftClientId: '',
			microsoftTenant: 'common'
		});
		expect((input as HTMLInputElement).value).toBe('wrong-client-id');
		expect(mocks.toast.success).not.toHaveBeenCalled();
	});

	it.each(['success', 'failure'] as const)(
		'ignores an old email registration save %s after Settings closes and reopens',
		async (outcome) => {
			mocks.app.settingsDialogRequestedTab = 'connections';
			let finishSave!: () => void;
			let failSave!: (error: string) => void;
			mocks.integrations.saveProviderSettings.mockReturnValueOnce(
				new Promise<void>((resolve, reject) => {
					finishSave = resolve;
					failSave = reject;
				})
			);
			const view = render(SettingsDialog, { open: true });
			await fireEvent.click(await view.findByRole('button', { name: 'Save email registrations' }));
			await waitFor(() => expect(mocks.integrations.saveProviderSettings).toHaveBeenCalledOnce());
			await view.rerender({ open: false });
			await waitFor(() => expect(view.queryByRole('dialog')).toBeNull());
			await view.rerender({ open: true });
			await view.findByRole('button', { name: 'Save email registrations' });
			if (outcome === 'success') finishSave();
			else failSave('Synthetic earlier registration save failed.');
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(mocks.toast.success).not.toHaveBeenCalled();
			expect(view.queryByText('Synthetic earlier registration save failed.')).toBeNull();
			expect(view.queryByText('Email registrations could not be saved.')).toBeNull();
		}
	);

	it.each(['google', 'microsoft'] as const)(
		'shows a usable Cancel for an existing %s mailbox during reconnect',
		async (provider) => {
			mocks.app.settingsDialogRequestedTab = 'connections';
			if (provider === 'google') {
				mocks.integrations.isGoogleConnected = true;
				mocks.integrations.status.google_gmail = 'connecting';
			} else {
				mocks.integrations.isMicrosoftConnected = true;
				mocks.integrations.status.microsoft_outlook = 'connecting';
			}
			const view = render(SettingsDialog, { open: true });
			await fireEvent.click(await view.findByRole('button', { name: 'Cancel' }));
			expect(
				provider === 'google'
					? mocks.integrations.cancelGoogleOAuth
					: mocks.integrations.cancelMicrosoftOAuth
			).toHaveBeenCalledOnce();
		}
	);

	it('preserves the previous logo when replacement profile persistence fails and leaves Save available', async () => {
		mocks.workspace.updateProfile.mockRejectedValueOnce(new Error('disk write failed'));
		const view = render(SettingsDialog, { open: true });
		await fireEvent.click((await view.findAllByRole('button', { name: 'Upload logo' }))[0]);
		await waitFor(() => expect(mocks.openDialog).toHaveBeenCalledOnce());
		await fireEvent.click(await view.findByRole('button', { name: 'Save Settings' }));
		await waitFor(() => expect(mocks.catchError).toHaveBeenCalledOnce());
		expect(mocks.workspace.logoFilePath).toBe('workspaces/synthetic-qa/logo-old.png');
		expect(mocks.removeVaultFile).not.toHaveBeenCalled();
		expect(view.getByRole('button', { name: 'Save Settings' }).hasAttribute('disabled')).toBe(
			false
		);
	});

	it('reports a failed logo picker without changing or removing the existing logo', async () => {
		const pickerError = new Error('Cannot open logo picker');
		mocks.openDialog.mockRejectedValueOnce(pickerError);
		const view = render(SettingsDialog, { open: true });
		await fireEvent.click((await view.findAllByRole('button', { name: 'Upload logo' }))[0]);
		await waitFor(() =>
			expect(mocks.catchError).toHaveBeenCalledWith(pickerError, 'Choose workspace logo')
		);
		expect(mocks.workspace.logoFilePath).toBe('workspaces/synthetic-qa/logo-old.png');
		expect(mocks.removeVaultFile).not.toHaveBeenCalled();
		expect(mocks.storeWorkspaceLogo).not.toHaveBeenCalled();
	});

	it('ignores a logo picker result from an earlier Settings session', async () => {
		let selectLogo!: (path: string) => void;
		mocks.openDialog.mockReturnValueOnce(new Promise<string>((resolve) => (selectLogo = resolve)));
		const view = render(SettingsDialog, { open: true });
		await fireEvent.click((await view.findAllByRole('button', { name: 'Upload logo' }))[0]);
		await view.rerender({ open: false });
		await waitFor(() => expect(view.queryByRole('dialog')).toBeNull());
		await view.rerender({ open: true });
		await fireEvent.input(await view.findByRole('textbox', { name: 'Business Name' }), {
			target: { value: 'Synthetic Updated Fabrication' }
		});
		selectLogo('/synthetic/stale-logo.png');
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fireEvent.click(view.getByRole('button', { name: 'Save Settings' }));
		await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Settings updated'));
		expect(mocks.storeWorkspaceLogo).not.toHaveBeenCalled();
		expect(mocks.workspace.logoFilePath).toBe('workspaces/synthetic-qa/logo-old.png');
	});

	it('keeps Settings open until an in-flight profile save commits', async () => {
		let finishSave!: () => void;
		mocks.workspace.updateProfile.mockImplementationOnce(
			() => new Promise<void>((resolve) => (finishSave = resolve))
		);
		const view = render(SettingsDialog, { open: true });
		await fireEvent.input(await view.findByRole('textbox', { name: 'Business Name' }), {
			target: { value: 'Synthetic Updated Fabrication' }
		});
		await fireEvent.click(await view.findByRole('button', { name: 'Save Settings' }));
		await waitFor(() => expect(mocks.workspace.updateProfile).toHaveBeenCalledOnce());
		await fireEvent.click(view.getByRole('button', { name: 'Close settings' }));
		expect(mocks.app.closeSettingsDialog).not.toHaveBeenCalled();
		finishSave();
		await waitFor(() => expect(mocks.app.closeSettingsDialog).toHaveBeenCalledOnce());
	});

	it('cleans only the old logo after replacement is persisted, and cleanup failure does not undo the saved profile', async () => {
		mocks.removeVaultFile.mockRejectedValueOnce(new Error('old logo cleanup failed'));
		const view = render(SettingsDialog, { open: true });
		await fireEvent.click((await view.findAllByRole('button', { name: 'Upload logo' }))[0]);
		await waitFor(() => expect(mocks.openDialog).toHaveBeenCalledOnce());
		await fireEvent.click(await view.findByRole('button', { name: 'Save Settings' }));
		await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Settings updated'));
		expect(mocks.workspace.logoFilePath).toBe('workspaces/synthetic-qa/logo-new.png');
		expect(mocks.removeVaultFile).toHaveBeenCalledExactlyOnceWith(
			'workspaces/synthetic-qa/logo-old.png'
		);
		expect(mocks.workspace.updateProfile.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.removeVaultFile.mock.invocationCallOrder[0]
		);
		expect(mocks.logger.warn).toHaveBeenCalledOnce();
		expect(mocks.catchError).not.toHaveBeenCalled();
	});
});
