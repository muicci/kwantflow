<script lang="ts">
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import InfoIcon from '@lucide/svelte/icons/info';
	import LoaderIcon from '@lucide/svelte/icons/loader';
	import OctagonXIcon from '@lucide/svelte/icons/octagon-x';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { mode } from 'mode-watcher';
	import { Toaster as Sonner, type ToasterProps as SonnerProps } from 'svelte-sonner';

	let {
		position = 'bottom-right',
		duration = 4000,
		closeButton = true,
		richColors = true,
		...restProps
	}: SonnerProps = $props();
</script>

<Sonner
	theme={mode.current ?? 'light'}
	class="ui-toaster toaster group"
	toastOptions={{
		class: 'toast-title',
		descriptionClass: 'toast-description'
	}}
	{position}
	{duration}
	{closeButton}
	{richColors}
	{...restProps}
>
	{#snippet loadingIcon()}
		<LoaderIcon class="size-4 animate-spin" />
	{/snippet}
	{#snippet successIcon()}
		<CircleCheckIcon class="size-4" />
	{/snippet}
	{#snippet errorIcon()}
		<OctagonXIcon class="size-4" />
	{/snippet}
	{#snippet infoIcon()}
		<InfoIcon class="size-4" />
	{/snippet}
	{#snippet warningIcon()}
		<TriangleAlertIcon class="size-4" />
	{/snippet}
</Sonner>
