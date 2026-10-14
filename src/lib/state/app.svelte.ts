import { storeService } from '../services/store';
import { controlDbService } from '$lib/services/control-db.js';
import { hasInternetConnection } from '$lib/utils/env.js';
import {
	DatabaseInitializationError,
	type DatabaseInitializationFailureKind,
	dbService
} from '$lib/services/db.js';
import { profileState } from './profile.svelte';
import { accountState } from './account.svelte';
import { workspaceState } from './workspace.svelte';
import { projectsState } from './projects.svelte';
import { contactsState } from './contacts.svelte';
import { aiState } from './ai.svelte';
import { assistantState } from './assistant.svelte.js';
import { onboardingState } from './onboarding.svelte';
import { errorState } from './errors.svelte';
import { explorerState } from './explorer.svelte.js';
import { integrationsState } from './integrations.svelte.js';
import { backupState } from './backup.svelte';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauri } from '../utils/env';
import { resetMode, setMode } from 'mode-watcher';
import type { ThemePreference } from '$lib/constants/index.js';
import { CURRENT_APP_SCHEMA_VERSION } from '$lib/constants/index.js';
import type { SidebarPanelId } from '$lib/constants/sidebar.js';
import {
	OPTIONAL_SETUP_PAGE_IDS,
	type OptionalSetupPageId
} from '$lib/constants/setup-page-visibility.js';
import type { AppShellCreateActionId } from './app-tabs.svelte.js';
import { createLogger } from '$lib/services/logger.js';

const log = createLogger('appState');
const logInfo = (msg: string) => log.info(msg);

const BOOT_STAGE_TIMEOUT_MS = 15_000;

/**
 * AppState — Global system health and orchestration.
 * Owns the boot sequence, sidebar toggle, and shell-wide orchestration.
 */
type SettingsDialogTab =
	'workspace' | 'business' | 'account' | 'general' | 'setup-pages' | 'backups' | 'knowledge' | 'ai';
type ExplorerTreeState = {
	expandedProjectIds: string[];
	collapsedAssetIds: string[];
};
type OptionalSetupPageRecordCounts = Record<OptionalSetupPageId, number>;

const EMPTY_OPTIONAL_SETUP_PAGE_RECORD_COUNTS: OptionalSetupPageRecordCounts = {
	materials: 0,
	'labour-rates': 0,
	'equipment-rates': 0,
	'subcontract-rates': 0,
	'cost-presets': 0,
	'estimate-templates': 0
};

class AppState {
	private bootPromise: Promise<void> | null = null;
	private initialBootPromise: Promise<void> | null = null;
	private hasCompletedInitialBoot = false;
	private aiHydrationPromise: Promise<void> | null = null;

	/** Whether the sidebar is expanded. Persisted via storeService. */
	isSidebarOpen: boolean = $state(true);

	/** Active sidebar panel. Persisted so the shell reopens to the last used mode. */
	activeSidebarPanel: SidebarPanelId = $state('pages');

	/** Session-local search text for the Pages sidebar panel. */
	sidebarPagesSearchQuery: string = $state('');

	/** Session-local search text for the Projects sidebar panel. */
	sidebarProjectsSearchQuery: string = $state('');

	/** Session-local search text for the Explorer sidebar panel. */
	sidebarExplorerSearchQuery: string = $state('');

	/** Local shell visibility preferences for optional setup pages. */
	hiddenSetupPageIds: OptionalSetupPageId[] = $state.raw([]);

	/** Current record counts for optional setup pages used by visibility controls. */
	optionalSetupPageRecordCounts: OptionalSetupPageRecordCounts = $state(
		EMPTY_OPTIONAL_SETUP_PAGE_RECORD_COUNTS
	);

	/** Whether the project-route workspace context rail is expanded. Persisted via storeService. */
	isWorkspaceRailOpen: boolean = $state(true);

	/** Mobile-only project-route workspace sheet state. Session-local. */
	isWorkspaceRailMobileOpen: boolean = $state(false);

	/** Files pane view mode. Persisted via storeService. */
	filesView: 'grid' | 'list' = $state('list');

	/** Preview box background theme for file viewers. Persisted via storeService. */
	previewTheme: 'dark' | 'light' = $state('dark');

