<script lang="ts">
	import PlusIcon from '@lucide/svelte/icons/plus';
	import UploadIcon from '@lucide/svelte/icons/upload';

	import { Button } from '$lib/components/ui/button/index.js';

	interface Props {
		createLabel: string;
		onCreate: () => void;
		importLabel?: string;
		onImport?: () => void;
		class?: string;
	}

	let {
		createLabel,
		onCreate,
		importLabel = 'Import Setup Data',
		onImport,
		class: className = ''
	}: Props = $props();
</script>

<div class={`ui-table-toolbar-actions ${className}`.trim()}>
	{#if onImport}
		<Button variant="secondary" size="default" class="gap-2 px-4" onclick={onImport}>
			<UploadIcon class="size-4" />
			{importLabel}
		</Button>
	{/if}
	<Button variant="brand" size="default" class="gap-2 px-4" onclick={onCreate}>
		<PlusIcon class="size-4" />
		{createLabel}
	</Button>
</div>
