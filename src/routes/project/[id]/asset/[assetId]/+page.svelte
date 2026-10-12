<script lang="ts">
	import { beforeNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import HydratedAssetEstimateEditor from '$lib/components/assets/hydrated-asset-estimate-editor.svelte';
	import { createLogger } from '$lib/services/logger.js';
	import { aiState } from '$lib/state/ai.svelte.js';
	import { appTabsState } from '$lib/state/app-tabs.svelte.js';
	import { costComponentPresetsState } from '$lib/state/cost-component-presets.svelte.js';
	import { estimateTemplatesState } from '$lib/state/estimate-templates.svelte.js';
	import { getQuoteEngine } from '$lib/state/quote.svelte.js';

	type AppHref =
		| `/project/${string}`
		| `/project/${string}/asset/${string}`
		| `/project/${string}/wbs`
		| `/project/${string}/quote`
		| `/project/${string}/quote/pdf`;

	let { data } = $props();
	const engine = getQuoteEngine();
	const log = createLogger('assetEstimatePage');

	const asset = $derived(data.assets.find((entry) => entry.id === data.assetId) ?? null);
	const costComponentPresets = $derived(
		costComponentPresetsState.list.length > 0
			? costComponentPresetsState.list
			: data.costComponentPresets
	);
	const estimateTemplates = $derived(
		estimateTemplatesState.list.length > 0 ? estimateTemplatesState.list : data.estimateTemplates
	);

	let discardDialogOpen = $state(false);
	let pendingNavUrl = $state('');
	let bypassGuard = false;

	function isBlankEstimateContext(value: ReturnType<typeof engine.getEstimate> | null): boolean {
		if (!value) return false;
		return (
			value.scope_summary.trim().length === 0 &&
			value.notes.trim().length === 0 &&
			value.classification_system_id === null &&
			value.wbs_root_node_id === null &&
			value.applied_template_id === null &&
			value.applied_template_name === null &&
			value.takeoff_items.length === 0
		);
	}

	$effect(() => {
		costComponentPresetsState.replaceFromSnapshot(data.costComponentPresets);
		estimateTemplatesState.replaceFromSnapshot(data.estimateTemplates);
	});

	beforeNavigate((navigation) => {
		if (bypassGuard) {
			bypassGuard = false;
			return;
		}
		if (!asset || !navigation.to?.url) return;
		if (appTabsState.consumeApprovedProjectTabClose(asset.project_id)) return;

		const currentUrl = page.url;
		const nextUrl = navigation.to.url;
		if (nextUrl.pathname === currentUrl.pathname && nextUrl.search === currentUrl.search) return;
		if (aiState.isRunActive(asset.id)) return;

		if (!engine.isDirty(asset.id)) return;

		navigation.cancel();
		pendingNavUrl = `${nextUrl.pathname}${nextUrl.search}`;
		discardDialogOpen = true;
		log.info('Blocked asset estimate navigation because the estimate is dirty', {
			assetId: asset.id,
			nextRoute: pendingNavUrl
		});
	});

	async function discardAndContinue() {
		if (asset) {
			const preAiEstimate = aiState.getEstimateBeforeApply(asset.id);
			if (aiState.hasPendingAppliedEstimate(asset.id) && preAiEstimate) {
				const savedEstimate = engine.getSavedEstimate(asset.id);
				if (savedEstimate && JSON.stringify(savedEstimate) === JSON.stringify(preAiEstimate)) {
					await engine.discardChanges(asset.id);
				} else if (!savedEstimate && isBlankEstimateContext(preAiEstimate)) {
					await engine.discardChanges(asset.id);
				} else {
					engine.replaceEstimate(asset.id, structuredClone(preAiEstimate));
				}
				await aiState.revertAutoAppliedEstimate(asset.id);
			} else {
				await engine.discardChanges(asset.id);
			}
			log.info('Discarded estimate changes and continued navigation', {
				assetId: asset.id,
				nextRoute: pendingNavUrl
			});
		}
		discardDialogOpen = false;
		bypassGuard = true;
		goto(resolve(pendingNavUrl as AppHref));
	}
</script>

{#if asset}
	{#key asset.id}
		<HydratedAssetEstimateEditor
			{asset}
			classificationSystems={data.classificationSystems}
			costCodes={data.costCodes}
			wbsNodes={data.wbsNodes}
			materialCatalogueItems={data.materialCatalogueItems}
			labourRateCards={data.labourRateCards}
			equipmentRateCards={data.equipmentRateCards}
			subcontractRateCards={data.subcontractRateCards}
			{costComponentPresets}
			{estimateTemplates}
		/>
	{/key}
{/if}

<AlertDialog.Root bind:open={discardDialogOpen}>
	<AlertDialog.Content class="ui-dialog-size-lg">
		<AlertDialog.Header>
			<AlertDialog.Title>Discard unsaved estimate changes?</AlertDialog.Title>
			<AlertDialog.Description>
				This asset has unsaved estimate edits. Discard them and continue?
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Action variant="secondary" onclick={discardAndContinue}>
				Discard changes
			</AlertDialog.Action>
			<AlertDialog.Cancel variant="default" autofocus onclick={() => (discardDialogOpen = false)}>
				Cancel
			</AlertDialog.Cancel>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