	/** Whether file viewers stay expanded across file changes. Persisted via storeService. */
	previewExpanded: boolean = $state(false);

	/** Theme preference. Persisted via storeService and resolved via ModeWatcher. */
	themePreference: ThemePreference = $state('system');

	/** AI drafting feature flag. Persisted via storeService. */
	aiEnabled: boolean = $state(true);

	/** Whether the app has internet connectivity. Updated by online/offline events. */
	hasInternet: boolean = $state(true);

	private readonly syncInternetStatus = () => {
		this.hasInternet = hasInternetConnection();
	};

	private internetListenersRegistered = false;

	private ensureInternetListeners(): void {
		if (this.internetListenersRegistered || typeof window === 'undefined') return;
		this.internetListenersRegistered = true;
		this.syncInternetStatus();
		window.addEventListener('online', this.syncInternetStatus);
		window.addEventListener('offline', this.syncInternetStatus);
	}

	/** Whether the boot sequence is still running. */
	isBooting: boolean = $state(true);

	/** Human-readable boot progress title shown in the startup shell. */
	bootStageTitle: string = $state('Starting workspace');

	/** Human-readable boot progress detail shown in the startup shell. */
	bootStageDetail: string = $state('Preparing your local workspace…');

	/** User-facing boot failure shown when startup cannot complete. */
	bootFailureMessage: string | null = $state(null);
	bootFailureKind: DatabaseInitializationFailureKind | 'unknown' | null = $state(null);

	/** Global settings dialog state. */
	isSettingsDialogOpen: boolean = $state(false);

	/** Preferred tab to show the next time the settings dialog opens. */
	settingsDialogRequestedTab: SettingsDialogTab = $state('account');

	/** Global standalone feedback dialog state. */

	/** Global setup-import wizard dialog state. */
	isSetupImportDialogOpen = $state(false);

	/** Pending shell-level create action request consumed by the root layout. */
	requestedShellCreateActionId: AppShellCreateActionId | null = $state(null);

	/** Pending pre-workspace sidebar state captured before navigation starts. */
	private pendingWorkspaceSidebarOpen: boolean | null = null;

	/**
	 * Boot — The central hydration sequence.
	 * Called once from +layout.svelte onMount.
	 * Each step is isolated — a failure in one does not block the rest.
	 */
	async boot(): Promise<void> {
		if (this.bootPromise) {
			await this.bootPromise;
			return;
		}

		this.bootPromise = this.runBoot();
		try {
			await this.bootPromise;
		} finally {
			this.bootPromise = null;
		}
	}

	async ensureBooted(): Promise<void> {
		if (this.hasCompletedInitialBoot) return;
		if (this.initialBootPromise) {
			await this.initialBootPromise;
			return;
		}

		this.initialBootPromise = this.boot();
		try {
			await this.initialBootPromise;
		} finally {
			this.initialBootPromise = null;
		}
	}

	private updateBootStage(title: string, detail: string): void {
		this.bootStageTitle = title;
		this.bootStageDetail = detail;
	}

	private async runBootStage<T>(
		title: string,
		detail: string,
		fn: () => Promise<T>,
		timeoutMs = BOOT_STAGE_TIMEOUT_MS
	): Promise<T> {
		this.updateBootStage(title, detail);
		const stageStartedAt = Date.now();
		let timeoutId: ReturnType<typeof setTimeout> | null = null;
		const timeoutPromise = new Promise<never>((_, reject) => {
			timeoutId = setTimeout(() => {
				reject(new Error(`${title} timed out. Try reopening Kwantflow.`));
			}, timeoutMs);
		});

		try {
			const result = (await Promise.race([fn(), timeoutPromise])) as T;
			logInfo(`${title} completed in ${Date.now() - stageStartedAt}ms.`);
			return result;
		} finally {
			if (timeoutId) clearTimeout(timeoutId);
		}
	}

	private setBootFailure(error: unknown): void {
		const message = error instanceof Error ? error.message : String(error);
		this.bootFailureMessage = message.trim() || 'Kwantflow could not finish startup.';
		this.bootFailureKind = error instanceof DatabaseInitializationError ? error.kind : 'unknown';
		if (error instanceof DatabaseInitializationError) {
			switch (error.kind) {
				case 'update_required':
					this.updateBootStage(
						'Update required',
						'Install the latest Kwantflow build to continue.'
					);
					return;
				case 'repair_required':
					this.updateBootStage(
						'Database repair required',
						'Use a compatible build or import a verified backup to recover your local data.'
					);
					return;
			}
		}
		this.updateBootStage('Startup paused', 'Kwantflow could not finish loading this workspace.');
	}

