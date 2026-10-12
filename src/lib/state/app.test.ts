import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const controlDbServiceMock = {
	init: vi.fn(),
	getActiveWorkspaceRegistryEntry: vi.fn()
};

const dbServiceMock = {
	init: vi.fn(),
	adoptActiveWorkspace: vi.fn(),
	getLocalBootstrapDataCounts: vi.fn(),
	getOptionalSetupPageRecordCounts: vi.fn(),
	getRuntimeDatabaseDiagnostics: vi.fn().mockResolvedValue({
		appVersion: '0.1.0',
		bundledSchemaVersion: 1,
		runtimeSchemaVersion: 1,
		schema: {
			ok: true,
			missingTables: [],
			missingColumns: []
		}
	}),
	resetWorkspace: vi.fn()
};

const storeServiceMock = {
	init: vi.fn(),
	getAiEnabled: vi.fn(),
	getSidebarOpen: vi.fn(),
	getSidebarPanelId: vi.fn(),
	getWorkspaceRailOpen: vi.fn(),
	getFilesView: vi.fn(),
	getThemePreference: vi.fn(),
	getHiddenSetupPageIds: vi.fn(),
	getExplorerTreeState: vi.fn(),
	setAiEnabled: vi.fn(),
	setSidebarOpen: vi.fn(),
	setSidebarPanelId: vi.fn(),
	setWorkspaceRailOpen: vi.fn(),
	setFilesView: vi.fn(),
	setThemePreference: vi.fn(),
	setHiddenSetupPageIds: vi.fn(),
	setExplorerTreeState: vi.fn(),
	setActiveProjectId: vi.fn()
};

const profileStateMock = {
	hydrate: vi.fn()
};

const accountStateMock = {
	hydrate: vi.fn(),
	accountName: 'Sam Owner',
	accountEmail: 'sam@acme.test'
};

const workspaceStateMock = {
	id: 'workspace-acme',
	hydrate: vi.fn(),
	refresh: vi.fn(),
	reset: vi.fn()
};

const customerStateMock = {
	hydrate: vi.fn(),
	refresh: vi.fn()
};

const projectsStateMock = {
	hydrate: vi.fn(),
	list: [] as unknown[],
	setActive: vi.fn(),
	refresh: vi.fn(),
	reset: vi.fn()
};

const contactsStateMock = {
	hydrate: vi.fn(),
	list: [] as unknown[],
	refresh: vi.fn(),
	reset: vi.fn()
};

const aiStateMock = {
	hydrate: vi.fn()
};

const assistantStateMock = {
	hydrate: vi.fn()
};

const onboardingStateMock = {
	hydrate: vi.fn(),
	shouldGateApp: false,
	reset: vi.fn(),
	setImportError: vi.fn(),
	recordSelectedImportSource: vi.fn(),
	clearSelectedImportSource: vi.fn()
};

const errorStateMock = {
	catchError: vi.fn()
};

const envMock = {
	isTauri: vi.fn()
};

const invokeMock = vi.fn();
const infoMock = vi.fn();
const warnMock = vi.fn();
const errorMock = vi.fn();
const traceMock = vi.fn();
const debugMock = vi.fn();
const attachConsoleMock = vi.fn();
const setModeMock = vi.fn();
const resetModeMock = vi.fn();

vi.mock('../services/store', () => ({
	storeService: storeServiceMock
}));

vi.mock('../services/control-db', () => ({
	controlDbService: controlDbServiceMock
}));

vi.mock('../services/db', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../services/db')>();
	return {
		...actual,
		dbService: dbServiceMock
	};
});

vi.mock('./profile.svelte', () => ({
	profileState: profileStateMock
}));

vi.mock('./account.svelte', () => ({
	accountState: accountStateMock
}));

vi.mock('./workspace.svelte', () => ({
	workspaceState: workspaceStateMock
}));

vi.mock('./customer.svelte', () => ({
	customerState: customerStateMock
}));

vi.mock('./projects.svelte', () => ({
	projectsState: projectsStateMock
}));

vi.mock('./contacts.svelte', () => ({
	contactsState: contactsStateMock
}));

vi.mock('./ai.svelte', () => ({
	aiState: aiStateMock
}));

vi.mock('./assistant.svelte.js', () => ({
	assistantState: assistantStateMock
}));

