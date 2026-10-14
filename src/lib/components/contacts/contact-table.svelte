<script lang="ts">
	import * as Table from '$lib/components/ui/table/index.js';
	import { SearchInput } from '$lib/components/ui/input/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import {
		type ColumnDef,
		getCoreRowModel,
		getPaginationRowModel,
		getSortedRowModel,
		getFilteredRowModel,
		type SortingState,
		type ColumnFiltersState,
		type RowSelectionState,
		type VisibilityState,
		type PaginationState,
		type Row
	} from '@tanstack/table-core';
	import {
		createSvelteTable,
		FlexRender,
		renderComponent,
		renderSnippet
	} from '$lib/components/ui/data-table/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import MoreHorizontalIcon from '@lucide/svelte/icons/more-horizontal';
	import UsersIcon from '@lucide/svelte/icons/users';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import MailIcon from '@lucide/svelte/icons/mail';
	import PhoneIcon from '@lucide/svelte/icons/phone';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import GripVerticalIcon from '@lucide/svelte/icons/grip-vertical';
	import { DragDropProvider } from '@dnd-kit-svelte/svelte';
	import { move } from '@dnd-kit/helpers';
	import { useSortable } from '@dnd-kit-svelte/svelte/sortable';
	import { RestrictToVerticalAxis } from '@dnd-kit/abstract/modifiers';
	import type { Attachment } from 'svelte/attachments';
	import { Text } from '$lib/components/primitives/index.js';
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const DndProvider = DragDropProvider as any;

	import DataTableCheckbox from '../rfqs/data-table-checkbox.svelte';
	import ContactDialog from './contact-dialog.svelte';
	import { contactsState } from '$lib/state/contacts.svelte.js';
	import { formatDate } from '$lib/utils/format.js';
	import type { Contact } from '$lib/types/index.js';
	import { toast } from 'svelte-sonner';
	import TablePaginationFooter from '../table-pagination-footer.svelte';
	import TableEmptyState from '../table-empty-state.svelte';
	import { tableEmptyStateConfigs } from '../table-empty-state-config.js';
	import {
		tablePreferencesState,
		TABLE_PAGE_SIZE_IDS
	} from '$lib/state/table-preferences.svelte.js';
	import TableHeaderLabel from '../table-header-label.svelte';
	import TableTextCell from '../table-text-cell.svelte';
	import { appState } from '$lib/state/app.svelte.js';
	import { projectsState } from '$lib/state/projects.svelte.js';
	import SetupTableActions from '../setup-table-actions.svelte';
	import TableViewSelector from '../table-view-selector.svelte';
	import { formatContactRoleLabel } from '$lib/services/contact-normalisation.js';

	const columns: ColumnDef<Contact>[] = [
		{
			id: 'drag',
			header: () => null,
			cell: () => renderSnippet(DragHandle),
			enableSorting: false,
			enableHiding: false
		},
		{
			id: 'select',
			header: ({ table }) =>
				renderComponent(DataTableCheckbox, {
					checked: table.getIsAllPageRowsSelected(),
					indeterminate: table.getIsSomePageRowsSelected(),
					onCheckedChange: (value) => table.toggleAllPageRowsSelected(!!value),
					ariaLabel: 'Select all'
				}),
			cell: ({ row }) =>
				renderComponent(DataTableCheckbox, {
					checked: row.getIsSelected(),
					onCheckedChange: (value) => row.toggleSelected(!!value),
					ariaLabel: 'Select row'
				}),
			enableSorting: false,
			enableHiding: false
		},
		{
			accessorKey: 'display_name',
			header: () => renderComponent(TableHeaderLabel, { text: 'Company' }),
			cell: ({ row }) => renderSnippet(CompanyCell, row.original)
		},
		{
			id: 'company_type',
			header: () => renderComponent(TableHeaderLabel, { text: 'Type' }),
			cell: ({ row }) =>
				renderComponent(TableTextCell, {
					text: formatContactRoleLabel(row.original),
					tone: 'secondary'
				})
		},
		{
			id: 'primary_contact',
			header: () => renderComponent(TableHeaderLabel, { text: 'Primary Contact' }),
			cell: ({ row }) =>
				renderComponent(TableTextCell, {
					text:
						contactsState
							.getLinkedPeople(row.original.id)
							.find((contact) => contact.is_primary_company_contact)?.display_name ?? null,
					tone: 'secondary'
				})
		},
		{
			accessorKey: 'email',
			header: () => renderComponent(TableHeaderLabel, { text: 'Email' }),
			cell: ({ row }) =>
				renderComponent(TableTextCell, { text: row.original.email, tone: 'secondary' })
		},
		{
			accessorKey: 'phone',
			header: () => renderComponent(TableHeaderLabel, { text: 'Phone' }),
			cell: ({ row }) =>
				renderComponent(TableTextCell, { text: row.original.phone, tone: 'secondary' })
		},
		{
			id: 'linked_people',
			header: () => renderComponent(TableHeaderLabel, { text: 'People', align: 'right' }),
			cell: ({ row }) =>
				renderComponent(TableTextCell, {
					text: String(contactsState.getLinkedPeople(row.original.id).length),
					tone: 'secondary',
					align: 'right',
					tabular: true
				})
		},
		{
			id: 'linked_rfqs',
			header: () => renderComponent(TableHeaderLabel, { text: 'RFQs', align: 'right' }),
			cell: ({ row }) =>
				renderComponent(TableTextCell, {
					text: String(
						projectsState.list.filter((project) => project.contact_id === row.original.id).length
					),
					tone: 'secondary',
					align: 'right',
					tabular: true
				})
		},
		{
			accessorKey: 'updated_at',
			header: () => renderComponent(TableHeaderLabel, { text: 'Updated', align: 'right' }),
			cell: ({ row }) =>
				renderComponent(TableTextCell, {
					text: formatDate(row.original.updated_at),
					tone: 'secondary',
					align: 'right',
					tabular: true
				})
		},
		{
			id: 'actions',
			cell: ({ row }) => renderSnippet(DataTableActions, { row }),
			enableSorting: false,
			enableHiding: false
		}
	];

	let sorting = $state<SortingState>([]);
	let columnFilters = $state<ColumnFiltersState>([]);
	let rowSelection = $state<RowSelectionState>({});
	let columnVisibility = $state<VisibilityState>({});
	const TABLE_PAGE_SIZE_ID = TABLE_PAGE_SIZE_IDS.contacts;
	let pagination = $state<PaginationState>({
		pageIndex: 0,
		pageSize: tablePreferencesState.getCachedPageSize(TABLE_PAGE_SIZE_ID)
	});
	let contactToEdit = $state<Contact | null>(null);
	let contactToDelete = $state<Contact | null>(null);
	let isEditDialogOpen = $state(false);
	let isDeleteDialogOpen = $state(false);
	let isBulkDeleteDialogOpen = $state(false);
	let isBulkDeleting = $state(false);
	let activeCompanyFilter = $state<'active' | 'archived' | 'all'>('active');
	let displayData = $state<Contact[]>([]);
	let lastSourceIds = $state('');
	const isManualOrderDisabled = $derived(sorting.length > 0);
	const selectedCount = $derived(Object.keys(rowSelection).length);
	let searchQuery = $state('');

	$effect(() => {
		contactsState.searchQuery = searchQuery;
	});

	const sourceCompanies = $derived.by(() => {
		if (activeCompanyFilter === 'archived') return contactsState.archivedCompanies;
		if (activeCompanyFilter === 'all') return contactsState.allCompanies;
		return contactsState.companies;
	});
	const filteredCompanies = $derived.by(() => {
		const source = sourceCompanies;
		const q = searchQuery.toLowerCase().trim();
		if (!q) return source;
		return source.filter(
			(contact) =>
				contact.name.toLowerCase().includes(q) ||
				(contact.display_name ?? '').toLowerCase().includes(q) ||
				(contact.email ?? '').toLowerCase().includes(q) ||
				(contact.phone ?? '').toLowerCase().includes(q) ||
				(contact.notes ?? '').toLowerCase().includes(q)
		);
	});
	const sourceIds = $derived(filteredCompanies.map((contact) => contact.id).join('|'));
	const showEmptyState = $derived(
		contactsState.allCompanies.length === 0 ||
			(activeCompanyFilter === 'active' && contactsState.companies.length === 0)
	);
	const emptyStateConfig = $derived.by(() => {
		if (contactsState.allCompanies.length === 0) {
			return tableEmptyStateConfigs.contacts;
		}

		return {
			...tableEmptyStateConfigs.contacts,
			title: 'No Active Companies',
			description:
				contactsState.archivedCompanies.length > 0
					? 'Your active list is empty. Archived companies are still available if you need to restore one.'
					: 'Create your first company to start linking RFQs, people, and commercial records.'
		};
	});
	const companyViewOptions = $derived([
		{ value: 'active', label: 'Active', count: contactsState.companies.length },
		{ value: 'archived', label: 'Archived', count: contactsState.archivedCompanies.length },
		{ value: 'all', label: 'All', count: contactsState.allCompanies.length }
	]);

	$effect(() => {
		const source = filteredCompanies;
		if (sourceIds !== lastSourceIds) {
			displayData = [...source];
			rowSelection = {};
			lastSourceIds = sourceIds;
			return;
		}

		const sourceById = new Map(source.map((item) => [item.id, item] as const));
		const reordered = displayData
			.filter((item) => sourceById.has(item.id))
			.map((item) => sourceById.get(item.id) ?? item);
		const seen = new Set(reordered.map((item) => item.id));
		const appended = source.filter((item) => !seen.has(item.id));

		if (
			reordered.length !== displayData.length ||
			appended.length > 0 ||
			reordered.some((item, index) => item !== displayData[index])
		) {
			displayData = [...reordered, ...appended];
		}
	});

	$effect(() => {
		let cancelled = false;
		const initialPageSize = pagination.pageSize;

		void tablePreferencesState.hydratePageSize(TABLE_PAGE_SIZE_ID).then((resolvedPageSize) => {
			if (
				cancelled ||
				pagination.pageSize !== initialPageSize ||
				resolvedPageSize === initialPageSize
			)
				return;
			pagination = { ...pagination, pageIndex: 0, pageSize: resolvedPageSize };
		});

		return () => {
			cancelled = true;
		};
	});

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	async function handleDragEnd(event: any) {
		if (isManualOrderDisabled) return;

		const visibleRows = table.getRowModel().rows.map((row) => row.original);
		const reorderedVisibleRows = move(visibleRows, event);
		const reorderedVisibleIds = reorderedVisibleRows.map((row) => row.id);
		if (
			reorderedVisibleIds.length === 0 ||
			reorderedVisibleIds.every((id, index) => id === visibleRows[index]?.id)
		) {
			return;
		}

		await contactsState.reorderContacts(reorderedVisibleIds);
	}

	function getSelectedContactIds(): string[] {
		return table.getFilteredSelectedRowModel().rows.map((row) => row.original.id);
	}

	async function handleBulkDelete() {
		const selectedIds = getSelectedContactIds();
		if (selectedIds.length === 0) return;

		isBulkDeleting = true;
		try {
			await contactsState.bulkArchiveCompanies(selectedIds);
			rowSelection = {};
			isBulkDeleteDialogOpen = false;
		} finally {
			isBulkDeleting = false;
		}
	}

	async function handleBulkPermanentDelete() {
		const selectedIds = getSelectedContactIds();
		if (selectedIds.length === 0) return;

		isBulkDeleting = true;
		try {
			await contactsState.bulkDeleteArchivedCompanies(selectedIds);
			rowSelection = {};
			isBulkDeleteDialogOpen = false;
		} finally {
			isBulkDeleting = false;
		}
	}

	async function handleBulkRestore() {
		const selectedIds = getSelectedContactIds();
		if (selectedIds.length === 0) return;

		isBulkDeleting = true;
		try {
			await contactsState.bulkRestoreCompanies(selectedIds);
			rowSelection = {};
			isBulkDeleteDialogOpen = false;
		} finally {
			isBulkDeleting = false;
		}
	}

	const table = createSvelteTable({
		get data() {
			return displayData;
		},
		columns,
		state: {
			get pagination() {
				return pagination;
			},
			get sorting() {
				return sorting;
			},
			get columnFilters() {
				return columnFilters;
			},
			get columnVisibility() {
				return columnVisibility;
			},
			get rowSelection() {
				return rowSelection;
			}
		},
		getRowId: (row) => row.id,
		enableRowSelection: true,
		onPaginationChange: (updater) => {
			const nextPagination = typeof updater === 'function' ? updater(pagination) : updater;
			const pageSizeChanged = nextPagination.pageSize !== pagination.pageSize;
			pagination = nextPagination;
			if (pageSizeChanged) {
				void tablePreferencesState.setPageSize(TABLE_PAGE_SIZE_ID, nextPagination.pageSize);
			}
		},
		onSortingChange: (updater) => {
			if (typeof updater === 'function') {
				sorting = updater(sorting);
			} else {
				sorting = updater;
			}
		},
		onColumnFiltersChange: (updater) => {
			if (typeof updater === 'function') {
				columnFilters = updater(columnFilters);
			} else {
				columnFilters = updater;
			}
		},
		onColumnVisibilityChange: (updater) => {
			if (typeof updater === 'function') {
				columnVisibility = updater(columnVisibility);
			} else {
				columnVisibility = updater;
			}
		},
		onRowSelectionChange: (updater) => {
			if (typeof updater === 'function') {
				rowSelection = updater(rowSelection);
			} else {
				rowSelection = updater;
			}
		},
		getCoreRowModel: getCoreRowModel(),
		getPaginationRowModel: getPaginationRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getFilteredRowModel: getFilteredRowModel()
	});

	function handleCreateContact(): void {
		contactToEdit = null;
		isEditDialogOpen = true;
	}