	private async finalizeStartupWindow(): Promise<void> {
		if (!isTauri()) return;

		logInfo('Finalising startup window.');
		await invoke('finalize_startup_window');
		logInfo('Startup window finalised.');
	}

	private ensureAiHydrationStarted(options: { includeWorkspaceState?: boolean } = {}): void {
		if (this.aiHydrationPromise) return;

		this.aiHydrationPromise = (async () => {
			try {
				await aiState.hydrate({
					includeWorkspaceState: options.includeWorkspaceState ?? true
				});
			} catch (error) {
				await errorState.catchError(error, 'AI Settings');
			} finally {
				this.aiHydrationPromise = null;
			}
		})();
	}

	private async runBoot(): Promise<void> {
		this.isBooting = true;
		this.bootFailureMessage = null;
		this.bootFailureKind = null;
		this.updateBootStage('Starting workspace', 'Preparing your local workspace…');
		explorerState.reset();
		this.ensureInternetListeners();
		logInfo('Boot sequence started.');
		const bootStartedAt = Date.now();
		try {
			if (isTauri()) {
				const failure = await this.runBootStage(
					'Checking local data',
					'Checking local startup recovery…',
					() => invoke<string | null>('get_local_startup_failure')
				);
				if (failure) {
					await backupState.hydrate();
					throw new DatabaseInitializationError('repair_required', failure, failure);
				}
			}
			await this.runBootStage('Loading settings', 'Opening local preferences…', async () => {
				try {
					await storeService.init();
					await backupState.hydrate();
				} catch (error) {
					await errorState.catchError(error, 'Store Init', () => void storeService.init());
				}
			});

			await this.runBootStage(
				'Initialising local data',
				'Checking local setup compatibility…',
				async () => {
					await controlDbService.init();
				}
			);

			let activeWorkspaceEntry: Awaited<
				ReturnType<typeof controlDbService.getActiveWorkspaceRegistryEntry>
			> = null;

			await this.runBootStage('Loading profile', 'Reading your saved details…', async () => {
				try {
					await profileState.hydrate();
				} catch (error) {
					await errorState.catchError(error, 'Profile Hydration');
				}
			});

			await this.runBootStage(
				'Resolving workspace',
				'Checking which workspace this device should open…',
				async () => {
					activeWorkspaceEntry = await controlDbService.getActiveWorkspaceRegistryEntry();
					if (!activeWorkspaceEntry) {
						workspaceState.reset();
						return;
					}

					const activatedWorkspace = await invoke<typeof activeWorkspaceEntry>(
						'activate_workspace_command',
						{
							input: { workspaceId: activeWorkspaceEntry.id }
						}
					);
					if (!activatedWorkspace) {
						throw new Error('Active workspace could not be activated.');
					}
					dbService.adoptActiveWorkspace(activatedWorkspace.id);
					await dbService.init();

					// Startup contract audit: compare the workspace contract written during init.
					const diagnostics = await dbService.getRuntimeDatabaseDiagnostics();
					logInfo(
						`Database contract audit: expected schema ${CURRENT_APP_SCHEMA_VERSION}, active schema ${diagnostics.runtimeSchemaVersion}`
					);
					if (
						diagnostics.runtimeSchemaVersion != null &&
						diagnostics.runtimeSchemaVersion < CURRENT_APP_SCHEMA_VERSION
					) {
						log.info(
							`WARN: Database contract is stale — workspace has ${diagnostics.runtimeSchemaVersion}, app requires ${CURRENT_APP_SCHEMA_VERSION}.`
						);
					}
				}
			);

			await this.runBootStage(
				'Loading workspace',
				'Reading local workspace settings…',
				async () => {
					try {
						if (activeWorkspaceEntry) {
							await accountState.hydrate({ includeWorkspaceMember: true });
							await workspaceState.hydrate();
						} else {
							await accountState.hydrate({ includeWorkspaceMember: false });
						}
					} catch (error) {
						await errorState.catchError(error, 'Workspace Hydration');
					}
				}
			);

			await this.runBootStage(
				'Restoring integrations',
				'Loading your connected accounts…',
				async () => {
					try {
						await integrationsState.hydrateIntegrations();
					} catch (error) {
						await errorState.catchError(error, 'Integration Hydration');
					}
				}
			);

			await this.runBootStage('Applying theme', 'Restoring your appearance settings…', async () => {
				try {
					this.themePreference = await storeService.getThemePreference();
				} catch {
					this.themePreference = 'system';
				}
				this.applyThemePreference(this.themePreference);
			});

			await this.runBootStage(
				'Restoring workspace layout',
				'Opening your saved workspace layout…',
				async () => {
					try {
						this.isSidebarOpen = await storeService.getSidebarOpen();
						this.activeSidebarPanel = await storeService.getSidebarPanelId();
						this.isWorkspaceRailOpen = await storeService.getWorkspaceRailOpen();
						this.hiddenSetupPageIds = await storeService.getHiddenSetupPageIds(workspaceState.id);
					} catch {
						this.isSidebarOpen = true;
						this.activeSidebarPanel = 'pages';
						this.isWorkspaceRailOpen = true;
						this.hiddenSetupPageIds = [];
					}
				}
			);

			await this.runBootStage(
				'Inspecting setup usage',
				'Checking which setup pages already contain data…',
				async () => {
					if (!activeWorkspaceEntry) {
						this.optionalSetupPageRecordCounts = EMPTY_OPTIONAL_SETUP_PAGE_RECORD_COUNTS;
						return;
					}
					await this.refreshOptionalSetupPageRecordCounts();
				}
			);

			await this.runBootStage('Restoring file view', 'Loading your saved file view…', async () => {
				try {
					this.filesView = await storeService.getFilesView();
				} catch {
					this.filesView = 'list';
				}
			});

			await this.runBootStage(
				'Restoring preview theme',
				'Restoring preview appearance…',
				async () => {
					try {
						this.previewTheme = await storeService.getPreviewTheme();
					} catch {
						this.previewTheme = 'dark';
					}
				}
			);

			await this.runBootStage('Restoring preview layout', 'Restoring preview layout…', async () => {
				try {
					this.previewExpanded = await storeService.getPreviewExpanded();
				} catch {
					this.previewExpanded = false;
				}
			});

			await this.runBootStage(
				'Loading AI settings',
				'Preparing Kwantflow AI preferences…',
				async () => {
					try {
						this.aiEnabled = true;
						await storeService.setAiEnabled(true);
						await assistantState.hydrate();
						this.ensureAiHydrationStarted({ includeWorkspaceState: Boolean(activeWorkspaceEntry) });
					} catch (error) {
						await errorState.catchError(error, 'AI Settings');
						this.aiEnabled = true;
					}
				}
			);

			await this.runBootStage('Checking access', 'Confirming local workspace access…', async () => {
				try {
					if (activeWorkspaceEntry) {
						await workspaceState.refresh();
					}
					await onboardingState.hydrate();
					this.isSettingsDialogOpen = false;
				} catch (error) {
					await errorState.catchError(error, 'Onboarding Hydration');
				}
			});

			if (!onboardingState.shouldGateApp) {
				await this.runBootStage('Loading RFQs', 'Opening your RFQ workspace…', async () => {
					try {
						await projectsState.hydrate();
					} catch (error) {
						await errorState.catchError(error, 'Project Hydration');
					}
				});

				await this.runBootStage(
					'Loading companies',
					'Opening your companies workspace…',
					async () => {
						try {
							await contactsState.hydrate();
						} catch (error) {
							await errorState.catchError(error, 'Company Hydration');
						}
					}
				);
			} else {
				projectsState.list = [];
				contactsState.list = [];
			}

			this.updateBootStage('Starting workspace', 'Finalising local services…');
			await this.runBootStage(
				'Opening workspace',
				'Switching from the launch screen…',
				async () => {
					await this.finalizeStartupWindow();
				},
				5_000
			);

			logInfo(`Boot sequence complete in ${Date.now() - bootStartedAt}ms.`);
			this.hasCompletedInitialBoot = true;

			// Preload setup/rates page code in the background so navigations are instantly compiled
			if (typeof window !== 'undefined') {
				import('$app/navigation')
					.then(({ preloadCode }) => {
						const routes = [
							'/companies',
							'/materials',
							'/labour-rates',
							'/equipment-rates',
							'/subcontract-rates',
							'/cost-presets',
							'/estimate-templates'
						];
						void Promise.all(routes.map((route) => preloadCode(route)));
					})
					.catch((err) => {
						log.warn(`Failed to preload page chunks: ${err}`);
					});
			}

			void backupState.maybeRunAutomaticBackup();
		} catch (error) {
			this.hasCompletedInitialBoot = false;
			this.setBootFailure(error);
			await errorState.catchError(error, 'Boot Sequence');
		} finally {
			this.isBooting = false;
		}
	}

