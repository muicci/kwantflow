<script lang="ts">
	import LabourRateTable from '$lib/components/labour-rates/labour-rate-table.svelte';
	import { labourRatesState } from '$lib/state/labour-rates.svelte.js';

	let hasHydrated = $state(false);

	$effect(() => {
		if (hasHydrated) return;
		hasHydrated = true;
		void labourRatesState.hydrate();
	});
</script>

<div class="ui-route-frame">
	<div class="ui-page-content">
		<LabourRateTable />
	</div>
</div>
