<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import * as Resizable from '$lib/components/ui/resizable/index.js';
	import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import {
		FieldLabel,
		FieldShell,
		Inline,
		Meta,
		SectionLabel,
		Stack,
		Text
	} from '$lib/components/primitives/index.js';
	import { getQuoteEngine } from '$lib/state/quote.svelte.js';
	import { appState } from '$lib/state/app.svelte.js';
	import { projectsState } from '$lib/state/projects.svelte.js';
	import { errorState } from '$lib/state/errors.svelte.js';
	import { MAX_ASSET_FILES } from '$lib/services/ai-drafting.js';
	import { isTauri } from '$lib/utils/env.js';
	import { open as openDialog } from '@tauri-apps/plugin-dialog';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { WORKSPACE_RESIZE_HANDLE_CLASS } from '$lib/components/assets/viewer-layout.js';

	import LayoutGridIcon from '@lucide/svelte/icons/layout-grid';
	import ListIcon from '@lucide/svelte/icons/list';
	import FoldersIcon from '@lucide/svelte/icons/folders';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SplitIcon from '@lucide/svelte/icons/split';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import ArrowUpFromLineIcon from '@lucide/svelte/icons/arrow-up-from-line';
	import MoreHorizontalIcon from '@lucide/svelte/icons/more-horizontal';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import MailIcon from '@lucide/svelte/icons/mail';
	import AssetThumbnail from '$lib/components/assets/asset-thumbnail.svelte';
	function goToEmail(messageId: string) {
		goto(resolve(`/preview/email/${encodeURIComponent(messageId)}`));
	}
	import GroupAssetsDialog from '$lib/components/assets/group-assets-dialog.svelte';

	import type { Asset, AssetFile } from '$lib/types/index.js';
	import {
		getGeneralFilePreviewKind,
		getGeneralProjectFileUploadExtensions
	} from '$lib/constants/index.js';
	import PaperclipIcon from '@lucide/svelte/icons/paperclip';

	type AppHref = `/project/${string}/asset/${string}`;

	let expandedAssets = new SvelteSet<string>();
	let assetNameDrafts = new SvelteMap<string, string>();
	let selectedReviewFileIds = new SvelteSet<string>();

	let { data } = $props();
	const engine = getQuoteEngine();
	const workspaceIsSynced = $derived(projectsState.workspaceProject?.id === data.project.id);
	const workspaceProject = $derived(
		workspaceIsSynced ? (projectsState.workspaceProject ?? data.project) : data.project
	);

	let groupingDialogOpen = $state(false);
	let ungroupConfirmOpen = $state(false);
	let ungroupTargetId = $state<string | null>(null);
	let ungroupFileCount = $state(0);

	const visibleAssets = $derived(workspaceIsSynced ? projectsState.workspaceAssets : data.assets);
	const reviewFiles = $derived(
		workspaceIsSynced ? projectsState.workspaceUnassignedFiles : (data.unassignedFiles ?? [])
	);
	const reviewFileIds = $derived(new Set(reviewFiles.map((file) => file.id)));
	const selectedReviewCount = $derived(
		reviewFiles.reduce((count, file) => count + (selectedReviewFileIds.has(file.id) ? 1 : 0), 0)
	);
	const allReviewSelected = $derived(
		reviewFiles.length > 0 && reviewFiles.every((file) => selectedReviewFileIds.has(file.id))
	);
	const noReviewSelected = $derived(
		reviewFiles.length === 0 || reviewFiles.every((file) => !selectedReviewFileIds.has(file.id))
	);
	const totalFileCount = $derived(
		reviewFiles.length + visibleAssets.reduce((sum, asset) => sum + (asset.files?.length ?? 0), 0)
	);

	const assetPath = (assetId: string): AppHref =>
		`/project/${workspaceProject.id}/asset/${assetId}`;

	$effect(() => {
		const visibleIds = reviewFileIds;
		for (const fileId of Array.from(selectedReviewFileIds)) {
			if (!visibleIds.has(fileId)) {
				selectedReviewFileIds.delete(fileId);
			}
		}
	});

	$effect(() => {
		const visibleAssetIds = new Set(visibleAssets.map((asset) => asset.id));

		for (const asset of visibleAssets) {
			if (!assetNameDrafts.has(asset.id)) {
				assetNameDrafts.set(asset.id, asset.display_name);
			}
		}

		for (const assetId of Array.from(assetNameDrafts.keys())) {
			if (!visibleAssetIds.has(assetId)) {
				assetNameDrafts.delete(assetId);
			}
		}
	});

	function getCurrentSelectedReviewFileIds() {
		return reviewFiles.filter((file) => selectedReviewFileIds.has(file.id)).map((file) => file.id);
	}

	function toggleReviewSelection(fileId: string) {
		if (selectedReviewFileIds.has(fileId)) {
			selectedReviewFileIds.delete(fileId);
		} else if (selectedReviewCount < MAX_ASSET_FILES) {
			selectedReviewFileIds.add(fileId);
		}
	}

	function getFileExtension(filePath: string): string {
		return filePath.split('.').pop()?.toUpperCase() || '';
	}

	function canPreviewReviewFile(file: AssetFile): boolean {
		return getGeneralFilePreviewKind(file.file_path) !== 'none';
	}

	function getReviewFileStatusLabel(): string {
		return 'Awaiting asset grouping';
	}

	function openReviewFilePreview(event: MouseEvent, fileId: string) {
		event.stopPropagation();
		void goto(resolve(`/preview/file/${fileId}`));
	}

	function getAssetThumbnailFile(asset: Asset) {
		if (!asset.files?.length) return null;
		return (
			asset.files.find((file) => file.id === asset.thumbnail_file_id) || asset.files[0] || null
		);
	}

	function getDefaultGroupName() {
		const firstSelected = reviewFiles.find((file) => selectedReviewFileIds.has(file.id));
		if (!firstSelected) return '';
		return firstSelected.original_name.replace(/\.[^/.]+$/, '');
	}

	function getAssetNameDraft(asset: Asset): string {
		return assetNameDrafts.get(asset.id) ?? asset.display_name;
	}

	function assetFileCountLabel(asset: Asset): string {
		const fileCount = asset.files?.length ?? 0;
		if (fileCount === 0) return 'No source files';
		return `${fileCount} file${fileCount === 1 ? '' : 's'}`;
	}

	async function commitAssetName(asset: Asset) {
		const nextName = getAssetNameDraft(asset).trim();

		if (!nextName) {
			assetNameDrafts.set(asset.id, asset.display_name);
			return;
		}

		if (nextName === asset.display_name) return;

		await projectsState.renameAsset(asset.id, nextName);
		assetNameDrafts.set(asset.id, nextName);
		if (!workspaceIsSynced) {
			await projectsState.refreshWorkspaceShell(workspaceProject.id);
		}
	}

	function toggleAllReviewFiles() {
		if (allReviewSelected) {
			selectedReviewFileIds.clear();
			return;
		}

		selectedReviewFileIds.clear();
		for (const file of reviewFiles) {
			selectedReviewFileIds.add(file.id);
		}
	}

	async function performManualGroup(name: string) {
		const fileIds = getCurrentSelectedReviewFileIds();
		if (fileIds.length === 0) return;
		await projectsState.createAssetFromFiles(workspaceProject.id, fileIds, name);
		selectedReviewFileIds.clear();
		if (!workspaceIsSynced) {
			await projectsState.refreshWorkspaceShell(workspaceProject.id);
		}
	}

	function requestUngroup(assetId: string, fileCount: number) {
		ungroupTargetId = assetId;
		ungroupFileCount = fileCount;
		ungroupConfirmOpen = true;
	}

	async function confirmUngroup() {
		if (!ungroupTargetId) return;
		await projectsState.ungroupAsset(ungroupTargetId);
		expandedAssets.delete(ungroupTargetId);
		ungroupTargetId = null;
		ungroupConfirmOpen = false;
		if (!workspaceIsSynced) {
			await projectsState.refreshWorkspaceShell(workspaceProject.id);
		}
	}

	async function performRemoveFile(fileId: string) {
		await projectsState.removeFileFromAsset(fileId);
		if (!workspaceIsSynced) {
			await projectsState.refreshWorkspaceShell(workspaceProject.id);
		}
	}

	async function addSelectedReviewFilesToAsset(assetId: string) {
		const fileIds = getCurrentSelectedReviewFileIds();
		if (fileIds.length === 0) return;
		await projectsState.addFilesToAsset(workspaceProject.id, assetId, fileIds);
		selectedReviewFileIds.clear();
		if (!workspaceIsSynced) {
			await projectsState.refreshWorkspaceShell(workspaceProject.id);
		}
	}

	function toggleExpanded(assetId: string) {
		if (expandedAssets.has(assetId)) {
			expandedAssets.delete(assetId);
		} else {
			expandedAssets.add(assetId);
		}
	}

	function openAssetEstimate(assetId: string) {
		goto(resolve(assetPath(assetId)));
	}

	async function handleAttach() {
		if (!isTauri()) return;
		try {
			const uploadExtensions = getGeneralProjectFileUploadExtensions();
			const selected = await openDialog({
				multiple: true,
				filters: [
					{
						name: 'Engineering Files',
						extensions: [...uploadExtensions]
					}
				]
			});

			if (selected && Array.isArray(selected)) {
				await projectsState.addFilesToProject(
					workspaceProject.id,
					selected.map((p) => ({ path: p }))
				);
				if (!workspaceIsSynced) {
					await projectsState.refreshWorkspaceShell(workspaceProject.id);
				}
			}
		} catch (err) {
			void errorState.catchError(
				err instanceof Error ? err : new Error(String(err)),
				'Attach files'
			);
		}
	}
