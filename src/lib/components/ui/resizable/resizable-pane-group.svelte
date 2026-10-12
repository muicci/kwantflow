<script lang="ts">
	import * as ResizablePrimitive from 'paneforge';
	import { cn } from '$lib/utils.js';

	let paneGroup = $state<ResizablePrimitive.PaneGroup | null>(null);

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: ResizablePrimitive.PaneGroupProps & {
		ref?: ResizablePrimitive.PaneGroup | null;
	} = $props();

	export const getLayout = () => paneGroup?.getLayout() ?? [];
	export const setLayout = (layout: number[]) => paneGroup?.setLayout(layout);
	export const getId = () => paneGroup?.getId() ?? '';
</script>

<ResizablePrimitive.PaneGroup
	bind:this={paneGroup}
	bind:ref
	data-slot="resizable-pane-group"
	class={cn('flex h-full w-full data-[direction=vertical]:flex-col', className)}
	{...restProps}
/>
