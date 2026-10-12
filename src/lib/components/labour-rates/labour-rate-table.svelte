<script lang="ts">
	import * as Table from '$lib/components/ui/table/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { SearchInput } from '$lib/components/ui/input/index.js';
	import MoreHorizontalIcon from '@lucide/svelte/icons/more-horizontal';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import CopyIcon from '@tabler/icons-svelte/icons/copy';
	import { appState } from '$lib/state/app.svelte.js';
	import { labourRatesState } from '$lib/state/labour-rates.svelte.js';
	import type { LabourRateCard } from '$lib/types/index.js';
	import LabourRateDialog from './labour-rate-dialog.svelte';
	import TableHeaderLabel from '../table-header-label.svelte';
	import TableTextCell from '../table-text-cell.svelte';
	import TablePaginationFooter from '../table-pagination-footer.svelte';
	import SetupTableActions from '../setup-table-actions.svelte';
	import TableEmptyState from '../table-empty-state.svelte';
	import { Text } from '$lib/components/primitives/index.js';
	import { tableEmptyStateConfigs } from '../table-empty-state-config.js';
	import {
		tablePreferencesState,
		TABLE_PAGE_SIZE_IDS
	} from '$lib/state/table-preferences.svelte.js';
	import { formatCurrency, formatDate } from '$lib/utils/format.js';
	import {
		clampTablePageIndex,
		getTablePageCount,
		paginateTableRows
	} from '$lib/utils/table-pagination.js';
	import { LABOUR_RATE_UNIT_OPTIONS } from '$lib/constants/index.js';

	let selectedIds = $state<string[]>([]);
	let labourRateToEdit = $state<LabourRateCard | null>(null);
	let labourRateToDelete = $state<LabourRateCard | null>(null);
	let isAddDialogOpen = $state(false);
	let isEditDialogOpen = $state(false);
	let isDeleteDialogOpen = $state(false);
	let isBulkDeleteDialogOpen = $state(false);

	function formatLinkedCompanies(record: LabourRateCard): string {
		const companies = record.linkedCompanies ?? [];
		if (companies.length === 0) return '';
		const [first] = companies;
		return companies.length === 1
			? first.displayName
			: `${first.displayName} +${companies.length - 1}`;
	}
	let isBulkDeleting = $state(false);
	let searchQuery = $state('');

	$effect(() => {
		labourRatesState.searchQuery = searchQuery;
	});
	let pageIndex = $state(0);
	const TABLE_PAGE_SIZE_ID = TABLE_PAGE_SIZE_IDS.labourRates;
	let pageSize = $state<number>(tablePreferencesState.getCachedPageSize(TABLE_PAGE_SIZE_ID));
	const filteredRows = $derived.by(() => {
		const list = labourRatesState.list;
		if (!searchQuery.trim()) return list;
		const q = searchQuery.toLowerCase().trim();
		return list.filter(
			(item) =>
				item.name.toLowerCase().includes(q) ||
				(item.code ?? '').toLowerCase().includes(q) ||
				(item.category ?? '').toLowerCase().includes(q) ||
				(item.work_center ?? '').toLowerCase().includes(q) ||
				item.unit.toLowerCase().includes(q)
		);
	});
	const showEmptyState = $derived(filteredRows.length === 0 && searchQuery.trim() === '');
	const pageCount = $derived(getTablePageCount(filteredRows.length, pageSize));
	const visibleRows = $derived(paginateTableRows(filteredRows, pageIndex, pageSize));
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
			await labourRatesState.bulkDeleteLabourRates(selectedIds);
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
			config={tableEmptyStateConfigs.labourRates}
			onCreate={() => (isAddDialogOpen = true)}
			onImport={() => appState.openSetupImportDialog()}
			class="flex-1"
		/>
	</div>
{:else}
	<div class="ui-table-page">
		<div class="ui-table-toolbar">
			<div class="ui-table-toolbar-leading">
				<SearchInput
					placeholder="Search labour..."
					bind:value={searchQuery}
					class="ui-table-toolbar-search"
				/>
			</div>
			<SetupTableActions
				createLabel="Create Labour Rate"
				onCreate={() => (isAddDialogOpen = true)}
			/>
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
							<Table.Head><TableHeaderLabel text="Rate" /></Table.Head>
							<Table.Head><TableHeaderLabel text="Companies" /></Table.Head>
							<Table.Head><TableHeaderLabel text="Category" /></Table.Head>
							<Table.Head><TableHeaderLabel text="Work Centre" /></Table.Head>
							<Table.Head><TableHeaderLabel text="Unit" /></Table.Head>
							<Table.Head><TableHeaderLabel text="Active" align="center" /></Table.Head>
							<Table.Head><TableHeaderLabel text="Rate" align="right" /></Table.Head>
							<Table.Head><TableHeaderLabel text="Updated" align="right" /></Table.Head>
							<Table.Head class="w-12 px-1"></Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#if visibleRows.length > 0}
							{#each visibleRows as labourRate (labourRate.id)}
								<Table.Row
									data-state={selectedIds.includes(labourRate.id) ? 'selected' : undefined}
								>
									<Table.Cell class="px-3">
										<div class="flex justify-center">
											<Checkbox
												checked={selectedIds.includes(labourRate.id)}
												onCheckedChange={(checked) => toggleSelected(labourRate.id, !!checked)}
											/>
										</div>
									</Table.Cell>
									<Table.Cell>
										<div class="flex flex-col">
											<TableTextCell text={labourRate.name} />
											<TableTextCell text={labourRate.code} tone="secondary" />
										</div>
									</Table.Cell>
									<Table.Cell
										><TableTextCell
											text={formatLinkedCompanies(labourRate)}
											tone="secondary"
										/></Table.Cell
									>
									<Table.Cell
										><TableTextCell text={labourRate.category} tone="secondary" /></Table.Cell
									>
									<Table.Cell
										><TableTextCell text={labourRate.work_center} tone="secondary" /></Table.Cell
									>
									<Table.Cell
										><TableTextCell
											text={LABOUR_RATE_UNIT_OPTIONS.find(
												(option) => option.value === labourRate.unit
											)?.label ?? labourRate.unit}
											tone="secondary"
										/></Table.Cell
									>
									<Table.Cell
										><TableTextCell
											text={labourRate.is_active ? 'Yes' : 'No'}
											align="center"
											tabular
										/></Table.Cell
									>
									<Table.Cell
										><TableTextCell
											text={formatCurrency(labourRate.default_rate)}
											align="right"
											tabular
										/></Table.Cell
									>
									<Table.Cell
										><TableTextCell
											text={formatDate(labourRate.updated_at)}
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
															labourRateToEdit = labourRate;
															isEditDialogOpen = true;
														}}
													>
														<PencilIcon class="muted size-3.5" />
														<span>Edit Labour Rate</span>
													</DropdownMenu.Item>
													<DropdownMenu.Item
														class="gap-2"
														onclick={() => void labourRatesState.duplicateLabourRate(labourRate.id)}
													>
														<CopyIcon class="muted size-3.5" />
														<span>Duplicate Labour Rate</span>
													</DropdownMenu.Item>
													<DropdownMenu.Separator />
													<DropdownMenu.Item
														class="menu-item-destructive gap-2"
														onclick={() => {
															labourRateToDelete = labourRate;
															isDeleteDialogOpen = true;
														}}
													>
														<Trash2Icon class="size-3.5" />
														<span>Delete Labour Rate</span>
													</DropdownMenu.Item>
												</DropdownMenu.Content>
											</DropdownMenu.Root>
										</div>
									</Table.Cell>
								</Table.Row>
							{/each}
						{:else}
							<Table.Row>
								<Table.Cell colspan={9} class="h-48 text-center">
									<div class="flex flex-col items-center gap-2 opacity-50">
										<Text tone="muted">No labour rates match the current filters.</Text>
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

