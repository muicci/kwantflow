<script lang="ts">
	import * as Table from '$lib/components/ui/table/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import * as Empty from '$lib/components/ui/empty/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { SearchInput } from '$lib/components/ui/input/index.js';
	import MoreHorizontalIcon from '@lucide/svelte/icons/more-horizontal';
	import WorkflowIcon from '@lucide/svelte/icons/workflow';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { wbsState } from '$lib/state/wbs.svelte.js';
	import type { WbsNode } from '$lib/types/index.js';
	import WbsNodeDialog from './wbs-node-dialog.svelte';
	import TableHeaderLabel from '../table-header-label.svelte';
	import TableTextCell from '../table-text-cell.svelte';
	import TablePaginationFooter from '../table-pagination-footer.svelte';
	import { Text } from '$lib/components/primitives/index.js';
	import {
		tablePreferencesState,
		TABLE_PAGE_SIZE_IDS
	} from '$lib/state/table-preferences.svelte.js';
	import {
		clampTablePageIndex,
		getTablePageCount,
		paginateTableRows
	} from '$lib/utils/table-pagination.js';

	interface Props {
		projectId: string;
		onBrowseTemplates?: () => void;
		onSaveTemplate?: () => void;
	}

	let { projectId, onBrowseTemplates, onSaveTemplate }: Props = $props();
	let selectedIds = $state<string[]>([]);
	let nodeToEdit = $state<WbsNode | null>(null);
	let nodeToDelete = $state<WbsNode | null>(null);
	let isAddDialogOpen = $state(false);
	let isEditDialogOpen = $state(false);
	let isDeleteDialogOpen = $state(false);
	let isBulkDeleteDialogOpen = $state(false);
	let isBulkDeleting = $state(false);
	let searchQuery = $state('');

	$effect(() => {
		wbsState.searchQuery = searchQuery;
	});
	let pageIndex = $state(0);
	const TABLE_PAGE_SIZE_ID = TABLE_PAGE_SIZE_IDS.wbs;
	let pageSize = $state<number>(tablePreferencesState.getCachedPageSize(TABLE_PAGE_SIZE_ID));

	const filteredRows = $derived.by(() => {
		const list = wbsState.list;
		if (!searchQuery.trim()) return list;
		const q = searchQuery.toLowerCase().trim();
		return list.filter(
			(item) =>
				item.name.toLowerCase().includes(q) ||
				(item.code ?? '').toLowerCase().includes(q) ||
				item.type.toLowerCase().includes(q)
		);
	});
	const showEmptyState = $derived(wbsState.list.length === 0 && searchQuery.trim() === '');
	const visibleRows = $derived(paginateTableRows(filteredRows, pageIndex, pageSize));
	const pageCount = $derived(getTablePageCount(filteredRows.length, pageSize));
	const parentNameById = $derived(new Map(wbsState.list.map((item) => [item.id, item.name])));
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
			await wbsState.bulkDeleteNodes(selectedIds);
			selectedIds = [];
			isBulkDeleteDialogOpen = false;
		} finally {
			isBulkDeleting = false;
		}
	}
</script>

