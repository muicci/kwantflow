<script lang="ts">
	import { onMount } from 'svelte';
	import AssetEstimateEditor from '$lib/components/assets/asset-estimate-editor.svelte';
	import { Text } from '$lib/components/primitives/index.js';
	import { getQuoteEngine } from '$lib/state/quote.svelte.js';
	import type {
		Asset,
		ClassificationSystem,
		CostCode,
		CostComponentPreset,
		EquipmentRateCard,
		EstimateTemplate,
		LabourRateCard,
		MaterialCatalogueItem,
		SubcontractRateCard,
		WbsNode
	} from '$lib/types/index.js';

	interface Props {
		asset: Asset;
		classificationSystems: ClassificationSystem[];
		costCodes: CostCode[];
		wbsNodes: WbsNode[];
		materialCatalogueItems: MaterialCatalogueItem[];
		labourRateCards: LabourRateCard[];
		equipmentRateCards: EquipmentRateCard[];
		subcontractRateCards: SubcontractRateCard[];
		costComponentPresets: CostComponentPreset[];
		estimateTemplates: EstimateTemplate[];
	}

	let {
		asset,
		classificationSystems,
		costCodes,
		wbsNodes,
		materialCatalogueItems,
		labourRateCards,
		equipmentRateCards,
		subcontractRateCards,
		costComponentPresets,
		estimateTemplates
	}: Props = $props();

	const engine = getQuoteEngine();

	let estimateReady = $state(false);

	onMount(() => {
		let active = true;
		void engine.hydrateEstimate(asset.id).then(() => {
			if (active) {
				estimateReady = true;
			}
		});

		return () => {
			active = false;
		};
	});
</script>

{#if estimateReady}
	<AssetEstimateEditor
		{asset}
		{classificationSystems}
		{costCodes}
		{wbsNodes}
		{materialCatalogueItems}
		{labourRateCards}
		{equipmentRateCards}
		{subcontractRateCards}
		{costComponentPresets}
		{estimateTemplates}
	/>
{:else}
	<div class="ui-pane-empty">
		<Text>Loading estimate…</Text>
	</div>
{/if}
