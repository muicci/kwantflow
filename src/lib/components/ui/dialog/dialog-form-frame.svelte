<script lang="ts">
	import type { ComponentProps, Snippet } from 'svelte';
	import { cn } from '$lib/utils.js';
	import * as Dialog from './index.js';
	import type { WithoutChildrenOrChild } from '$lib/utils.js';

	type DialogFrameSize = 'sm' | 'md' | 'lg';
	type DialogContentWidth = 'none' | 'form';

	const frameSizeClass: Record<DialogFrameSize, string> = {
		sm: 'ui-dialog-frame-width-sm',
		md: 'ui-dialog-frame-width-md',
		lg: 'ui-dialog-frame-width-lg'
	};

	const contentWidthClass: Record<DialogContentWidth, string> = {
		none: '',
		form: 'ui-dialog-content-width-form'
	};

	interface Props extends WithoutChildrenOrChild<ComponentProps<typeof Dialog.Content>> {
		title: string;
		description?: string;
		bodyClass?: string;
		size?: DialogFrameSize;
		contentWidth?: DialogContentWidth;
		children: Snippet;
		footer?: Snippet;
	}

	let {
		title,
		description = '',
		bodyClass = '',
		size = 'md',
		contentWidth = 'form',
		class: className = '',
		children,
		footer,
		portalProps,
		showCloseButton = true,
		...contentProps
	}: Props = $props();
</script>

<Dialog.Content
	class={cn('dialog-shell-form', size ? frameSizeClass[size] : '', className)}
	{portalProps}
	{showCloseButton}
	trapFocus={contentProps.trapFocus ?? false}
	onInteractOutside={contentProps.onInteractOutside ?? ((event) => event.preventDefault())}
	onEscapeKeydown={contentProps.onEscapeKeydown ?? ((event) => event.preventDefault())}
	{...contentProps}
>
	<Dialog.Header class="ui-dialog-frame-header">
		<Dialog.Title>{title}</Dialog.Title>
		{#if description}
			<Dialog.Description>{description}</Dialog.Description>
		{/if}
	</Dialog.Header>

	<div class={cn('ui-dialog-frame-body', contentWidthClass[contentWidth], bodyClass)}>
		{@render children?.()}
	</div>

	{#if footer}
		<Dialog.Footer class="ui-dialog-frame-footer">
			{@render footer()}
		</Dialog.Footer>
	{/if}
</Dialog.Content>
