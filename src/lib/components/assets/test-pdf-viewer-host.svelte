<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import PdfViewer from './pdf-viewer.svelte';
	let props: ComponentProps<typeof PdfViewer> = $props();
</script>

<Tooltip.Provider>
	<PdfViewer {...props} />
</Tooltip.Provider>
