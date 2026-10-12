<script lang="ts">
	import { cn, type WithElementRef, type WithoutChildren } from '$lib/utils.js';
	import type { HTMLTextareaAttributes } from 'svelte/elements';

	let {
		ref = $bindable(null),
		value = $bindable(),
		size = 'default',
		invalidTone,
		class: className,
		'data-slot': dataSlot = 'textarea',
		...restProps
	}: WithoutChildren<WithElementRef<HTMLTextareaAttributes>> & {
		size?: 'xs' | 'sm' | 'default' | 'lg';
		invalidTone?: 'neutral' | 'destructive';
	} = $props();

	const sizeClass = $derived(
		size === 'xs'
			? 'ui-textarea-control-xs'
			: size === 'sm'
				? 'ui-textarea-control-sm'
				: size === 'lg'
					? 'ui-textarea-control-lg'
					: 'ui-textarea-control-md'
	);

	const invalidClass = $derived.by(() => {
		if (invalidTone === 'neutral') return 'ui-field-invalid-neutral';
		if (invalidTone === 'destructive') return 'ui-field-invalid-destructive aria-invalid';
		return '';
	});
</script>

<textarea
	bind:this={ref}
	data-slot={dataSlot}
	class={cn(
		'field-copy ui-field-control-base ui-textarea-control ui-field-control-focus placeholder:muted field-sizing-content disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30 dark:aria-invalid:ring-destructive/40',
		sizeClass,
		invalidClass,
		className
	)}
	bind:value
	{...restProps}
></textarea>