	private applyThemePreference(preference: ThemePreference): void {
		if (preference === 'system') {
			resetMode();
		} else {
			setMode(preference);
		}

		// Sync the native window theme so macOS vibrancy/transparency renders match the app theme.
		// Without this, a light-mode app on a dark-mode macOS system shows dark vibrancy behind
		// the transparent sidebar and toolbar surfaces.
		if (isTauri()) {
			void getCurrentWindow()
				.setTheme(preference === 'system' ? null : preference)
				.catch(() => {});
		}
	}

	/** Toggle sidebar and persist the state. */
	async toggleSidebar(): Promise<void> {
		this.isSidebarOpen = !this.isSidebarOpen;
		await storeService.setSidebarOpen(this.isSidebarOpen);
	}

	/** Persist an explicit sidebar open/closed state. */
	async setSidebarOpen(open: boolean): Promise<void> {
		this.isSidebarOpen = open;
		await storeService.setSidebarOpen(open);
	}

	/** Persist the current sidebar state without re-owning the reactive source. */
	async persistSidebarOpen(open: boolean): Promise<void> {
		await storeService.setSidebarOpen(open);
	}

	async setSidebarPanel(panelId: SidebarPanelId): Promise<void> {
		if (this.activeSidebarPanel === panelId) return;
		this.activeSidebarPanel = panelId;
		await storeService.setSidebarPanelId(panelId);
	}