<div class="ui-table-page">
	{#if showEmptyState}
		<div class="flex min-h-0 flex-1 items-center justify-center">
			<Empty.Root class="w-full max-w-3xl px-4 py-8">
				<Empty.Header>
					<Empty.Media variant="icon">
						<WorkflowIcon />
					</Empty.Media>
					<Empty.Title>No structure nodes yet</Empty.Title>
					<Empty.Description>
						Start with a blank project structure or browse a reusable template.
					</Empty.Description>
				</Empty.Header>
				<Empty.Content class="pt-1">
					<div class="flex flex-wrap items-center justify-center gap-2">
						<Button
							variant="filled"
							size="default"
							class="gap-2 px-4 shadow-none"
							onclick={() => (isAddDialogOpen = true)}
						>
							Add Structure Node
						</Button>
						{#if onBrowseTemplates}
							<Button
								variant="secondary"
								size="default"
								class="gap-2 px-4"
								onclick={() => onBrowseTemplates?.()}
							>
								Start from Template
							</Button>
						{/if}
					</div>
				</Empty.Content>
			</Empty.Root>
		</div>
	{:else}
		<div class="ui-table-toolbar">
			<SearchInput
				placeholder="Search structure nodes..."
				bind:value={searchQuery}
				class="ui-table-toolbar-search"
			/>
			<div class="ui-table-toolbar-actions">
				{#if wbsState.list.length > 0 && onSaveTemplate}
					<Button variant="secondary" class="gap-1.5" onclick={() => onSaveTemplate?.()}>
						Save as Template
					</Button>
				{/if}
				<Button class="gap-1.5" onclick={() => (isAddDialogOpen = true)}>
					<PlusIcon class="size-3.5" />
					Add Structure Node
				</Button>
			</div>
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
							<Table.Head><TableHeaderLabel text="Name" /></Table.Head>
							<Table.Head><TableHeaderLabel text="Type" /></Table.Head>
							<Table.Head><TableHeaderLabel text="Parent" /></Table.Head>
							<Table.Head><TableHeaderLabel text="Order" align="right" /></Table.Head>
							<Table.Head class="w-12 px-1"></Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#if visibleRows.length > 0}
							{#each visibleRows as node (node.id)}
								<Table.Row data-state={selectedIds.includes(node.id) ? 'selected' : undefined}>
									<Table.Cell class="px-3">
										<div class="flex justify-center">
											<Checkbox
												checked={selectedIds.includes(node.id)}
												onCheckedChange={(checked) => toggleSelected(node.id, !!checked)}
											/>
										</div>
									</Table.Cell>
									<Table.Cell>
										<div class="flex flex-col">
											<TableTextCell text={node.name} />
											<TableTextCell text={node.code} tone="secondary" />
										</div>
									</Table.Cell>
									<Table.Cell><TableTextCell text={node.type} tone="secondary" /></Table.Cell>
									<Table.Cell
										><TableTextCell
											text={node.parent_id ? parentNameById.get(node.parent_id) : 'Top-level'}
											tone="secondary"
										/></Table.Cell
									>
									<Table.Cell
										><TableTextCell text={node.sort_order} align="right" tabular /></Table.Cell
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
															nodeToEdit = node;
															isEditDialogOpen = true;
														}}
													>
														<PencilIcon class="muted size-3.5" />
														<span>Edit Structure Node</span>
													</DropdownMenu.Item>
													<DropdownMenu.Separator />
													<DropdownMenu.Item
														class="menu-item-destructive gap-2"
														onclick={() => {
															nodeToDelete = node;
															isDeleteDialogOpen = true;
														}}
													>
														<Trash2Icon class="size-3.5" />
														<span>Delete Structure Node</span>
													</DropdownMenu.Item>
												</DropdownMenu.Content>
											</DropdownMenu.Root>
										</div>
									</Table.Cell>
								</Table.Row>
							{/each}
						{:else}
							<Table.Row>
								<Table.Cell colspan={6} class="h-24 text-center">
									<Text as="span" tone="muted">No structure nodes match your search.</Text>
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
	{/if}
</div>

<WbsNodeDialog bind:open={isAddDialogOpen} {projectId} hideTrigger />
<WbsNodeDialog bind:open={isEditDialogOpen} {projectId} node={nodeToEdit} hideTrigger />

{#if selectedIds.length > 0}
	<div class="ui-selection-toolbar-wrap">
		<div class="ui-selection-toolbar">
			<Text as="span" tone="muted">
				{selectedIds.length} Structure Node{selectedIds.length > 1 ? 's' : ''} selected
			</Text>
			<div class="ui-selection-toolbar-divider"></div>
			<Button variant="ghost" size="sm" onclick={() => (selectedIds = [])}>Clear</Button>
			<Button variant="destructive" size="sm" onclick={() => (isBulkDeleteDialogOpen = true)}>
				<Trash2Icon class="size-3.5" />
				Delete {selectedIds.length} Structure Node{selectedIds.length > 1 ? 's' : ''}
			</Button>
		</div>
	</div>
{/if}

<AlertDialog.Root bind:open={isBulkDeleteDialogOpen}>
	<AlertDialog.Content class="ui-dialog-size-alert">
		<AlertDialog.Header>
			<AlertDialog.Title
				>Delete {selectedIds.length} Structure Node{selectedIds.length > 1
					? 's'
					: ''}?</AlertDialog.Title
			>
			<AlertDialog.Description>
				This action cannot be undone. This will permanently delete the selected structure nodes,
				delete their descendant subtree, and clear any linked estimate or takeoff structure
				references.
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
					: `Delete ${selectedIds.length} Structure Node${selectedIds.length > 1 ? 's' : ''}`}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root bind:open={isDeleteDialogOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete Structure Node</AlertDialog.Title>
			<AlertDialog.Description>
				This action cannot be undone. This will permanently delete <strong
					>{nodeToDelete?.name}</strong
				>, delete any descendant structure nodes under it, and clear any linked estimate or takeoff
				structure references.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel onclick={() => (isDeleteDialogOpen = false)}>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				class="action-destructive"
				onclick={() => {
					if (nodeToDelete) wbsState.deleteNode(nodeToDelete.id);
					isDeleteDialogOpen = false;
				}}
			>
				Delete Structure Node
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
