<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import type { Snippet } from 'svelte';
	import FormHelpTooltip from '$lib/components/form-help-tooltip.svelte';
	import { cn } from '$lib/utils.js';
	import FieldLabel from './field-label.svelte';
	import SectionLabel from './section-label.svelte';

	let {
		for: htmlFor,
		tooltip,
		class: className,
		aside,
		children,
		...restProps
	}: HTMLAttributes<HTMLDivElement> & {
		for?: string;
		tooltip?: string;
		aside?: Snippet;
		children?: Snippet;
	} = $props();
</script>

<div
	data-kf-primitive="field-label-row"
	class={cn('flex items-center justify-between gap-3', className)}
	{...restProps}
>
	<div class="ui-label-gap flex min-w-0 items-center">
		{#if htmlFor}
			<FieldLabel for={htmlFor}>{@render children?.()}</FieldLabel>
		{:else}
			<SectionLabel>{@render children?.()}</SectionLabel>
		{/if}
		{#if tooltip}
			<FormHelpTooltip content={tooltip} />
		{/if}
	</div>
	{#if aside}
		<div class="shrink-0">
			{@render aside()}
		</div>
	{/if}
</div>