	setSidebarPagesSearchQuery(query: string): void {
		this.sidebarPagesSearchQuery = query;
	}

	setSidebarProjectsSearchQuery(query: string): void {
		this.sidebarProjectsSearchQuery = query;
	}

	setSidebarExplorerSearchQuery(query: string): void {
		this.sidebarExplorerSearchQuery = query;
	}

	isSetupPageHidden(pageId: OptionalSetupPageId): boolean {
		return this.hiddenSetupPageIds.includes(pageId);
	}

	async refreshOptionalSetupPageRecordCounts(): Promise<void> {
		try {
			this.optionalSetupPageRecordCounts = await dbService.getOptionalSetupPageRecordCounts();
			const hiddenLockedPageIds = this.hiddenSetupPageIds.filter(
				(pageId) => this.optionalSetupPageRecordCounts[pageId] > 0
			);
			if (hiddenLockedPageIds.length > 0) {
				this.hiddenSetupPageIds = this.hiddenSetupPageIds.filter(
					(pageId) => !hiddenLockedPageIds.includes(pageId)
				);
				await storeService.setHiddenSetupPageIds(this.hiddenSetupPageIds, workspaceState.id);
			}
		} catch {
			this.optionalSetupPageRecordCounts = EMPTY_OPTIONAL_SETUP_PAGE_RECORD_COUNTS;
		}
	}

	async setVisibleSetupPageIds(visiblePageIds: readonly OptionalSetupPageId[]): Promise<void> {
		const visibleSet = new Set(visiblePageIds);
		this.hiddenSetupPageIds = OPTIONAL_SETUP_PAGE_IDS.filter(
			(id) => !visibleSet.has(id) && this.optionalSetupPageRecordCounts[id] === 0
		);
		await storeService.setHiddenSetupPageIds(this.hiddenSetupPageIds, workspaceState.id);
	}

	async setSetupPageVisible(pageId: OptionalSetupPageId, visible: boolean): Promise<void> {
		const nextVisible = OPTIONAL_SETUP_PAGE_IDS.filter((id) =>
			id === pageId ? visible : !this.hiddenSetupPageIds.includes(id)
		);
		await this.setVisibleSetupPageIds(nextVisible);
	}

