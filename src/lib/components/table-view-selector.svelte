<script lang="ts">
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';

	import { Button } from '$lib/components/ui/button/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { Meta, Text } from '$lib/components/primitives/index.js';
	import { cn } from '$lib/utils.js';

	type TableViewOption = {
		value: string;
		label: string;
		count?: number;
	};

	interface Props {
		options: TableViewOption[];
		value?: string;
		ariaLabel?: string;
		class?: string;
	}

	let {
		options,
		value = $bindable(''),
		ariaLabel = 'Select view',
		class: className = ''
	}: Props = $props();

	const selectedOption = $derived(
		options.find((option) => option.value === value) ?? options[0] ?? null
	);
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				type="button"
				variant="secondary"
				size="default"
				class={cn(
					'ui-field-trigger-button ui-table-toolbar-filter justify-between gap-2',
					className
				)}
				aria-label={ariaLabel}
			>
				<Text as="span" class="truncate">{selectedOption?.label ?? 'View'}</Text>
				<ChevronDownIcon class="muted size-4" />
			</Button>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="start" class="ui-menu-anchor-width">
		<DropdownMenu.RadioGroup bind:value>
			{#each options as option (option.value)}
				<DropdownMenu.RadioItem value={option.value}>
					<div class="flex min-w-0 flex-1 items-center justify-between gap-3">
						<span class="truncate">{option.label}</span>
						{#if typeof option.count === 'number'}
							<Meta as="span" class="tabular-nums">{option.count}</Meta>
						{/if}
					</div>
				</DropdownMenu.RadioItem>
			{/each}
		</DropdownMenu.RadioGroup>
	</DropdownMenu.Content>
</DropdownMenu.Root>
