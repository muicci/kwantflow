<script lang="ts">
	import { Label } from '$lib/components/ui/label/index.js';
	import type { ComponentProps, Snippet } from 'svelte';

	let {
		class: className,
		children,
		...restProps
	}: ComponentProps<typeof Label> & {
		children?: Snippet;
	} = $props();
</script>

<Label data-kf-primitive="field-label" class={className} {...restProps}>
	{@render children?.()}
</Label>
