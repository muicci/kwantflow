<script lang="ts">
	import CopyIcon from '@tabler/icons-svelte/icons/copy';
	import MoreHorizontalIcon from '@lucide/svelte/icons/more-horizontal';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';

	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import { SearchInput } from '$lib/components/ui/input/index.js';
	import BooleanStateBadge from '../boolean-state-badge.svelte';
	import TableEmptyState from '../table-empty-state.svelte';
	import TableHeaderLabel from '../table-header-label.svelte';
	import TablePaginationFooter from '../table-pagination-footer.svelte';
	import SetupTableActions from '../setup-table-actions.svelte';
	import TableTextCell from '../table-text-cell.svelte';
	import { Text } from '$lib/components/primitives/index.js';
	import { tableEmptyStateConfigs } from '../table-empty-state-config.js';
	import { appState } from '$lib/state/app.svelte.js';
	import { subcontractRatesState } from '$lib/state/subcontract-rates.svelte.js';
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
	import { SUBCONTRACT_RATE_UNIT_OPTIONS } from '$lib/constants/index.js';
	import type { SubcontractRateCard } from '$lib/types/index.js';
	import SubcontractRateDialog from './subcontract-rate-dialog.svelte';

	let selectedIds = $state<string[]>([]);
	let subcontractRateToEdit = $state<SubcontractRateCard | null>(null);
	let subcontractRateToDelete = $state<SubcontractRateCard | null>(null);
	let isEditDialogOpen = $state(false);
	let isDeleteDialogOpen = $state(false);
	let isBulkDeleteDialogOpen = $state(false);
	let isBulkDeleting = $state(false);
	let searchQuery = $state('');

	$effect(() => {
		subcontractRatesState.searchQuery = searchQuery;
	});

	function formatLinkedCompanies(record: SubcontractRateCard): string {
		const companies = record.linkedCompanies ?? [];
		if (companies.length === 0) return '';
		const [first] = companies;
		return companies.length === 1
			? first.displayName
			: `${first.displayName} +${companies.length - 1}`;
	}

	const TABLE_PAGE_SIZE_ID = TABLE_PAGE_SIZE_IDS.subcontractRates;
	let pageIndex = $state(0);
	let pageSize = $state<number>(tablePreferencesState.getCachedPageSize(TABLE_PAGE_SIZE_ID));
	const filteredRows = $derived.by(() => {
		const list = subcontractRatesState.list;
		if (!searchQuery.trim()) return list;
		const q = searchQuery.toLowerCase().trim();
		return list.filter(
			(item) =>
				item.name.toLowerCase().includes(q) ||
				(item.code ?? '').toLowerCase().includes(q) ||
				(item.category ?? '').toLowerCase().includes(q) ||
				item.unit.toLowerCase().includes(q)
		);
	});
	const pageCount = $derived(getTablePageCount(filteredRows.length, pageSize));
	const visibleRows = $derived(paginateTableRows(filteredRows, pageIndex, pageSize));
	const showEmptyState = $derived(subcontractRatesState.list.length === 0);
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
		if (nextPageIndex !== pageIndex) pageIndex = nextPageIndex;
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
			await subcontractRatesState.bulkDeleteSubcontractRates(selectedIds);
			selectedIds = [];
			isBulkDeleteDialogOpen = false;
		} finally {
			isBulkDeleting = false;
		}
	}

	function handleCreateSubcontractRate(): void {
		subcontractRateToEdit = null;
		isEditDialogOpen = true;
	}
</script>