vi.mock('./onboarding.svelte', () => ({
	onboardingState: onboardingStateMock
}));

vi.mock('./backup.svelte', () => ({
	backupState: {
		hydrate: vi.fn(),
		maybeRunAutomaticBackup: vi.fn(),
		startPeriodicCheck: vi.fn(),
		status: {
			lastBackup: null,
			lastAutomaticBackup: null,
			recentSnapshots: []
		},
		isHydrated: false,
		automaticCadence: 'weekly',
		automaticCadenceLabel: 'Weekly'
	}
}));

vi.mock('./errors.svelte', () => ({
	errorState: errorStateMock
}));

vi.mock('../utils/env', () => ({
	isTauri: envMock.isTauri,
	hasInternetConnection: vi.fn().mockReturnValue(true)
}));

vi.mock('@tauri-apps/api/core', () => ({
	invoke: invokeMock
}));

const setThemeMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@tauri-apps/api/window', () => ({
	getCurrentWindow: vi.fn(() => ({
		setTheme: setThemeMock
	}))
}));

vi.mock('@tauri-apps/plugin-log', () => ({
	attachConsole: attachConsoleMock,
	trace: traceMock,
	debug: debugMock,
	info: infoMock,
	warn: warnMock,
	error: errorMock
}));

vi.mock('mode-watcher', () => ({
	setMode: setModeMock,
	resetMode: resetModeMock
}));

