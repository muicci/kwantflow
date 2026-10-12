<script lang="ts">
	import * as Table from '$lib/components/ui/table/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { SearchInput } from '$lib/components/ui/input/index.js';
	import TableEmptyState from '$lib/components/table-empty-state.svelte';
	import TableHeaderLabel from '$lib/components/table-header-label.svelte';
	import TableTextCell from '$lib/components/table-text-cell.svelte';
	import TablePaginationFooter from '$lib/components/table-pagination-footer.svelte';
	import { tableEmptyStateConfigs } from '$lib/components/table-empty-state-config.js';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import MoreHorizontalIcon from '@lucide/svelte/icons/more-horizontal';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import PlayIcon from '@lucide/svelte/icons/play';
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
	import { projectStructureTemplatesState } from '$lib/state/project-structure-templates.svelte.js';
	import type { ProjectStructureTemplate } from '$lib/types/index.js';
	import ProjectStructureTemplateEditorDialog from './project-structure-template-editor-dialog.svelte';
	import ProjectStructureTemplatePreview from './project-structure-template-preview.svelte';
	import { Text } from '$lib/components/primitives/index.js';

	interface Props {
		projectId: string;
		projectHasStructure: boolean;
		onApplied?: () => Promise<void> | void;
	}

	let { projectId, projectHasStructure, onApplied = () => {} }: Props = $props();
	let selectedIds = $state<string[]>([]);
	let templateToPreview = $state<ProjectStructureTemplate | null>(null);
	let templateToEdit = $state<ProjectStructureTemplate | null>(null);
	let templateToDelete = $state<ProjectStructureTemplate | null>(null);
	let previewOpen = $state(false);
	let editOpen = $state(false);
	let deleteOpen = $state(false);
	let bulkDeleteOpen = $state(false);
	let bulkDeleting = $state(false);
	let searchQuery = $state('');

	$effect(() => {
		projectStructureTemplatesState.searchQuery = searchQuery;
	});
	let pageIndex = $state(0);
	const TABLE_PAGE_SIZE_ID = TABLE_PAGE_SIZE_IDS.projectStructureTemplates;
	let pageSize = $state<number>(tablePreferencesState.getCachedPageSize(TABLE_PAGE_SIZE_ID));

	const filteredRows = $derived.by(() => {
		const list = projectStructureTemplatesState.list;
		if (!searchQuery.trim()) return list;
		const q = searchQuery.toLowerCase().trim();
		return list.filter(
			(item) =>
				item.name.toLowerCase().includes(q) ||
				(item.code ?? '').toLowerCase().includes(q) ||
				item.description.toLowerCase().includes(q)
		);
	});
	const showEmptyState = $derived(
		projectStructureTemplatesState.list.length === 0 && searchQuery.trim() === ''
	);
	const pageCount = $derived(getTablePageCount(filteredRows.length, pageSize));
	const visibleRows = $derived(paginateTableRows(filteredRows, pageIndex, pageSize));
	const allVisibleSelected = $derived(
		visibleRows.length > 0 && visibleRows.every((item) => selectedIds.includes(item.id))
	);
	const someVisibleSelected = $derived(
		visibleRows.some((item) => selectedIds.includes(item.id)) && !allVisibleSelected
	);

	$effect(() => {
		const visibleIds = filteredRows.map((item) => item.id);
		const next = selectedIds.filter((id) => visibleIds.includes(id));
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
			? [...selectedIds, ...visibleRows.map((item) => item.id)].filter(
					(id, index, ids) => ids.indexOf(id) === index
				)
			: selectedIds.filter((id) => !visibleRows.some((item) => item.id === id));
	}

	async function handleApply(templateId: string) {
		await projectStructureTemplatesState.applyTemplateToProject(templateId, projectId);
		await onApplied();
	}

	async function handleBulkDelete() {
		if (selectedIds.length === 0) return;
		bulkDeleting = true;
		try {
			await projectStructureTemplatesState.bulkDeleteTemplates(selectedIds);
			selectedIds = [];
			bulkDeleteOpen = false;
		} finally {
			bulkDeleting = false;
		}
	}
</script>

<div class="ui-table-page">
	{#if showEmptyState}
		<div class="flex min-h-0 flex-1 items-center justify-center">
			<TableEmptyState
				config={tableEmptyStateConfigs.projectStructureTemplates}
				onCreate={() => {
					templateToEdit = null;
					editOpen = true;
				}}
				class="w-full"
			/>
		</div>
	{:else}
		<div class="ui-table-toolbar">
			<div class="ui-table-toolbar-leading">
				<SearchInput
					placeholder="Search templates..."
					bind:value={searchQuery}
					class="ui-table-toolbar-search"
				/>
				<div class="field-copy ui-table-toolbar-note">
					{projectHasStructure
						? 'Apply is available only on empty projects.'
						: 'Apply a template to start this project quickly.'}
				</div>
			</div>
			<div class="ui-table-toolbar-actions">
				<Button
					class="gap-1.5"
					onclick={() => {
						templateToEdit = null;
						editOpen = true;
					}}
				>
					<PlusIcon class="size-3.5" />
					Create Template
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
							<Table.Head><TableHeaderLabel text="Template" /></Table.Head>
							<Table.Head><TableHeaderLabel text="Nodes" align="right" /></Table.Head>
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
									<Table.Cell>
										<TableTextCell text={template.nodes.length} align="right" tabular />
									</Table.Cell>
									<Table.Cell>
										<TableTextCell
											text={template.is_active ? 'Yes' : 'No'}
											align="center"
											tabular
										/>
									</Table.Cell>
									<Table.Cell>
										<TableTextCell
											text={formatDate(template.updated_at)}
											tone="secondary"
											align="right"
											tabular
										/>
									</Table.Cell>
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
												<DropdownMenu.Content align="end" class="w-52">
													{#if !projectHasStructure}
														<DropdownMenu.Item
															class="gap-2"
															onclick={() => void handleApply(template.id)}
														>
															<PlayIcon class="muted size-3.5" />
															<span>Apply to Project</span>
														</DropdownMenu.Item>
													{/if}
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
															void projectStructureTemplatesState.duplicateTemplate(template.id)}
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
										<Text tone="muted">No structure templates match the current filters.</Text>
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
	{/if}
</div>

<ProjectStructureTemplatePreview bind:open={previewOpen} template={templateToPreview} />
<ProjectStructureTemplateEditorDialog bind:open={editOpen} template={templateToEdit} />

{#if selectedIds.length > 0}
	<div class="ui-selection-toolbar-wrap">
		<div class="ui-selection-toolbar">
			<Text as="span" tone="muted">
				{selectedIds.length} Structure Template{selectedIds.length > 1 ? 's' : ''} selected
			</Text>
			<div class="ui-selection-toolbar-divider"></div>
			<Button variant="ghost" size="sm" onclick={() => (selectedIds = [])}>Clear</Button>
			<Button variant="destructive" size="sm" onclick={() => (bulkDeleteOpen = true)}>
				<Trash2Icon class="size-3.5" />
				Delete {selectedIds.length} Structure Template{selectedIds.length > 1 ? 's' : ''}
			</Button>
		</div>
	</div>
{/if}

<AlertDialog.Root bind:open={deleteOpen}>
	<AlertDialog.Content class="ui-dialog-size-xs">
		<AlertDialog.Header>
			<AlertDialog.Title>Delete structure template?</AlertDialog.Title>
			<AlertDialog.Description>
				This action cannot be undone. This will permanently delete the structure template.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				class="action-destructive"
				onclick={() => {
					if (templateToDelete)
						void projectStructureTemplatesState.deleteTemplate(templateToDelete.id);
					deleteOpen = false;
				}}
			>
				Delete Template
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root bind:open={bulkDeleteOpen}>
	<AlertDialog.Content class="ui-dialog-size-xs">
		<AlertDialog.Header>
			<AlertDialog.Title>
				Delete {selectedIds.length} Structure Template{selectedIds.length > 1 ? 's' : ''}?
			</AlertDialog.Title>
			<AlertDialog.Description>
				This action cannot be undone. This will permanently delete the selected structure templates.
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