{#if showEmptyState}
	<div class="flex min-h-0 flex-1">
		<TableEmptyState
			config={tableEmptyStateConfigs.subcontractRates}
			onCreate={handleCreateSubcontractRate}
			onImport={() => appState.openSetupImportDialog()}
			class="flex-1"
		/>
	</div>
{:else}
	<div class="ui-table-page">
		<div class="ui-table-toolbar">
			<div class="ui-table-toolbar-leading">
				<SearchInput
					placeholder="Search subcontract..."
					bind:value={searchQuery}
					class="ui-table-toolbar-search"
				/>
			</div>
			<SetupTableActions
				createLabel="Create Subcontract Rate"
				onCreate={handleCreateSubcontractRate}
			/>
		</div>
		<div class="ui-table-shell">
			<div class="ui-table-shell-body">
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
							<Table.Head><TableHeaderLabel text="Unit" /></Table.Head>
							<Table.Head><TableHeaderLabel text="Active" align="center" /></Table.Head>
							<Table.Head><TableHeaderLabel text="Rate" align="right" /></Table.Head>
							<Table.Head><TableHeaderLabel text="Updated" align="right" /></Table.Head>
							<Table.Head class="w-12 px-1"></Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#if visibleRows.length > 0}
							{#each visibleRows as subcontractRate (subcontractRate.id)}
								<Table.Row
									data-state={selectedIds.includes(subcontractRate.id) ? 'selected' : undefined}
								>
									<Table.Cell class="px-3">
										<div class="flex justify-center">
											<Checkbox
												checked={selectedIds.includes(subcontractRate.id)}
												onCheckedChange={(checked) => toggleSelected(subcontractRate.id, !!checked)}
											/>
										</div>
									</Table.Cell>
									<Table.Cell>
										<div class="flex flex-col">
											<TableTextCell text={subcontractRate.name} />
											<TableTextCell text={subcontractRate.code} tone="secondary" />
										</div>
									</Table.Cell>
									<Table.Cell
										><TableTextCell
											text={formatLinkedCompanies(subcontractRate)}
											tone="secondary"
										/></Table.Cell
									>
									<Table.Cell
										><TableTextCell text={subcontractRate.category} tone="secondary" /></Table.Cell
									>
									<Table.Cell>
										<TableTextCell
											text={SUBCONTRACT_RATE_UNIT_OPTIONS.find(
												(option) => option.value === subcontractRate.unit
											)?.label ?? subcontractRate.unit}
											tone="secondary"
										/>
									</Table.Cell>
									<Table.Cell>
										<div class="flex justify-center">
											<BooleanStateBadge
												value={subcontractRate.is_active}
												trueLabel="Active"
												falseLabel="Inactive"
											/>
										</div>
									</Table.Cell>
									<Table.Cell
										><TableTextCell
											text={formatCurrency(subcontractRate.default_rate)}
											align="right"
											tabular
										/></Table.Cell
									>
									<Table.Cell
										><TableTextCell
											text={formatDate(subcontractRate.updated_at)}
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
												<DropdownMenu.Content align="end" class="ui-menu-width-md">
													<DropdownMenu.Item
														class="gap-2"
														onclick={() => {
															subcontractRateToEdit = subcontractRate;
															isEditDialogOpen = true;
														}}
													>
														<PencilIcon class="muted size-3.5" />
														<span>Edit Subcontract Rate</span>
													</DropdownMenu.Item>
													<DropdownMenu.Item
														class="gap-2"
														onclick={() =>
															void subcontractRatesState.duplicateSubcontractRate(
																subcontractRate.id
															)}
													>
														<CopyIcon class="muted size-3.5" />
														<span>Duplicate Subcontract Rate</span>
													</DropdownMenu.Item>
													<DropdownMenu.Separator />
													<DropdownMenu.Item
														class="menu-item-destructive gap-2"
														onclick={() => {
															subcontractRateToDelete = subcontractRate;
															isDeleteDialogOpen = true;
														}}
													>
														<Trash2Icon class="size-3.5" />
														<span>Delete Subcontract Rate</span>
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
										<Text tone="muted">No subcontract rates match the current filters.</Text>
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

<SubcontractRateDialog
	bind:open={isEditDialogOpen}
	subcontractRate={subcontractRateToEdit}
	hideTrigger
/>

<AlertDialog.Root bind:open={isDeleteDialogOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete Subcontract Rate?</AlertDialog.Title>
			<AlertDialog.Description>
				This will permanently remove {subcontractRateToDelete?.name ?? 'this subcontract rate'}.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				class="action-destructive"
				onclick={() => {
					if (subcontractRateToDelete) {
						void subcontractRatesState.deleteSubcontractRate(subcontractRateToDelete.id);
					}
					subcontractRateToDelete = null;
					isDeleteDialogOpen = false;
				}}
			>
				Delete Subcontract Rate
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root bind:open={isBulkDeleteDialogOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete Selected Subcontract Rates?</AlertDialog.Title>
			<AlertDialog.Description>
				This will permanently remove {selectedIds.length} selected subcontract rate{selectedIds.length ===
				1
					? ''
					: 's'}.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={isBulkDeleting}>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				class="action-destructive"
				disabled={isBulkDeleting}
				onclick={() => void handleBulkDelete()}
			>
				{isBulkDeleting ? 'Deleting…' : 'Delete Subcontract Rates'}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
