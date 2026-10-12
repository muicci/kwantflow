<script lang="ts">
	import MaterialTable from '$lib/components/materials/material-table.svelte';
	import { materialsState } from '$lib/state/materials.svelte.js';

	let hasHydrated = $state(false);

	$effect(() => {
		if (hasHydrated) return;
		hasHydrated = true;
		void materialsState.hydrate();
	});
</script>

<div class="ui-route-frame">
	<div class="ui-page-content">
		<MaterialTable />
	</div>
</div>
