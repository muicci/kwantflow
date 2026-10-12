<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils.js';
	import * as Dialog from './index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import MobileDialogStepTabs from '$lib/components/mobile-dialog-step-tabs.svelte';
	import DialogRailBreadcrumbHeader from './dialog-rail-breadcrumb-header.svelte';

	import type { DialogRailItem } from './types.js';

	type DialogFrameSize = 'sm' | 'md' | 'lg';
	type DialogContentWidth = 'none' | 'form';

	interface Props {
		rootLabel: string;
		description?: string;
		items: DialogRailItem[];
		activeItemId: string;
		onItemSelect: (itemId: string) => void;
		onCloseRequest?: () => void;
		bodyClass?: string;
		size?: DialogFrameSize;
		contentWidth?: DialogContentWidth;
		class?: string;
		showCloseButton?: boolean;
		children: Snippet;
		footer?: Snippet;
		sidebarFooter?: Snippet;
	}

	let {
		rootLabel,
		description = '',
		items,
		activeItemId,
		onItemSelect,
		onCloseRequest,
		bodyClass = '',
		size = 'md',
		contentWidth = 'none',
		class: className = '',
		showCloseButton = true,
		children,
		footer,
		sidebarFooter
	}: Props = $props();

	const activeItem = $derived(items.find((item) => item.id === activeItemId) ?? null);

	const frameSizeClass: Record<DialogFrameSize, string> = {
		sm: 'ui-dialog-frame-size-sm',
		md: 'ui-dialog-frame-size-md',
		lg: 'ui-dialog-frame-size-lg'
	};

	const contentWidthClass: Record<DialogContentWidth, string> = {
		none: '',
		form: 'ui-dialog-content-width-form'
	};
</script>

<Dialog.Content
	class={cn('dialog-shell-rail', size ? frameSizeClass[size] : '', className)}
	{showCloseButton}
	trapFocus={false}
	onInteractOutside={(event) => event.preventDefault()}
	onEscapeKeydown={(event) => event.preventDefault()}
>
	<Dialog.Title class="sr-only">{rootLabel}</Dialog.Title>
	{#if description}
		<Dialog.Description class="sr-only">{description}</Dialog.Description>
	{/if}

	<Sidebar.Provider class="dialog-sidebar-provider items-start">
		{#if items.length > 1}
			<Sidebar.Root collapsible="none" class="ui-dialog-rail-sidebar shrink-0">
				<Sidebar.Content class="overflow-hidden">
					<Sidebar.Group>
						<Sidebar.GroupContent>
							<Sidebar.Menu>
								{#each items as item (item.id)}
									<Sidebar.MenuItem>
										<Sidebar.MenuButton
											isActive={activeItemId === item.id}
											onclick={() => onItemSelect(item.id)}
										>
											<item.icon strokeWidth={1.5} />
											<span>{item.name}</span>
										</Sidebar.MenuButton>
									</Sidebar.MenuItem>
								{/each}
							</Sidebar.Menu>
						</Sidebar.GroupContent>
					</Sidebar.Group>
				</Sidebar.Content>
				{#if sidebarFooter}
					<Sidebar.Footer>
						{@render sidebarFooter()}
					</Sidebar.Footer>
				{/if}
			</Sidebar.Root>
		{/if}

		<main class="ui-dialog-rail-main">
			<DialogRailBreadcrumbHeader
				{rootLabel}
				pageLabel={activeItem?.name ?? rootLabel}
				{onCloseRequest}
			/>

			{#if items.length > 1}
				<div class="ui-dialog-rail-tabs md:hidden">
					<MobileDialogStepTabs {items} activeStep={activeItemId} onSelect={onItemSelect} />
				</div>
			{/if}

			<div class="ui-dialog-rail-scroll">
				<div class={cn('ui-dialog-rail-body', contentWidthClass[contentWidth], bodyClass)}>
					{@render children?.()}
				</div>
			</div>

			{#if footer}
				<Dialog.Footer class="ui-dialog-rail-footer">
					{@render footer()}
				</Dialog.Footer>
			{/if}
		</main>
	</Sidebar.Provider>
</Dialog.Content>
