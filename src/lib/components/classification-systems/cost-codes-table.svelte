<script lang="ts">
	import * as Table from '$lib/components/ui/table/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { SearchInput } from '$lib/components/ui/input/index.js';
	import TableEmptyState from '$lib/components/table-empty-state.svelte';
	import MoreHorizontalIcon from '@lucide/svelte/icons/more-horizontal';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { classificationSystemsState } from '$lib/state/classification-systems.svelte.js';
	import type { CostCode } from '$lib/types/index.js';
	import TableHeaderLabel from '../table-header-label.svelte';
	import TableTextCell from '../table-text-cell.svelte';
	import TablePaginationFooter from '../table-pagination-footer.svelte';
	import { tableEmptyStateConfigs } from '../table-empty-state-config.js';
	import {
		tablePreferencesState,
		TABLE_PAGE_SIZE_IDS
	} from '$lib/state/table-preferences.svelte.js';
	import {
		clampTablePageIndex,
		getTablePageCount,
		paginateTableRows
	} from '$lib/utils/table-pagination.js';
	import { Text } from '$lib/components/primitives/index.js';

	interface Props {
		onAdd?: () => void;
		onEdit?: (costCode: CostCode) => void;
	}

	let { onAdd, onEdit }: Props = $props();
	let selectedIds = $state<string[]>([]);
	let costCodeToDelete = $state<CostCode | null>(null);
	let isDeleteDialogOpen = $state(false);
	let isBulkDeleteDialogOpen = $state(false);
	let isBulkDeleting = $state(false);
	let searchQuery = $state('');

	$effect(() => {
		classificationSystemsState.costCodeSearchQuery = searchQuery;
	});
	let pageIndex = $state(0);
	const TABLE_PAGE_SIZE_ID = TABLE_PAGE_SIZE_IDS.costCodes;
	let pageSize = $state<number>(tablePreferencesState.getCachedPageSize(TABLE_PAGE_SIZE_ID));

	const filteredRows = $derived.by(() => {
		const list = classificationSystemsState.costCodes;
		if (!searchQuery.trim()) return list;
		const q = searchQuery.toLowerCase().trim();
		return list.filter(
			(item) =>
				item.code.toLowerCase().includes(q) ||
				item.name.toLowerCase().includes(q) ||
				(item.description ?? '').toLowerCase().includes(q)
		);
	});
	const showEmptyState = $derived(filteredRows.length === 0 && searchQuery.trim() === '');
	const visibleRows = $derived(paginateTableRows(filteredRows, pageIndex, pageSize));
	const pageCount = $derived(getTablePageCount(filteredRows.length, pageSize));
	const parentNameById = $derived(
		new Map(classificationSystemsState.costCodes.map((item) => [item.id, item.code]))
	);
	const allVisibleSelected = $derived(
		visibleRows.length > 0 && visibleRows.every((item) => selectedIds.includes(item.id))
	);
	const someVisibleSelected = $derived(
		visibleRows.some((item) => selectedIds.includes(item.id)) && !allVisibleSelected
	);

	$effect(() => {
		const visibleIds = new Set(filteredRows.map((item) => item.id));
		const next = selectedIds.filter((id) => visibleIds.has(id));
		if (next.length !== selectedIds.length) {
			selectedIds = next;
			if (next.length === 0) isBulkDeleteDialogOpen = false;
		}
	});

	$effect(() => {
		const nextPageIndex = clampTablePageIndex(pageIndex, filteredRows.length, pageSize);
		if (nextPageIndex !== pageIndex) {
			pageIndex = nextPageIndex;
		}
	});

	$effect(() => {
		let cancelled = false;
		const initialPageSize = pageSize;

		void tablePreferencesState.hydratePageSize(TABLE_PAGE_SIZE_ID).then((resolvedPageSize) => {
			if (cancelled || pageSize !== initialPageSize || resolvedPageSize === initialPageSize) return;
			pageSize = resolvedPageSize;
			pageIndex = 0;
		});

		return () => {
			cancelled = true;
		};
	});

	function toggleSelected(id: string, checked: boolean) {
		selectedIds = checked ? [...selectedIds, id] : selectedIds.filter((value) => value !== id);
	}

	function toggleAllVisible(checked: boolean) {
		selectedIds = checked
			? Array.from(new Set([...selectedIds, ...visibleRows.map((item) => item.id)]))
			: selectedIds.filter((id) => !visibleRows.some((item) => item.id === id));
	}

	async function handleBulkDelete() {
		if (selectedIds.length === 0) return;
		isBulkDeleting = true;
		try {
			await classificationSystemsState.bulkDeleteCostCodes(selectedIds);
			selectedIds = [];
			isBulkDeleteDialogOpen = false;
		} finally {
			isBulkDeleting = false;
		}
	}
