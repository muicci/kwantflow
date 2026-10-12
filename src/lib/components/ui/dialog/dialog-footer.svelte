<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils.js';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		ref = $bindable(null),
		class: className,
		density = 'default',
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		density?: 'default' | 'compact';
	} = $props();
</script>

<div
	bind:this={ref}
	data-slot="dialog-footer"
	data-density={density}
	class={cn(
		'ui-dialog-shell-footer flex flex-col-reverse gap-2 sm:flex-row sm:justify-end',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</div>