</script>

<div class="h-full w-full p-2">
	<Resizable.PaneGroup direction="vertical" class="h-full w-full gap-2">
		<Resizable.Pane defaultSize={55} minSize={30}>
			<Resizable.PaneGroup direction="horizontal" class="h-full w-full gap-2">
				<Resizable.Pane defaultSize={40} minSize={25}>
					<div class="relative flex h-full flex-col">
						<div class="ui-pane-card">
							<div class="ui-pane-card-header ui-route-header-sm flex items-center justify-between">
								<SectionLabel>Context</SectionLabel>
								{#if workspaceProject.source_channel === 'email' && workspaceProject.source_email_message_id}
									<Button
										variant="secondary"
										size="sm"
										class="gap-1"
										title="Open source email"
										onclick={() => goToEmail(workspaceProject.source_email_message_id!)}
									>
										<MailIcon class="size-3" />
										<Meta as="span">From email</Meta>
									</Button>
								{/if}
							</div>
							<ScrollArea class="flex-1 overflow-hidden">
								<Stack gap="var(--space-4)" class="p-4">
									<FieldShell>
										<FieldLabel>Content</FieldLabel>
										<Textarea
											value={workspaceProject.content || 'No content provided.'}
											rows={8}
											readonly
											size="sm"
											class="ui-field-readonly-md bg-background"
										/>
									</FieldShell>

									<FieldShell>
										<FieldLabel>Note</FieldLabel>
										<Textarea
											value={workspaceProject.note || 'No notes.'}
											rows={4}
											readonly
											size="sm"
											class="ui-field-readonly-sm bg-background"
										/>
									</FieldShell>
								</Stack>
							</ScrollArea>
						</div>
					</div>
				</Resizable.Pane>

				<Resizable.Handle withHandle class={WORKSPACE_RESIZE_HANDLE_CLASS} />

				<Resizable.Pane defaultSize={60} minSize={30}>
					<div class="relative flex h-full flex-col">
						<div class="ui-pane-card">
							<Inline
								justify="space-between"
								wrap
								class="ui-pane-card-header ui-route-header-sm gap-2"
							>
								<Inline wrap gap="var(--space-3)">
									<Text as="span">{reviewFiles.length} In Review</Text>
									<Meta as="span" class="tabular-nums opacity-60">{totalFileCount} Total</Meta>
								</Inline>

								<Inline wrap justify="flex-end" gap="var(--space-2)">
									<Button variant="secondary" size="sm" class="gap-1.5" onclick={handleAttach}>
										<PaperclipIcon class="size-3.5" />
										Attach Files
									</Button>
									<div class="ui-view-toggle-group">
										<button
											onclick={() => appState.setFilesView('grid')}
											class="ui-view-toggle-button {appState.filesView === 'grid'
												? 'ui-view-toggle-button-active'
												: 'ui-view-toggle-button-inactive'}"
											title="Grid view"
										>
											<LayoutGridIcon class="size-3.5" />
										</button>
										<button
											onclick={() => appState.setFilesView('list')}
											class="ui-view-toggle-button {appState.filesView === 'list'
												? 'ui-view-toggle-button-active'
												: 'ui-view-toggle-button-inactive'}"
											title="List view"
										>
											<ListIcon class="size-3.5" />
										</button>
									</div>
									<Inline
										gap="var(--space-2)"
										class="ui-muted-action ui-radius-md hover-surface-subtle control-copy-sm control-height-sm relative px-2"
									>
										<Checkbox
											id="{workspaceProject.id}-review-files-select-all"
											checked={allReviewSelected}
											indeterminate={!noReviewSelected && !allReviewSelected}
											onCheckedChange={() => toggleAllReviewFiles()}
											aria-label="Select all review files"
										/>
										<label
											class="absolute inset-0 cursor-pointer"
											for="{workspaceProject.id}-review-files-select-all"
										>
											<span class="sr-only">Select all review files</span>
										</label>
										<Text as="span" class="pointer-events-none">
											{selectedReviewCount > 0 ? `${selectedReviewCount} Selected` : 'Select Files'}
										</Text>
									</Inline>

									{#if selectedReviewCount > 0}
										<Button
											size="sm"
											class="gap-1.5 bg-primary text-primary-foreground"
											onclick={() => (groupingDialogOpen = true)}
										>
											<FoldersIcon class="size-3.5" />
											Create Asset ({selectedReviewCount})
										</Button>
									{/if}
								</Inline>
							</Inline>

							<ScrollArea class="flex-1 overflow-hidden">
								{#if appState.filesView === 'grid'}
									<div class="grid grid-cols-2 gap-4 p-4 lg:grid-cols-3 xl:grid-cols-4">
										{#each reviewFiles as file (file.id)}
											{@const selected = selectedReviewFileIds.has(file.id)}
											{@const previewSupported = canPreviewReviewFile(file)}
											<div
												class="group ui-review-grid-card relative aspect-4/5 text-left {selected
													? 'ui-review-grid-card-selected'
													: 'ui-review-grid-card-inactive'}"
											>
												{#if previewSupported}
													<Button
														variant="ghost"
														size="icon"
														class="surface-overlay ui-radius-pill absolute top-2 left-2 z-20 size-7"
														title="Open preview"
														aria-label={`Open preview for ${file.original_name}`}
														onclick={(event) => openReviewFilePreview(event, file.id)}
													>
														<EyeIcon class="size-3.5" />
													</Button>
												{/if}
												<Checkbox
													id="{file.id}-review-file-select"
													class="absolute top-2 right-2 z-20"
													checked={selected}
													onCheckedChange={() => toggleReviewSelection(file.id)}
													aria-label={`Select ${file.original_name} for asset grouping`}
												/>
												<label
													class="absolute inset-0 z-10 cursor-pointer"
													for="{file.id}-review-file-select"
												>
													<span class="sr-only">Select {file.original_name} for asset grouping</span
													>
												</label>
												<div
													class="pointer-events-none flex flex-1 items-center justify-center overflow-hidden"
												>
													<AssetThumbnail filePath={file.file_path} />
												</div>

												<div class="pointer-events-none mt-2">
													<div title={file.original_name}>
														<Text class="shell-label truncate">
															{file.original_name}
														</Text>
													</div>
													<Meta class="truncate opacity-60">{getReviewFileStatusLabel()}</Meta>
												</div>
											</div>
										{:else}
											<Text
												tone="muted"
												class="col-span-full flex h-32 items-center justify-center text-center"
											>
												No files waiting in review.
											</Text>
										{/each}
									</div>
								{:else}
									<Stack gap="var(--space-1)" class="p-4">
										{#each reviewFiles as file (file.id)}
											{@const selected = selectedReviewFileIds.has(file.id)}
											{@const previewSupported = canPreviewReviewFile(file)}
											<div
												class="ui-review-list-row relative min-w-0 text-left {selected
													? ''
													: 'ui-review-list-row-inactive'}"
											>
												<Checkbox
													id="{file.id}-review-file-list-select"
													class="relative z-20 shrink-0"
													checked={selected}
													onCheckedChange={() => toggleReviewSelection(file.id)}
													aria-label={`Select ${file.original_name} for asset grouping`}
												/>
												<label
													class="absolute inset-0 z-10 cursor-pointer"
													for="{file.id}-review-file-list-select"
												>
													<span class="sr-only">Select {file.original_name} for asset grouping</span
													>
												</label>
												<div class="pointer-events-none flex min-w-0 flex-1 flex-col">
													<div title={file.original_name}>
														<Text as="span" class="shell-label truncate">
															{file.original_name}
														</Text>
													</div>
													<Meta as="span" class="truncate opacity-60">
														{getReviewFileStatusLabel()}
													</Meta>
												</div>
												{#if previewSupported}
													<Button
														variant="ghost"
														size="icon"
														class="relative z-20 size-7 shrink-0"
														title="Open preview"
														aria-label={`Open preview for ${file.original_name}`}
														onclick={(event) => openReviewFilePreview(event, file.id)}
													>
														<EyeIcon class="size-3.5" />
													</Button>
												{/if}
												<Badge
													variant="secondary"
													class="pointer-events-none relative z-20 shrink-0"
												>
													{getFileExtension(file.file_path)}
												</Badge>
											</div>
										{:else}
											<Text tone="muted" class="flex h-32 items-center justify-center text-center">
												No files waiting in review.
											</Text>
										{/each}
									</Stack>
								{/if}
							</ScrollArea>
						</div>
					</div>
				</Resizable.Pane>
			</Resizable.PaneGroup>
		</Resizable.Pane>

		<Resizable.Handle withHandle class={WORKSPACE_RESIZE_HANDLE_CLASS} />

		<Resizable.Pane defaultSize={45} minSize={24}>
			<div class="flex h-full flex-col">
				<div class="ui-pane-card">
					<Inline justify="space-between" class="ui-pane-card-header ui-route-header-sm px-4">
						<Inline gap="var(--space-2)">
							<SectionLabel>Assets</SectionLabel>
							<Meta as="span" class="opacity-60">{visibleAssets.length} Total</Meta>
						</Inline>
						<Meta as="span">Open an asset to build its estimate</Meta>
					</Inline>
					<ScrollArea class="flex-1 overflow-hidden">
						<Stack gap="var(--space-1)" class="p-4">
							{#if visibleAssets.length === 0}
								<Text tone="muted" class="flex h-full items-center justify-center text-center">
									Create an asset from the review files above to start estimating.
								</Text>
							{:else}
								{#each visibleAssets as asset, i (asset.id)}
									{@const thumbnailFile = getAssetThumbnailFile(asset)}
									{@const path = thumbnailFile?.file_path ?? ''}
									{@const status = engine.getEstimateStatus(asset.id)}
									<div class="ui-asset-row">
										<Inline gap="var(--space-3)">
											<Inline gap="var(--space-2)" class="w-8 shrink-0">
												<span
													class="ui-radius-pill size-1.5 shrink-0 {status === 'saved'
														? 'bg-success'
														: status === 'dirty'
															? 'bg-warning'
															: 'status-dot-muted'}"
												></span>
												<Meta as="span" class="w-5 shrink-0 text-right tabular-nums">{i + 1}</Meta>
											</Inline>
											<button
												type="button"
												class="ui-asset-thumb-button"
												onclick={() => openAssetEstimate(asset.id)}
												title="Open asset estimate"
											>
												{#if path}
													<AssetThumbnail filePath={path} />
												{:else}
													<Inline justify="center" class="h-full px-2 text-center">
														<Meta as="span">No source file</Meta>
													</Inline>
												{/if}
											</button>

											<Inline gap="var(--space-3)" class="min-w-0 flex-1">
												<Stack gap="var(--space-0-5)" class="min-w-0 flex-1 justify-center">
													<Input
														type="text"
														size="sm"
														class="min-w-0 border-transparent bg-transparent px-1 hover:border-border/70 focus-visible:border-input focus-visible:bg-background focus-visible:ring-0"
														style="max-width:500px"
														bind:value={
															() => getAssetNameDraft(asset),
															(value) => assetNameDrafts.set(asset.id, value)
														}
														title={asset.display_name}
														onblur={() => void commitAssetName(asset)}
														onkeydown={(event) => {
															if (event.key === 'Enter') {
																event.currentTarget.blur();
															} else if (event.key === 'Escape') {
																assetNameDrafts.set(asset.id, asset.display_name);
																event.currentTarget.blur();
															}
														}}
													/>

													<Inline wrap gap="var(--space-2)" class="px-1">
														{#if asset.files && asset.files.length > 1}
															<button
																type="button"
																class="ui-muted-action ui-radius-md hover-surface-subtle inline-flex cursor-pointer items-center gap-1 px-1 py-0.5"
																onclick={() => toggleExpanded(asset.id)}
															>
																{#if expandedAssets.has(asset.id)}
																	<ChevronDownIcon class="size-3.5" />
																{:else}
																	<ChevronRightIcon class="size-3.5" />
																{/if}
																<FoldersIcon class="size-3.5" />
																<Meta as="span">{assetFileCountLabel(asset)}</Meta>
															</button>
														{:else}
															<Meta as="span" class="opacity-60">{assetFileCountLabel(asset)}</Meta>
														{/if}
													</Inline>
												</Stack>

												<Inline gap="var(--space-1)" class="shrink-0">
													<Button
														variant="ghost"
														size="icon"
														class="ui-muted-action size-7 shrink-0"
														onclick={() => openAssetEstimate(asset.id)}
														title="Open asset estimate"
													>
														<ArrowUpFromLineIcon class="size-3.5" />
													</Button>

													<DropdownMenu.Root>
														<DropdownMenu.Trigger>
															{#snippet child({ props })}
																<Button
																	{...props}
																	variant="ghost"
																	size="icon"
																	class="ui-muted-action size-7 shrink-0"
																>
																	<MoreHorizontalIcon class="size-3.5" />
																	<span class="sr-only">More actions</span>
																</Button>
															{/snippet}
														</DropdownMenu.Trigger>
														<DropdownMenu.Content align="end" class="ui-popover-width-sm">
															{#if reviewFiles.length > 0}
																<DropdownMenu.Item
																	disabled={selectedReviewCount === 0 ||
																		(asset.files?.length ?? 0) + selectedReviewCount >
																			MAX_ASSET_FILES}
																	onclick={() => addSelectedReviewFilesToAsset(asset.id)}
																>
																	<PlusIcon class="size-4" />
																	<span
																		>{selectedReviewCount > 0
																			? `Add selected files (${selectedReviewCount})`
																			: 'Add files'}</span
																	>
																</DropdownMenu.Item>
															{/if}
															<DropdownMenu.Item
																class="menu-item-destructive"
																onclick={() => requestUngroup(asset.id, asset.files?.length ?? 0)}
															>
																<SplitIcon class="size-4" />
																<span>Ungroup Asset</span>
															</DropdownMenu.Item>
														</DropdownMenu.Content>
													</DropdownMenu.Root>
												</Inline>
											</Inline>
										</Inline>

										{#if asset.files && asset.files.length > 1 && expandedAssets.has(asset.id)}
											<Stack gap="var(--space-0-5)" class="mt-1 pl-1">
												{#each asset.files as file (file.id)}
													<Inline
														gap="var(--space-2)"
														class="ui-radius-md hover-surface-subtle px-2 py-1"
													>
														<div class="min-w-0 flex-1 overflow-hidden">
															<div title={file.original_name}>
																<Text class="truncate">{file.original_name}</Text>
															</div>
														</div>
														<Button
															variant="ghost"
															size="icon"
															class="ui-muted-action size-7 shrink-0"
															onclick={() => performRemoveFile(file.id)}
															title="Return file to review"
														>
															<ArrowUpFromLineIcon class="size-3.5" />
														</Button>
													</Inline>
												{/each}
											</Stack>
										{/if}
									</div>
								{/each}
							{/if}
						</Stack>
					</ScrollArea>
				</div>
			</div>
		</Resizable.Pane>
	</Resizable.PaneGroup>
</div>

{#if groupingDialogOpen}
	{#key `${selectedReviewCount}:${getDefaultGroupName()}`}
		<GroupAssetsDialog
			bind:open={groupingDialogOpen}
			defaultName={getDefaultGroupName()}
			selectedCount={selectedReviewCount}
			onConfirm={performManualGroup}
		/>
	{/key}
{/if}

<AlertDialog.Root bind:open={ungroupConfirmOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>
				{#if ungroupFileCount > 0}
					Delete asset and return files to review?
				{:else}
					Delete file-less asset?
				{/if}
			</AlertDialog.Title>
			<AlertDialog.Description>
				{#if ungroupFileCount > 0}
					This will return {ungroupFileCount} file{ungroupFileCount === 1 ? '' : 's'} to review and delete
					this asset’s estimate data.
				{:else}
					This will delete this file-less asset and its estimate data.
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel onclick={() => (ungroupConfirmOpen = false)}>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action onclick={confirmUngroup}>Delete asset</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
