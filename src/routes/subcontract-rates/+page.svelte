<script lang="ts">
	import SubcontractRateTable from '$lib/components/subcontract-rates/subcontract-rate-table.svelte';
	import { subcontractRatesState } from '$lib/state/subcontract-rates.svelte.js';

	let hasHydrated = $state(false);

	$effect(() => {
		if (hasHydrated) return;
		hasHydrated = true;
		void subcontractRatesState.hydrate();
	});
</script>

<div class="ui-route-frame">
	<div class="ui-page-content">
		<SubcontractRateTable />
	</div>
</div>
