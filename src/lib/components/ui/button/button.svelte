<script lang="ts" module>
	import LoaderIcon from '@lucide/svelte/icons/loader';
	import { cn } from '$lib/utils.js';
	import { buttonVariants } from './types.js';
</script>

<script lang="ts">
	import type { ButtonProps } from './types.js';
	import { resolve } from '$app/paths';

	let {
		class: className,
		variant = 'default',
		size = 'default',
		ref = $bindable(null),
		href = undefined,
		type = 'button',
		disabled,
		loading = false,
		loadingLabel = 'Loading',
		children,
		...restProps
	}: ButtonProps = $props();
</script>

{#if href}
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
	<a
		bind:this={ref}
		data-slot="button"
		class={cn(buttonVariants({ variant, size }), className)}
		href={disabled || loading
			? undefined
			: href?.startsWith('/') && !href.startsWith('//') && !href.startsWith('/#')
				? resolve(href as any)
				: href}
		aria-disabled={disabled || loading}
		aria-busy={loading || undefined}
		role={disabled || loading ? 'link' : undefined}
		tabindex={disabled || loading ? -1 : undefined}
		{...restProps}
	>
		{#if loading}
			<LoaderIcon class="size-3.5 animate-spin" aria-hidden="true" />
			<span class="sr-only">{loadingLabel}</span>
		{/if}
		{@render children?.()}
	</a>
{:else}
	<button
		bind:this={ref}
		data-slot="button"
		class={cn(buttonVariants({ variant, size }), className)}
		{type}
		disabled={disabled || loading}
		aria-busy={loading || undefined}
		{...restProps}
	>
		{#if loading}
			<LoaderIcon class="size-3.5 animate-spin" aria-hidden="true" />
			<span class="sr-only">{loadingLabel}</span>
		{/if}
		{@render children?.()}
	</button>
{/if}
