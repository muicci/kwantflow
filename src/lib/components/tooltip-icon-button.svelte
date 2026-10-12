<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import type { ComponentProps } from 'svelte';
	import type { WithoutChildrenOrChild } from '$lib/utils.js';

	let {
		tooltip,
		tooltipSide = 'top',
		tooltipAlign = 'center',
		tooltipContentProps,
		children,
		...buttonProps
	}: ComponentProps<typeof Button> & {
		tooltip: string;
		tooltipSide?: ComponentProps<typeof Tooltip.Content>['side'];
		tooltipAlign?: ComponentProps<typeof Tooltip.Content>['align'];
		tooltipContentProps?: WithoutChildrenOrChild<ComponentProps<typeof Tooltip.Content>>;
	} = $props();
</script>

<Tooltip.Root>
	<Tooltip.Trigger>
		{#snippet child({ props })}
			<Button aria-label={tooltip} {...props} {...buttonProps}>
				{@render children?.()}
			</Button>
		{/snippet}
	</Tooltip.Trigger>
	<Tooltip.Content side={tooltipSide} align={tooltipAlign} {...tooltipContentProps}>
		{tooltip}
	</Tooltip.Content>
</Tooltip.Root>