	async getExplorerTreeState(): Promise<ExplorerTreeState> {
		try {
			return await storeService.getExplorerTreeState();
		} catch {
			return {
				expandedProjectIds: [],
				collapsedAssetIds: []
			};
		}
	}

	async setExplorerTreeState(snapshot: ExplorerTreeState): Promise<void> {
		await storeService.setExplorerTreeState(snapshot);
	}

	async toggleWorkspaceRail(options: { mobile?: boolean } = {}): Promise<void> {
		if (options.mobile) {
			this.isWorkspaceRailMobileOpen = !this.isWorkspaceRailMobileOpen;
			return;
		}

		this.isWorkspaceRailOpen = !this.isWorkspaceRailOpen;
		await storeService.setWorkspaceRailOpen(this.isWorkspaceRailOpen);
	}

	async setWorkspaceRailOpen(open: boolean): Promise<void> {
		this.isWorkspaceRailOpen = open;
		await storeService.setWorkspaceRailOpen(open);
	}

	setWorkspaceRailMobileOpen(open: boolean): void {
		this.isWorkspaceRailMobileOpen = open;
	}

	/** Collapse the sidebar immediately for workspace entry without persisting the temporary state. */
	prepareForWorkspaceEntry(): void {
		if (this.pendingWorkspaceSidebarOpen === null) {
			this.pendingWorkspaceSidebarOpen = this.isSidebarOpen;
		}

		this.isSidebarOpen = false;
	}

	/** Consume any pending pre-workspace sidebar state captured before navigation. */
	takePendingWorkspaceSidebarOpen(): boolean | null {
		const pendingOpen = this.pendingWorkspaceSidebarOpen;
		this.pendingWorkspaceSidebarOpen = null;
		return pendingOpen;
	}

	/** Set files view mode and persist the preference. */
	async setFilesView(view: 'grid' | 'list'): Promise<void> {
		this.filesView = view;
		await storeService.setFilesView(view);
	}

	/** Set preview box background theme and persist the preference. */
	async setPreviewTheme(theme: 'dark' | 'light'): Promise<void> {
		this.previewTheme = theme;
		await storeService.setPreviewTheme(theme);
	}

	/** Set file preview expanded layout and persist the preference. */
	async setPreviewExpanded(expanded: boolean): Promise<void> {
		this.previewExpanded = expanded;
		await storeService.setPreviewExpanded(expanded);
	}

	/** Restore the saved preview theme from the store (e.g. on detached window load). */
	async restorePreviewTheme(): Promise<void> {
		try {
			this.previewTheme = await storeService.getPreviewTheme();
		} catch {
			this.previewTheme = 'dark';
		}
	}

	async setThemePreference(preference: ThemePreference): Promise<void> {
		this.themePreference = preference;
		this.applyThemePreference(preference);
		await storeService.setThemePreference(preference);
	}

	async setAiEnabled(enabled: boolean): Promise<void> {
		this.aiEnabled = enabled;
		await storeService.setAiEnabled(enabled);
	}

	/** Restore sidebar to its persisted state (after a temporary workspace override). */
	async restoreSidebarState(): Promise<void> {
		try {
			this.isSidebarOpen = await storeService.getSidebarOpen();
			this.isWorkspaceRailOpen = await storeService.getWorkspaceRailOpen();
		} catch {
			this.isSidebarOpen = true;
			this.isWorkspaceRailOpen = true;
		}
	}

	async retryBoot(): Promise<void> {
		this.bootFailureMessage = null;
		await this.boot();
	}

	openSettingsDialog(tab: SettingsDialogTab = 'account'): void {
		this.settingsDialogRequestedTab = tab;
		this.isSettingsDialogOpen = true;
	}

	closeSettingsDialog(): void {
		this.isSettingsDialogOpen = false;
		this.settingsDialogRequestedTab = 'account';
	}

	openSetupImportDialog(): void {
		this.isSetupImportDialogOpen = true;
	}

	closeSetupImportDialog(): void {
		this.isSetupImportDialogOpen = false;
	}

	requestShellCreate(actionId: AppShellCreateActionId): void {
		this.requestedShellCreateActionId = actionId;
	}

	consumeRequestedShellCreateActionId(): AppShellCreateActionId | null {
		const requested = this.requestedShellCreateActionId;
		this.requestedShellCreateActionId = null;
		return requested;
	}

