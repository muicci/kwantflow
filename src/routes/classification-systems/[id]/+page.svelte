<script lang="ts">
	import { page } from '$app/state';
	import ClassificationSystemsSplitView from '$lib/components/classification-systems/classification-systems-split-view.svelte';

	const systemId = $derived(page.params.id);
</script>

<div class="ui-route-frame">
	<div class="ui-page-content">
		<ClassificationSystemsSplitView selectedSystemId={systemId} />
	</div>
</div>
