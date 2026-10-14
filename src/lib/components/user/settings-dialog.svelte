<script lang="ts">
	import { onDestroy, tick, untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import BriefcaseIcon from '@lucide/svelte/icons/briefcase';
	import BuildingIcon from '@lucide/svelte/icons/building';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import HardDriveDownloadIcon from '@lucide/svelte/icons/hard-drive-download';
	import MoreHorizontalIcon from '@lucide/svelte/icons/more-horizontal';
	import PanelLeftIcon from '@lucide/svelte/icons/panel-left';
	import PlugIcon from '@lucide/svelte/icons/plug';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import Settings2Icon from '@lucide/svelte/icons/settings-2';
	import SparkleIcon from '@lucide/svelte/icons/sparkle';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import UserIcon from '@lucide/svelte/icons/user';
	import googleLogoUrl from '$lib/assets/integration-logos/google.svg';
	import microsoftLogoUrl from '$lib/assets/integration-logos/microsoft.svg';

	const POLL_LABELS: Record<string, string> = {
		off: 'Off',
		'15m': '15 min',
		'30m': '30 min',
		'1h': '1 hr'
	};

	import { open as openDialog } from '@tauri-apps/plugin-dialog';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import {
		FieldError,
		FieldLabel,
		FieldLabelRow,
		FieldShell,
		Meta,
		Text
	} from '$lib/components/primitives/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import PhoneInput from '$lib/components/phone-input.svelte';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as ScrollArea from '$lib/components/ui/scroll-area/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import CircularImagePicker from '$lib/components/circular-image-picker.svelte';
	import IntegrationConsentDialog from '$lib/components/user/integration-consent-dialog.svelte';
	import { errorState } from '$lib/state/errors.svelte.js';
	import { appState } from '$lib/state/app.svelte.js';
	import { accountState } from '$lib/state/account.svelte.js';
	import { backupState } from '$lib/state/backup.svelte.js';
	import { workspaceState } from '$lib/state/workspace.svelte.js';
	import { settingsProfileSchema, type SettingsProfileValues } from '$lib/schemas/index.js';
	import {
		APP_VERSION,
		BRAND_LOGO_EXTENSIONS,
		CURRENCY_OPTIONS,
		DATE_FORMAT_OPTIONS,
		INDUSTRY_OPTIONS,
		ONBOARDING_OPERATOR_ROLE_OPTIONS,
		WORKSPACE_COUNTRY_OPTIONS,
		formatIdentifierLabel,
		getCurrencySymbol,
		getWorkspaceCountryLanguageLocale,
		getWorkspaceCountryNumberLocale,
		getWorkspaceCountryProfile,
		getWorkspaceCountryTaxDefaults,
		type SupportedCurrencyCode,
		type SupportedDateFormat
	} from '$lib/constants/index.js';
	import {
		OPTIONAL_SETUP_PAGE_IDS,
		type OptionalSetupPageId
	} from '$lib/constants/setup-page-visibility.js';
	import {
		getAppLocalFileUrl,
		getVaultImagePreviewUrl,
		removeVaultFile,
		storeWorkspaceLogo
	} from '$lib/services/assets.js';
	import { normaliseEmailValue } from '$lib/services/email.js';
	import { createLogger } from '$lib/services/logger.js';
	import { formatPhoneDraft } from '$lib/services/phone.js';
	import { isTauri } from '$lib/utils/env.js';
	import { getFieldInvalidTone } from '$lib/utils/field-errors.js';
	import { getErrorMessage } from '$lib/utils/runtime-form-errors.js';
	import { buildPersonDisplayName } from '$lib/utils/person-name.js';
	import { APP_SHELL_PAGE_DESTINATIONS } from '$lib/state/app-tabs.svelte.js';
	import { integrationsState } from '$lib/state/integrations.svelte.js';
	import AiSettingsPanel from './ai-settings-panel.svelte';
	import WorkspaceKnowledgeSettingsPanel from './workspace-knowledge-settings-panel.svelte';
	import WorkspaceManagerPanel from './workspace-manager-panel.svelte';
	import type { BackupReason, BackupSummary } from '$lib/services/backup.js';

	type SettingsStep =
		| 'workspace'
		| 'business'
		| 'account'
		| 'general'
		| 'setup-pages'
		| 'backups'
		| 'connections'
		| 'knowledge'
		| 'ai';
	type SettingsField = keyof SettingsProfileValues;
	type KnowledgePanelState = {
		hasUnsavedChanges: boolean;
		canSave: boolean;
		isSaving: boolean;
	};

	let { open = $bindable(false) }: { open?: boolean } = $props();
	const log = createLogger('settingsDialog');

	const id = $props.id();
	const emailSignatureHint = 'Best regards,\nJane Doe\nProject Manager\n0412 345 678';
	const baseNav = [
		{ id: 'account' as const, name: 'User', icon: UserIcon },
		{ id: 'workspace' as const, name: 'Workspace', icon: BuildingIcon },
		{ id: 'business' as const, name: 'Business', icon: BriefcaseIcon },
		{ id: 'general' as const, name: 'General', icon: Settings2Icon },
		{ id: 'setup-pages' as const, name: 'Setup Pages', icon: PanelLeftIcon },
		{ id: 'backups' as const, name: 'Backups', icon: HardDriveDownloadIcon },
		{ id: 'connections' as const, name: 'Connections', icon: PlugIcon }
	];
	const knowledgeNav = { id: 'knowledge' as const, name: 'Knowledge', icon: FileTextIcon };
	const aiNav = { id: 'ai' as const, name: 'Agent', icon: SparkleIcon };
	const nav = $derived.by(() => [...baseNav, knowledgeNav, aiNav]);

	const settingsFieldStepMap: Record<SettingsField, SettingsStep> = {
		accountEmail: 'account',
		phone: 'account',
		avatar: 'account',
		currencySymbol: 'general',
		currencyCode: 'general',
		measurementUnit: 'general',
		dateFormat: 'general',
		languageLocale: 'general',
		numberLocale: 'general',
		taxRatePercentage: 'general',
		quotePaymentTerms: 'general',
		quoteValidityDays: 'general',
		quoteDefaultInclusions: 'general',
		quoteDefaultExclusions: 'general',
		quoteDefaultTerms: 'general',
		quoteNumberPrefix: 'general',
		quoteNumberFormat: 'general',
		displayName: 'workspace',
		countryCode: 'business',
		businessName: 'business',
		logoFilePath: 'business',
		businessContactFirstName: 'business',
		businessContactLastName: 'business',
		businessContactEmail: 'business',
		businessContactPhone: 'business',
		businessIdValue: 'business',
		businessAddress: 'business',
		emailSignature: 'business',
		primaryOperatorRole: 'business',
		industry: 'business'
	};

	let activeStep = $state<SettingsStep>('account');
	let isSaving = $state(false);
	let isResetting = $state(false);
	let isExportingDiagnostics = $state(false);
	let isSetupPageVisibilityLoading = $state(false);
	let resetDialogOpen = $state(false);
	let deleteBackupDialogOpen = $state(false);
	let disconnectGoogleDialogOpen = $state(false);
	let googleConsentDialogOpen = $state(false);
	let disconnectMicrosoftDialogOpen = $state(false);
	let microsoftConsentDialogOpen = $state(false);
	let disconnectingGoogleId = $state<string | null>(null);
	let disconnectingMicrosoftId = $state<string | null>(null);
	let isDisconnectingGoogle = $state(false);
	let isDisconnectingMicrosoft = $state(false);
	let stagedWorkspaceLogoPath = $state<string | null>(null);
	let stagedWorkspaceLogoPreviewUrl = $state('');
	let persistedWorkspaceLogoPreviewUrl = $state('');
	let workspaceKnowledgeSettingsPanel = $state<{
		savePlaybook: () => Promise<void>;
	} | null>(null);
	let initialSettingsSignature = $state('');
	let initialSetupVisibilitySignature = $state('');
	let hasAutoPopulatedEmailSignature = $state(false);
	let visibleSetupPageIds = $state<OptionalSetupPageId[]>([...OPTIONAL_SETUP_PAGE_IDS]);
	let wasOpen = $state(false);
	let settingsSession = 0;
	const visibleSetupPageOptions = APP_SHELL_PAGE_DESTINATIONS.filter((destination) =>
		OPTIONAL_SETUP_PAGE_IDS.includes(destination.id as OptionalSetupPageId)
	).map((destination) => ({
		id: destination.id as OptionalSetupPageId,
		title: destination.title
	}));

	let formValues = $state<SettingsProfileValues>({
		accountEmail: '',
		phone: '',
		avatar: '',
		currencySymbol: '$',
		currencyCode: 'AUD',
		measurementUnit: 'Metric',
		dateFormat: 'en-AU',
		languageLocale: 'en-AU',
		numberLocale: 'en-AU',
		taxRatePercentage: 10,
		quotePaymentTerms: 'Payment Terms: Due on receipt.',
		quoteValidityDays: 30,
		quoteDefaultInclusions: '',
		quoteDefaultExclusions: '',
		quoteDefaultTerms: '',
		quoteNumberPrefix: 'Q',
		quoteNumberFormat: '{prefix}-{yyyy}-{seq}',
		displayName: '',
		countryCode: 'AU',
		businessName: '',
		logoFilePath: '',
		businessContactFirstName: '',
		businessContactLastName: '',
		businessContactEmail: '',
		businessContactPhone: '',
		businessIdValue: '',
		businessAddress: '',
		emailSignature: '',
		primaryOperatorRole: 'owner_founder',
		industry: ''
	});

	let providerSettingsDraft = $state({
		googleClientId: '',
		microsoftClientId: '',
		microsoftTenant: 'common'
	});
	let providerSettingsError = $state<string | null>(null);
	const emailSettingsBusy = $derived(
		integrationsState.providerSettingsLoading || integrationsState.providerSettingsSaving
	);
	const backupActionsBusy = $derived(backupState.isBusy);

	async function loadProviderSettings(): Promise<void> {
		const session = settingsSession;
		providerSettingsError = null;
		try {
			await integrationsState.loadProviderSettings();
			if (!open || session !== settingsSession) return;
			if (integrationsState.providerSettings)
				providerSettingsDraft = { ...integrationsState.providerSettings };
		} catch (error) {
			if (!open || session !== settingsSession) return;
			providerSettingsError = getErrorMessage(error);
		}
	}

	async function saveProviderSettings(): Promise<void> {
		if (!open || emailSettingsBusy) return;
		const session = settingsSession;
		providerSettingsError = null;
		try {
			await integrationsState.saveProviderSettings({ ...providerSettingsDraft });
			if (!open || session !== settingsSession) return;
			if (integrationsState.providerSettings)
				providerSettingsDraft = { ...integrationsState.providerSettings };
			toast.success('Email registrations saved');
		} catch (error) {
			if (!open || session !== settingsSession) return;
			providerSettingsError = getErrorMessage(error);
		}
	}

	async function exportLocalDiagnostics(): Promise<void> {
		if (isExportingDiagnostics) return;
		isExportingDiagnostics = true;
		try {
			await appState.exportLocalDiagnostics();
		} finally {
			isExportingDiagnostics = false;
		}
	}

	let fieldErrors = $state<Record<string, string[] | undefined>>({});
	let isSavableStep = $derived(
		activeStep === 'workspace' ||
			activeStep === 'business' ||
			activeStep === 'account' ||
			activeStep === 'general' ||
			activeStep === 'setup-pages'
	);
	let hasDirtySettings = $derived(buildSettingsSignature(formValues) !== initialSettingsSignature);
	let hasDirtySetupVisibility = $derived(
		buildSetupVisibilitySignature(visibleSetupPageIds) !== initialSetupVisibilitySignature
	);
	let hasUnsavedChanges = $derived(
		hasDirtySettings || hasDirtySetupVisibility || Boolean(stagedWorkspaceLogoPath)
	);
	let knowledgePanelState = $state<KnowledgePanelState>({
		hasUnsavedChanges: false,
		canSave: false,
		isSaving: false
	});
	let showProfileFooter = $derived(isSavableStep && hasUnsavedChanges);
	let showKnowledgeFooter: boolean = $derived.by(
		() => activeStep === 'knowledge' && knowledgePanelState.hasUnsavedChanges
	);
	let selectedCountryProfile = $derived(getWorkspaceCountryProfile(formValues.countryCode));
	let selectedCountryTaxDefaults = $derived(getWorkspaceCountryTaxDefaults(formValues.countryCode));
	let workspaceLogoPreviewUrl = $derived(
		stagedWorkspaceLogoPreviewUrl || persistedWorkspaceLogoPreviewUrl
	);
	let selectedRoleLabel = $derived(getOperatorRoleLabel(formValues.primaryOperatorRole));
	let selectedIndustryLabel = $derived(
		(INDUSTRY_OPTIONS.find((option) => option.value === formValues.industry)?.label ??
			formValues.industry) ||
			'Choose industry'
	);
	let backupSnapshots = $derived(backupState.status.recentSnapshots ?? []);
	let visibleBackupLimit = $state(5);
	let visibleBackupSnapshots = $derived(backupSnapshots.slice(0, visibleBackupLimit));
	let hasMoreBackupSnapshots = $derived(backupSnapshots.length > visibleBackupLimit);
	let backupToDelete = $state<BackupSummary | null>(null);

	function formatBackupDateTime(value: string): string {
		const parsed = new Date(value);
		if (Number.isNaN(parsed.getTime())) {
			return value;
		}

		return new Intl.DateTimeFormat(undefined, {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(parsed);
	}

	function describeBackupReason(reason: BackupReason): string {
		switch (reason) {
			case 'auto':
				return 'Automatic backup';
			case 'manual':
				return 'Manual backup';
			case 'pre_update':
				return 'Before upgrade';
			case 'pre_restore':
				return 'Safety snapshot';
		}
	}

	function backupWorkspaceLabel(summary: BackupSummary): string {
		if (summary.reason === 'pre_update') {
			return 'Captured before an upgrade';
		}
		if (summary.reason === 'pre_restore') {
			return 'Captured before a restore';
		}
		return 'Restore point';
	}

	function resolveRequestedStep(): SettingsStep {
		return appState.settingsDialogRequestedTab;
	}

	function buildSettingsSignature(values: SettingsProfileValues): string {
		return JSON.stringify(values);
	}

	function buildSetupVisibilitySignature(ids: OptionalSetupPageId[]): string {
		return JSON.stringify(ids);
	}

	function getOperatorRoleLabel(role: SettingsProfileValues['primaryOperatorRole']): string {
		return ONBOARDING_OPERATOR_ROLE_OPTIONS.find((option) => option.value === role)?.label ?? '';
	}

	function buildDefaultEmailSignature(values: SettingsProfileValues): string {
		const fullName = buildPersonDisplayName(
			values.businessContactFirstName,
			values.businessContactLastName
		);
		const contactLine = [values.businessContactPhone, values.businessContactEmail]
			.map((value) => (value ?? '').trim())
			.filter(Boolean)
			.join(' | ');

		const lines = [
			'Best regards,',
			fullName,
			getOperatorRoleLabel(values.primaryOperatorRole),
			(values.businessName ?? '').trim(),
			contactLine
		].filter(Boolean);

		return '\n' + lines.join('\n');
	}

	function syncSettingsBaselines(): void {
		initialSettingsSignature = buildSettingsSignature(formValues);
		initialSetupVisibilitySignature = buildSetupVisibilitySignature(visibleSetupPageIds);
	}

	function hydrateForm(): void {
		activeStep = resolveRequestedStep();
		fieldErrors = {};
		deleteBackupDialogOpen = false;
		backupToDelete = null;
		visibleBackupLimit = 5;
		knowledgePanelState = {
			hasUnsavedChanges: false,
			canSave: false,
			isSaving: false
		};
		stagedWorkspaceLogoPath = null;
		stagedWorkspaceLogoPreviewUrl = '';
		const workspaceCountryCode = workspaceState.countryCode;
		const persistedEmailSignature = workspaceState.emailSignature;
		formValues = {
			accountEmail: accountState.accountEmail,
			phone: formatPhoneDraft(accountState.phone, workspaceCountryCode),
			avatar: accountState.avatarPath,
			currencySymbol: workspaceState.currencySymbol,
			currencyCode: workspaceState.currencyCode as SupportedCurrencyCode,
			measurementUnit: workspaceState.measurementUnit,
			dateFormat: workspaceState.dateFormat as SupportedDateFormat,
			languageLocale: workspaceState.languageLocale as SettingsProfileValues['languageLocale'],
			numberLocale: workspaceState.numberLocale as SettingsProfileValues['numberLocale'],
			taxRatePercentage: workspaceState.taxRatePercentage,
			quotePaymentTerms: workspaceState.quotePaymentTerms,
			quoteValidityDays: workspaceState.quoteValidityDays,
			quoteDefaultInclusions: workspaceState.quoteDefaultInclusions,
			quoteDefaultExclusions: workspaceState.quoteDefaultExclusions,
			quoteDefaultTerms: workspaceState.quoteDefaultTerms,
			quoteNumberPrefix: workspaceState.quoteNumberPrefix,
			quoteNumberFormat: workspaceState.quoteNumberFormat,
			displayName: workspaceState.displayName,
			countryCode: workspaceState.countryCode,
			businessName: workspaceState.businessName,
			logoFilePath: workspaceState.logoFilePath,
			businessContactFirstName: workspaceState.businessContactFirstName,
			businessContactLastName: workspaceState.businessContactLastName,
			businessContactEmail: workspaceState.businessContactEmail,
			businessContactPhone: formatPhoneDraft(
				workspaceState.businessContactPhone,
				workspaceCountryCode
			),
			businessIdValue: workspaceState.businessIdValue,
			businessAddress: workspaceState.businessAddress,
			emailSignature: persistedEmailSignature,
			primaryOperatorRole: workspaceState.primaryOperatorRole,
			industry: workspaceState.industry
		};
		const shouldAutoPopulateEmailSignature =
			!hasAutoPopulatedEmailSignature &&
			!persistedEmailSignature.trim() &&
			Boolean(formValues.businessContactEmail.trim());
		if (shouldAutoPopulateEmailSignature) {
			formValues.emailSignature = buildDefaultEmailSignature(formValues);
			hasAutoPopulatedEmailSignature = true;
		}
		visibleSetupPageIds = OPTIONAL_SETUP_PAGE_IDS.filter(
			(pageId) => !appState.hiddenSetupPageIds.includes(pageId)
		);
		if (shouldAutoPopulateEmailSignature) {
			initialSettingsSignature = buildSettingsSignature({
				...formValues,
				emailSignature: persistedEmailSignature
			});
			initialSetupVisibilitySignature = buildSetupVisibilitySignature(visibleSetupPageIds);
		} else {
			syncSettingsBaselines();
		}
	}

	function isSetupPageVisibilityLocked(pageId: OptionalSetupPageId): boolean {
		return (appState.optionalSetupPageRecordCounts[pageId] ?? 0) > 0;
	}

	function getSetupPageVisibilityLockMessage(title: string, pageId: OptionalSetupPageId): string {
		const count = appState.optionalSetupPageRecordCounts[pageId] ?? 0;
		return `${title} stays visible because it contains ${count} saved record${count === 1 ? '' : 's'}.`;
	}

	function getSetupPageRecordCountLabel(pageId: OptionalSetupPageId): string {
		const count = appState.optionalSetupPageRecordCounts[pageId] ?? 0;
		return count > 0 ? `${count} saved record${count === 1 ? '' : 's'}` : 'No records';
	}

	function toggleVisibleSetupPage(pageId: OptionalSetupPageId, checked: boolean): void {
		if (isSetupPageVisibilityLocked(pageId)) {
			return;
		}

		const nextVisible = checked
			? [...new Set([...visibleSetupPageIds, pageId])]
			: visibleSetupPageIds.filter((id) => id !== pageId);

		visibleSetupPageIds = OPTIONAL_SETUP_PAGE_IDS.filter((id) => nextVisible.includes(id));
		toast.success(checked ? 'Setup page shown' : 'Setup page hidden');
	}

	function closeSettingsDialogImmediately(): void {
		appState.closeSettingsDialog();
	}

	function promptDeleteBackup(summary: BackupSummary): void {
		backupToDelete = summary;
		deleteBackupDialogOpen = true;
	}

	function closeDeleteBackupDialog(): void {
		deleteBackupDialogOpen = false;
		backupToDelete = null;
	}

	async function confirmDeleteBackup(): Promise<void> {
		if (!backupToDelete) return;
		const deleted = await backupState.deleteSnapshot(backupToDelete.id);
		if (deleted) {
			closeDeleteBackupDialog();
		}
	}

	async function connectGoogle(): Promise<void> {
		if (emailSettingsBusy || integrationsState.status['google_gmail'] === 'connecting') return;
		if (!appState.hasInternet) {
			toast.error('Cannot connect to Google: no internet connection');
			return;
		}
		googleConsentDialogOpen = true;
	}

	async function handleGoogleConnect(): Promise<void> {
		if (emailSettingsBusy) return;
		await integrationsState.startGoogleOAuth();
	}

	function promptDisconnectGoogle(connectionId: string): void {
		disconnectingGoogleId = connectionId;
		disconnectGoogleDialogOpen = true;
	}

	async function confirmDisconnectGoogle(): Promise<void> {
		if (!disconnectingGoogleId || isDisconnectingGoogle) return;
		isDisconnectingGoogle = true;
		try {
			await integrationsState.disconnectGoogle(disconnectingGoogleId);
			disconnectingGoogleId = null;
			disconnectGoogleDialogOpen = false;
		} finally {
			isDisconnectingGoogle = false;
		}
	}

	async function connectMicrosoft(): Promise<void> {
		if (emailSettingsBusy || integrationsState.status['microsoft_outlook'] === 'connecting') return;
		if (!appState.hasInternet) {
			toast.error('Cannot connect to Microsoft: no internet connection');
			return;
		}
		microsoftConsentDialogOpen = true;
	}

	async function handleMicrosoftConnect(): Promise<void> {
		if (emailSettingsBusy) return;
		await integrationsState.startMicrosoftOAuth();
	}

	function promptDisconnectMicrosoft(connectionId: string): void {
		disconnectingMicrosoftId = connectionId;
		disconnectMicrosoftDialogOpen = true;
	}

	async function confirmDisconnectMicrosoft(): Promise<void> {
		if (!disconnectingMicrosoftId || isDisconnectingMicrosoft) return;
		isDisconnectingMicrosoft = true;
		try {
			await integrationsState.disconnectMicrosoft(disconnectingMicrosoftId);
			disconnectingMicrosoftId = null;
			disconnectMicrosoftDialogOpen = false;
		} finally {
			isDisconnectingMicrosoft = false;
		}
	}

	async function handleKnowledgeSave(): Promise<void> {
		await workspaceKnowledgeSettingsPanel?.savePlaybook();
	}

	async function handleWorkspaceLogoPick(): Promise<void> {
		if (!open || !isTauri() || isSaving) return;
		const session = settingsSession;
		const workspaceId = workspaceState.id;
		try {
			const selected = await openDialog({
				multiple: false,
				filters: [
					{
						name: 'Logo images',
						extensions: [...BRAND_LOGO_EXTENSIONS]
					}
				]
			});
			if (
				open &&
				session === settingsSession &&
				workspaceId === workspaceState.id &&
				typeof selected === 'string'
			) {
				stagedWorkspaceLogoPath = selected;
			}
		} catch (error) {
			if (open && session === settingsSession && workspaceId === workspaceState.id) {
				await errorState.catchError(error, 'Choose workspace logo');
			}
		}
	}

	function clearWorkspaceLogo(): void {
		stagedWorkspaceLogoPath = null;
		stagedWorkspaceLogoPreviewUrl = '';
		formValues.logoFilePath = '';
	}

	async function focusSettingsField(field: SettingsField): Promise<void> {
		activeStep = settingsFieldStepMap[field];
		await tick();
		const target = document.getElementById(`${id}-${field}`);
		target?.focus();
	}

	async function focusFirstSettingsError(
		errors: Record<string, string[] | undefined>
	): Promise<void> {
		const firstField = (
			[
				'displayName',
				'countryCode',
				'businessName',
				'logoFilePath',
				'businessContactFirstName',
				'businessContactLastName',
				'businessContactEmail',
				'businessContactPhone',
				'businessIdValue',
				'businessAddress',
				'primaryOperatorRole',
				'industry',
				'accountEmail',
				'phone',
				'currencySymbol',
				'currencyCode',
				'measurementUnit',
				'dateFormat',
				'taxRatePercentage',
				'quotePaymentTerms',
				'quoteValidityDays',
				'quoteDefaultInclusions',
				'quoteDefaultExclusions',
				'quoteDefaultTerms',
				'quoteNumberPrefix',
				'quoteNumberFormat'
			] as SettingsField[]
		).find((field) => errors[field]?.length);
		if (firstField) {
			await focusSettingsField(firstField);
		}
	}

	async function handleSave(): Promise<void> {
		if (!open || isSaving) return;
		fieldErrors = {};
		formValues.currencySymbol = getCurrencySymbol(formValues.currencyCode);
		const result = settingsProfileSchema.safeParse(formValues);
		if (!result.success) {
			fieldErrors = result.error.flatten().fieldErrors as Record<string, string[] | undefined>;
			toast.error('Validation failed');
			await focusFirstSettingsError(fieldErrors);
			return;
		}

		isSaving = true;
		try {
			const payload = { ...result.data };
			const previousLogoPath = workspaceState.logoFilePath;
			const formattedAccountPhone = formatPhoneDraft(payload.phone, payload.countryCode);
			if (stagedWorkspaceLogoPath) {
				payload.logoFilePath = await storeWorkspaceLogo(workspaceState.id, stagedWorkspaceLogoPath);
				formValues.logoFilePath = payload.logoFilePath ?? '';
				stagedWorkspaceLogoPath = null;
				stagedWorkspaceLogoPreviewUrl = '';
			}
			await accountState.update({
				accountEmail: normaliseEmailValue(payload.accountEmail),
				phone: formattedAccountPhone
			});
			await workspaceState.updateProfile({
				displayName: (payload.displayName ?? '').trim(),
				countryCode: payload.countryCode,
				businessName: (payload.businessName ?? '').trim(),
				logoFilePath: payload.logoFilePath ?? '',
				businessContactName: buildPersonDisplayName(
					payload.businessContactFirstName,
					payload.businessContactLastName
				),
				businessContactFirstName: (payload.businessContactFirstName ?? '').trim(),
				businessContactLastName: (payload.businessContactLastName ?? '').trim(),
				businessContactEmail: normaliseEmailValue(payload.businessContactEmail),
				businessContactPhone: (payload.businessContactPhone ?? '').trim(),
				businessIdValue: (payload.businessIdValue ?? '').trim(),
				businessAddress: (payload.businessAddress ?? '').trim(),
				emailSignature: (payload.emailSignature ?? '').trim()
			});
			await workspaceState.updateOnboardingProfile({
				primaryOperatorRole: payload.primaryOperatorRole,
				industry: (payload.industry ?? '').trim()
			});
			await workspaceState.updateDefaults({
				currencyCode: payload.currencyCode,
				currencySymbol: payload.currencySymbol,
				measurementUnit: payload.measurementUnit,
				dateFormat: payload.dateFormat,
				languageLocale: getWorkspaceCountryLanguageLocale(payload.countryCode),
				numberLocale: getWorkspaceCountryNumberLocale(payload.countryCode),
				taxRatePercentage: payload.taxRatePercentage,
				quotePaymentTerms: (payload.quotePaymentTerms ?? '').trim(),
				quoteValidityDays: payload.quoteValidityDays,
				quoteDefaultInclusions: (payload.quoteDefaultInclusions ?? '').trim(),
				quoteDefaultExclusions: (payload.quoteDefaultExclusions ?? '').trim(),
				quoteDefaultTerms: (payload.quoteDefaultTerms ?? '').trim(),
				quoteNumberPrefix: (payload.quoteNumberPrefix ?? '').trim(),
				quoteNumberFormat: (payload.quoteNumberFormat ?? '').trim()
			});
			await appState.setVisibleSetupPageIds(visibleSetupPageIds);
			if (
				previousLogoPath &&
				previousLogoPath !== payload.logoFilePath &&
				previousLogoPath !== workspaceState.logoFilePath &&
				!previousLogoPath.startsWith('/')
			) {
				try {
					await removeVaultFile(previousLogoPath);
				} catch (error) {
					log.warn('Settings saved, but the previous logo file could not be removed.', { error });
				}
			}
			syncSettingsBaselines();
			toast.success('Settings updated');
			closeSettingsDialogImmediately();
		} catch (error) {
			await errorState.catchError(error, 'Update Settings');
		} finally {
			isSaving = false;
		}
	}

	async function handleResetWorkspace(): Promise<void> {
		isResetting = true;
		try {
			await appState.resetWorkspace();
			toast.success('Workspace reset');
			resetDialogOpen = false;
		} finally {
			isResetting = false;
		}
	}

	$effect(() => {
		settingsSession += 1;
		if (!open) {
			wasOpen = false;
			isSetupPageVisibilityLoading = false;
			return;
		}

		if (untrack(() => wasOpen)) {
			return;
		}

		untrack(() => {
			wasOpen = true;
			hydrateForm();
			void loadProviderSettings();
			isSetupPageVisibilityLoading = true;
		});

		let cancelled = false;
		void (async () => {
			try {
				await appState.refreshOptionalSetupPageRecordCounts();
				if (!cancelled) {
					visibleSetupPageIds = OPTIONAL_SETUP_PAGE_IDS.filter(
						(pageId) => !appState.hiddenSetupPageIds.includes(pageId)
					);
				}
			} finally {
				if (!cancelled) {
					isSetupPageVisibilityLoading = false;
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	});

	onDestroy(() => {
		settingsSession += 1;
	});

	$effect(() => {
		let cancelled = false;
		if (!stagedWorkspaceLogoPath) {
			stagedWorkspaceLogoPreviewUrl = '';
			return;
		}

		void (async () => {
			const preview = await getAppLocalFileUrl(stagedWorkspaceLogoPath);
			if (!cancelled) {
				stagedWorkspaceLogoPreviewUrl = preview;
			}
		})();

		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		let cancelled = false;
		let objectUrl: string | null = null;
		if (stagedWorkspaceLogoPath || !formValues.logoFilePath) {
			persistedWorkspaceLogoPreviewUrl = '';
			return;
		}

		void (async () => {
			const preview = await getVaultImagePreviewUrl(formValues.logoFilePath ?? '');
			if (cancelled) {
				URL.revokeObjectURL(preview);
				return;
			}
			objectUrl = preview;
			persistedWorkspaceLogoPreviewUrl = preview;
		})();

		return () => {
			cancelled = true;
			persistedWorkspaceLogoPreviewUrl = '';
			if (objectUrl) URL.revokeObjectURL(objectUrl);
		};
	});
</script>

<Dialog.Root bind:open>
	<Dialog.RailFrame
		rootLabel="Settings"
		description="Edit the local workspace profile, user details, and workspace preferences."
		items={nav}
		activeItemId={activeStep}
		onItemSelect={(itemId) => {
			if (isSaving) return;
			activeStep = itemId as SettingsStep;
		}}
		size="lg"
		contentWidth="form"
		bodyClass="flex flex-col gap-5"
		showCloseButton={false}
		onCloseRequest={() => {
			if (!isSaving) closeSettingsDialogImmediately();
		}}
	>
		{#snippet sidebarFooter()}
			<div class="ui-dialog-shell-nav-footer flex flex-col gap-0.5">
				<Meta>v{APP_VERSION}</Meta>
			</div>
		{/snippet}
		{#if activeStep === 'workspace'}
			<div class="flex flex-col gap-5" inert={isSaving}>
				<FieldShell>
					<FieldLabelRow
						for="{id}-displayName"
						tooltip="Internal workspace label shown in the app sidebar and workspace picker."
					>
						Workspace Name
					</FieldLabelRow>
					<Input
						id="{id}-displayName"
						bind:value={formValues.displayName}
						size="default"
						invalidTone={getFieldInvalidTone(fieldErrors.displayName)}
						placeholder="e.g. Default"
					/>
					<FieldError errors={fieldErrors.displayName} />
				</FieldShell>

				<WorkspaceManagerPanel />
			</div>
		{:else if activeStep === 'business'}
			<div class="flex flex-col gap-5" inert={isSaving}>
				<FieldShell>
					<CircularImagePicker
						alt="Workspace logo"
						initials={formValues.businessName?.trim()?.slice(0, 1).toUpperCase() || 'W'}
						variant="logo"
						previewUrl={workspaceLogoPreviewUrl}
						pending={Boolean(stagedWorkspaceLogoPath)}
						class="shrink-0"
						clearLabel="Remove logo"
						pickLabel="Upload logo"
						changeLabel="Upload logo"
						helperText="PNG, JPEG, or SVG used on quotes and PDF exports."
						showActions
						onPick={() => void handleWorkspaceLogoPick()}
						onClear={clearWorkspaceLogo}
					/>
				</FieldShell>
				<div class="grid gap-4">
					<FieldShell>
						<FieldLabelRow
							for="{id}-businessName"
							tooltip="Customer-facing business identity used in quotes, exports, and PDF documents."
						>
							Business Name
						</FieldLabelRow>
						<Input
							id="{id}-businessName"
							bind:value={formValues.businessName}
							size="default"
							invalidTone={getFieldInvalidTone(fieldErrors.businessName)}
							placeholder="e.g. Kwantflow Fabrication"
						/>
						<FieldError errors={fieldErrors.businessName} />
					</FieldShell>
					<div class="grid gap-4 sm:grid-cols-2">
						<FieldShell>
							<FieldLabelRow
								for="{id}-businessContactFirstName"
								tooltip="Primary business contact shown on quote and workspace records."
								>First Name</FieldLabelRow
							>
							<Input
								id="{id}-businessContactFirstName"
								bind:value={formValues.businessContactFirstName}
								size="default"
								invalidTone={getFieldInvalidTone(fieldErrors.businessContactFirstName)}
								placeholder="First name"
							/>
							<FieldError errors={fieldErrors.businessContactFirstName} />
						</FieldShell>
						<FieldShell>
							<FieldLabelRow
								for="{id}-businessContactLastName"
								tooltip="Used with first name to identify the quote contact."
								>Last Name</FieldLabelRow
							>
							<Input
								id="{id}-businessContactLastName"
								bind:value={formValues.businessContactLastName}
								size="default"
								invalidTone={getFieldInvalidTone(fieldErrors.businessContactLastName)}
								placeholder="Last name"
							/>
							<FieldError errors={fieldErrors.businessContactLastName} />
						</FieldShell>
					</div>
				</div>
				<div class="grid gap-4 md:grid-cols-2">
					<FieldShell>
						<FieldLabelRow
							for="{id}-businessContactEmail"
							tooltip="Customer-facing email used on quote and PDF contact details."
							>Contact Email</FieldLabelRow
						>
						<Input
							id="{id}-businessContactEmail"
							type="email"
							autocomplete="email"
							bind:value={formValues.businessContactEmail}
							size="default"
							invalidTone={getFieldInvalidTone(fieldErrors.businessContactEmail)}
							placeholder="quotes@example.com"
						/>
						<FieldError errors={fieldErrors.businessContactEmail} />
					</FieldShell>
					<FieldShell>
						<FieldLabelRow
							for="{id}-businessContactPhone"
							tooltip="Customer-facing phone number used on quote and PDF contact details."
							>Contact Phone</FieldLabelRow
						>
						<PhoneInput
							id="{id}-businessContactPhone"
							bind:value={formValues.businessContactPhone}
							countryCode={formValues.countryCode}
							size="default"
							invalidTone={getFieldInvalidTone(fieldErrors.businessContactPhone)}
							placeholder="Phone number"
						/>
						<FieldError errors={fieldErrors.businessContactPhone} />
					</FieldShell>
				</div>
				<div class="grid gap-4 md:grid-cols-2">
					<FieldShell>
						<FieldLabelRow
							for="{id}-primaryOperatorRole"
							tooltip="Your main role in the workspace."
						>
							Role
						</FieldLabelRow>
						<Select.Root type="single" bind:value={formValues.primaryOperatorRole}>
							<Select.Trigger
								id="{id}-primaryOperatorRole"
								size="default"
								class="w-full min-w-0"
								invalidTone={getFieldInvalidTone(fieldErrors.primaryOperatorRole)}
							>
								<span class="block min-w-0 truncate">{selectedRoleLabel}</span>
							</Select.Trigger>
							<Select.Content>
								{#each ONBOARDING_OPERATOR_ROLE_OPTIONS as option (option.value)}
									<Select.Item value={option.value} label={option.label} />
								{/each}
							</Select.Content>
						</Select.Root>
						<FieldError errors={fieldErrors.primaryOperatorRole} />
					</FieldShell>
					<FieldShell>
						<FieldLabelRow
							for="{id}-industry"
							tooltip="Business context used to tune quote defaults and guidance."
						>
							Industry
						</FieldLabelRow>
						<Select.Root type="single" bind:value={formValues.industry}>
							<Select.Trigger
								id="{id}-industry"
								size="default"
								class="w-full min-w-0"
								invalidTone={getFieldInvalidTone(fieldErrors.industry)}
							>
								<span class="block min-w-0 truncate">{selectedIndustryLabel}</span>
							</Select.Trigger>
							<Select.Content>
								{#each INDUSTRY_OPTIONS as option (option.value)}
									<Select.Item value={option.value} label={option.label} />
								{/each}
							</Select.Content>
						</Select.Root>
						<FieldError errors={fieldErrors.industry} />
					</FieldShell>
				</div>
				<div class="grid gap-4 md:grid-cols-2">
					<FieldShell>
						<FieldLabelRow
							for="{id}-businessIdValue"
							tooltip="Country-specific business identifier shown on quote and PDF exports when provided."
						>
							{formatIdentifierLabel(selectedCountryProfile.businessIdLabel)}
						</FieldLabelRow>
						<Input
							id="{id}-businessIdValue"
							bind:value={formValues.businessIdValue}
							size="default"
							invalidTone={getFieldInvalidTone(fieldErrors.businessIdValue)}
							class="tabular-nums"
							placeholder={`Enter ${formatIdentifierLabel(selectedCountryProfile.businessIdLabel)}`}
						/>
						<FieldError errors={fieldErrors.businessIdValue} />
					</FieldShell>
					<FieldShell>
						<FieldLabelRow
							for="{id}-countryCode"
							tooltip="Sets business defaults such as tax wording, number formats, and identifiers."
						>
							Country
						</FieldLabelRow>
						<Select.Root type="single" bind:value={formValues.countryCode}>
							<Select.Trigger
								id="{id}-countryCode"
								size="default"
								class="w-full"
								invalidTone={getFieldInvalidTone(fieldErrors.countryCode)}
							>
								{selectedCountryProfile.label}
							</Select.Trigger>
							<Select.Content>
								{#each WORKSPACE_COUNTRY_OPTIONS as option (option.code)}
									<Select.Item value={option.code} label={option.label} />
								{/each}
							</Select.Content>
						</Select.Root>
						<FieldError errors={fieldErrors.countryCode} />
					</FieldShell>
				</div>
				<FieldShell>
					<FieldLabelRow
						for="{id}-businessAddress"
						tooltip="Optional address printed on quotes and workspace exports when provided."
						>Business Address</FieldLabelRow
					>
					<Textarea
						id="{id}-businessAddress"
						bind:value={formValues.businessAddress}
						size="default"
						invalidTone={getFieldInvalidTone(fieldErrors.businessAddress)}
						class="ui-field-note-lg resize-none"
						placeholder="Street, suburb, state, postcode"
						rows={5}
					/>
					<FieldError errors={fieldErrors.businessAddress} />
				</FieldShell>
				<FieldShell>
					<FieldLabelRow
						for="{id}-emailSignature"
						tooltip="Default sign-off appended to all outgoing quote emails. Supports plain text with line breaks."
						>Email Signature</FieldLabelRow
					>
					<Textarea
						id="{id}-emailSignature"
						bind:value={formValues.emailSignature}
						size="default"
						invalidTone={getFieldInvalidTone(fieldErrors.emailSignature)}
						class="ui-field-note-lg resize-none"
						placeholder={emailSignatureHint}
						rows={5}
					/>
					<FieldError errors={fieldErrors.emailSignature} />
				</FieldShell>
			</div>
		{:else if activeStep === 'account'}
			<div class="grid gap-4 md:grid-cols-2" inert={isSaving}>
				<FieldShell>
					<FieldLabel for="{id}-accountEmail">Email</FieldLabel>
					<Input
						id="{id}-accountEmail"
						type="email"
						autocomplete="email"
						bind:value={formValues.accountEmail}
						invalidTone={getFieldInvalidTone(fieldErrors.accountEmail)}
					/>
					<FieldError errors={fieldErrors.accountEmail} />
				</FieldShell>
				<FieldShell>
					<FieldLabel for="{id}-phone">Phone</FieldLabel>
					<PhoneInput
						id="{id}-phone"
						bind:value={formValues.phone}
						countryCode={formValues.countryCode}
						invalidTone={getFieldInvalidTone(fieldErrors.phone)}
					/>
					<FieldError errors={fieldErrors.phone} />
				</FieldShell>
			</div>
			<Meta>These profile details are saved locally on this computer.</Meta>
		{:else if activeStep === 'general'}
			<div class="flex flex-col gap-5" inert={isSaving}>
				<div class="grid gap-4 md:grid-cols-2">
					<FieldShell>
						<FieldLabel for="{id}-currencyCode">Currency</FieldLabel>
						<Select.Root
							type="single"
							bind:value={formValues.currencyCode}
							onValueChange={(value) => {
								if (value) {
									formValues.currencyCode = value as SettingsProfileValues['currencyCode'];
									formValues.currencySymbol = getCurrencySymbol(value);
								}
							}}
						>
							<Select.Trigger
								id="{id}-currencyCode"
								size="default"
								class="w-full"
								invalidTone={getFieldInvalidTone(fieldErrors.currencyCode)}
							>
								{CURRENCY_OPTIONS.find((option) => option.code === formValues.currencyCode)
									?.label ?? 'AUD · Australian Dollar'}
							</Select.Trigger>
							<Select.Content>
								{#each CURRENCY_OPTIONS as option (option.code)}
									<Select.Item value={option.code} class="menu-copy">{option.label}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
						<FieldError errors={fieldErrors.currencyCode} />
					</FieldShell>
					<FieldShell>
						<FieldLabel for="{id}-measurementUnit">Measurement Unit</FieldLabel>
						<Select.Root
							type="single"
							bind:value={formValues.measurementUnit}
							onValueChange={(value) => {
								if (value) {
									formValues.measurementUnit = value as SettingsProfileValues['measurementUnit'];
								}
							}}
						>
							<Select.Trigger id="{id}-measurementUnit" size="default" class="w-full">
								{formValues.measurementUnit}
							</Select.Trigger>
							<Select.Content>
								<Select.Item value="Metric" class="menu-copy">Metric</Select.Item>
								<Select.Item value="Imperial" class="menu-copy">Imperial</Select.Item>
							</Select.Content>
						</Select.Root>
					</FieldShell>
				</div>
				<div class="grid gap-4 md:grid-cols-2">
					<FieldShell>
						<FieldLabel for="{id}-dateFormat">Date Format</FieldLabel>
						<Select.Root
							type="single"
							bind:value={formValues.dateFormat}
							onValueChange={(value) => {
								if (value) {
									formValues.dateFormat = value as SettingsProfileValues['dateFormat'];
								}
							}}
						>
							<Select.Trigger
								id="{id}-dateFormat"
								size="default"
								class="w-full"
								invalidTone={getFieldInvalidTone(fieldErrors.dateFormat)}
							>
								{DATE_FORMAT_OPTIONS.find((option) => option.value === formValues.dateFormat)
									?.label ?? 'Australia · 07 Mar 2026'}
							</Select.Trigger>
							<Select.Content>
								{#each DATE_FORMAT_OPTIONS as option (option.value)}
									<Select.Item value={option.value} class="menu-copy">{option.label}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
						<FieldError errors={fieldErrors.dateFormat} />
					</FieldShell>
					<FieldShell>
						<FieldLabel for="{id}-taxRatePercentage">
							{selectedCountryTaxDefaults.taxDisplayLabel || 'Tax'} Rate (%)
						</FieldLabel>
						<Input
							id="{id}-taxRatePercentage"
							type="number"
							min="0"
							max="100"
							step="0.1"
							bind:value={formValues.taxRatePercentage}
							size="default"
							invalidTone={getFieldInvalidTone(fieldErrors.taxRatePercentage)}
							class="text-right tabular-nums"
							placeholder="10.0"
						/>
						<FieldError errors={fieldErrors.taxRatePercentage} />
					</FieldShell>
				</div>
				<div class="grid gap-4 md:grid-cols-2">
					<FieldShell invalidTone={getFieldInvalidTone(fieldErrors.quoteValidityDays)}>
						<FieldLabelRow
							for="{id}-quoteValidityDays"
							tooltip="Default number of days a generated quote remains valid."
						>
							Quote Validity (days)
						</FieldLabelRow>
						<Input
							id="{id}-quoteValidityDays"
							type="number"
							min="1"
							step="1"
							bind:value={formValues.quoteValidityDays}
							size="default"
							invalidTone={getFieldInvalidTone(fieldErrors.quoteValidityDays)}
							class="text-right tabular-nums"
							placeholder="30"
						/>
						<FieldError errors={fieldErrors.quoteValidityDays} />
					</FieldShell>
					<FieldShell>
						<FieldLabelRow
							for="{id}-quoteNumberPrefix"
							tooltip="Prefix used when Kwantflow generates quote numbers."
						>
							Quote Number Prefix
						</FieldLabelRow>
						<Input
							id="{id}-quoteNumberPrefix"
							bind:value={formValues.quoteNumberPrefix}
							size="default"
							placeholder="Q"
						/>
					</FieldShell>
				</div>
				<FieldShell>
					<FieldLabelRow
						for="{id}-quotePaymentTerms"
						tooltip="Default payment wording included on quote exports."
					>
						Payment Terms
					</FieldLabelRow>
					<Input
						id="{id}-quotePaymentTerms"
						bind:value={formValues.quotePaymentTerms}
						size="default"
						placeholder="Payment Terms: Due on receipt."
					/>
				</FieldShell>
				<FieldShell>
					<FieldLabelRow
						for="{id}-quoteDefaultInclusions"
						tooltip="Standard inclusions copied into new quote exports unless edited."
					>
						Default Inclusions
					</FieldLabelRow>
					<Textarea
						id="{id}-quoteDefaultInclusions"
						bind:value={formValues.quoteDefaultInclusions}
						size="default"
						class="max-h-80 min-h-20 resize-none"
						placeholder="Default inclusions shown on quote exports."
					/>
				</FieldShell>
				<FieldShell>
					<FieldLabelRow
						for="{id}-quoteDefaultExclusions"
						tooltip="Standard exclusions copied into new quote exports unless edited."
					>
						Default Exclusions
					</FieldLabelRow>
					<Textarea
						id="{id}-quoteDefaultExclusions"
						bind:value={formValues.quoteDefaultExclusions}
						size="default"
						class="max-h-80 min-h-20 resize-none"
						placeholder="Default exclusions shown on quote exports."
					/>
				</FieldShell>
				<FieldShell>
					<FieldLabelRow
						for="{id}-quoteDefaultTerms"
						tooltip="Fallback terms and conditions shown on quote exports."
					>
						Default Quote Terms
					</FieldLabelRow>
					<Textarea
						id="{id}-quoteDefaultTerms"
						bind:value={formValues.quoteDefaultTerms}
						size="default"
						class="max-h-80 min-h-24 resize-none"
						placeholder="Terms and conditions fallback for quote exports."
					/>
				</FieldShell>
				<div class="ui-settings-card space-y-3 p-4">
					<Text>Help and licences</Text>
					<Meta>Open the documentation included with this installation, available offline.</Meta>
					<div class="flex flex-wrap gap-2">
						<Button
							variant="secondary"
							size="sm"
							onclick={() => void appState.openLocalDocumentation('help')}>Help</Button
						>
						<Button
							variant="secondary"
							size="sm"
							onclick={() => void appState.openLocalDocumentation('license')}>Licence</Button
						>
						<Button
							variant="secondary"
							size="sm"
							onclick={() => void appState.openLocalDocumentation('notices')}
							>Third-party notices</Button
						>
					</div>
				</div>
				<div class="ui-settings-card space-y-3 p-4">
					<Text>Local diagnostics</Text>
					<Meta>Save diagnostic logs on this computer to inspect or share yourself.</Meta>
					<Button
						variant="secondary"
						size="sm"
						onclick={() => void exportLocalDiagnostics()}
						disabled={isExportingDiagnostics}
						loading={isExportingDiagnostics}>Export diagnostic logs</Button
					>
				</div>
			</div>
		{:else if activeStep === 'setup-pages'}
			<div class="flex flex-col gap-5" inert={isSaving}>
				<div class="space-y-3">
					<FieldLabelRow
						tooltip="Only empty setup pages can be hidden from navigation. Pages with saved records stay visible."
					>
						Visible Setup Pages
					</FieldLabelRow>
					<div
						class={`grid gap-2 md:grid-cols-2 ${isSetupPageVisibilityLoading ? 'opacity-70' : ''}`}
						aria-busy={isSetupPageVisibilityLoading}
					>
						{#each visibleSetupPageOptions as option (option.id)}
							{@const isLocked = isSetupPageVisibilityLocked(option.id)}
							{@const lockMessage = isLocked
								? getSetupPageVisibilityLockMessage(option.title, option.id)
								: undefined}
							<div
								class={`ui-choice-card relative items-start ${
									visibleSetupPageIds.includes(option.id)
										? 'ui-choice-card-active'
										: 'ui-choice-card-inactive'
								} ${isLocked || isSetupPageVisibilityLoading ? 'opacity-70' : ''}`}
								title={lockMessage}
							>
								<Checkbox
									id="{id}-visible-setup-page-{option.id}"
									checked={visibleSetupPageIds.includes(option.id)}
									disabled={isLocked || isSetupPageVisibilityLoading}
									class="mt-1"
									onCheckedChange={(checked) => toggleVisibleSetupPage(option.id, checked === true)}
								/>
								<label
									class="absolute inset-0 cursor-pointer"
									for="{id}-visible-setup-page-{option.id}"
								>
									<span class="sr-only">Toggle {option.title}</span>
								</label>
								<div class="pointer-events-none min-w-0 space-y-0.5">
									<Text as="span">{option.title}</Text>
									<Meta as="span" class={isLocked ? 'text-foreground' : undefined}>
										{getSetupPageRecordCountLabel(option.id)}
									</Meta>
								</div>
							</div>
						{/each}
					</div>
				</div>
			</div>
		{:else if activeStep === 'backups'}
			<div class="flex flex-col gap-5">
				{#if backupState.status.retainedRecoveryPaths.length > 0}
					<div class="ui-settings-card space-y-3 p-4">
						<Text>Original data retained</Text>
						<Meta>
							A previous damaged installation was preserved before recovery. Its original files are
							still available at these locations:
						</Meta>
						<ScrollArea.Root
							class="h-32"
							orientation="vertical"
							viewportProps={{
								tabindex: 0,
								role: 'region',
								'aria-label': 'Retained original data'
							}}
						>
							<ul class="space-y-1 pe-3 break-words">
								{#each backupState.status.retainedRecoveryPaths as path (path)}
									<li><Meta>{path}</Meta></li>
								{/each}
							</ul>
						</ScrollArea.Root>
					</div>
				{/if}
				<div class="flex items-start justify-between gap-3">
					<div class="min-w-0 space-y-1">
						<FieldLabelRow>Automatic Backup</FieldLabelRow>
						<Meta>
							{backupState.automaticCadenceLabel}
							{#if backupState.lastBackupSummary}
								· Last backup {formatBackupDateTime(backupState.lastBackupSummary.createdAt)}
							{:else}
								· No backup saved yet
							{/if}
						</Meta>
					</div>
					<div class="shrink-0">
						<Button
							variant="filled"
							size="sm"
							class="h-8"
							onclick={() => void backupState.createManualBackup()}
							disabled={backupActionsBusy}
						>
							{backupState.isCreatingManualBackup ? 'Saving backup…' : 'Back Up Now'}
						</Button>
					</div>
				</div>
				<div class="ui-settings-card space-y-3 p-4">
					<Text>Portable backup</Text>
					<Meta
						>Export all local workspaces and stored documents to a ZIP archive for another computer.
						Email credentials and downloaded AI files are excluded.</Meta
					>
					<div class="flex flex-wrap gap-2">
						<Button
							variant="secondary"
							size="sm"
							onclick={() => void backupState.exportPortableBackup()}
							disabled={backupActionsBusy}
							loading={backupState.isExportingBackup}>Export backup</Button
						>
						<Button
							variant="secondary"
							size="sm"
							onclick={() => void backupState.promptImportArchive()}
							disabled={backupActionsBusy}
							loading={backupState.isInspectingArchive}>Import backup</Button
						>
					</div>
				</div>
				<div class="space-y-3">
					<FieldLabelRow
						tooltip="Restoring a backup replaces every local workspace on this device and restarts the app."
					>
						Restore Points
					</FieldLabelRow>
					<div class="grid gap-2">
						{#if backupSnapshots.length > 0}
							{#each visibleBackupSnapshots as summary (summary.id)}
								<div class="ui-file-row group items-start justify-between gap-3">
									<div class="min-w-0 flex-1 space-y-1">
										<Text>{backupWorkspaceLabel(summary)}</Text>
										<Meta>
											{describeBackupReason(summary.reason)} · {formatBackupDateTime(
												summary.createdAt
											)}
										</Meta>
										<Meta class="opacity-70">
											App v{summary.appVersion}
										</Meta>
									</div>
									<DropdownMenu.Root>
										<DropdownMenu.Trigger>
											{#snippet child({ props })}
												<Button
													{...props}
													variant="ghost"
													size="icon-xs"
													class="shrink-0 md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100"
												>
													<span class="sr-only">Open backup actions</span>
													<MoreHorizontalIcon class="size-3.5" />
												</Button>
											{/snippet}
										</DropdownMenu.Trigger>
										<DropdownMenu.Content align="end" class="ui-menu-width-md ui-radius-lg">
											<DropdownMenu.Item
												class="gap-2"
												onclick={() => void backupState.promptRestoreSnapshot(summary.id)}
												disabled={backupActionsBusy}
											>
												<RotateCcwIcon class="muted size-3.5" />
												<span>Restore backup</span>
											</DropdownMenu.Item>
											<DropdownMenu.Separator />
											<DropdownMenu.Item
												class="menu-item-destructive gap-2"
												onclick={() => promptDeleteBackup(summary)}
												disabled={backupActionsBusy}
											>
												<Trash2Icon class="size-3.5" />
												<span>Delete backup</span>
											</DropdownMenu.Item>
										</DropdownMenu.Content>
									</DropdownMenu.Root>
								</div>
							{/each}
							{#if hasMoreBackupSnapshots}
								<div class="flex justify-center pt-1">
									<Button
										variant="secondary"
										size="sm"
										class="h-8"
										onclick={() => {
											visibleBackupLimit += 5;
										}}
									>
										Load more backups
									</Button>
								</div>
							{/if}
						{:else}
							<div class="ui-empty-panel-card-compact">
								<Text>No backups saved yet.</Text>
								<Meta class="mt-1">
									Kwantflow keeps local restore points here so you can recover this device without
									handling backup files directly.
								</Meta>
							</div>
						{/if}
					</div>
				</div>
			</div>
		{:else if activeStep === 'connections'}
			<div class="flex flex-col gap-5">
				{#each integrationsState.connections.filter((connection) => connection.status === 'revoked' && connection.lastError) as connection (connection.id)}
					<div class="ui-settings-card space-y-2 p-4">
						<Text>{connection.externalName || connection.label} requires reconnecting</Text>
						<FieldError errors={[connection.lastError ?? 'Reconnect this email connection.']} />
					</div>
				{/each}
				{#if integrationsState.isGoogleConnected && integrationsState.status['google_gmail'] !== 'connecting'}
					<div class="ui-settings-card">
						<div class="ui-settings-row">
							<div class="flex min-w-0 items-center gap-3">
								<img src={googleLogoUrl} alt="" class="size-9 shrink-0" aria-hidden="true" />
								<div class="min-w-0">
									<div class="flex items-center gap-2">
										<span class="shell-label truncate">
											{integrationsState.connectedGoogle?.externalName ??
												integrationsState.connectedGoogle?.label ??
												'Google'}
										</span>
										<Badge variant="success">Connected</Badge>
									</div>
									<Meta class="mt-0.5">Connected just now</Meta>
								</div>
							</div>
							<div class="flex items-center gap-2">
								<DropdownMenu.Root>
									<DropdownMenu.Trigger>
										{#snippet child({ props })}
											<Button
												{...props}
												variant="ghost"
												size="sm"
												class="ui-radius-md h-8 shrink-0 gap-1.5 px-2.5"
												title="Auto-refresh"
											>
												<RefreshCwIcon class="size-3.5" />
												<span class="caption">{POLL_LABELS[integrationsState.pollingInterval]}</span
												>
											</Button>
										{/snippet}
									</DropdownMenu.Trigger>
									<DropdownMenu.Content align="end" class="ui-menu-width-md ui-radius-lg">
										<DropdownMenu.Group>
											<DropdownMenu.Label>Auto-refresh</DropdownMenu.Label>
										</DropdownMenu.Group>
										<DropdownMenu.Separator />
										{#each [['off', 'Off'], ['15m', '15 min'], ['30m', '30 min'], ['1h', '1 hr']] as [val, label] (val)}
											<DropdownMenu.CheckboxItem
												checked={integrationsState.pollingInterval === val}
												onclick={async () => {
													const changed = await integrationsState.setPollingInterval(
														val as 'off' | '15m' | '30m' | '1h'
													);
													if (changed) {
														toast.success(
															val === 'off'
																? 'Auto-refresh turned off'
																: `Auto-refresh set to every ${label}`
														);
													}
												}}
											>
												{label}
											</DropdownMenu.CheckboxItem>
										{/each}
									</DropdownMenu.Content>
								</DropdownMenu.Root>
								<DropdownMenu.Root>
									<DropdownMenu.Trigger>
										{#snippet child({ props })}
											<Button
												{...props}
												variant="ghost"
												size="sm"
												class="ui-radius-md size-8 shrink-0 p-0"
											>
												<MoreHorizontalIcon class="size-4" />
											</Button>
										{/snippet}
									</DropdownMenu.Trigger>
									<DropdownMenu.Content align="end" class="ui-menu-width-md ui-radius-lg">
										<DropdownMenu.Item onclick={() => connectGoogle()} disabled={emailSettingsBusy}>
											<RotateCcwIcon class="size-3.5" />
											Reconnect
										</DropdownMenu.Item>
										<DropdownMenu.Separator />
										<DropdownMenu.Item
											onclick={() => promptDisconnectGoogle(integrationsState.connectedGoogle!.id)}
											class="text-destructive"
										>
											<Trash2Icon class="size-3.5" />
											Disconnect
										</DropdownMenu.Item>
									</DropdownMenu.Content>
								</DropdownMenu.Root>
							</div>
						</div>
					</div>
				{:else if integrationsState.status['google_gmail'] === 'connecting'}
					<div class="ui-settings-card">
						<div class="ui-settings-row">
							<div class="flex items-center gap-3">
								<img src={googleLogoUrl} alt="" class="size-9" aria-hidden="true" />
								<div>
									<span class="shell-label">Google</span>
									<Meta class="mt-0.5"
										>Waiting for you to complete sign-in in your browser. Cancel to stop.</Meta
									>
								</div>
							</div>
							<Button
								variant="secondary"
								size="default"
								class="h-9 shrink-0"
								onclick={() => integrationsState.cancelGoogleOAuth()}
							>
								Cancel
							</Button>
						</div>
					</div>
				{:else if integrationsState.status['google_gmail'] === 'error'}
					<div class="ui-settings-card">
						<div class="ui-settings-row">
							<div class="min-w-0">
								<FieldLabelRow tooltip="Connect Gmail to receive RFQ emails directly."
									>Google Mail</FieldLabelRow
								>
								{#if integrationsState.errorMessage}
									<p class="caption status-text-destructive mt-1">
										{integrationsState.errorMessage}
									</p>
								{/if}
							</div>
							<Button
								variant="secondary"
								size="default"
								class="ui-integration-btn h-9 shrink-0 gap-2"
								onclick={() => connectGoogle()}
								disabled={emailSettingsBusy || !integrationsState.providerSettings?.googleClientId}
							>
								<img src={googleLogoUrl} alt="" class="size-4" aria-hidden="true" />
								Google (retry)
							</Button>
						</div>
					</div>
				{:else}
					<div class="ui-settings-card">
						<div class="ui-settings-row">
							<div class="min-w-0">
								<FieldLabelRow tooltip="Connect Gmail to receive RFQ emails directly."
									>Google Mail</FieldLabelRow
								>
							</div>
							{#if !integrationsState.providerSettings?.googleClientId}
								<Tooltip.Root>
									<Tooltip.Trigger>
										{#snippet child({ props })}
											<div {...props} class="w-fit shrink-0">
												<Button
													variant="secondary"
													size="default"
													class="ui-integration-btn pointer-events-none h-9 gap-2"
													disabled
												>
													<img src={googleLogoUrl} alt="" class="size-4" aria-hidden="true" />
													Connect with Gmail
												</Button>
											</div>
										{/snippet}
									</Tooltip.Trigger>
									<Tooltip.Content side="top">
										Save your own provider registration below before connecting.
									</Tooltip.Content>
								</Tooltip.Root>
							{:else}
								<Button
									variant="secondary"
									size="default"
									class="ui-integration-btn h-9 shrink-0 gap-2"
									onclick={() => connectGoogle()}
									disabled={emailSettingsBusy}
								>
									<img src={googleLogoUrl} alt="" class="size-4" aria-hidden="true" />
									Connect with Gmail
								</Button>
							{/if}
						</div>
					</div>
				{/if}

				{#if integrationsState.isMicrosoftConnected && integrationsState.status['microsoft_outlook'] !== 'connecting'}
					<div class="ui-settings-card">
						<div class="ui-settings-row">
							<div class="flex min-w-0 items-center gap-3">
								<img src={microsoftLogoUrl} alt="" class="size-9 shrink-0" aria-hidden="true" />
								<div class="min-w-0">
									<div class="flex items-center gap-2">
										<span class="shell-label truncate">
											{integrationsState.connectedMicrosoft?.externalName ??
												integrationsState.connectedMicrosoft?.label ??
												'Outlook'}
										</span>
										<Badge variant="success">Connected</Badge>
									</div>
									<Meta class="mt-0.5">Connected just now</Meta>
								</div>
							</div>
							<div class="flex items-center gap-2">
								<DropdownMenu.Root>
									<DropdownMenu.Trigger>
										{#snippet child({ props })}
											<Button
												{...props}
												variant="ghost"
												size="sm"
												class="ui-radius-md h-8 shrink-0 gap-1.5 px-2.5"
												title="Auto-refresh"
											>
												<RefreshCwIcon class="size-3.5" />
												<span class="caption">{POLL_LABELS[integrationsState.pollingInterval]}</span
												>
											</Button>
										{/snippet}
									</DropdownMenu.Trigger>
									<DropdownMenu.Content align="end" class="ui-menu-width-md ui-radius-lg">
										<DropdownMenu.Group>
											<DropdownMenu.Label>Auto-refresh</DropdownMenu.Label>
										</DropdownMenu.Group>
										<DropdownMenu.Separator />
										{#each [['off', 'Off'], ['15m', '15 min'], ['30m', '30 min'], ['1h', '1 hr']] as [val, label] (val)}
											<DropdownMenu.CheckboxItem
												checked={integrationsState.pollingInterval === val}
												onclick={async () => {
													const changed = await integrationsState.setPollingInterval(
														val as 'off' | '15m' | '30m' | '1h'
													);
													if (changed) {
														toast.success(
															val === 'off'
																? 'Auto-refresh turned off'
																: `Auto-refresh set to every ${label}`
														);
													}
												}}
											>
												{label}
											</DropdownMenu.CheckboxItem>
										{/each}
									</DropdownMenu.Content>
								</DropdownMenu.Root>
								<DropdownMenu.Root>
									<DropdownMenu.Trigger>
										{#snippet child({ props })}
											<Button
												{...props}
												variant="ghost"
												size="sm"
												class="ui-radius-md size-8 shrink-0 p-0"
											>
												<MoreHorizontalIcon class="size-4" />
											</Button>
										{/snippet}
									</DropdownMenu.Trigger>
									<DropdownMenu.Content align="end" class="ui-menu-width-md ui-radius-lg">
										<DropdownMenu.Item
											onclick={() => connectMicrosoft()}
											disabled={emailSettingsBusy}
										>
											<RotateCcwIcon class="size-3.5" />
											Reconnect
										</DropdownMenu.Item>
										<DropdownMenu.Separator />
										<DropdownMenu.Item
											onclick={() =>
												promptDisconnectMicrosoft(integrationsState.connectedMicrosoft!.id)}
											class="text-destructive"
										>
											<Trash2Icon class="size-3.5" />
											Disconnect
										</DropdownMenu.Item>
									</DropdownMenu.Content>
								</DropdownMenu.Root>
							</div>
						</div>
					</div>
				{:else if integrationsState.status['microsoft_outlook'] === 'connecting'}
					<div class="ui-settings-card">
						<div class="ui-settings-row">
							<div class="flex items-center gap-3">
								<img src={microsoftLogoUrl} alt="" class="size-9" aria-hidden="true" />
								<div>
									<span class="shell-label">Microsoft</span>
									<Meta class="mt-0.5"
										>Waiting for you to complete sign-in in your browser. Cancel to stop.</Meta
									>
								</div>
							</div>
							<Button
								variant="secondary"
								size="default"
								class="h-9 shrink-0"
								onclick={() => integrationsState.cancelMicrosoftOAuth()}
							>
								Cancel
							</Button>
						</div>
					</div>
				{:else if integrationsState.status['microsoft_outlook'] === 'error'}
					<div class="ui-settings-card">
						<div class="ui-settings-row">
							<div class="min-w-0">
								<FieldLabelRow tooltip="Connect Outlook to receive RFQ emails directly."
									>Microsoft Outlook</FieldLabelRow
								>
								{#if integrationsState.errorMessage}
									<p class="caption status-text-destructive mt-1">
										{integrationsState.errorMessage}
									</p>
								{/if}
							</div>
							<Button
								variant="secondary"
								size="default"
								class="ui-integration-btn h-9 shrink-0 gap-2"
								onclick={() => connectMicrosoft()}
								disabled={emailSettingsBusy ||
									!integrationsState.providerSettings?.microsoftClientId}
							>
								<img src={microsoftLogoUrl} alt="" class="size-4" aria-hidden="true" />
								Microsoft (retry)
							</Button>
						</div>
					</div>
				{:else}
					<div class="ui-settings-card">
						<div class="ui-settings-row">
							<div class="min-w-0">
								<FieldLabelRow tooltip="Connect Outlook to receive RFQ emails directly."
									>Microsoft Outlook</FieldLabelRow
								>
							</div>
							{#if !integrationsState.providerSettings?.microsoftClientId}
								<Tooltip.Root>
									<Tooltip.Trigger>
										{#snippet child({ props })}
											<div {...props} class="w-fit shrink-0">
												<Button
													variant="secondary"
													size="default"
													class="ui-integration-btn pointer-events-none h-9 gap-2"
													disabled
												>
													<img src={microsoftLogoUrl} alt="" class="size-4" aria-hidden="true" />
													Connect with Outlook
												</Button>
											</div>
										{/snippet}
									</Tooltip.Trigger>
									<Tooltip.Content side="top">
										Save your own provider registration below before connecting.
									</Tooltip.Content>
								</Tooltip.Root>
							{:else}
								<Button
									variant="secondary"
									size="default"
									class="ui-integration-btn h-9 shrink-0 gap-2"
									onclick={() => connectMicrosoft()}
									disabled={emailSettingsBusy}
								>
									<img src={microsoftLogoUrl} alt="" class="size-4" aria-hidden="true" />
									Connect with Outlook
								</Button>
							{/if}
						</div>
					</div>
				{/if}

				<div class="ui-settings-card space-y-4 p-4">
					<Text>Optional email registrations</Text>
					<Meta
						>Email connects directly to Google or Microsoft using your own registration, shared by
						all workspaces on this computer. No Kwantflow server, API key, or client secret is
						required. You can use Kwantflow and import EML or MSG files without connecting.</Meta
					>
					<Button
						variant="secondary"
						size="sm"
						onclick={() => void appState.openLocalDocumentation('email_setup')}
						>Email setup guide</Button
					>
					<Meta
						>Changing a registration requires reconnecting its mailboxes in every workspace.
						Imported RFQs and files stay on this device.</Meta
					>
					<FieldShell>
						<FieldLabel for="{id}-googleClientId">Google Desktop client ID</FieldLabel>
						<Input
							id="{id}-googleClientId"
							bind:value={providerSettingsDraft.googleClientId}
							placeholder="…apps.googleusercontent.com"
							disabled={integrationsState.providerSettingsLoading ||
								integrationsState.providerSettingsSaving}
						/>
					</FieldShell>
					<FieldShell>
						<FieldLabel for="{id}-microsoftClientId">Microsoft native client ID</FieldLabel>
						<Input
							id="{id}-microsoftClientId"
							bind:value={providerSettingsDraft.microsoftClientId}
							placeholder="Application (client) UUID"
							disabled={integrationsState.providerSettingsLoading ||
								integrationsState.providerSettingsSaving}
						/>
					</FieldShell>
					<FieldShell>
						<FieldLabel for="{id}-microsoftTenant">Microsoft tenant</FieldLabel>
						<Input
							id="{id}-microsoftTenant"
							bind:value={providerSettingsDraft.microsoftTenant}
							placeholder="common, organizations, consumers, or tenant UUID"
							disabled={integrationsState.providerSettingsLoading ||
								integrationsState.providerSettingsSaving}
						/>
					</FieldShell>
					{#if providerSettingsError}<FieldError errors={[providerSettingsError]} />{/if}
					<Button
						variant="secondary"
						size="sm"
						onclick={() => void saveProviderSettings()}
						disabled={integrationsState.providerSettingsLoading ||
							integrationsState.providerSettingsSaving}
						loading={integrationsState.providerSettingsSaving}>Save email registrations</Button
					>
				</div>
			</div>
		{:else if activeStep === 'knowledge'}
			<WorkspaceKnowledgeSettingsPanel
				bind:this={workspaceKnowledgeSettingsPanel}
				onStateChange={(state) => {
					knowledgePanelState = state;
				}}
			/>
		{:else if activeStep === 'ai'}
			<AiSettingsPanel />
		{/if}
		{#snippet footer()}
			{#if showProfileFooter}
				<Button
					variant="brand"
					size="default"
					onclick={handleSave}
					disabled={isSaving}
					loading={isSaving}
				>
					{isSaving ? 'Saving...' : 'Save Settings'}
				</Button>
			{:else if showKnowledgeFooter}
				<Button
					variant="brand"
					size="default"
					onclick={() => void handleKnowledgeSave()}
					disabled={!knowledgePanelState.canSave || knowledgePanelState.isSaving}
					loading={knowledgePanelState.isSaving}
				>
					{knowledgePanelState.isSaving ? 'Saving...' : 'Save Settings'}
				</Button>
			{/if}
		{/snippet}
	</Dialog.RailFrame>
</Dialog.Root>

<AlertDialog.Root bind:open={deleteBackupDialogOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete this backup?</AlertDialog.Title>
			<AlertDialog.Description>
				This permanently deletes the selected backup from this device. It cannot be restored after
				deletion.
			</AlertDialog.Description>
		</AlertDialog.Header>
		{#if backupToDelete}
			<div class="grid gap-1 pb-2 sm:grid-cols-2">
				<Meta>Created {formatBackupDateTime(backupToDelete.createdAt)}</Meta>
				<Meta>App v{backupToDelete.appVersion}</Meta>
				<Meta>{describeBackupReason(backupToDelete.reason)}</Meta>
			</div>
		{/if}
		<AlertDialog.Footer>
			<AlertDialog.Cancel onclick={closeDeleteBackupDialog} disabled={backupActionsBusy}>
				Cancel
			</AlertDialog.Cancel>
			<AlertDialog.Action
				onclick={() => void confirmDeleteBackup()}
				disabled={backupActionsBusy}
				variant="destructiveSoft"
			>
				{backupState.isDeletingBackup ? 'Deleting...' : 'Delete backup'}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root bind:open={disconnectGoogleDialogOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Disconnect Google account?</AlertDialog.Title>
			<AlertDialog.Description>
				This removes the mailbox's stored credentials from this computer. Revoke the application's
				access separately in your Google account if needed. You can reconnect from this screen.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel onclick={() => (disconnectGoogleDialogOpen = false)}
				>Cancel</AlertDialog.Cancel
			>
			<AlertDialog.Action
				onclick={() => void confirmDisconnectGoogle()}
				disabled={isDisconnectingGoogle}
				variant="destructiveSoft"
			>
				{isDisconnectingGoogle ? 'Disconnecting…' : 'Disconnect'}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root bind:open={disconnectMicrosoftDialogOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Disconnect Microsoft account?</AlertDialog.Title>
			<AlertDialog.Description>
				This removes the mailbox's stored credentials from this computer. Revoke the application's
				access separately in your Microsoft account if needed. You can reconnect from this screen.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel onclick={() => (disconnectMicrosoftDialogOpen = false)}
				>Cancel</AlertDialog.Cancel
			>
			<AlertDialog.Action
				onclick={() => void confirmDisconnectMicrosoft()}
				disabled={isDisconnectingMicrosoft}
				variant="destructiveSoft"
			>
				{isDisconnectingMicrosoft ? 'Disconnecting…' : 'Disconnect'}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<IntegrationConsentDialog
	bind:open={googleConsentDialogOpen}
	providerName="Google"
	providerLogo={googleLogoUrl}
	title="Connect Google Mail"
	description="Kwantflow brings RFQ emails directly from your Gmail inbox into your estimating workflow. Read specifications from attachments and bring them straight into your estimate. Processed emails are marked as read so you never estimate the same job twice, and quotes can be sent to your clients without leaving Kwantflow. Email access and sending communicate directly with your provider. RFQ processing and AI stay on this device."
	features={[
		{
			title: 'Send quotes instantly.',
			description: 'Quote PDFs go directly to your clients from your Gmail address.'
		}
	]}
	consentText="I agree to let Kwantflow connect to my Gmail in accordance with the"
	consentLinkLabel="Google API Services User Data Policy"
	consentHref="https://developers.google.com/terms/api-services-user-data-policy"
	onconnect={() => void handleGoogleConnect()}
/>

<IntegrationConsentDialog
	bind:open={microsoftConsentDialogOpen}
	providerName="Microsoft"
	providerLogo={microsoftLogoUrl}
	title="Connect Microsoft Outlook"
	description="Kwantflow brings RFQ emails directly from your Outlook inbox into your estimating workflow. Read specifications from attachments and bring them straight into your estimate. Processed emails are marked as read so you never estimate the same job twice, and quotes can be sent to your clients without leaving Kwantflow. Email access and sending communicate directly with your provider. RFQ processing and AI stay on this device."
	features={[
		{
			title: 'Send quotes instantly.',
			description: 'Quote PDFs go directly to your clients from your Outlook address.'
		}
	]}
	consentText="I agree to let Kwantflow connect to my Outlook in accordance with the"
	consentLinkLabel="Microsoft APIs Terms of Use"
	consentHref="https://learn.microsoft.com/en-us/legal/microsoft-apis/terms-of-use"
	onconnect={() => void handleMicrosoftConnect()}
/>

<AlertDialog.Root bind:open={resetDialogOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Reset local workspace on this device?</AlertDialog.Title>
			<AlertDialog.Description>
				This deletes the local workspace database and files from this device and returns the app to
				setup. Export a backup before resetting.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel onclick={() => (resetDialogOpen = false)}>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action onclick={() => void handleResetWorkspace()} disabled={isResetting}>
				{isResetting ? 'Resetting...' : 'Reset local workspace'}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
