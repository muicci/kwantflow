<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import SetupImportDialog from './setup-import-dialog.svelte';
	let props: ComponentProps<typeof SetupImportDialog> = $props();
</script>

<Tooltip.Provider>
	<SetupImportDialog {...props} />
</Tooltip.Provider>
