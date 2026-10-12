<script lang="ts">
	import { Tabs as TabsPrimitive } from 'bits-ui';
	import { cn, type WithElementRef } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<TabsPrimitive.TriggerProps> = $props();
</script>

<TabsPrimitive.Trigger
	bind:ref
	data-slot="tabs-trigger"
	class={cn('ui-tabs-trigger', className)}
	{...restProps}
>
	{@render children?.()}
</TabsPrimitive.Trigger>
