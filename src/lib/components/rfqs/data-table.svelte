<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import * as Table from '$lib/components/ui/table/index.js';
	import { SearchInput } from '$lib/components/ui/input/index.js';
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
	import PackageIcon from '@lucide/svelte/icons/package';
	import ArchiveIcon from '@lucide/svelte/icons/archive';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import GripVerticalIcon from '@tabler/icons-svelte/icons/grip-vertical';
	import { DragDropProvider } from '@dnd-kit-svelte/svelte';
	import { move } from '@dnd-kit/helpers';
	import { useSortable } from '@dnd-kit-svelte/svelte/sortable';
	import { RestrictToVerticalAxis } from '@dnd-kit/abstract/modifiers';
	import type { DragEndEvent } from '@dnd-kit/abstract';
	import type { Attachment } from 'svelte/attachments';
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const DndProvider = DragDropProvider as any;

	import DataTableCheckbox from './data-table-checkbox.svelte';
	import PriorityBadge from './priority-badge.svelte';
	import StatusBadge from './status-badge.svelte';
	import ProjectActionsMenu from '../project-actions-menu.svelte';
	import TablePaginationFooter from '../table-pagination-footer.svelte';
	import TableEmptyState from '../table-empty-state.svelte';
	import { tableEmptyStateConfigs } from '../table-empty-state-config.js';
	import {
		tablePreferencesState,
		TABLE_PAGE_SIZE_IDS
	} from '$lib/state/table-preferences.svelte.js';
	import TableHeaderLabel from '../table-header-label.svelte';
	import TableStackCell from '../table-stack-cell.svelte';
	import TableTextCell from '../table-text-cell.svelte';
	import { appState } from '$lib/state/app.svelte.js';
	import { projectsState } from '$lib/state/projects.svelte.js';
	import { getUrgencyLevel, formatRelativeDate } from '$lib/utils/date.js';
	import { formatDate } from '$lib/utils/format.js';
	import {
		getProjectCompanyDisplayName,
		getProjectRequesterDisplayName
	} from '$lib/utils/project-contact.js';
	import { PriorityLevel } from '$lib/constants/index.js';
	import type { Project } from '$lib/types/index.js';
	import TableViewSelector from '../table-view-selector.svelte';
	import SetupTableActions from '../setup-table-actions.svelte';
	import { Text } from '$lib/components/primitives/index.js';

	const columns: ColumnDef<Project>[] = [
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
			accessorKey: 'rfq_number',
			header: () => renderComponent(TableHeaderLabel, { text: 'RFQ Number' }),
			cell: ({ row }) => renderComponent(TableTextCell, { text: row.original.rfq_number })
		},
		{
			accessorKey: 'contact_name',
			header: () => renderComponent(TableHeaderLabel, { text: 'Company' }),
			cell: ({ row }) =>
				renderComponent(TableStackCell, {
					primaryText: getProjectCompanyDisplayName(row.original),
					secondaryText: getProjectRequesterDisplayName(row.original)
				})
		},
		{
			accessorKey: 'project_name',
			header: () => renderComponent(TableHeaderLabel, { text: 'Project Name' }),
			cell: ({ row }) => renderComponent(TableTextCell, { text: row.original.project_name })
		},
		{
			accessorKey: 'priority',
			header: () => renderComponent(TableHeaderLabel, { text: 'Priority' }),
			cell: ({ row }) =>
				renderComponent(PriorityBadge, {
					priority: row.original.priority ?? PriorityLevel.Medium
				})
		},
		{
			accessorKey: 'status',
			header: () => renderComponent(TableHeaderLabel, { text: 'Status' }),
			cell: ({ row }) =>
				renderComponent(StatusBadge, {
					status: row.original.status
				})
		},
		{
			id: 'assets',
			header: () => renderComponent(TableHeaderLabel, { text: 'Files', align: 'right' }),
			cell: ({ row }) =>
				renderComponent(TableTextCell, {
					text: row.original.asset_count || 0,
					align: 'right',
					tabular: true
				})
		},
		{
			accessorKey: 'due_date',
			header: () =>
				renderComponent(TableHeaderLabel, { text: 'Submission Deadline', align: 'right' }),
			cell: ({ row }) => {
				const date = row.original.submission_deadline_at || row.original.due_date;
				if (!date) {
					return renderComponent(TableTextCell, {
						text: '—',
						tone: 'secondary',
						align: 'right',
						tabular: true
					});
				}

				const urgency = getUrgencyLevel(date);
				const relative = formatRelativeDate(date);

				return renderComponent(TableStackCell, {
					primaryText: formatDate(date),
					secondaryText: relative,
					align: 'right',
					tabular: true,
					primaryClass: urgency === 'critical' ? 'text-destructive' : ''
				});
			}
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
	let columnVisibility = $state<VisibilityState>({ due_date: true });
	const TABLE_PAGE_SIZE_ID = TABLE_PAGE_SIZE_IDS.rfqs;
	let pagination = $state<PaginationState>({
		pageIndex: 0,
		pageSize: tablePreferencesState.getCachedPageSize(TABLE_PAGE_SIZE_ID)
	});
	let isBulkDeleteDialogOpen = $state(false);
	let isBulkDeleting = $state(false);
	let activeProjectFilter = $state<'active' | 'archived' | 'all'>('active');
	let displayData = $state<Project[]>([]);
	let lastSourceIds = $state('');
	const isManualOrderDisabled = $derived(sorting.length > 0);
	const selectedCount = $derived(Object.keys(rowSelection).length);
	let searchQuery = $state('');

	$effect(() => {
		projectsState.searchQuery = searchQuery;
	});

	const sourceProjects = $derived.by(() => {
		if (activeProjectFilter === 'archived')
			return projectsState.list.filter((p) => p.status === 'archived');
		if (activeProjectFilter === 'all') return projectsState.list;
		return projectsState.list.filter((p) => p.status !== 'archived');
	});
	const filteredProjects = $derived.by(() => {
		const source = sourceProjects;
		const q = searchQuery.toLowerCase().trim();
		if (!q) return source;
		return source.filter((project) =>
			[
				project.rfq_number,
				project.contact_name ?? '',
				project.contact_name_snapshot ?? '',
				project.requester_contact_name ?? '',
				project.requester_name_snapshot ?? '',
				project.project_name ?? ''
			].some((value) => value.toLowerCase().includes(q))
		);
	});
	const sourceIds = $derived(filteredProjects.map((project) => project.id).join('|'));
	const showEmptyState = $derived(
		activeProjectFilter === 'active' && projectsState.activeProjects.length === 0
	);
	const projectViewOptions = $derived([
		{ value: 'active', label: 'Active', count: projectsState.filtered.length },
		{ value: 'archived', label: 'Archived', count: projectsState.filteredArchived.length },
		{ value: 'all', label: 'All', count: projectsState.filteredAll.length }
	]);

	$effect(() => {
		const source = filteredProjects;
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

	async function handleDragEnd(event: DragEndEvent) {
		if (isManualOrderDisabled) return;

		const visibleRows = table.getRowModel().rows.map((row) => row.original);
		// @ts-expect-error - Event type mismatch from library
		const reorderedVisibleRows = move(visibleRows, event);
		const reorderedVisibleIds = reorderedVisibleRows.map((row) => row.id);
		if (
			reorderedVisibleIds.length === 0 ||
			reorderedVisibleIds.every((id, index) => id === visibleRows[index]?.id)
		) {
			return;
		}

		await projectsState.reorderProjects(reorderedVisibleIds);
	}

	function getSelectedProjectIds(): string[] {
		return table.getFilteredSelectedRowModel().rows.map((row) => row.original.id);
	}

	async function handleBulkDelete() {
		const selectedIds = getSelectedProjectIds();
		if (selectedIds.length === 0) return;

		isBulkDeleting = true;
		try {
			await projectsState.bulkDeleteProjects(selectedIds);
			rowSelection = {};
			isBulkDeleteDialogOpen = false;
		} finally {
			isBulkDeleting = false;
		}
	}

	async function handleBulkArchive() {
		const selectedIds = getSelectedProjectIds();
		if (selectedIds.length === 0) return;

		isBulkDeleting = true;
		try {
			await projectsState.bulkArchiveProjects(selectedIds);
			rowSelection = {};
			isBulkDeleteDialogOpen = false;
		} finally {
			isBulkDeleting = false;
		}
	}

	async function handleBulkRestore() {
		const selectedIds = getSelectedProjectIds();
		if (selectedIds.length === 0) return;

		isBulkDeleting = true;
		try {
			await projectsState.bulkRestoreProjects(selectedIds);
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

	function handleCreateRfq(): void {
		appState.requestShellCreate('rfq');
	}

	function openProject(project: Project): void {
		void projectsState.setActive(project);
		appState.prepareForWorkspaceEntry();
		void goto(resolve(`/project/${project.id}`));
	}
</script>

{#snippet DataTableActions({ row }: { row: { original: Project } })}
	<div class="flex justify-end">
		<ProjectActionsMenu project={row.original} dropdownAlign="end">
			{#snippet triggerSnippet({ props }: { props: Record<string, unknown> })}
				<Button {...props} variant="ghost" size="icon-xs">
					<span class="sr-only">Open menu</span>
					<MoreHorizontalIcon class="size-3.5" />
				</Button>
			{/snippet}
		</ProjectActionsMenu>
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

{#snippet DraggableRow({ row, index }: { row: Row<Project>; index: number })}
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
							: 'cursor-pointer'}
				onclick={(e) => {
					if (['drag', 'select', 'actions'].includes(cell.column.id)) return;
					const target = e.target as HTMLElement;
					if (
						target.closest('button') ||
						target.closest('a') ||
						target.closest('input') ||
						target.closest('[data-slot="checkbox"]')
					) {
						return;
					}
					openProject(row.original);
				}}
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
			config={{
				...(projectsState.list.length === 0
					? {
							...tableEmptyStateConfigs.rfqs,
							importLabel: 'Import Setup Data'
						}
					: {
							...tableEmptyStateConfigs.rfqs,
							title: 'No Active RFQs',
							description:
								projectsState.archivedProjects.length > 0
									? 'Your active RFQ list is empty. Archived RFQs are still available if you need to restore one.'
									: 'Create your first RFQ to start tracking files, estimates, and quote progress.',
							importLabel: 'Import Setup Data'
						})
			}}
			onCreate={handleCreateRfq}
			onImport={() => appState.openSetupImportDialog()}
			secondaryActionLabel={projectsState.archivedProjects.length > 0 &&
			projectsState.activeProjects.length === 0
				? `Archived (${projectsState.archivedProjects.length})`
				: undefined}
			onSecondaryAction={projectsState.archivedProjects.length > 0 &&
			projectsState.activeProjects.length === 0
				? () => (activeProjectFilter = 'archived')
				: undefined}
			stackSecondaryAction={projectsState.archivedProjects.length > 0 &&
				projectsState.activeProjects.length === 0}
			class="flex-1"
		/>
	</div>
{:else}
	<div class="ui-table-page">
		<div class="ui-table-toolbar">
			<div class="ui-table-toolbar-leading">
				<TableViewSelector
					ariaLabel="Select RFQ view"
					bind:value={activeProjectFilter}
					options={projectViewOptions}
				/>
			</div>
			<div class="flex items-center gap-2">
				<SearchInput
					placeholder="Search RFQs..."
					bind:value={searchQuery}
					class="ui-table-toolbar-search"
				/>
				<SetupTableActions createLabel="Create RFQ" onCreate={handleCreateRfq} />
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
											<PackageIcon class="size-8" />
											<Text tone="muted">
												{activeProjectFilter === 'archived'
													? 'No archived RFQs found.'
													: activeProjectFilter === 'all'
														? 'No RFQs found.'
														: 'No active RFQs found.'}
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

{#if selectedCount > 0}
	<div class="ui-selection-toolbar-wrap">
		<div class="ui-selection-toolbar">
			<Text as="span" tone="muted">
				{selectedCount} RFQ{selectedCount > 1 ? 's' : ''} selected
			</Text>
			<div class="ui-selection-toolbar-divider"></div>
			<Button variant="ghost" size="sm" onclick={() => (rowSelection = {})}>Clear</Button>
			{#if activeProjectFilter === 'archived'}
				<Button
					variant="secondary"
					size="sm"
					class="gap-2"
					aria-label="Restore RFQ"
					onclick={() => (isBulkDeleteDialogOpen = true)}
				>
					<RotateCcwIcon class="size-3.5" />
					Restore {selectedCount} RFQ{selectedCount === 1 ? '' : 's'}
				</Button>
				<Button
					variant="destructive"
					size="sm"
					aria-label="Delete RFQ"
					onclick={() => (isBulkDeleteDialogOpen = true)}
				>
					<Trash2Icon class="size-3.5" />
					Delete {selectedCount} RFQ{selectedCount === 1 ? '' : 's'}
				</Button>
			{:else if activeProjectFilter === 'active'}
				<Button
					variant="destructive"
					size="sm"
					aria-label="Archive RFQ"
					onclick={() => (isBulkDeleteDialogOpen = true)}
				>
					<ArchiveIcon class="size-3.5" />
					Archive {selectedCount} RFQ{selectedCount === 1 ? '' : 's'}
				</Button>
			{/if}
		</div>
	</div>
{/if}

<AlertDialog.Root bind:open={isBulkDeleteDialogOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>
				{#if activeProjectFilter === 'archived'}
					Restore or delete {selectedCount} archived RFQ{selectedCount === 1 ? '' : 's'}?
				{:else}
					Archive {selectedCount} RFQ{selectedCount === 1 ? '' : 's'}?
				{/if}
			</AlertDialog.Title>
			<AlertDialog.Description>
				{#if activeProjectFilter === 'archived'}
					Restored RFQs return to the default list. Deleted RFQs are permanently removed with their
					associated data.
				{:else}
					This moves <strong>{selectedCount} RFQ{selectedCount === 1 ? '' : 's'}</strong> out of the default
					RFQ list. You can restore them later or delete them permanently from the archived view.
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={isBulkDeleting}>Cancel</AlertDialog.Cancel>
			{#if activeProjectFilter === 'archived'}
				<Button
					variant="secondary"
					size="sm"
					class="gap-2"
					disabled={isBulkDeleting}
					onclick={handleBulkRestore}
				>
					{isBulkDeleting
						? 'Restoring...'
						: `Restore ${selectedCount} RFQ${selectedCount === 1 ? '' : 's'}`}
				</Button>
				<AlertDialog.Action
					variant="destructive"
					disabled={isBulkDeleting}
					onclick={handleBulkDelete}
				>
					{isBulkDeleting
						? 'Deleting...'
						: `Delete ${selectedCount} RFQ${selectedCount === 1 ? '' : 's'}`}
				</AlertDialog.Action>
			{:else}
				<AlertDialog.Action
					variant="destructive"
					disabled={isBulkDeleting}
					onclick={handleBulkArchive}
				>
					{isBulkDeleting
						? 'Archiving...'
						: `Archive ${selectedCount} RFQ${selectedCount === 1 ? '' : 's'}`}
				</AlertDialog.Action>
			{/if}
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
