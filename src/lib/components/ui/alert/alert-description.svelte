<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';

	import { cn, type WithElementRef } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<div
	bind:this={ref}
	data-slot="alert-description"
	class={cn(
		'shell-label grid gap-1 text-current/86 [&_p]:leading-normal [&_ul]:ml-4 [&_ul]:list-disc [&_ul]:space-y-1',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</div>