describe('appState boot', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.resetModules();
		vi.clearAllMocks();

		envMock.isTauri.mockReturnValue(true);
		controlDbServiceMock.init.mockResolvedValue(undefined);
		controlDbServiceMock.getActiveWorkspaceRegistryEntry.mockResolvedValue({
			id: 'workspace-acme',
			customerId: 'primary-customer',
			displayName: 'Acme Fabrication',
			slug: 'acme-fabrication',
			dbPath: 'workspaces/workspace-acme/workspace.db',
			vaultRootPath: 'Kwantflow/workspaces/workspace-acme/vault',
			isDefault: true,
			lastOpenedAt: '2026-04-23T00:00:00.000Z',
			created_at: '2026-04-23T00:00:00.000Z',
			updated_at: '2026-04-23T00:00:00.000Z'
		});
		profileStateMock.hydrate.mockResolvedValue(undefined);
		dbServiceMock.init.mockResolvedValue(undefined);
		dbServiceMock.adoptActiveWorkspace.mockReturnValue(undefined);
		dbServiceMock.getLocalBootstrapDataCounts.mockResolvedValue({
			projectCount: 0,
			customerCount: 0
		});
		dbServiceMock.getOptionalSetupPageRecordCounts.mockResolvedValue({
			materials: 0,
			'labour-rates': 0,
			'equipment-rates': 0,
			'subcontract-rates': 0,
			'cost-presets': 0,
			'estimate-templates': 0
		});
		dbServiceMock.resetWorkspace.mockResolvedValue(undefined);
		storeServiceMock.init.mockResolvedValue(undefined);
		accountStateMock.hydrate.mockResolvedValue(undefined);
		accountStateMock.accountName = 'Sam Owner';
		accountStateMock.accountEmail = 'sam@acme.test';
		storeServiceMock.getAiEnabled.mockResolvedValue(false);
		storeServiceMock.getSidebarOpen.mockResolvedValue(true);
		storeServiceMock.getSidebarPanelId.mockResolvedValue('pages');
		storeServiceMock.getWorkspaceRailOpen.mockResolvedValue(true);
		storeServiceMock.getFilesView.mockResolvedValue('list');
		storeServiceMock.getThemePreference.mockResolvedValue('system');
		storeServiceMock.getHiddenSetupPageIds.mockResolvedValue([]);
		storeServiceMock.getExplorerTreeState.mockResolvedValue({
			expandedProjectIds: [],
			collapsedAssetIds: []
		});
		storeServiceMock.setHiddenSetupPageIds.mockResolvedValue(undefined);
		storeServiceMock.setThemePreference.mockResolvedValue(undefined);
		storeServiceMock.setExplorerTreeState.mockResolvedValue(undefined);
		storeServiceMock.setActiveProjectId.mockResolvedValue(undefined);
		workspaceStateMock.hydrate.mockResolvedValue(undefined);
		workspaceStateMock.refresh.mockResolvedValue(undefined);
		workspaceStateMock.reset.mockReturnValue(undefined);
		customerStateMock.hydrate.mockResolvedValue(undefined);
		customerStateMock.refresh.mockResolvedValue(undefined);
		projectsStateMock.hydrate.mockResolvedValue(undefined);
		projectsStateMock.reset.mockReturnValue(undefined);
		contactsStateMock.hydrate.mockResolvedValue(undefined);
		contactsStateMock.reset.mockReturnValue(undefined);
		aiStateMock.hydrate.mockResolvedValue(undefined);
		assistantStateMock.hydrate.mockResolvedValue(undefined);
		onboardingStateMock.shouldGateApp = false;
		onboardingStateMock.hydrate.mockResolvedValue(undefined);
		onboardingStateMock.recordSelectedImportSource.mockResolvedValue(undefined);
		onboardingStateMock.clearSelectedImportSource.mockResolvedValue(undefined);
		invokeMock.mockImplementation(async (command: string) => {
			if (command === 'activate_workspace_command') {
				return {
					id: 'workspace-acme',
					dbPath: 'workspaces/workspace-acme/workspace.db'
				};
			}
			return undefined;
		});
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	afterEach(async () => {
		const { resetLoggerForTests } = await import('$lib/services/logger.js');
		resetLoggerForTests();
	});

	it('finalises the startup window once boot completes in Tauri', async () => {
		const { appState } = await import('./app.svelte');
		const bootPromise = appState.boot();

		await vi.runAllTimersAsync();
		await bootPromise;

		expect(appState.isBooting).toBe(false);
		expect(appState.bootFailureMessage).toBeNull();
		expect(controlDbServiceMock.init).toHaveBeenCalledTimes(1);
		expect(controlDbServiceMock.getActiveWorkspaceRegistryEntry).toHaveBeenCalledTimes(1);
		expect(profileStateMock.hydrate).toHaveBeenCalledTimes(1);
		expect(dbServiceMock.adoptActiveWorkspace).toHaveBeenCalledWith('workspace-acme');
		expect(dbServiceMock.init).toHaveBeenCalledTimes(1);
		expect(invokeMock).toHaveBeenCalledWith('finalize_startup_window');
	}, 10_000);

	it('surfaces a visible boot failure when a startup stage hangs', async () => {
		storeServiceMock.init.mockImplementation(
			() =>
				new Promise<void>(() => {
					/* never resolves */
				})
		);

		const { appState } = await import('./app.svelte');
		const bootPromise = appState.boot();

		await vi.advanceTimersByTimeAsync(15_001);
		await bootPromise;

		expect(appState.isBooting).toBe(false);
		expect(appState.bootStageTitle).toBe('Startup paused');
		expect(appState.bootFailureMessage).toContain('Loading settings timed out');
		expect(errorStateMock.catchError).toHaveBeenCalledWith(expect.any(Error), 'Boot Sequence');
	});

	it('opens the recovery screen without querying or hydrating damaged local data', async () => {
		invokeMock.mockImplementation(async (command: string) =>
			command === 'get_local_startup_failure' ? 'Unknown local database schema.' : undefined
		);
		const { appState } = await import('./app.svelte');
		const bootPromise = appState.boot();
		await vi.runAllTimersAsync();
		await bootPromise;
		expect(appState.isBooting).toBe(false);
		expect(appState.bootFailureKind).toBe('repair_required');
		expect(appState.bootFailureMessage).toBe('Unknown local database schema.');
		expect(appState.bootStageDetail).toContain('verified backup');
		expect(controlDbServiceMock.init).not.toHaveBeenCalled();
		expect(storeServiceMock.init).not.toHaveBeenCalled();
		expect(profileStateMock.hydrate).not.toHaveBeenCalled();
		expect(dbServiceMock.init).not.toHaveBeenCalled();
		expect(projectsStateMock.hydrate).not.toHaveBeenCalled();
		expect(contactsStateMock.hydrate).not.toHaveBeenCalled();
	});

	it('opens the fixed local email setup guide without requesting a web resource', async () => {
		invokeMock.mockResolvedValue('Synthetic offline email setup instructions');
		const { appState } = await import('./app.svelte');
		await appState.openLocalDocumentation('email_setup');
		expect(invokeMock).toHaveBeenCalledExactlyOnceWith('open_local_documentation', {
			kind: 'email_setup'
		});
		expect(appState.localDocumentationTitle).toBe('Connect email');
		expect(appState.localDocumentationText).toBe('Synthetic offline email setup instructions');
		expect(appState.isLocalDocumentationOpen).toBe(true);
	});

	it('keeps the latest documentation selection when reads finish out of order', async () => {
		let resolveHelp: (text: string) => void = () => {};
		invokeMock.mockImplementation(async (_command: string, args: { kind: string }) => {
			if (args.kind === 'help')
				return new Promise<string>((resolve) => {
					resolveHelp = resolve;
				});
			return 'License text';
		});
		const { appState } = await import('./app.svelte');
		const first = appState.openLocalDocumentation('help');
		await appState.openLocalDocumentation('license');
		resolveHelp('Older help response');
		await first;
		expect(appState.localDocumentationTitle).toBe('License');
		expect(appState.localDocumentationText).toBe('License text');
		expect(appState.isLocalDocumentationOpen).toBe(true);
	});

	it('hydrates customer and workspace authority during boot when an active workspace is available', async () => {
		const { appState } = await import('./app.svelte');
		const bootPromise = appState.boot();

		await vi.runAllTimersAsync();
		await bootPromise;

		expect(customerStateMock.hydrate).toHaveBeenCalledTimes(1);
		expect(workspaceStateMock.hydrate).toHaveBeenCalledTimes(1);
	});

	it('stops boot immediately when local database initialisation fails', async () => {
		dbServiceMock.init.mockRejectedValueOnce(new Error('Update required'));

		const { appState } = await import('./app.svelte');
		const bootPromise = appState.boot();

		await vi.runAllTimersAsync();
		await bootPromise;

		expect(appState.isBooting).toBe(false);
		expect(appState.bootFailureMessage).toContain('Update required');
		expect(accountStateMock.hydrate).not.toHaveBeenCalled();
		expect(customerStateMock.hydrate).not.toHaveBeenCalled();
		expect(workspaceStateMock.hydrate).not.toHaveBeenCalled();
		expect(projectsStateMock.hydrate).not.toHaveBeenCalled();
		expect(contactsStateMock.hydrate).not.toHaveBeenCalled();
	});

	it('restores a dark theme preference during boot', async () => {
		storeServiceMock.getThemePreference.mockResolvedValueOnce('dark');

		const { appState } = await import('./app.svelte');
		const bootPromise = appState.boot();

		await vi.runAllTimersAsync();
		await bootPromise;

		expect(storeServiceMock.getThemePreference).toHaveBeenCalledTimes(1);
		expect(appState.themePreference).toBe('dark');
		expect(setModeMock).toHaveBeenCalledWith('dark');
		expect(resetModeMock).not.toHaveBeenCalled();
	});

	it('restores a system theme preference during boot', async () => {
		const { appState } = await import('./app.svelte');
		const bootPromise = appState.boot();

		await vi.runAllTimersAsync();
		await bootPromise;

		expect(storeServiceMock.getThemePreference).toHaveBeenCalledTimes(1);
		expect(appState.themePreference).toBe('system');
		expect(resetModeMock).toHaveBeenCalledTimes(1);
		expect(setModeMock).not.toHaveBeenCalled();
	});

	it('persists theme preference changes and applies the selected mode', async () => {
		const { appState } = await import('./app.svelte');

		await appState.setThemePreference('light');
		expect(appState.themePreference).toBe('light');
		expect(storeServiceMock.setThemePreference).toHaveBeenCalledWith('light');
		expect(setModeMock).toHaveBeenCalledWith('light');

		vi.clearAllMocks();

		await appState.setThemePreference('system');
		expect(appState.themePreference).toBe('system');
		expect(storeServiceMock.setThemePreference).toHaveBeenCalledWith('system');
		expect(resetModeMock).toHaveBeenCalledTimes(1);
		expect(setModeMock).not.toHaveBeenCalled();
	});

	it('prepares for workspace entry without persisting the temporary collapse', async () => {
		const { appState } = await import('./app.svelte');

		appState.isSidebarOpen = true;
		appState.prepareForWorkspaceEntry();

		expect(appState.isSidebarOpen).toBe(false);
		expect(appState.takePendingWorkspaceSidebarOpen()).toBe(true);
		expect(appState.takePendingWorkspaceSidebarOpen()).toBeNull();
		expect(storeServiceMock.setSidebarOpen).not.toHaveBeenCalled();
	});

	it('keeps the first pending sidebar state across repeated workspace-entry preparation', async () => {
		const { appState } = await import('./app.svelte');

		appState.isSidebarOpen = true;
		appState.prepareForWorkspaceEntry();
		appState.prepareForWorkspaceEntry();

		expect(appState.takePendingWorkspaceSidebarOpen()).toBe(true);
		expect(storeServiceMock.setSidebarOpen).not.toHaveBeenCalled();
	});

	it('persists the workspace rail toggle independently from the main sidebar', async () => {
		const { appState } = await import('./app.svelte');

		appState.isWorkspaceRailOpen = true;
		await appState.toggleWorkspaceRail();

		expect(appState.isWorkspaceRailOpen).toBe(false);
		expect(storeServiceMock.setWorkspaceRailOpen).toHaveBeenCalledWith(false);
		expect(storeServiceMock.setSidebarOpen).not.toHaveBeenCalled();
	});

	it('can persist sidebar state without mutating the current reactive owner', async () => {
		const { appState } = await import('./app.svelte');

		appState.isSidebarOpen = true;
		await appState.persistSidebarOpen(false);

		expect(appState.isSidebarOpen).toBe(true);
		expect(storeServiceMock.setSidebarOpen).toHaveBeenCalledWith(false);
	});

	it('keeps mobile workspace rail toggles session-local', async () => {
		const { appState } = await import('./app.svelte');

		appState.isWorkspaceRailMobileOpen = false;
		await appState.toggleWorkspaceRail({ mobile: true });

		expect(appState.isWorkspaceRailMobileOpen).toBe(true);
		expect(storeServiceMock.setWorkspaceRailOpen).not.toHaveBeenCalled();
	});

	it('opens settings on Account by default', async () => {
		const { appState } = await import('./app.svelte');

		appState.openSettingsDialog();

		expect(appState.isSettingsDialogOpen).toBe(true);
		expect(appState.settingsDialogRequestedTab).toBe('account');
	});

	it('opens settings on the requested tab', async () => {
		const { appState } = await import('./app.svelte');

		appState.openSettingsDialog('account');

		expect(appState.isSettingsDialogOpen).toBe(true);
		expect(appState.settingsDialogRequestedTab).toBe('account');
	});

	it('skips workspace lists while local onboarding gates the app', async () => {
		onboardingStateMock.shouldGateApp = true;

		const { appState } = await import('./app.svelte');
		const bootPromise = appState.boot();

		await vi.runAllTimersAsync();
		await bootPromise;

		expect(aiStateMock.hydrate).toHaveBeenCalledWith({
			includeWorkspaceState: true
		});
		expect(onboardingStateMock.hydrate).toHaveBeenCalledTimes(1);
		expect(projectsStateMock.hydrate).not.toHaveBeenCalled();
		expect(contactsStateMock.hydrate).not.toHaveBeenCalled();
	});

	it('hydrates onboarding without legacy bootstrap count inputs', async () => {
		const { appState } = await import('./app.svelte');
		await appState.boot();

		expect(onboardingStateMock.hydrate).toHaveBeenCalledWith();
	});

	it('boots local AI state without scheduling a remote AI access refresh', async () => {
		const { appState } = await import('./app.svelte');
		const bootPromise = appState.boot();

		await vi.runAllTimersAsync();
		await bootPromise;

		expect(appState.isBooting).toBe(false);
		expect(appState.bootFailureMessage).toBeNull();
		expect(aiStateMock.hydrate).toHaveBeenCalledWith({
			includeWorkspaceState: true
		});
	});

	it('does not block boot when local AI hydration hangs', async () => {
		aiStateMock.hydrate.mockImplementation(
			() =>
				new Promise<void>(() => {
					/* intentionally unresolved */
				})
		);

		const { appState } = await import('./app.svelte');
		const bootPromise = appState.boot();

		await vi.runAllTimersAsync();
		await bootPromise;

		expect(appState.isBooting).toBe(false);
		expect(appState.bootFailureMessage).toBeNull();
		expect(aiStateMock.hydrate).toHaveBeenCalledWith({
			includeWorkspaceState: true
		});
	});

	it('does not hydrate workspace-owned account, customer, or AI state before first workspace exists', async () => {
		controlDbServiceMock.getActiveWorkspaceRegistryEntry.mockResolvedValueOnce(null);
		onboardingStateMock.shouldGateApp = true;

		const { appState } = await import('./app.svelte');
		const bootPromise = appState.boot();

		await vi.runAllTimersAsync();
		await bootPromise;

		expect(accountStateMock.hydrate).not.toHaveBeenCalledWith({ includeWorkspaceMember: true });
		expect(customerStateMock.hydrate).not.toHaveBeenCalledWith({ includeWorkspace: true });
		expect(workspaceStateMock.hydrate).not.toHaveBeenCalled();
		expect(aiStateMock.hydrate).not.toHaveBeenCalledWith({
			includeAccessStatus: false,
			includeWorkspaceState: true
		});
	});

	it('loads explorer tree state through appState with an empty fallback', async () => {
		const { appState } = await import('./app.svelte');

		storeServiceMock.getExplorerTreeState.mockRejectedValueOnce(new Error('store unavailable'));

		await expect(appState.getExplorerTreeState()).resolves.toEqual({
			expandedProjectIds: [],
			collapsedAssetIds: []
		});
	});

	it('persists explorer tree state through appState', async () => {
		const { appState } = await import('./app.svelte');

		await appState.setExplorerTreeState({
			expandedProjectIds: ['project-1'],
			collapsedAssetIds: ['asset-2']
		});

		expect(storeServiceMock.setExplorerTreeState).toHaveBeenCalledWith({
			expandedProjectIds: ['project-1'],
			collapsedAssetIds: ['asset-2']
		});
	});

	it('resets the active workspace without querying the deleted workspace database', async () => {
		const { appState } = await import('./app.svelte');

		await appState.resetWorkspace();

		expect(dbServiceMock.resetWorkspace).toHaveBeenCalledTimes(1);
		expect(onboardingStateMock.reset).toHaveBeenCalledWith(null);
		expect(storeServiceMock.setActiveProjectId).toHaveBeenCalledWith(null);
		expect(projectsStateMock.reset).toHaveBeenCalledTimes(1);
		expect(contactsStateMock.reset).toHaveBeenCalledTimes(1);
		expect(workspaceStateMock.reset).toHaveBeenCalledTimes(1);
		expect(projectsStateMock.refresh).not.toHaveBeenCalled();
		expect(contactsStateMock.refresh).not.toHaveBeenCalled();
		expect(workspaceStateMock.hydrate).not.toHaveBeenCalled();
		expect(accountStateMock.hydrate).toHaveBeenCalledWith({ includeWorkspaceMember: false });
		expect(customerStateMock.hydrate).toHaveBeenCalledWith({ includeWorkspace: false });
	});

	it('refreshes optional setup page counts and unhides pages that already contain records', async () => {
		const { appState } = await import('./app.svelte');

		appState.hiddenSetupPageIds = ['materials', 'equipment-rates'];
		dbServiceMock.getOptionalSetupPageRecordCounts.mockResolvedValueOnce({
			materials: 2,
			'labour-rates': 0,
			'equipment-rates': 0,
			'subcontract-rates': 0,
			'cost-presets': 0,
			'estimate-templates': 0
		});

		await appState.refreshOptionalSetupPageRecordCounts();

		expect(appState.optionalSetupPageRecordCounts.materials).toBe(2);
		expect(appState.hiddenSetupPageIds).toEqual(['equipment-rates']);
		expect(storeServiceMock.setHiddenSetupPageIds).toHaveBeenCalledWith(
			['equipment-rates'],
			'workspace-acme'
		);
	});

	it('keeps setup pages with records visible when saving visibility preferences', async () => {
		const { appState } = await import('./app.svelte');

		appState.optionalSetupPageRecordCounts = {
			materials: 1,
			'labour-rates': 0,
			'equipment-rates': 0,
			'subcontract-rates': 0,
			'cost-presets': 0,
			'estimate-templates': 0
		};

		await appState.setVisibleSetupPageIds(['labour-rates']);

		expect(appState.hiddenSetupPageIds).not.toContain('materials');
		expect(appState.hiddenSetupPageIds).toEqual([
			'equipment-rates',
			'subcontract-rates',
			'cost-presets',
			'estimate-templates'
		]);
	});
});