</script>

{#if showEmptyState}
	<div class="flex min-h-0 flex-1">
		<TableEmptyState
			config={tableEmptyStateConfigs.costCodes}
			onCreate={() => onAdd?.()}
			class="flex-1"
		/>
	</div>
{:else}
	<div class="ui-table-page">
		<div class="ui-table-toolbar">
			<SearchInput
				placeholder="Search cost codes..."
				size="sm"
				bind:value={searchQuery}
				class="ui-table-toolbar-search"
			/>
			<Button size="sm" class="gap-1.5" onclick={() => onAdd?.()}>
				<PlusIcon class="size-3.5" />
				Add Cost Code
			</Button>
		</div>

		<div class="ui-table-shell">
			<div class="ui-table-shell-body scrollbar-activate-x">
				<Table.Root>
					<Table.Header class="ui-table-header-sticky">
						<Table.Row>
							<Table.Head class="w-10 px-3">
								<div class="flex justify-center">
									<Checkbox
										checked={allVisibleSelected}
										indeterminate={someVisibleSelected}
										onCheckedChange={(checked) => toggleAllVisible(!!checked)}
									/>
								</div>
							</Table.Head>
							<Table.Head><TableHeaderLabel text="Code" /></Table.Head>
							<Table.Head><TableHeaderLabel text="Name" /></Table.Head>
							<Table.Head><TableHeaderLabel text="Parent" /></Table.Head>
							<Table.Head><TableHeaderLabel text="Active" align="center" /></Table.Head>
							<Table.Head><TableHeaderLabel text="Order" align="right" /></Table.Head>
							<Table.Head class="w-12 px-1"></Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#if visibleRows.length > 0}
							{#each visibleRows as costCode (costCode.id)}
								<Table.Row data-state={selectedIds.includes(costCode.id) ? 'selected' : undefined}>
									<Table.Cell class="px-3">
										<div class="flex justify-center">
											<Checkbox
												checked={selectedIds.includes(costCode.id)}
												onCheckedChange={(checked) => toggleSelected(costCode.id, !!checked)}
											/>
										</div>
									</Table.Cell>
									<Table.Cell><TableTextCell text={costCode.code} /></Table.Cell>
									<Table.Cell>
										<div class="flex flex-col">
											<TableTextCell text={costCode.name} />
											<TableTextCell text={costCode.description} tone="secondary" />
										</div>
									</Table.Cell>
									<Table.Cell
										><TableTextCell
											text={costCode.parent_id
												? parentNameById.get(costCode.parent_id)
												: 'Top-level'}
											tone="secondary"
										/></Table.Cell
									>
									<Table.Cell
										><TableTextCell
											text={costCode.is_active ? 'Yes' : 'No'}
											align="center"
											tabular
										/></Table.Cell
									>
									<Table.Cell
										><TableTextCell
											text={costCode.sort_order}
											tone="secondary"
											align="right"
											tabular
										/></Table.Cell
									>
									<Table.Cell class="px-1">
										<div class="flex justify-end">
											<DropdownMenu.Root>
												<DropdownMenu.Trigger>
													{#snippet child({ props })}
														<Button {...props} variant="ghost" size="icon-xs">
															<span class="sr-only">Open menu</span>
															<MoreHorizontalIcon class="size-3.5" />
														</Button>
													{/snippet}
												</DropdownMenu.Trigger>
												<DropdownMenu.Content align="end" class="menu-width-standard">
													<DropdownMenu.Item
														class="gap-2"
														onclick={() => {
															onEdit?.(costCode);
														}}
													>
														<PencilIcon class="muted size-3.5" />
														<span>Edit Cost Code</span>
													</DropdownMenu.Item>
													<DropdownMenu.Separator />
													<DropdownMenu.Item
														class="menu-item-destructive gap-2"
														onclick={() => {
															costCodeToDelete = costCode;
															isDeleteDialogOpen = true;
														}}
													>
														<Trash2Icon class="size-3.5" />
														<span>Delete Cost Code</span>
													</DropdownMenu.Item>
												</DropdownMenu.Content>
											</DropdownMenu.Root>
										</div>
									</Table.Cell>
								</Table.Row>
							{/each}
						{:else}
							<Table.Row>
								<Table.Cell colspan={7} class="h-48 text-center">
									<div class="flex flex-col items-center gap-2 opacity-50">
										<Text tone="muted">No cost codes match the current filters.</Text>
									</div>
								</Table.Cell>
							</Table.Row>
						{/if}
					</Table.Body>
				</Table.Root>
			</div>
		</div>

		<div class="ui-table-pagination">
			<TablePaginationFooter
				selectedCount={selectedIds.length}
				totalCount={filteredRows.length}
				{pageIndex}
				{pageCount}
				{pageSize}
				canPreviousPage={pageIndex > 0}
				canNextPage={pageIndex < pageCount - 1}
				onPageSizeChange={(nextPageSize) => {
					pageSize = nextPageSize;
					pageIndex = 0;
					void tablePreferencesState.setPageSize(TABLE_PAGE_SIZE_ID, nextPageSize);
				}}
				onFirstPage={() => (pageIndex = 0)}
				onPreviousPage={() => (pageIndex = Math.max(0, pageIndex - 1))}
				onNextPage={() => (pageIndex = Math.min(pageCount - 1, pageIndex + 1))}
				onLastPage={() => (pageIndex = Math.max(0, pageCount - 1))}
			/>
		</div>
	</div>
{/if}

{#if selectedIds.length > 0}
	<div class="ui-selection-toolbar-wrap">
		<div class="ui-selection-toolbar">
			<Text as="span" tone="muted">
				{selectedIds.length} Cost Code{selectedIds.length > 1 ? 's' : ''} selected
			</Text>
			<div class="ui-selection-toolbar-divider"></div>
			<Button variant="ghost" size="sm" onclick={() => (selectedIds = [])}>Clear</Button>
			<Button variant="destructive" size="sm" onclick={() => (isBulkDeleteDialogOpen = true)}>
				<Trash2Icon class="size-3.5" />
				Delete {selectedIds.length} Cost Code{selectedIds.length > 1 ? 's' : ''}
			</Button>
		</div>
	</div>
{/if}

<AlertDialog.Root bind:open={isBulkDeleteDialogOpen}>
	<AlertDialog.Content class="ui-dialog-size-alert">
		<AlertDialog.Header>
			<AlertDialog.Title
				>Delete {selectedIds.length} Cost Code{selectedIds.length > 1
					? 's'
					: ''}?</AlertDialog.Title
			>
			<AlertDialog.Description>
				This action cannot be undone. This will permanently delete the selected cost codes and any
				descendant codes nested under them.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={isBulkDeleting}>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				class="action-destructive"
				disabled={isBulkDeleting}
				onclick={handleBulkDelete}
			>
				{isBulkDeleting
					? 'Deleting...'
					: `Delete ${selectedIds.length} Cost Code${selectedIds.length > 1 ? 's' : ''}`}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root bind:open={isDeleteDialogOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete Cost Code</AlertDialog.Title>
			<AlertDialog.Description>
				This action cannot be undone. This will permanently delete <strong
					>{costCodeToDelete?.code}</strong
				> and any descendant codes nested under it.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel onclick={() => (isDeleteDialogOpen = false)}>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				class="action-destructive"
				onclick={() => {
					if (costCodeToDelete) classificationSystemsState.deleteCostCode(costCodeToDelete.id);
					isDeleteDialogOpen = false;
				}}
			>
				Delete Cost Code
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
