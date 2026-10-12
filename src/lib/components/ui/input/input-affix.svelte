<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn, type WithElementRef } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		affix,
		numeric = false,
		size = 'default',
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		affix: string;
		numeric?: boolean;
		size?: 'xs' | 'sm' | 'default' | 'lg';
	} = $props();

	const sizeClass = $derived(
		size === 'xs'
			? 'ui-input-affix-field-xs'
			: size === 'sm'
				? 'ui-input-affix-field-sm'
				: size === 'lg'
					? 'ui-input-affix-field-lg'
					: 'ui-input-affix-field-default'
	);
</script>

<div
	bind:this={ref}
	data-slot="input-affix"
	data-numeric={numeric}
	class={cn('ui-input-affix-field', sizeClass, className)}
	{...restProps}
>
	{@render children?.()}
	<span data-slot="input-affix-label" class="field-copy ui-input-affix-label" aria-hidden="true">
		{affix}
	</span>
</div>
