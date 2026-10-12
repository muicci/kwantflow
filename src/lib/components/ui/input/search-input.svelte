<script lang="ts">
	import SearchIcon from '@lucide/svelte/icons/search';
	import { cn, type WithElementRef } from '$lib/utils.js';
	import type { HTMLInputAttributes } from 'svelte/elements';

	type Props = WithElementRef<
		Omit<HTMLInputAttributes, 'type' | 'size'> & {
			size?: 'xs' | 'sm' | 'default' | 'lg';
			inputClass?: string;
		}
	>;

	let {
		ref = $bindable(null),
		value = $bindable(),
		size = 'default',
		class: className,
		inputClass,
		oninput,
		...restProps
	}: Props = $props();

	const sizeClass = $derived(
		size === 'xs'
			? 'ui-field-size-xs'
			: size === 'sm'
				? 'ui-field-size-sm'
				: size === 'lg'
					? 'ui-field-size-lg'
					: 'ui-field-size-default'
	);

	const iconClass = $derived(
		size === 'xs'
			? 'ui-search-input-icon size-3.5'
			: size === 'sm'
				? 'ui-search-input-icon size-3.5'
				: size === 'lg'
					? 'ui-search-input-icon size-[1.125rem]'
					: 'ui-search-input-icon size-4'
	);
</script>

<div class={cn('ui-search-input', className)} data-size={size}>
	<SearchIcon class={iconClass} aria-hidden="true" />
	<input
		bind:this={ref}
		data-slot="input"
		class={cn(
			'field-copy ui-field-control-base ui-input-control ui-input-control-text ui-field-control-focus placeholder:muted ring-offset-background selection:bg-primary selection:text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30',
			sizeClass,
			'ui-search-input-control',
			inputClass
		)}
		type="search"
		value={value ?? ''}
		oninput={(event) => {
			value = event.currentTarget.value;
			if (typeof oninput === 'function') {
				oninput(event);
			}
		}}
		{...restProps}
	/>
</div>