	isLocalDocumentationOpen = $state(false);
	localDocumentationTitle = $state('');
	localDocumentationText = $state('');
	localDocumentationKind = $state<'help' | 'email_setup' | 'license' | 'notices'>('help');
	localDocumentationPages = $state<{ file: string; title: string }[]>([]);
	localDocumentationPage = $state('README.md');
	private documentationRequestId = 0;

	async openLocalDocumentation(
		kind: 'help' | 'email_setup' | 'license' | 'notices',
		page?: string
	): Promise<void> {
		if (!isTauri()) return;
		const requestId = ++this.documentationRequestId;
		try {
			if (kind === 'help' && this.localDocumentationPages.length === 0) {
				this.localDocumentationPages = await invoke<{ file: string; title: string }[]>(
					'list_local_documentation_pages'
				);
			}
			const text = await invoke<string>('open_local_documentation', {
				kind,
				page: kind === 'help' ? (page ?? 'README.md') : null
			});
			if (requestId !== this.documentationRequestId) return;
			const pageTitle = this.localDocumentationPages.find((entry) => entry.file === page)?.title;
			this.localDocumentationKind = kind;
			this.localDocumentationPage = kind === 'help' ? (page ?? 'README.md') : '';
			this.localDocumentationTitle = {
				help: pageTitle ?? 'Kwantflow Help',
				email_setup: 'Connect email',
				license: 'Licence',
				notices: 'Third-party notices'
			}[kind];
			this.localDocumentationText = text;
			this.isLocalDocumentationOpen = true;
		} catch (error) {
			if (requestId !== this.documentationRequestId) return;
			await errorState.catchError(error, 'Open documentation');
		}
	}

	async exportLocalDiagnostics(): Promise<void> {
		if (!isTauri()) return;
		try {
			const { save } = await import('@tauri-apps/plugin-dialog');
			const path = await save({
				defaultPath: 'kwantflow-diagnostics.zip',
				filters: [{ name: 'ZIP archive', extensions: ['zip'] }]
			});
			if (!path) return;
			const result = await invoke<{ bytes: number[] }>('create_support_diagnostics_bundle', {
				request: {
					context: {
						appVersion: __KWANTFLOW_APP_VERSION__,
						platform: navigator.platform,
						currentRoute: window.location.pathname,
						submittedAt: new Date().toISOString(),
						healthStatus: errorState.healthStatus,
						diagnosticsStatus: 'attached',
						diagnosticsFailureReason: null,
						lastError: null,
						activeProjectId: null,
						activeProjectRfqNumber: null
					}
				}
			});
			const { writeFile } = await import('@tauri-apps/plugin-fs');
			await writeFile(path, new Uint8Array(result.bytes));
		} catch (error) {
			await errorState.catchError(error, 'Export diagnostic logs');
		}
	}

	/** Delete the local workspace and all workspace-owned project/customer data, then return to setup state. */
	async resetWorkspace(): Promise<void> {
		try {
			await dbService.resetWorkspace();
			await onboardingState.reset(null);
			explorerState.reset();
			await storeService.setActiveProjectId(null);
			projectsState.reset();
			contactsState.reset();
			workspaceState.reset();
			await accountState.hydrate({ includeWorkspaceMember: false });
			await onboardingState.hydrate();
			this.isSettingsDialogOpen = false;
		} catch (error) {
			await errorState.catchError(error, 'Reset Workspace');
		}
	}
}

type AppStateHmrSnapshot = {
	isSidebarOpen: boolean;
	activeSidebarPanel: SidebarPanelId;
	sidebarPagesSearchQuery: string;
	sidebarProjectsSearchQuery: string;
	sidebarExplorerSearchQuery: string;
	hiddenSetupPageIds: OptionalSetupPageId[];
	optionalSetupPageRecordCounts: OptionalSetupPageRecordCounts;
	isWorkspaceRailOpen: boolean;
	isWorkspaceRailMobileOpen: boolean;
	filesView: 'grid' | 'list';
	previewTheme: 'dark' | 'light';
	previewExpanded: boolean;
	themePreference: ThemePreference;
	aiEnabled: boolean;
	hasInternet: boolean;
	isBooting: boolean;
	bootStageTitle: string;
	bootStageDetail: string;
	bootFailureMessage: string | null;
	bootFailureKind: DatabaseInitializationFailureKind | 'unknown' | null;
	isSettingsDialogOpen: boolean;
	settingsDialogRequestedTab: SettingsDialogTab;
	isSetupImportDialogOpen: boolean;
	requestedShellCreateActionId: AppShellCreateActionId | null;
};

