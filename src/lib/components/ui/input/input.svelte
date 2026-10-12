<script lang="ts">
	import type { HTMLInputAttributes, HTMLInputTypeAttribute } from 'svelte/elements';
	import { cn, type WithElementRef } from '$lib/utils.js';

	type InputType = Exclude<HTMLInputTypeAttribute, 'file'>;

	type Props = WithElementRef<
		Omit<HTMLInputAttributes, 'type' | 'size'> &
			({ type: 'file'; files?: FileList } | { type?: InputType; files?: undefined })
	>;

	let {
		ref = $bindable(null),
		value = $bindable(),
		type = 'text',
		files = $bindable(),
		size = 'default',
		invalidTone,
		class: className,
		'data-slot': dataSlot = 'input',
		oninput,
		...restProps
	}: Props & {
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
	const typeClass = $derived(type === 'number' ? 'ui-input-control-number' : '');
</script>

{#if type === 'file'}
	<input
		bind:this={ref}
		data-slot={dataSlot}
		class={cn(
			'field-copy ui-field-control-base ui-input-control ui-input-control-file ui-field-control-focus placeholder:muted ring-offset-background selection:bg-primary selection:text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30',
			sizeClass,
			'aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40',
			invalidClass,
			className
		)}
		type="file"
		bind:files
		bind:value
		{...restProps}
	/>
{:else}
	<input
		bind:this={ref}
		data-slot={dataSlot}
		class={cn(
			'field-copy ui-field-control-base ui-input-control ui-input-control-text ui-field-control-focus placeholder:muted ring-offset-background selection:bg-primary selection:text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30',
			sizeClass,
			typeClass,
			'aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40',
			invalidClass,
			className
		)}
		{type}
		value={value ?? ''}
		oninput={(event) => {
			if (type === 'number') {
				const val = event.currentTarget.valueAsNumber;
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				value = Number.isNaN(val) ? undefined : (val as any);
			} else {
				value = event.currentTarget.value;
			}
			if (typeof oninput === 'function') {
				oninput(event);
			}
		}}
		{...restProps}
	/>
{/if}
