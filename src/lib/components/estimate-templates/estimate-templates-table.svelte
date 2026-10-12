<script lang="ts">
	import * as Table from '$lib/components/ui/table/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { SearchInput } from '$lib/components/ui/input/index.js';
	import { appState } from '$lib/state/app.svelte.js';
	import TableHeaderLabel from '$lib/components/table-header-label.svelte';
	import TableTextCell from '$lib/components/table-text-cell.svelte';
	import TablePaginationFooter from '$lib/components/table-pagination-footer.svelte';
	import MoreHorizontalIcon from '@lucide/svelte/icons/more-horizontal';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import CopyIcon from '@tabler/icons-svelte/icons/copy';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { formatDate } from '$lib/utils/format.js';
	import {
		clampTablePageIndex,
		getTablePageCount,
		paginateTableRows
	} from '$lib/utils/table-pagination.js';
	import {
		tablePreferencesState,
		TABLE_PAGE_SIZE_IDS
	} from '$lib/state/table-preferences.svelte.js';
	import { estimateTemplatesState } from '$lib/state/estimate-templates.svelte.js';
	import type { EstimateTemplate } from '$lib/types/index.js';
	import EstimateTemplateDialog from './estimate-template-dialog.svelte';
	import EstimateTemplatePreview from './estimate-template-preview.svelte';
	import SetupTableActions from '../setup-table-actions.svelte';
	import TableEmptyState from '../table-empty-state.svelte';
	import { Text } from '$lib/components/primitives/index.js';
	import { tableEmptyStateConfigs } from '../table-empty-state-config.js';

	let selectedIds = $state<string[]>([]);
	let templateToPreview = $state<EstimateTemplate | null>(null);
	let templateToEdit = $state<EstimateTemplate | null>(null);
	let templateToDelete = $state<EstimateTemplate | null>(null);
	let previewOpen = $state(false);
	let editOpen = $state(false);
	let deleteOpen = $state(false);
	let bulkDeleteOpen = $state(false);
	let bulkDeleting = $state(false);
	let searchQuery = $state('');

	$effect(() => {
		estimateTemplatesState.searchQuery = searchQuery;
	});
	let pageIndex = $state(0);
	const TABLE_PAGE_SIZE_ID = TABLE_PAGE_SIZE_IDS.estimateTemplates;
	let pageSize = $state<number>(tablePreferencesState.getCachedPageSize(TABLE_PAGE_SIZE_ID));

	const filteredRows = $derived.by(() => {
		const list = estimateTemplatesState.list;
		if (!searchQuery.trim()) return list;
		const q = searchQuery.toLowerCase().trim();
		return list.filter(
			(item) =>
				item.name.toLowerCase().includes(q) ||
				(item.code ?? '').toLowerCase().includes(q) ||
				item.description.toLowerCase().includes(q) ||
				(item.aliases ?? []).some((alias) => alias.toLowerCase().includes(q))
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
			if (next.length === 0) bulkDeleteOpen = false;
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
		bulkDeleting = true;
		try {
			await estimateTemplatesState.bulkDeleteTemplates(selectedIds);
			selectedIds = [];
			bulkDeleteOpen = false;
		} finally {
			bulkDeleting = false;
		}
	}
</script>

{#if showEmptyState}
	<div class="flex min-h-0 flex-1">
		<TableEmptyState
			config={tableEmptyStateConfigs.estimateTemplates}
			onCreate={() => (editOpen = true)}
			onImport={() => appState.openSetupImportDialog()}
			class="flex-1"
		/>
	</div>
{:else}
	<div class="ui-table-page">
		<div class="ui-table-toolbar">
			<SearchInput
				placeholder="Search templates..."
				bind:value={searchQuery}
				class="ui-table-toolbar-search"
			/>
			<SetupTableActions
				createLabel="Create Estimate Template"
				onCreate={() => (editOpen = true)}
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
							<Table.Head><TableHeaderLabel text="Template" /></Table.Head>
							<Table.Head><TableHeaderLabel text="Items" align="right" /></Table.Head>
							<Table.Head><TableHeaderLabel text="Active" align="center" /></Table.Head>
							<Table.Head><TableHeaderLabel text="Updated" align="right" /></Table.Head>
							<Table.Head class="w-12 px-1"></Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#if visibleRows.length > 0}
							{#each visibleRows as template (template.id)}
								<Table.Row data-state={selectedIds.includes(template.id) ? 'selected' : undefined}>
									<Table.Cell class="px-3">
										<div class="flex justify-center">
											<Checkbox
												checked={selectedIds.includes(template.id)}
												onCheckedChange={(checked) => toggleSelected(template.id, !!checked)}
											/>
										</div>
									</Table.Cell>
									<Table.Cell>
										<div class="flex flex-col">
											<TableTextCell text={template.name} />
											<TableTextCell text={template.code} tone="secondary" />
										</div>
									</Table.Cell>
									<Table.Cell
										><TableTextCell
											text={template.estimate.takeoff_items.length}
											align="right"
											tabular
										/></Table.Cell
									>
									<Table.Cell
										><TableTextCell
											text={template.is_active ? 'Yes' : 'No'}
											align="center"
											tabular
										/></Table.Cell
									>
									<Table.Cell
										><TableTextCell
											text={formatDate(template.updated_at)}
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
															templateToPreview = template;
															previewOpen = true;
														}}
													>
														<EyeIcon class="muted size-3.5" />
														<span>Preview</span>
													</DropdownMenu.Item>
													<DropdownMenu.Item
														class="gap-2"
														onclick={() => {
															templateToEdit = template;
															editOpen = true;
														}}
													>
														<PencilIcon class="muted size-3.5" />
														<span>Edit Template</span>
													</DropdownMenu.Item>
													<DropdownMenu.Item
														class="gap-2"
														onclick={() =>
															void estimateTemplatesState.duplicateTemplate(template.id)}
													>
														<CopyIcon class="muted size-3.5" />
														<span>Duplicate</span>
													</DropdownMenu.Item>
													<DropdownMenu.Separator />
													<DropdownMenu.Item
														class="menu-item-destructive gap-2"
														onclick={() => {
															templateToDelete = template;
															deleteOpen = true;
														}}
													>
														<Trash2Icon class="size-3.5" />
														<span>Delete Template</span>
													</DropdownMenu.Item>
												</DropdownMenu.Content>
											</DropdownMenu.Root>
										</div>
									</Table.Cell>
								</Table.Row>
							{/each}
						{:else}
							<Table.Row>
								<Table.Cell colspan={6} class="h-48 text-center">
									<div class="flex flex-col items-center gap-2 opacity-50">
										<Text tone="muted">No estimate templates match the current filters.</Text>
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

<EstimateTemplatePreview bind:open={previewOpen} template={templateToPreview} />
<EstimateTemplateDialog bind:open={editOpen} template={templateToEdit} />

{#if selectedIds.length > 0}
	<div class="ui-selection-toolbar-wrap">
		<div class="ui-selection-toolbar">
			<Text as="span" tone="muted">
				{selectedIds.length} Estimate Template{selectedIds.length > 1 ? 's' : ''} selected
			</Text>
			<div class="ui-selection-toolbar-divider"></div>
			<Button variant="ghost" size="sm" onclick={() => (selectedIds = [])}>Clear</Button>
			<Button variant="destructive" size="sm" onclick={() => (bulkDeleteOpen = true)}>
				<Trash2Icon class="size-3.5" />
				Delete {selectedIds.length} Estimate Template{selectedIds.length > 1 ? 's' : ''}
			</Button>
		</div>
	</div>
{/if}

<AlertDialog.Root bind:open={deleteOpen}>
	<AlertDialog.Content class="ui-dialog-size-alert">
		<AlertDialog.Header>
			<AlertDialog.Title>Delete estimate template?</AlertDialog.Title>
			<AlertDialog.Description>
				This action cannot be undone. This will permanently delete the estimate template.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				class="action-destructive"
				onclick={() => {
					if (templateToDelete) void estimateTemplatesState.deleteTemplate(templateToDelete.id);
					deleteOpen = false;
				}}
			>
				Delete Template
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root bind:open={bulkDeleteOpen}>
	<AlertDialog.Content class="ui-dialog-size-alert">
		<AlertDialog.Header>
			<AlertDialog.Title
				>Delete {selectedIds.length} Estimate Template{selectedIds.length > 1
					? 's'
					: ''}?</AlertDialog.Title
			>
			<AlertDialog.Description>
				This action cannot be undone. This will permanently delete the selected estimate templates.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				class="action-destructive"
				disabled={bulkDeleting}
				onclick={handleBulkDelete}
			>
				Delete Selected
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
