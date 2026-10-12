<script lang="ts">
	import EquipmentRateTable from '$lib/components/equipment-rates/equipment-rate-table.svelte';
	import { equipmentRatesState } from '$lib/state/equipment-rates.svelte.js';

	let hasHydrated = $state(false);

	$effect(() => {
		if (hasHydrated) return;
		hasHydrated = true;
		void equipmentRatesState.hydrate();
	});
</script>

<div class="ui-route-frame">
	<div class="ui-page-content">
		<EquipmentRateTable />
	</div>
</div>