function captureAppStateHmrSnapshot(state: AppState): AppStateHmrSnapshot {
	return {
		isSidebarOpen: state.isSidebarOpen,
		activeSidebarPanel: state.activeSidebarPanel,
		sidebarPagesSearchQuery: state.sidebarPagesSearchQuery,
		sidebarProjectsSearchQuery: state.sidebarProjectsSearchQuery,
		sidebarExplorerSearchQuery: state.sidebarExplorerSearchQuery,
		hiddenSetupPageIds: [...state.hiddenSetupPageIds],
		optionalSetupPageRecordCounts: { ...state.optionalSetupPageRecordCounts },
		isWorkspaceRailOpen: state.isWorkspaceRailOpen,
		isWorkspaceRailMobileOpen: state.isWorkspaceRailMobileOpen,
		filesView: state.filesView,
		previewTheme: state.previewTheme,
		previewExpanded: state.previewExpanded,
		themePreference: state.themePreference,
		aiEnabled: state.aiEnabled,
		hasInternet: state.hasInternet,
		isBooting: state.isBooting,
		bootStageTitle: state.bootStageTitle,
		bootStageDetail: state.bootStageDetail,
		bootFailureMessage: state.bootFailureMessage,
		bootFailureKind: state.bootFailureKind,
		isSettingsDialogOpen: state.isSettingsDialogOpen,
		settingsDialogRequestedTab: state.settingsDialogRequestedTab,
		isSetupImportDialogOpen: state.isSetupImportDialogOpen,
		requestedShellCreateActionId: state.requestedShellCreateActionId
	};
}

function restoreAppStateHmrSnapshot(state: AppState, snapshot: AppStateHmrSnapshot): void {
	state.isSidebarOpen = snapshot.isSidebarOpen;
	state.activeSidebarPanel = snapshot.activeSidebarPanel;
	state.sidebarPagesSearchQuery = snapshot.sidebarPagesSearchQuery;
	state.sidebarProjectsSearchQuery = snapshot.sidebarProjectsSearchQuery;
	state.sidebarExplorerSearchQuery = snapshot.sidebarExplorerSearchQuery;
	state.hiddenSetupPageIds = [...snapshot.hiddenSetupPageIds];
	state.optionalSetupPageRecordCounts = { ...snapshot.optionalSetupPageRecordCounts };
	state.isWorkspaceRailOpen = snapshot.isWorkspaceRailOpen;
	state.isWorkspaceRailMobileOpen = snapshot.isWorkspaceRailMobileOpen;
	state.filesView = snapshot.filesView;
	state.previewTheme = snapshot.previewTheme;
	state.previewExpanded = snapshot.previewExpanded;
	state.themePreference = snapshot.themePreference;
	state.aiEnabled = snapshot.aiEnabled;
	state.hasInternet = snapshot.hasInternet;
	state.isBooting = snapshot.isBooting;
	state.bootStageTitle = snapshot.bootStageTitle;
	state.bootStageDetail = snapshot.bootStageDetail;
	state.bootFailureMessage = snapshot.bootFailureMessage;
	state.bootFailureKind = snapshot.bootFailureKind;
	state.isSettingsDialogOpen = snapshot.isSettingsDialogOpen;
	state.settingsDialogRequestedTab = snapshot.settingsDialogRequestedTab;
	state.isSetupImportDialogOpen = snapshot.isSetupImportDialogOpen;
	state.requestedShellCreateActionId = snapshot.requestedShellCreateActionId;
}

export const appState = new AppState();

if (import.meta.hot?.data?.appStateSnapshot) {
	restoreAppStateHmrSnapshot(
		appState,
		import.meta.hot.data.appStateSnapshot as AppStateHmrSnapshot
	);
}

if (import.meta.hot) {
	import.meta.hot.dispose((data) => {
		data.appStateSnapshot = captureAppStateHmrSnapshot(appState);
	});
}