</script>

{#snippet CompanyCell(contact: Contact)}
	<div class="flex min-w-0 flex-col">
		<div class="table-copy truncate">{contact.display_name || contact.name}</div>
		{#if contact.notes && contact.notes.trim().length > 0}
			<div class="mt-0.5 table-caption max-w-[280px] truncate" title={contact.notes}>
				{contact.notes}
			</div>
		{/if}
	</div>
{/snippet}

{#snippet DataTableActions({ row }: { row: { original: Contact } })}
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
			<DropdownMenu.Content align="end" class="ui-menu-width-md ui-radius-lg">
				<DropdownMenu.Item
					onclick={() => {
						contactToEdit = row.original;
						isEditDialogOpen = true;
					}}
					class="gap-2"
				>
					<PencilIcon class="muted size-3.5" />
					<span>Open Company</span>
				</DropdownMenu.Item>
				<DropdownMenu.Item
					onclick={() => void contactsState.duplicateContact(row.original.id)}
					class="gap-2"
				>
					<CopyIcon class="muted size-3.5" />
					<span>Duplicate Company</span>
				</DropdownMenu.Item>
				{#if row.original.email}
					<DropdownMenu.Item
						onclick={() => {
							if (row.original.email) {
								navigator.clipboard.writeText(row.original.email);
								toast.success('Email copied');
							}
						}}
						class="gap-2"
					>
						<MailIcon class="muted size-3.5" />
						<span>Copy Email</span>
					</DropdownMenu.Item>
				{/if}
				{#if row.original.phone}
					<DropdownMenu.Item
						onclick={() => {
							if (row.original.phone) {
								navigator.clipboard.writeText(row.original.phone);
								toast.success('Phone copied');
							}
						}}
						class="gap-2"
					>
						<PhoneIcon class="muted size-3.5" />
						<span>Copy Phone</span>
					</DropdownMenu.Item>
				{/if}
				<DropdownMenu.Separator />
				{#if row.original.is_active === false}
					<DropdownMenu.Item
						class="gap-2"
						onclick={() => void contactsState.restoreCompany(row.original.id)}
					>
						<RotateCcwIcon class="muted size-3.5" />
						<span>Restore Company</span>
					</DropdownMenu.Item>
					<DropdownMenu.Item
						class="menu-item-destructive gap-2"
						onclick={() => {
							contactToDelete = row.original;
							isDeleteDialogOpen = true;
						}}
					>
						<Trash2Icon class="size-3.5" />
						<span>Delete Company</span>
					</DropdownMenu.Item>
				{:else}
					<DropdownMenu.Item
						class="menu-item-destructive gap-2"
						onclick={() => {
							contactToDelete = row.original;
							isDeleteDialogOpen = true;
						}}
					>
						<Trash2Icon class="size-3.5" />
						<span>Archive Company</span>
					</DropdownMenu.Item>
				{/if}
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</div>
{/snippet}

{#snippet DragHandle({ attach }: { attach: Attachment })}
	{#if isManualOrderDisabled}
		<Button variant="ghost" size="icon" class="muted size-6 cursor-not-allowed opacity-50">
			<GripVerticalIcon class="muted size-3.5" />
			<span class="sr-only">Manual reorder is disabled while sorting is active</span>
		</Button>
	{:else}
		<Button
			{@attach attach}
			variant="ghost"
			size="icon"
			class="muted size-6 cursor-grab hover:bg-transparent"
		>
			<GripVerticalIcon class="muted size-3.5" />
			<span class="sr-only">Drag to reorder</span>
		</Button>
	{/if}
{/snippet}

{#snippet DraggableRow({ row, index }: { row: Row<Contact>; index: number })}
	{@const { ref, isDragging, handleRef } = useSortable({
		id: row.original.id,
		index: () => index
	})}
	<Table.Row
		data-state={row.getIsSelected() && 'selected'}
		data-dragging={isDragging.current}
		class="group ui-table-row-draggable"
		{@attach ref}
	>
		{#each row.getVisibleCells() as cell (cell.id)}
			<Table.Cell
				class={cell.column.id === 'drag'
					? 'px-1'
					: cell.column.id === 'select'
						? 'px-2'
						: cell.column.id === 'actions'
							? 'px-1'
							: ''}
			>
				<FlexRender
					attach={handleRef}
					content={cell.column.columnDef.cell}
					context={cell.getContext()}
				/>
			</Table.Cell>
		{/each}
	</Table.Row>
{/snippet}

{#if showEmptyState}
	<div class="flex min-h-0 flex-1">
		<TableEmptyState
			config={emptyStateConfig}
			onCreate={handleCreateContact}
			onImport={() => appState.openSetupImportDialog()}
			secondaryActionLabel={contactsState.archivedCompanies.length > 0 &&
			contactsState.companies.length === 0
				? `Archived (${contactsState.archivedCompanies.length})`
				: undefined}
			onSecondaryAction={contactsState.archivedCompanies.length > 0 &&
			contactsState.companies.length === 0
				? () => (activeCompanyFilter = 'archived')
				: undefined}
			stackSecondaryAction={contactsState.archivedCompanies.length > 0 &&
				contactsState.companies.length === 0}
			class="flex-1"
		/>
	</div>
{:else}
	<div class="ui-table-page">
		<div class="ui-table-toolbar">
			<div class="ui-table-toolbar-leading">
				<TableViewSelector
					ariaLabel="Select company view"
					bind:value={activeCompanyFilter}
					options={companyViewOptions}
				/>
			</div>
			<div class="flex items-center gap-2">
				<SearchInput
					placeholder="Search companies..."
					bind:value={searchQuery}
					class="ui-table-toolbar-search"
				/>
				<SetupTableActions createLabel="Create Company" onCreate={handleCreateContact} />
			</div>
		</div>
		<div class="ui-table-shell">
			<div class="ui-table-shell-body">
				<DndProvider modifiers={[RestrictToVerticalAxis]} onDragEnd={handleDragEnd}>
					<Table.Root>
						<Table.Header class="ui-table-header-sticky">
							{#each table.getHeaderGroups() as headerGroup (headerGroup.id)}
								<Table.Row>
									{#each headerGroup.headers as header (header.id)}
										<Table.Head
											class={header.id === 'drag'
												? 'w-8 px-1'
												: header.id === 'select'
													? 'w-10 px-2'
													: header.id === 'actions'
														? 'w-12 px-1'
														: ''}
										>
											{#if !header.isPlaceholder}
												<FlexRender
													content={header.column.columnDef.header}
													context={header.getContext()}
												/>
											{/if}
										</Table.Head>
									{/each}
								</Table.Row>
							{/each}
						</Table.Header>
						<Table.Body>
							{#if table.getRowModel().rows.length}
								{#each table.getRowModel().rows as row, index (row.id)}
									{@render DraggableRow({ row, index })}
								{/each}
							{:else}
								<Table.Row>
									<Table.Cell colspan={columns.length} class="h-48 text-center">
										<div class="flex flex-col items-center gap-2 opacity-50">
											<UsersIcon class="size-8" />
											<Text tone="muted">
												{activeCompanyFilter === 'archived'
													? 'No archived companies found.'
													: activeCompanyFilter === 'all'
														? 'No companies found.'
														: 'No active companies found.'}
											</Text>
										</div>
									</Table.Cell>
								</Table.Row>
							{/if}
						</Table.Body>
					</Table.Root>
				</DndProvider>
			</div>
		</div>
		<div class="ui-table-pagination">
			<TablePaginationFooter
				selectedCount={table.getFilteredSelectedRowModel().rows.length}
				totalCount={table.getFilteredRowModel().rows.length}
				pageIndex={table.getState().pagination.pageIndex}
				pageCount={table.getPageCount() || 1}
				pageSize={table.getState().pagination.pageSize}
				canPreviousPage={table.getCanPreviousPage()}
				canNextPage={table.getCanNextPage()}
				onPageSizeChange={(nextPageSize) => table.setPageSize(nextPageSize)}
				onFirstPage={() => table.setPageIndex(0)}
				onPreviousPage={() => table.previousPage()}
				onNextPage={() => table.nextPage()}
				onLastPage={() => table.setPageIndex(table.getPageCount() - 1)}
			/>
		</div>
	</div>
{/if}

<ContactDialog bind:open={isEditDialogOpen} contact={contactToEdit} hideTrigger />

{#if selectedCount > 0}
	<div class="ui-selection-toolbar-wrap">
		<div class="ui-selection-toolbar">
			<Text as="span" tone="muted">
				{selectedCount} Compan{selectedCount === 1 ? 'y' : 'ies'} selected
			</Text>
			<div class="ui-selection-toolbar-divider"></div>
			<Button variant="ghost" size="sm" onclick={() => (rowSelection = {})}>Clear</Button>
			{#if activeCompanyFilter === 'archived'}
				<Button
					variant="secondary"
					size="sm"
					class="gap-2"
					onclick={() => (isBulkDeleteDialogOpen = true)}
				>
					<RotateCcwIcon class="size-3.5" />
					Restore {selectedCount} Compan{selectedCount === 1 ? 'y' : 'ies'}
				</Button>
				<Button variant="destructive" size="sm" onclick={() => (isBulkDeleteDialogOpen = true)}>
					<Trash2Icon class="size-3.5" />
					Delete {selectedCount} Compan{selectedCount === 1 ? 'y' : 'ies'}
				</Button>
			{:else if activeCompanyFilter === 'active'}
				<Button variant="destructive" size="sm" onclick={() => (isBulkDeleteDialogOpen = true)}>
					<Trash2Icon class="size-3.5" />
					Archive {selectedCount} Compan{selectedCount === 1 ? 'y' : 'ies'}
				</Button>
			{/if}
		</div>
	</div>
{/if}

<AlertDialog.Root bind:open={isBulkDeleteDialogOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>
				{#if activeCompanyFilter === 'archived'}
					Restore {selectedCount} Compan{selectedCount === 1 ? 'y' : 'ies'}?
				{:else}
					Archive {selectedCount} Compan{selectedCount === 1 ? 'y' : 'ies'}?
				{/if}
			</AlertDialog.Title>
			<AlertDialog.Description>
				{#if activeCompanyFilter === 'archived'}
					Restore returns the selected companies to the default workspace view. Delete permanently
					removes archived companies that no longer have linked people or RFQs.
				{:else}
					Archived companies are hidden from the default workspace view but keep their linked RFQs
					and people history. This will archive <strong
						>{selectedCount} Compan{selectedCount === 1 ? 'y' : 'ies'}</strong
					>.
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={isBulkDeleting}>Cancel</AlertDialog.Cancel>
			{#if activeCompanyFilter === 'archived'}
				<Button
					variant="secondary"
					size="sm"
					class="gap-2"
					disabled={isBulkDeleting}
					onclick={handleBulkRestore}
				>
					{isBulkDeleting ? 'Restoring...' : `Restore ${selectedCount} companies`}
				</Button>
				<AlertDialog.Action
					variant="destructive"
					disabled={isBulkDeleting}
					onclick={handleBulkPermanentDelete}
				>
					{isBulkDeleting ? 'Deleting...' : `Delete ${selectedCount} companies`}
				</AlertDialog.Action>
			{:else}
				<AlertDialog.Action
					variant="destructive"
					disabled={isBulkDeleting}
					onclick={handleBulkDelete}
				>
					{isBulkDeleting ? 'Archiving...' : `Archive ${selectedCount} companies`}
				</AlertDialog.Action>
			{/if}
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root bind:open={isDeleteDialogOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>
				{contactToDelete?.is_active === false ? 'Delete Company' : 'Archive Company'}
			</AlertDialog.Title>
			<AlertDialog.Description>
				{#if contactToDelete?.is_active === false}
					This permanently deletes the archived company <strong
						>{contactToDelete?.display_name || contactToDelete?.name}</strong
					>. Linked people and RFQs must be cleared first.
				{:else}
					This company will be hidden from the default workspace view. Linked RFQs and people will
					be kept. Archive <strong>{contactToDelete?.display_name || contactToDelete?.name}</strong> now?
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel onclick={() => (isDeleteDialogOpen = false)}>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				variant="destructive"
				onclick={() => {
					if (contactToDelete?.is_active === false) {
						void contactsState.deleteArchivedCompany(contactToDelete.id);
					} else if (contactToDelete) {
						void contactsState.archiveCompany(contactToDelete.id);
					}
					isDeleteDialogOpen = false;
				}}
			>
				{contactToDelete?.is_active === false ? 'Delete Company' : 'Archive Company'}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