<LabourRateDialog bind:open={isAddDialogOpen} hideTrigger />
<LabourRateDialog bind:open={isEditDialogOpen} labourRate={labourRateToEdit} hideTrigger />

{#if selectedIds.length > 0}
	<div class="ui-selection-toolbar-wrap">
		<div class="ui-selection-toolbar">
			<Text as="span" tone="muted">
				{selectedIds.length} Labour Rate{selectedIds.length > 1 ? 's' : ''} selected
			</Text>
			<div class="ui-selection-toolbar-divider"></div>
			<Button variant="ghost" size="sm" onclick={() => (selectedIds = [])}>Clear</Button>
			<Button variant="destructive" size="sm" onclick={() => (isBulkDeleteDialogOpen = true)}>
				<Trash2Icon class="size-3.5" />
				Delete {selectedIds.length} Labour Rate{selectedIds.length > 1 ? 's' : ''}
			</Button>
		</div>
	</div>
{/if}

<AlertDialog.Root bind:open={isBulkDeleteDialogOpen}>
	<AlertDialog.Content class="ui-dialog-size-alert">
		<AlertDialog.Header>
			<AlertDialog.Title
				>Delete {selectedIds.length} Labour Rate{selectedIds.length > 1
					? 's'
					: ''}?</AlertDialog.Title
			>
			<AlertDialog.Description>
				This action cannot be undone. This will permanently delete the selected labour rate cards.
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
					: `Delete ${selectedIds.length} Labour Rate${selectedIds.length > 1 ? 's' : ''}`}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root bind:open={isDeleteDialogOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete Labour Rate</AlertDialog.Title>
			<AlertDialog.Description>
				This action cannot be undone. This will permanently delete <strong
					>{labourRateToDelete?.name}</strong
				>.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel onclick={() => (isDeleteDialogOpen = false)}>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				class="action-destructive"
				onclick={() => {
					if (labourRateToDelete) labourRatesState.deleteLabourRate(labourRateToDelete.id);
					isDeleteDialogOpen = false;
				}}
			>
				Delete Labour Rate
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
