<script lang="ts">
	import '../app.css';
	import { ModeWatcher } from 'mode-watcher';
	import ProjectRevisionHistoryDialog from '$lib/components/quote/project-revision-history-dialog.svelte';
	import AiTaskCentre from '$lib/components/ai-task-centre.svelte';
	import AskKwantflowSidebar from '$lib/components/ask-kwantflow-sidebar.svelte';
	import AskKwantflowButton from '$lib/components/ask-kwantflow-button.svelte';
	import { Toaster } from '$lib/components/ui/sonner/index.js';
	import AppSidebar from '$lib/components/app-sidebar.svelte';
	import AppShellTabStrip from '$lib/components/app-shell-tab-strip.svelte';
	import ClassificationSystemDialog from '$lib/components/classification-systems/classification-system-dialog.svelte';
	import ContactDialog from '$lib/components/contacts/contact-dialog.svelte';
	import EquipmentRateDialog from '$lib/components/equipment-rates/equipment-rate-dialog.svelte';
	import IntakeDialog from '$lib/components/intake/intake-dialog.svelte';
	import LabourRateDialog from '$lib/components/labour-rates/labour-rate-dialog.svelte';
	import MaterialDialog from '$lib/components/materials/material-dialog.svelte';
	import SubcontractRateDialog from '$lib/components/subcontract-rates/subcontract-rate-dialog.svelte';
	import OnboardingWorkspace from '$lib/components/onboarding/onboarding-workspace.svelte';
	import SettingsDialog from '$lib/components/user/settings-dialog.svelte';
	import BackupRestoreDialog from '$lib/components/user/backup-restore-dialog.svelte';
	import SetupImportDialog from '$lib/components/user/setup-import-dialog.svelte';
	import TooltipIconButton from '$lib/components/tooltip-icon-button.svelte';
	import WorkspaceRailToggle from '$lib/components/workspace-rail-toggle.svelte';
	import { Meta, Text } from '$lib/components/primitives/index.js';
	import * as Breadcrumb from '$lib/components/ui/breadcrumb/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as ScrollArea from '$lib/components/ui/scroll-area/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import { afterNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { appState } from '$lib/state/app.svelte.js';
	import {
		appTabsState,
		buildTabDestination,
		type AppShellCreateActionId
	} from '$lib/state/app-tabs.svelte.js';
	import { accountState } from '$lib/state/account.svelte.js';
	import { backupState } from '$lib/state/backup.svelte.js';
	import {
		assetPreviewState,
		resolveDetachedAssetPreviewTarget
	} from '$lib/state/asset-preview.svelte.js';
	import { classificationSystemsState } from '$lib/state/classification-systems.svelte.js';
	import { costComponentPresetsState } from '$lib/state/cost-component-presets.svelte.js';
	import { contactsState } from '$lib/state/contacts.svelte.js';
	import { equipmentRatesState } from '$lib/state/equipment-rates.svelte.js';
	import { estimateTemplatesState } from '$lib/state/estimate-templates.svelte.js';
	import { labourRatesState } from '$lib/state/labour-rates.svelte.js';
	import { materialsState } from '$lib/state/materials.svelte.js';
	import { subcontractRatesState } from '$lib/state/subcontract-rates.svelte.js';
	import { onboardingState } from '$lib/state/onboarding.svelte.js';
	import { projectRevisionHistoryState } from '$lib/state/project-revision-history.svelte.js';
	import { projectsState } from '$lib/state/projects.svelte.js';
	import { workspaceState } from '$lib/state/workspace.svelte.js';
	import {
		DETACHED_ASSET_PREVIEW_WINDOW_LABEL,
		ASSET_PREVIEW_CLOSED_EVENT,
		ASSET_PREVIEW_REQUEST_SYNC_EVENT,
		ASSET_PREVIEW_SELECTION_CHANGED_EVENT
	} from '$lib/services/detached-asset-preview-window.js';
	import { detachedAssetPreviewWindowService } from '$lib/services/detached-asset-preview-window.js';
	import { createLogger, installBenignBrowserWarningFilter } from '$lib/services/logger.js';
	import { isMacOsDesktopRuntime, isTauri } from '$lib/utils/env.js';
	import { formatDate } from '$lib/utils/format.js';
	import {
		getProjectCompanyDisplayName,
		getProjectRequesterDisplayName
	} from '$lib/utils/project-contact.js';
	import { shouldRedirectProtectedRoute } from '$lib/utils/onboarding-route-guard.js';
	import { resolveRecoverableProjectRoute } from '$lib/utils/project-route-recovery.js';
	import type { AppShellHref } from '$lib/utils/app-shell-href.js';
	import { getAppShellTitle, isRfqHomeRoute, normaliseAppPathname } from '$lib/utils/route-path.js';
	import { onMount, untrack } from 'svelte';
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
	import HistoryIcon from '@lucide/svelte/icons/history';
	import StarIcon from '@lucide/svelte/icons/star';

	const { children } = $props();
	type NativeAppMenuAction = 'open-settings' | 'open-help' | 'show-main-window';
	let isShellIntakeDialogOpen = $state(false);
	let shellIntakeProject = $state<(typeof projectsState.list)[number] | null>(null);
	let isShellContactDialogOpen = $state(false);
	let isShellMaterialDialogOpen = $state(false);
	let isShellLabourRateDialogOpen = $state(false);
	let isShellEquipmentRateDialogOpen = $state(false);
	let isShellSubcontractRateDialogOpen = $state(false);
	let isShellClassificationSystemDialogOpen = $state(false);
	let isShellProjectDeleteDialogOpen = $state(false);
	let shellProjectPendingDelete = $state<(typeof projectsState.list)[number] | null>(null);
	let showBootStatus = $state(false);
	let redirectingToOnboarding = $state(false);
	let restoringTabs = $state(false);
	let currentWindowLabel = $state('main');
	const isDetachedPreviewWindow = $derived(
		currentWindowLabel === DETACHED_ASSET_PREVIEW_WINDOW_LABEL
	);
	const detachedPreviewRouteId = '/preview/asset/[projectId]/[assetId]';
	const detachedPreviewPathnamePattern = /^\/preview\/asset\/[^/]+\/[^/]+\/?$/;
	const shellLog = createLogger('appShell');
	const isLocalShellBlocked = $derived(
		appState.isBooting ||
			Boolean(appState.bootFailureMessage) ||
			backupState.isRestoreRecoveryBlocked
	);

	async function recoverStaleProjectRouteIfNeeded(): Promise<void> {
		if (isLocalShellBlocked) return;
		const recoveryTarget = resolveRecoverableProjectRoute(page.url.pathname, page.status);
		if (!recoveryTarget) return;

		try {
			if (recoveryTarget.detachedPreview) {
				await projectsState.loadDetachedPreviewShell(recoveryTarget.projectId);
			} else {
				await projectsState.loadWorkspaceShell(recoveryTarget.projectId);
			}

			shellLog.info('Recovering stale 404 project route after boot.', {
				pathname: page.url.pathname,
				projectId: recoveryTarget.projectId,
				detachedPreview: recoveryTarget.detachedPreview
			});

			await goto(resolve(`${page.url.pathname}${page.url.search}` as AppShellHref), {
				replaceState: true,
				invalidateAll: true,
				noScroll: true,
				keepFocus: true
			});
		} catch (error) {
			shellLog.warn(
				'Project route no longer exists in the active workspace; returning to the RFQ list.',
				{
					pathname: page.url.pathname,
					projectId: recoveryTarget.projectId,
					error
				}
			);
			await goto(resolve('/'), {
				replaceState: true,
				invalidateAll: true,
				noScroll: true,
				keepFocus: true
			});
		}
	}

	function requestNewRfq(): void {
		shellIntakeProject = null;
		isShellIntakeDialogOpen = true;
	}

	function requestEditProject(projectId: string): void {
		const project = projectsState.list.find((candidate) => candidate.id === projectId) ?? null;
		shellIntakeProject = project;
		isShellIntakeDialogOpen = true;
	}

	function requestDeleteProject(projectId: string): void {
		const project = projectsState.list.find((candidate) => candidate.id === projectId) ?? null;
		if (!project) return;
		shellProjectPendingDelete = project;
		isShellProjectDeleteDialogOpen = true;
	}

	function requestQuickCreate(actionId: AppShellCreateActionId): void {
		if (isLocalShellBlocked) return;
		switch (actionId) {
			case 'rfq':
				shellIntakeProject = null;
				isShellIntakeDialogOpen = true;
				return;
			case 'company':
				isShellContactDialogOpen = true;
				return;
			case 'material':
				isShellMaterialDialogOpen = true;
				return;
			case 'labour-rate':
				isShellLabourRateDialogOpen = true;
				return;
			case 'equipment-rate':
				isShellEquipmentRateDialogOpen = true;
				return;
			case 'subcontract-rate':
				isShellSubcontractRateDialogOpen = true;
				return;
			case 'classification-system':
				isShellClassificationSystemDialogOpen = true;
				return;
		}
	}

	$effect(() => {
		if (isDetachedPreviewSurface || isLocalShellBlocked) return;
		const requestedActionId = appState.consumeRequestedShellCreateActionId();
		if (!requestedActionId) return;
		requestQuickCreate(requestedActionId);
	});

	onMount(() => {
		if (typeof window !== 'undefined') {
			(window as unknown as Record<string, unknown>).appState = appState;
		}

		// Fade out and remove the early HTML boot splash screen when Svelte loads
		const earlySplash = document.getElementById('early-boot-splash');
		if (earlySplash) {
			earlySplash.style.opacity = '0';
			setTimeout(() => {
				earlySplash.remove();
			}, 250);
		}

		const detachBenignWarningFilter = installBenignBrowserWarningFilter();
		const cleanupHandlers: Array<() => void> = [];
		if (!isTauri()) {
			void appState.ensureBooted().then(() => recoverStaleProjectRouteIfNeeded());
			return () => {
				detachBenignWarningFilter();
				cleanupHandlers.forEach((cleanup) => cleanup());
			};
		}

		document.documentElement.classList.add('vibrant-window');

		const handleMainWindowFocus = async () => {
			if (!assetPreviewState.isDetachedActive()) return;
			const previewWindowStillOpen = await detachedAssetPreviewWindowService.isOpen();
			if (previewWindowStillOpen) return;
			shellLog.info('Finalising stale detached preview session after main window focus.');
			assetPreviewState.finalizeDetachedSession();
		};
		window.addEventListener('focus', handleMainWindowFocus);

		void Promise.all([import('@tauri-apps/api/event'), import('@tauri-apps/api/window')]).then(
			([eventApi, windowApi]) => {
				currentWindowLabel = windowApi.getCurrentWindow().label;
				if (currentWindowLabel === DETACHED_ASSET_PREVIEW_WINDOW_LABEL) {
					return;
				}

				if (currentWindowLabel === 'main') {
					const win = windowApi.getCurrentWindow();
					void win
						.unminimize()
						.then(() => win.show())
						.then(() => win.setFocus());
				}

				void appState.ensureBooted().then(() => recoverStaleProjectRouteIfNeeded());

				void eventApi
					.listen<NativeAppMenuAction>('native-app-menu-action', (event) => {
						switch (event.payload) {
							case 'open-settings':
								if (
									isLocalShellBlocked ||
									appState.isLocalDocumentationOpen ||
									backupState.pendingRestoreInspection
								)
									break;
								appState.openSettingsDialog('workspace');
								break;
							case 'open-help':
								void appState.openLocalDocumentation('help');
								break;
						}
					})
					.then((cleanup) => {
						cleanupHandlers.push(cleanup);
					});

				const currentWindow = windowApi.getCurrentWindow();
				void Promise.all([
					currentWindow.listen<{ assetId?: string }>(ASSET_PREVIEW_REQUEST_SYNC_EVENT, (event) => {
						shellLog.info('Received detached preview sync request.', {
							payload: event.payload,
							detachedSession: assetPreviewState.detachedSession
						});
						if (!assetPreviewState.isDetachedActive()) return;
						if (
							event.payload?.assetId &&
							event.payload.assetId !== assetPreviewState.detachedSession?.assetId
						)
							return;
						void assetPreviewState.syncDetached(event.payload?.assetId);
					}),
					currentWindow.listen<{
						assetId: string;
						activeFileId: string | null;
						targetPdfPage: number | null;
						targetCadViewLabel: string | null;
					}>(ASSET_PREVIEW_SELECTION_CHANGED_EVENT, (event) => {
						shellLog.info('Received detached preview selection change.', event.payload);
						void assetPreviewState.setSelection(
							event.payload.assetId,
							{
								activeFileId: event.payload.activeFileId,
								targetPdfPage: event.payload.targetPdfPage,
								targetCadViewLabel: event.payload.targetCadViewLabel
							},
							{ syncDetached: false }
						);
					}),
					currentWindow.listen<{ assetId?: string }>(ASSET_PREVIEW_CLOSED_EVENT, () => {
						shellLog.info('Received detached preview closed event.');
						assetPreviewState.finalizeDetachedSession();
						void currentWindow
							.unminimize()
							.then(() => currentWindow.show())
							.then(() => currentWindow.setFocus())
							.catch((error) =>
								shellLog.warn('Failed to refocus main window on preview close.', error)
							);
					})
				]).then((unlisteners) => {
					cleanupHandlers.push(() => {
						for (const unlisten of unlisteners) {
							unlisten();
						}
					});
				});
			}
		);

		const handleBeforeUnload = () => {
			if (isTauri()) {
				// Synchronously notify the backend to unload the GPU/Metal engine before webview reload.
				const { invoke } = window.__TAURI_INTERNALS__ || {};
				if (typeof invoke === 'function') {
					void invoke('unload_local_ai_runtime');
				}
			}
		};
		window.addEventListener('beforeunload', handleBeforeUnload);

		return () => {
			detachBenignWarningFilter();
			window.removeEventListener('focus', handleMainWindowFocus);
			window.removeEventListener('beforeunload', handleBeforeUnload);
			cleanupHandlers.forEach((cleanup) => cleanup());
		};
	});

	$effect(() => {
		if (appState.bootFailureMessage) {
			showBootStatus = true;
			return;
		}
		if (!appState.isBooting) {
			showBootStatus = false;
			return;
		}

		showBootStatus = false;
		const timer = window.setTimeout(() => {
			showBootStatus = true;
		}, 450);

		return () => {
			window.clearTimeout(timer);
		};
	});

	// ── Route key for {#key} — groups project sub-routes under one key ──
	// `/project/abc/asset/xyz` → `/project/abc` (no destruction on intra-project nav)
	// `/` → `/` (home ↔ project transition still fades)
	const pathname = $derived(normaliseAppPathname(page.url.pathname));
	const emailTitle = $derived(
		page.url.pathname.startsWith('/preview/email/')
			? (page.url.searchParams.get('title') ?? null)
			: null
	);
	const routeId = $derived(page.route.id ?? '');
	const isDetachedPreviewRoute = $derived(routeId === detachedPreviewRouteId);
	const isDetachedPreviewPath = $derived(detachedPreviewPathnamePattern.test(pathname));
	const isDetachedPreviewSurface = $derived(
		isDetachedPreviewWindow || isDetachedPreviewRoute || isDetachedPreviewPath
	);
	const isWorkspaceRoute = $derived(pathname.startsWith('/project/'));
	const useNativeMacShell = $derived(isTauri() && isMacOsDesktopRuntime());
	const activeDetachedPreviewTarget = $derived(
		resolveDetachedAssetPreviewTarget(routeId, page.data)
	);

	$effect(() => {
		if (isDetachedPreviewSurface || isLocalShellBlocked) return;
		const target = activeDetachedPreviewTarget;
		if (!assetPreviewState.isDetachedActive() || !target) return;
		shellLog.info('Following detached preview target from shell.', {
			target,
			pathname,
			routeId
		});
		void assetPreviewState.followAsset(target);
	});

	$effect(() => {
		if (isDetachedPreviewSurface || isLocalShellBlocked) return;
		if (isRfqHomeRoute(pathname, routeId) && projectsState.searchQuery !== '') {
			projectsState.searchQuery = '';
		}
		if (pathname === '/companies' && contactsState.searchQuery !== '') {
			contactsState.searchQuery = '';
		}
		if (pathname === '/materials' && materialsState.searchQuery !== '') {
			materialsState.searchQuery = '';
		}
		if (pathname === '/labour-rates' && labourRatesState.searchQuery !== '') {
			labourRatesState.searchQuery = '';
		}
		if (pathname === '/equipment-rates' && equipmentRatesState.searchQuery !== '') {
			equipmentRatesState.searchQuery = '';
		}
		if (pathname === '/subcontract-rates' && subcontractRatesState.searchQuery !== '') {
			subcontractRatesState.searchQuery = '';
		}
		if (pathname === '/cost-presets' && costComponentPresetsState.searchQuery !== '') {
			costComponentPresetsState.searchQuery = '';
		}
		if (pathname === '/estimate-templates' && estimateTemplatesState.searchQuery !== '') {
			estimateTemplatesState.searchQuery = '';
		}
		if (
			pathname.startsWith('/classification-systems') &&
			classificationSystemsState.searchQuery !== ''
		) {
			classificationSystemsState.searchQuery = '';
		}
	});

	$effect(() => {
		if (isDetachedPreviewSurface || isLocalShellBlocked) return;
		if (!shouldRedirectProtectedRoute(pathname, onboardingState.isAccessReady)) {
			redirectingToOnboarding = false;
			return;
		}
		if (redirectingToOnboarding) return;
		redirectingToOnboarding = true;
		void goto(resolve('/'), { replaceState: true }).finally(() => {
			redirectingToOnboarding = false;
		});
	});

	afterNavigate(() => {
		if (isDetachedPreviewSurface || isLocalShellBlocked) return;
		if (typeof window !== 'undefined' && isTauri()) {
			import('@tauri-apps/api/window')
				.then(({ getCurrentWindow }) => {
					void getCurrentWindow()
						.setFocus()
						.catch(() => {});
				})
				.catch(() => {});
		}
	});

	// ── Workspace sidebar management ────────────────────────────────
	// Lives here (root layout) so sidebar state survives intra-project navigation.
	let savedSidebarOpen: boolean | null = null;

	$effect(() => {
		if (isDetachedPreviewSurface || isLocalShellBlocked) return;
		const isWorkspace = isWorkspaceRoute;
		untrack(() => {
			if (isWorkspace && savedSidebarOpen === null) {
				// Entering workspace — save current state and collapse
				savedSidebarOpen = appState.takePendingWorkspaceSidebarOpen() ?? appState.isSidebarOpen;
				appState.isSidebarOpen = false;
				appState.isWorkspaceRailMobileOpen = false;
			} else if (!isWorkspace && savedSidebarOpen !== null) {
				// Leaving workspace — restore saved state
				appState.isSidebarOpen = savedSidebarOpen;
				savedSidebarOpen = null;
			}
		});
	});

	const headerProject = $derived(projectsState.workspaceProject ?? projectsState.active);
	const previewFileName = $derived(
		(page.data as { previewFile?: { file?: { original_name?: string | null } } }).previewFile?.file
			?.original_name ?? null
	);
	const shellUser = $derived({
		name: workspaceState.displayName || workspaceState.businessName || 'Workspace',
		email: accountState.accountEmail,
		avatar: accountState.avatarUrl
	});
	const shellTitle = $derived(
		getAppShellTitle(pathname, routeId, headerProject?.rfq_number ?? null, previewFileName)
	);

	$effect(() => {
		if (isDetachedPreviewSurface || isLocalShellBlocked) return;
		if (isLocalShellBlocked || onboardingState.shouldGateApp || !useNativeMacShell || restoringTabs)
			return;

		const destination =
			isWorkspaceRoute && !headerProject?.id
				? null
				: buildTabDestination({
						pathname,
						routeId,
						projectId: headerProject?.id ?? null,
						projectNumber: headerProject?.rfq_number ?? null,
						fileName: previewFileName,
						emailTitle
					});

		// Route state is the effect input. Tab hydration and synchronisation mutate
		// a separate reactive class, so keep those reads and writes untracked to
		// prevent the shell from subscribing to its own updates.
		void untrack(() =>
			(async () => {
				if (!appTabsState.isHydrated) {
					const restoreRoute = await appTabsState.hydrate(destination, pathname);
					if (restoreRoute) {
						restoringTabs = true;
						try {
							await goto(resolve(restoreRoute as AppShellHref), { replaceState: true });
						} finally {
							restoringTabs = false;
						}
						return;
					}
				}

				if (!destination) return;

				appTabsState.openOrFocus(destination);
				appTabsState.syncActiveRoute(pathname);

				if (appTabsState.pendingCloseTabId && appTabsState.pendingCloseTabId !== destination.id) {
					appTabsState.finalisePendingClose();
				}
			})()
		);
	});

	$effect(() => {
		if (isDetachedPreviewSurface || isLocalShellBlocked) return;
		if (isLocalShellBlocked || onboardingState.shouldGateApp || !useNativeMacShell || restoringTabs)
			return;

		const nextRoute = appTabsState.consumePendingNavigationRoute();
		if (!nextRoute || nextRoute === pathname) return;

		void goto(resolve(nextRoute), { replaceState: true });
	});

	$effect(() => {
		if (isDetachedPreviewSurface || isLocalShellBlocked) return;
		if (
			!appTabsState.isHydrated ||
			isLocalShellBlocked ||
			onboardingState.shouldGateApp ||
			!useNativeMacShell
		)
			return;

		const snapshot = appTabsState.toSnapshot();
		void appTabsState.persist(snapshot);
	});

	if (typeof document !== 'undefined') {
		document.oncontextmenu = () => false;
	}
</script>

<ModeWatcher track={false} />
<Toaster />

{#if backupState.isRestoreRecoveryBlocked}
	<div class="ui-boot-shell items-center justify-center">
		<div class="flex w-full max-w-sm flex-col gap-4 text-center">
			<p class="eyebrow status-text-destructive">Backup recovery paused</p>
			<p class="large">Restart Kwantflow before editing data.</p>
			<Meta>Quit Kwantflow completely, then reopen it to finish recovery safely.</Meta>
		</div>
	</div>
{:else if isDetachedPreviewSurface && !appState.bootFailureMessage}
	<Tooltip.Provider delayDuration={500}>
		<div class="ui-detached-shell">
			<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
				{@render children()}
			</div>
		</div>
	</Tooltip.Provider>
{:else if appState.isBooting || appState.bootFailureMessage}
	<div class="ui-boot-shell items-center justify-center">
		<div class="flex w-full max-w-xs flex-col items-center gap-5 text-center">
			<div class="ui-boot-logo-container">
				<div class="ui-boot-logo-shimmer block size-16" aria-label="Kwantflow"></div>
			</div>
			{#if showBootStatus || appState.bootFailureMessage}
				<div class="flex w-full flex-col items-center gap-3">
					<div class="flex flex-col gap-1 text-center">
						<p class="eyebrow">Opening Kwantflow</p>
						<p class="large">Loading your local workspace…</p>
						<Meta>{appState.bootStageTitle}: {appState.bootStageDetail}</Meta>
					</div>
					{#if appState.bootFailureMessage}
						<div class="status-panel status-panel-destructive ui-radius-lg w-full text-left">
							<p class="eyebrow status-text-destructive">Startup paused</p>
							<p class="muted mt-1">{appState.bootFailureMessage}</p>
						</div>
						<Button
							variant="secondary"
							size="sm"
							class="gap-2"
							onclick={() => {
								void appState.retryBoot();
							}}
						>
							Try again
						</Button>
						<Button
							variant="secondary"
							size="sm"
							onclick={() => void backupState.promptImportArchive()}
							disabled={backupState.isBusy}
							loading={backupState.isInspectingArchive}
						>
							Import backup
						</Button>
					{/if}
				</div>
			{/if}
		</div>
	</div>
{:else if onboardingState.shouldGateApp}
	<OnboardingWorkspace />
{:else}
	<SettingsDialog bind:open={appState.isSettingsDialogOpen} />
	<SetupImportDialog bind:open={appState.isSetupImportDialogOpen} />
	<IntakeDialog bind:open={isShellIntakeDialogOpen} project={shellIntakeProject} hideTrigger />
	<ContactDialog bind:open={isShellContactDialogOpen} hideTrigger />
	<MaterialDialog bind:open={isShellMaterialDialogOpen} hideTrigger />
	<LabourRateDialog bind:open={isShellLabourRateDialogOpen} hideTrigger />
	<EquipmentRateDialog bind:open={isShellEquipmentRateDialogOpen} hideTrigger />
	<SubcontractRateDialog bind:open={isShellSubcontractRateDialogOpen} hideTrigger />
	<ClassificationSystemDialog bind:open={isShellClassificationSystemDialogOpen} hideTrigger />
	<AlertDialog.Root bind:open={isShellProjectDeleteDialogOpen}>
		<AlertDialog.Content>
			<AlertDialog.Header>
				<AlertDialog.Title>Delete RFQ?</AlertDialog.Title>
				<AlertDialog.Description>
					{#if shellProjectPendingDelete}
						This action cannot be undone. This will permanently delete <strong
							>{shellProjectPendingDelete.rfq_number}</strong
						> and remove all associated data.
					{/if}
				</AlertDialog.Description>
			</AlertDialog.Header>
			<AlertDialog.Footer>
				<AlertDialog.Cancel
					onclick={() => {
						isShellProjectDeleteDialogOpen = false;
						shellProjectPendingDelete = null;
					}}
				>
					Cancel
				</AlertDialog.Cancel>
				<AlertDialog.Action
					variant="destructive"
					onclick={() => {
						if (shellProjectPendingDelete) {
							void projectsState.deleteProject(shellProjectPendingDelete.id);
						}
						isShellProjectDeleteDialogOpen = false;
						shellProjectPendingDelete = null;
					}}
				>
					Delete RFQ
				</AlertDialog.Action>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	</AlertDialog.Root>
	<ProjectRevisionHistoryDialog
		bind:open={projectRevisionHistoryState.open}
		revisions={projectRevisionHistoryState.revisions}
		isHydrated={projectRevisionHistoryState.isHydrated}
	/>
	<Sidebar.Provider
		bind:open={appState.isSidebarOpen}
		onOpenChange={(open) => {
			void appState.persistSidebarOpen(open);
		}}
		class={useNativeMacShell ? 'flex-col' : undefined}
	>
		{#if useNativeMacShell}
			<AppShellTabStrip project={headerProject} user={shellUser} {pathname} />
		{/if}
		<div class="flex min-h-0 flex-1">
			<AppSidebar
				useNativeShellHeader={useNativeMacShell}
				onRequestNewRfq={requestNewRfq}
				onRequestQuickCreate={requestQuickCreate}
				onRequestEditProject={requestEditProject}
				onRequestDeleteProject={requestDeleteProject}
			/>
			<Sidebar.Inset>
				{#if !useNativeMacShell}
					<header
						class="ui-shell-header-bar group-has-data-[collapsible=icon]/sidebar-wrapper:h-12"
					>
						<div class="flex min-w-0 items-center gap-2" data-tauri-drag-region>
							<Breadcrumb.Root>
								<Breadcrumb.List>
									{#if pathname.startsWith('/project/')}
										<Breadcrumb.Item>
											<Breadcrumb.Link href="/">RFQs</Breadcrumb.Link>
										</Breadcrumb.Item>
										<Breadcrumb.Separator />
									{/if}
									<Breadcrumb.Item>
										<Breadcrumb.Page>{shellTitle}</Breadcrumb.Page>
									</Breadcrumb.Item>
									{#if pathname.startsWith('/project/') && headerProject}
										<Breadcrumb.Separator />
										<Breadcrumb.Item>
											<Breadcrumb.Page>
												<Text as="span" class="shell-label ui-shell-chip">
													{getProjectCompanyDisplayName(headerProject) || 'No Company'}
												</Text>
											</Breadcrumb.Page>
										</Breadcrumb.Item>
										{#if getProjectRequesterDisplayName(headerProject)}
											<Breadcrumb.Separator />
											<Breadcrumb.Item>
												<Breadcrumb.Page>
													<Text as="span" tone="muted" class="truncate">
														{getProjectRequesterDisplayName(headerProject)}
													</Text>
												</Breadcrumb.Page>
											</Breadcrumb.Item>
										{/if}
									{/if}
								</Breadcrumb.List>
							</Breadcrumb.Root>
						</div>
						{#if pathname.startsWith('/project/') && headerProject}
							<div class="flex shrink-0 items-center gap-2">
								<AiTaskCentre />
								<AskKwantflowButton />
								<Meta>
									{headerProject.submission_deadline_at || headerProject.due_date
										? formatDate(
												headerProject.submission_deadline_at || headerProject.due_date || ''
											)
										: 'No submission deadline'}
								</Meta>
								<TooltipIconButton
									tooltip={headerProject.is_favourite
										? 'Remove from favourites'
										: 'Add to favourites'}
									variant="ghost"
									size="icon"
									class="size-8"
									onclick={() => void projectsState.toggleFavourite(headerProject.id)}
								>
									<StarIcon
										class={`size-4 ${headerProject.is_favourite ? 'fill-current text-primary' : ''}`}
									/>
								</TooltipIconButton>
								<DropdownMenu.Root>
									<DropdownMenu.Trigger>
										{#snippet child({ props })}
											<Button variant="ghost" size="icon" class="size-8" {...props}>
												<EllipsisIcon class="size-4" />
												<span class="sr-only">Project actions</span>
											</Button>
										{/snippet}
									</DropdownMenu.Trigger>
									<DropdownMenu.Content class="ui-radius-lg w-48" align="end">
										<DropdownMenu.Item
											onclick={() => {
												void projectRevisionHistoryState.openForProject(headerProject.id);
											}}
										>
											<HistoryIcon class="muted size-4" />
											<span>Revision History</span>
										</DropdownMenu.Item>
									</DropdownMenu.Content>
								</DropdownMenu.Root>
								<WorkspaceRailToggle sizeClass="size-8" iconClass="size-4" />
							</div>
						{:else}
							<div class="flex shrink-0 items-center gap-2">
								<AiTaskCentre />
								<AskKwantflowButton />
							</div>
						{/if}
					</header>
				{/if}
				<div class="flex min-h-0 flex-1 flex-col">
					<div class="flex h-full min-h-0 flex-1 flex-col" data-viewport-screenshot>
						{@render children()}
					</div>
				</div>
			</Sidebar.Inset>
			{#if !isDetachedPreviewWindow}
				<AskKwantflowSidebar />
			{/if}
		</div>
	</Sidebar.Provider>
{/if}

<BackupRestoreDialog />
{#if appState.isLocalDocumentationOpen}
	<Dialog.Root bind:open={appState.isLocalDocumentationOpen}>
		<Dialog.StandardFrame
			title={appState.localDocumentationTitle}
			description="Bundled documentation available offline."
			size="lg"
			class="ui-dialog-frame-size-lg"
			bodyClass="ui-dialog-workbench-body flex min-h-0 flex-1"
			trapFocus={true}
			onEscapeKeydown={() => (appState.isLocalDocumentationOpen = false)}
		>
			<ScrollArea.Root
				class="min-h-0 flex-1"
				orientation="vertical"
				viewportProps={{
					tabindex: 0,
					role: 'region',
					'aria-label': appState.localDocumentationTitle
				}}
			>
				<pre
					class="field-copy py-4 font-sans leading-relaxed wrap-break-word whitespace-pre-wrap">{appState.localDocumentationText}</pre>
			</ScrollArea.Root>
			{#snippet footer()}
				<Button variant="secondary" onclick={() => (appState.isLocalDocumentationOpen = false)}>
					Close
				</Button>
			{/snippet}
		</Dialog.StandardFrame>
	</Dialog.Root>
{/if}

<style>
	.ui-boot-logo-container {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.ui-boot-logo-shimmer {
		filter: none !important;
		background: linear-gradient(
			135deg,
			#7a8583 0%,
			#a3afae 25%,
			#ffffff 45%,
			#ffffff 55%,
			#a3afae 75%,
			#7a8583 100%
		);
		background-size: 250% 100%;
		-webkit-mask: url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAyNCIgaGVpZ2h0PSIxMDI0IiB2aWV3Qm94PSIwIDAgMTAyNCAxMDI0IiBmaWxsPSJub25lIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgo8ZyB0cmFuc2Zvcm09InRyYW5zbGF0ZSgxMDIsIDEwMikgc2NhbGUoMC44MDgpIj4KPHBhdGggZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiIGQ9Ik0yNTQuMDQ0IDc2MS45MjlINzYxLjkyMVYyNTMuOTg0SDQwMS42NzVDMzU1LjU1IDI0OS4wMDcgMzEzLjU1OSAyMjUuMjQzIDI4NS40NDkgMTg4LjM3MUMyNjkuNjA3IDE2Ny41NTEgMjU4Ljk1MyAxNDMuNTc3IDI1My45NzYgMTE4LjQ4MVYwLjA4MkgwLjBWMjU0LjA1NEgxMDUuMjkxQzE1MS40MTYgMjU5LjAzMiAxOTMuNDA3IDI4Mi43OTUgMjIxLjUxNiAzMTkuNjY4QzIzOC41NTEgMzQyLjAzIDI0OS41NiAzNjcuODk3IDI1My45NzYgMzk1LjA5NVY3NjIuMDY5Vjc2MS44NTlMMjU0LjA0NCA3NjEuOTI5WiIgZmlsbD0iY3VycmVudENvbG9yIi8+CjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgY2xpcC1ydWxlPSJldmVub2RkIiBkPSJNMC4wODIgMTAxNS44NUgyNTQuMDU0Vjc2MS45NDdIMC4wODJWMTAxNS44NVoiIGZpbGw9ImN1cnJlbnRDb2xvciIvPgo8cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGNsaXAtcnVsZT0iZXZlbm9kZCIgZD0iTTc2MS45NDIgMTAxNS44NUgxMDE1Ljg0MlY3NjEuOTQ3SDc2MS45NDJWMTAxNS44NVoiIGZpbGw9ImN1cnJlbnRDb2xvciIvPgo8cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGNsaXAtcnVsZT0iZXZlbm9kZCIgZD0iTTc2MS45NDIgMjUzLjkwMkgxMDE1Ljg0MlYwLjBINzYxLjk0MlYyNTMuOTAyWiIgZmlsbD0iY3VycmVudENvbG9yIi8+CjwvZz4KPC9zdmc+')
			no-repeat center / contain;
		mask: url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAyNCIgaGVpZ2h0PSIxMDI0IiB2aWV3Qm94PSIwIDAgMTAyNCAxMDI0IiBmaWxsPSJub25lIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgo8ZyB0cmFuc2Zvcm09InRyYW5zbGF0ZSgxMDIsIDEwMikgc2NhbGUoMC44MDgpIj4KPHBhdGggZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiIGQ9Ik0yNTQuMDQ0IDc2MS45MjlINzYxLjkyMVYyNTMuOTg0SDQwMS42NzVDMzU1LjU1IDI0OS4wMDcgMzEzLjU1OSAyMjUuMjQzIDI4NS40NDkgMTg4LjM3MUMyNjkuNjA3IDE2Ny41NTEgMjU4Ljk1MyAxNDMuNTc3IDI1My45NzYgMTE4LjQ4MVYwLjA4MkgwLjBWMjU0LjA1NEgxMDUuMjkxQzE1MS40MTYgMjU5LjAzMiAxOTMuNDA3IDI4Mi43OTUgMjIxLjUxNiAzMTkuNjY4QzIzOC41NTEgMzQyLjAzIDI0OS41NiAzNjcuODk3IDI1My45NzYgMzk1LjA5NVY3NjIuMDY5Vjc2MS44NTlMMjU0LjA0NCA3NjEuOTI5WiIgZmlsbD0iY3VycmVudENvbG9yIi8+CjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgY2xpcC1ydWxlPSJldmVub2RkIiBkPSJNMC4wODIgMTAxNS44NUgyNTQuMDU0Vjc2MS45NDdIMC4wODJWMTAxNS44NVoiIGZpbGw9ImN1cnJlbnRDb2xvciIvPgo8cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGNsaXAtcnVsZT0iZXZlbm9kZCIgZD0iTTc2MS45NDIgMTAxNS44NUgxMDE1Ljg0MlY3NjEuOTQ3SDc2MS45NDJWMTAxNS44NVoiIGZpbGw9ImN1cnJlbnRDb2xvciIvPgo8cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGNsaXAtcnVsZT0iZXZlbm9kZCIgZD0iTTc2MS45NDIgMjUzLjkwMkgxMDE1Ljg0MlYwLjBINzYxLjk0MlYyNTMuOTAyWiIgZmlsbD0iY3VycmVudENvbG9yIi8+CjwvZz4KPC9zdmc+')
			no-repeat center / contain;
		animation: ui-silver-shimmer 3.6s infinite cubic-bezier(0.4, 0, 0.2, 1);
	}

	@keyframes ui-silver-shimmer {
		0% {
			background-position: 180% 0;
		}
		100% {
			background-position: -80% 0;
		}
	}
</style>
