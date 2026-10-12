<script lang="ts">
	import { Progress as ProgressPrimitive } from 'bits-ui';
	import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		value = 0,
		max = 100,
		min = 0,
		class: className,
		...restProps
	}: WithoutChildrenOrChild<ProgressPrimitive.RootProps> = $props();

	const progressPercent = $derived.by(() => {
		if (value === null) return null;
		const safeMax = Number.isFinite(max) ? max : 100;
		const safeMin = Number.isFinite(min) ? min : 0;
		const range = Math.max(safeMax - safeMin, 1);
		const bounded = Math.min(Math.max(value, safeMin), safeMax);
		return ((bounded - safeMin) / range) * 100;
	});
</script>

<ProgressPrimitive.Root
	bind:ref
	data-slot="progress"
	{value}
	{max}
	{min}
	class={cn('ui-progress-root', className)}
	{...restProps}
>
	<div
		data-slot="progress-indicator"
		class="ui-progress-indicator"
		style:transform={progressPercent === null
			? undefined
			: `translateX(-${100 - progressPercent}%)`}
	></div>
</ProgressPrimitive.Root>
