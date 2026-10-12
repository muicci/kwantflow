<script lang="ts">
	import CostComponentPresetsTable from '$lib/components/cost-component-presets/cost-component-presets-table.svelte';
	import { costComponentPresetsState } from '$lib/state/cost-component-presets.svelte.js';

	let hasHydrated = $state(false);

	$effect(() => {
		if (hasHydrated) return;
		hasHydrated = true;
		void costComponentPresetsState.hydrate();
	});
</script>

<div class="ui-route-frame">
	<div class="ui-page-content">
		<CostComponentPresetsTable />
	</div>
</div>
