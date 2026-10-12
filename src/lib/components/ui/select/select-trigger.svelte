<script lang="ts">
	import { Select as SelectPrimitive } from 'bits-ui';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import { cn, type WithoutChild } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		size = 'default',
		invalidTone,
		...restProps
	}: WithoutChild<SelectPrimitive.TriggerProps> & {
		size?: 'xs' | 'sm' | 'default' | 'lg';
		invalidTone?: 'neutral' | 'destructive';
	} = $props();

	const sizeClass = $derived(
		size === 'xs'
			? 'ui-field-size-xs'
			: size === 'sm'
				? 'ui-field-size-sm'
				: size === 'lg'
					? 'ui-field-size-lg'
					: 'ui-field-size-default'
	);
	const invalidClass = $derived.by(() => {
		if (invalidTone === 'neutral') return 'ui-field-invalid-neutral';
		if (invalidTone === 'destructive') return 'ui-field-invalid-destructive aria-invalid';
		return '';
	});
</script>

<SelectPrimitive.Trigger
	bind:ref
	data-slot="select-trigger"
	data-size={size}
	class={cn(
		`field-copy ui-field-control-base ui-select-control ui-field-control-focus ${sizeClass} data-[placeholder]:muted disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0`,
		invalidClass,
		className
	)}
	{...restProps}
>
	{@render children?.()}
	<ChevronDownIcon class="muted size-4" />
</SelectPrimitive.Trigger>
