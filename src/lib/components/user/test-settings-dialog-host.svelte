<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import SettingsDialog from './settings-dialog.svelte';
	let props: ComponentProps<typeof SettingsDialog> = $props();
</script>

<Tooltip.Provider>
	<SettingsDialog {...props} />
</Tooltip.Provider>
