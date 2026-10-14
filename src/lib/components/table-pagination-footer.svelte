<script lang="ts">
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import ChevronsLeftIcon from '@lucide/svelte/icons/chevrons-left';
	import ChevronsRightIcon from '@lucide/svelte/icons/chevrons-right';
	import { FieldLabel } from '$lib/components/primitives/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { DEFAULT_TABLE_PAGE_SIZES } from '$lib/utils/table-pagination.js';

	interface Props {
		selectedCount: number;
		totalCount: number;
		pageIndex: number;
		pageCount: number;
		pageSize: number;
		pageSizeLabel?: string;
		pageSizeOptions?: readonly number[];
		compact?: boolean;
		hidePageSize?: boolean;
		canPreviousPage: boolean;
		canNextPage: boolean;
		onPageSizeChange: (pageSize: number) => void;
		onFirstPage: () => void;
		onPreviousPage: () => void;
		onNextPage: () => void;
		onLastPage: () => void;
	}

	let {
		selectedCount,
		totalCount,
		pageIndex,
		pageCount,
		pageSize,
		pageSizeLabel = 'Rows per page',
		pageSizeOptions = DEFAULT_TABLE_PAGE_SIZES,
		compact = false,
		hidePageSize = false,
		canPreviousPage,
		canNextPage,
		onPageSizeChange,
		onFirstPage,
		onPreviousPage,
		onNextPage,
		onLastPage
	}: Props = $props();
</script>

{#if totalCount > 0}
	<div
		class={`flex w-full items-center justify-end ${compact ? 'gap-3 pt-0 pb-2' : 'gap-4 pt-0 pb-2'}`}
	>
		<div
			class={`muted me-auto table-caption tabular-nums ${compact ? 'hidden' : 'hidden lg:flex'}`}
		>
			{#if selectedCount > 0}{selectedCount} of {totalCount} selected{/if}
		</div>
		<div class={`flex items-center ${compact ? 'gap-3' : 'gap-4'}`}>
			<div
				class={`items-center gap-2 ${hidePageSize ? 'hidden' : compact ? 'flex' : 'hidden lg:flex'}`}
			>
				<FieldLabel class="px-0 whitespace-nowrap">{pageSizeLabel}</FieldLabel>
				<Select.Root
					type="single"
					value={`${pageSize}`}
					onValueChange={(value) => {
						const nextPageSize = Number(value);
						if (Number.isFinite(nextPageSize)) {
							onPageSizeChange(nextPageSize);
						}
					}}
				>
					<Select.Trigger
						size={compact ? 'sm' : 'default'}
						class={compact ? 'ui-control-width-sm' : 'w-20'}
					>
						{pageSize}
					</Select.Trigger>
					<Select.Content side="top">
						{#each pageSizeOptions as option (option)}
							<Select.Item value={option.toString()}>{option}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
			<div class="flex table-caption w-fit items-center justify-center tabular-nums">
				Page {pageIndex + 1} of {pageCount}
			</div>
			<div class={`flex items-center ${compact ? 'gap-1.5' : 'gap-2'}`}>
				<Button
					variant="secondary"
					size={compact ? 'icon' : 'icon-sm'}
					class="hidden lg:flex"
					onclick={onFirstPage}
					disabled={!canPreviousPage}
				>
					<span class="sr-only">Go to first page</span>
					<ChevronsLeftIcon class="size-4" />
				</Button>
				<Button
					variant="secondary"
					size={compact ? 'icon' : 'icon-sm'}
					onclick={onPreviousPage}
					disabled={!canPreviousPage}
				>
					<span class="sr-only">Go to previous page</span>
					<ChevronLeftIcon class="size-4" />
				</Button>
				<Button
					variant="secondary"
					size={compact ? 'icon' : 'icon-sm'}
					onclick={onNextPage}
					disabled={!canNextPage}
				>
					<span class="sr-only">Go to next page</span>
					<ChevronRightIcon class="size-4" />
				</Button>
				<Button
					variant="secondary"
					size={compact ? 'icon' : 'icon-sm'}
					class="hidden lg:flex"
					onclick={onLastPage}
					disabled={!canNextPage}
				>
					<span class="sr-only">Go to last page</span>
					<ChevronsRightIcon class="size-4" />
				</Button>
			</div>
		</div>
	</div>
{/if}
