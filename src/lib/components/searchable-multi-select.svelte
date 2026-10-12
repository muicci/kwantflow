<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
	import { tick } from 'svelte';

	import { Button } from '$lib/components/ui/button/index.js';
	import { SearchInput } from '$lib/components/ui/input/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { Meta, Text } from '$lib/components/primitives/index.js';
	import { cn } from '$lib/utils.js';

	type MultiSelectOption = {
		value: string;
		label: string;
		keywords?: string[];
	};

	interface Props {
		id?: string;
		options: readonly MultiSelectOption[];
		selectedValues?: string[];
		size?: 'xs' | 'sm' | 'default' | 'lg';
		placeholder?: string;
		searchPlaceholder?: string;
		emptyLabel?: string;
		disabled?: boolean;
		maxInlineLabels?: number;
		buttonClass?: string;
		contentClass?: string;
	}

	let {
		id,
		options,
		selectedValues = $bindable([]),
		size = 'default',
		placeholder = 'Select options',
		searchPlaceholder = 'Search options...',
		emptyLabel = 'No matching options.',
		disabled = false,
		maxInlineLabels = 2,
		buttonClass = '',
		contentClass = ''
	}: Props = $props();

	let open = $state(false);
	let query = $state('');
	let triggerRef = $state<HTMLButtonElement | null>(null);
	let searchInputRef = $state<HTMLInputElement | null>(null);

	const selectedOptions = $derived(
		options.filter((option) => selectedValues.includes(option.value))
	);
	const filteredOptions = $derived.by(() => {
		const needle = query.trim().toLowerCase();
		if (!needle) return options;
		return options.filter((option) =>
			[option.label, option.value, ...(option.keywords ?? [])].some((token) =>
				token.toLowerCase().includes(needle)
			)
		);
	});
	const triggerLabel = $derived.by(() => {
		if (selectedOptions.length === 0) return placeholder;
		if (selectedOptions.length <= maxInlineLabels) {
			return selectedOptions.map((option) => option.label).join(', ');
		}
		return `${selectedOptions.length} selected`;
	});

	$effect(() => {
		if (!open) {
			query = '';
			return;
		}

		void tick().then(() => {
			searchInputRef?.focus();
		});
	});

	function toggleValue(value: string): void {
		if (selectedValues.includes(value)) {
			selectedValues = selectedValues.filter((currentValue) => currentValue !== value);
			return;
		}

		selectedValues = [...selectedValues, value];
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger bind:ref={triggerRef}>
		{#snippet child({ props })}
			<Button
				{...props}
				{id}
				type="button"
				variant="secondary"
				{size}
				class={cn('ui-field-trigger-button w-full justify-between gap-2', buttonClass)}
				role="combobox"
				aria-expanded={open}
				aria-label={placeholder}
				{disabled}
			>
				<Text as="span" class={cn('truncate text-left', selectedValues.length === 0 && 'muted')}>
					{triggerLabel}
				</Text>
				<ChevronsUpDownIcon class="muted size-4" />
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content
		align="start"
		class={cn('ui-popover-anchor-width ui-popover-padding-none', contentClass)}
	>
		<div class="border-b p-2">
			<SearchInput
				bind:ref={searchInputRef}
				bind:value={query}
				{size}
				inputClass="border-0 focus-visible:ring-0"
				placeholder={searchPlaceholder}
			/>
		</div>
		<div class="max-h-64 overflow-y-auto p-1" role="listbox" aria-multiselectable="true">
			{#if filteredOptions.length === 0}
				<Meta class="px-3 py-2">{emptyLabel}</Meta>
			{:else}
				{#each filteredOptions as option (option.value)}
					<button
						type="button"
						class={cn(
							'menu-copy ui-floating-field-item ui-floating-field-item-end-indicator min-h-9 px-2.5'
						)}
						data-selected={selectedValues.includes(option.value)}
						role="option"
						aria-selected={selectedValues.includes(option.value)}
						onclick={() => toggleValue(option.value)}
					>
						<span class="min-w-0 flex-1 truncate text-left">{option.label}</span>
						<span class="ui-selector-item-check">
							{#if selectedValues.includes(option.value)}
								<CheckIcon class="size-4" />
							{/if}
						</span>
					</button>
				{/each}
			{/if}
		</div>
	</Popover.Content>
</Popover.Root>
