<script lang="ts">
	import { page } from '$app/state';
	import { appTabsState } from '$lib/state/app-tabs.svelte.js';
	import { appState } from '$lib/state/app.svelte.js';
	import { QuoteEngineState, setQuoteEngine } from '$lib/state/quote.svelte.js';
	import { projectsState } from '$lib/state/projects.svelte.js';
	import { IsMobile } from '$lib/hooks/is-mobile.svelte.js';
	import WorkspaceContextRail from '$lib/components/workspace-context-rail.svelte';

	// The +layout.ts data
	let { data, children } = $props();
	const isMobileViewport = new IsMobile();

	// 1. Initialize our Encapsulated Engine for this specific RFQ
	const engine = (() => new QuoteEngineState(data.project.id))();
	const pathname = $derived(page.url.pathname);
	const isDetachedPreviewRoute = $derived(
		/^\/project\/[^/]+\/asset\/[^/]+\/preview\/?$/.test(pathname)
	);
	const workspaceIsSynced = $derived(projectsState.workspaceProject?.id === data.project.id);
	const workspaceProject = $derived(
		workspaceIsSynced ? (projectsState.workspaceProject ?? data.project) : data.project
	);
	const workspaceAssets = $derived(workspaceIsSynced ? projectsState.workspaceAssets : data.assets);

	// 2. Keep the route-family workspace snapshot in shared state
	$effect(() => {
		if (isDetachedPreviewRoute) return;
		projectsState.setWorkspaceShell(data);
	});

	// 3. Hydrate the engine with existing assets from SQLite
	$effect(() => {
		if (isDetachedPreviewRoute) return;
		engine.hydrateProjectPreferences(workspaceProject);
		engine.hydrateWorkspaceAssets(workspaceAssets);
		void Promise.all([
			engine.hydrateEstimateStatuses(),
			engine.hydrateQuoteOptions(),
			engine.hydrateQuoteOptionPresets()
		]).then(() => {
			// Full estimate bodies needed for isPdfExportReady checks (sidebar PDF Preview)
			const ids = workingAssets.map((a) => a.id);
			if (ids.length > 0) {
				void engine.hydrateEstimatesForAssets(ids);
			}
		});
	});

	$effect(() => {
		if (isDetachedPreviewRoute) return;
		appTabsState.setProjectDirty(workspaceProject.id, engine.dirtyIds.size > 0);
	});

	// 4. Inject it into the Svelte Component Context tree
	setQuoteEngine(engine);

	// Make sure the global activeId is synced with this route
	$effect(() => {
		if (isDetachedPreviewRoute) return;
		if (projectsState.activeId !== workspaceProject.id) {
			projectsState.setActive(workspaceProject);
		}
	});

	const hasAssets = $derived(workspaceAssets.length > 0);
	const workingAssets = $derived(workspaceAssets.filter((asset) => engine.isSelected(asset.id)));
	const canOpenPdfPreview = $derived(
		hasAssets && workingAssets.some((asset) => engine.isPdfExportReady(asset.id))
	);
	const pdfPreviewBlockerMessage = $derived.by(() => {
		if (!hasAssets) return 'Create an asset in the Estimate workspace to unlock PDF Preview.';
		if (workingAssets.length === 0) return 'Select assets in Quote before opening PDF Preview.';
		// Check for explicit blockers first (AI unresolved, zero rates)
		for (const asset of workingAssets) {
			const blockers = engine.getPdfReadinessBlockers(asset.id);
			if (blockers.length > 0) return blockers[0];
		}
		// If all assets are already PDF-export-ready, no message needed
		if (workingAssets.some((a) => engine.isPdfExportReady(a.id))) return null;
		// Check the first blocked asset for a specific reason
		const blocked = workingAssets.find((a) => !engine.isPdfExportReady(a.id));
		if (!blocked) return null;
		if (!engine.hasSavedQuoteContent(blocked.id)) {
			return 'Save estimate content before opening PDF Preview.';
		}
		if (engine.isDirty(blocked.id)) {
			return 'Save current estimate changes before opening PDF Preview.';
		}
		if (!engine.isPdfIncluded(blocked.id)) {
			return 'Include this asset in Quote before opening PDF Preview.';
		}
		return 'Complete estimate details before opening PDF Preview.';
	});
	const workspaceRailOpen = $derived(
		isMobileViewport.current ? appState.isWorkspaceRailMobileOpen : appState.isWorkspaceRailOpen
	);
</script>

{#if isDetachedPreviewRoute}
	<div class="ui-route-frame ui-workspace-shell flex-col overflow-hidden">
		{@render children()}
	</div>
{:else}
	<div class="ui-workspace-shell flex h-full w-full overflow-hidden">
		<main class="ui-workspace-surface relative min-w-0 flex-1 overflow-hidden">
			{@render children()}
		</main>
		<WorkspaceContextRail
			project={workspaceProject}
			assets={workspaceAssets}
			open={workspaceRailOpen}
			{canOpenPdfPreview}
			{pdfPreviewBlockerMessage}
			getEstimateStatus={(assetId) => engine.getEstimateStatus(assetId)}
			onOpenChange={(open) => {
				if (isMobileViewport.current) {
					appState.setWorkspaceRailMobileOpen(open);
					return;
				}
				void appState.setWorkspaceRailOpen(open);
			}}
		/>
	</div>
{/if}
