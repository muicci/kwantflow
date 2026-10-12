<!-- Shared source-of-truth empty state for first-class record tables. -->
<script lang="ts">
	import * as Empty from '$lib/components/ui/empty/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import type { TableEmptyStateConfig } from './table-empty-state-config.js';

	interface Props {
		config: TableEmptyStateConfig;
		onCreate: () => void;
		onImport?: () => void;
		secondaryActionLabel?: string;
		onSecondaryAction?: () => void;
		stackSecondaryAction?: boolean;
		class?: string;
	}

	let {
		config,
		onCreate,
		onImport,
		secondaryActionLabel,
		onSecondaryAction,
		stackSecondaryAction = false,
		class: className
	}: Props = $props();
</script>

<Empty.Root class={cn('mx-auto min-h-0 max-w-3xl flex-1 px-4 py-8', className)}>
	<Empty.Header>
		<Empty.Media variant="icon">
			{@const Icon = config.icon}
			<Icon />
		</Empty.Media>
		<Empty.Title>{config.title}</Empty.Title>
		<Empty.Description>{config.description}</Empty.Description>
	</Empty.Header>
	<Empty.Content class="pt-1">
		<div class="flex flex-col items-center justify-center gap-0">
			<div class="flex flex-wrap items-center justify-center gap-2 sm:flex-nowrap">
				<Button variant="filled" size="default" class="gap-2 px-4 shadow-none" onclick={onCreate}>
					{config.createLabel}
				</Button>
				{#if onImport && config.importLabel}
					<Button variant="secondary" size="default" class="gap-2 px-4" onclick={onImport}>
						{config.importLabel}
					</Button>
				{/if}
				{#if onSecondaryAction && secondaryActionLabel && !stackSecondaryAction}
					<Button
						variant="link"
						size="default"
						class="muted px-2 no-underline hover:text-foreground hover:no-underline"
						onclick={onSecondaryAction}
					>
						{secondaryActionLabel}
					</Button>
				{/if}
			</div>
			{#if onSecondaryAction && secondaryActionLabel && stackSecondaryAction}
				<div class="flex w-full justify-center pt-3">
					<Button
						variant="link"
						size="default"
						class="muted px-2 no-underline hover:text-foreground hover:no-underline"
						onclick={onSecondaryAction}
					>
						{secondaryActionLabel}
					</Button>
				</div>
			{/if}
		</div>
	</Empty.Content>
</Empty.Root>
