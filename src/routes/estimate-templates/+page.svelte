<script lang="ts">
	import EstimateTemplatesTable from '$lib/components/estimate-templates/estimate-templates-table.svelte';
	import { estimateTemplatesState } from '$lib/state/estimate-templates.svelte.js';

	let hasHydrated = $state(false);

	$effect(() => {
		if (hasHydrated) return;
		hasHydrated = true;
		void estimateTemplatesState.hydrate();
	});
</script>

<div class="ui-route-frame">
	<div class="ui-page-content">
		<EstimateTemplatesTable />
	</div>
</div>
