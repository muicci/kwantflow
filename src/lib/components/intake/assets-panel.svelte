<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import UploadIcon from '@lucide/svelte/icons/upload';
	import HardDriveIcon from '@lucide/svelte/icons/hard-drive';
	import FilePlusIcon from '@lucide/svelte/icons/file-plus';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import XIcon from '@lucide/svelte/icons/x';
	import { open as openDialog } from '@tauri-apps/plugin-dialog';
	import { stat } from '@tauri-apps/plugin-fs';
	import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
	import { isTauri } from '$lib/utils/env.js';
	import {
		getGeneralProjectFileSummary,
		getGeneralProjectFileUploadExtensions,
		getGeneralFilePreviewKind,
		isGeneralProjectFileUploadAllowed
	} from '$lib/constants/index.js';
	import { errorState } from '$lib/state/errors.svelte.js';
	import { Meta, Text } from '$lib/components/primitives/index.js';
	import { onMount } from 'svelte';

	export interface StagedFile {
		path: string;
		name: string;
	}

	export interface ExistingFile {
		fileId: string;
		name: string;
		path: string;
	}

	interface Props {
		existingFiles: ExistingFile[];
		newFiles: StagedFile[];
	}

	let { existingFiles = $bindable(), newFiles = $bindable() }: Props = $props();

	let isDraggingOver = $state(false);
	const uploadExtensions = $derived(getGeneralProjectFileUploadExtensions());
	const uploadSummary = $derived(getGeneralProjectFileSummary());

	type SkippedProjectPathReason = 'unsupported_extension' | 'directory' | 'missing_extension';

	type SkippedProjectPath = {
		name: string;
		reason: SkippedProjectPathReason;
	};

	function isAllowedIntakeExtension(ext: string): boolean {
		return isGeneralProjectFileUploadAllowed(`file.${ext}`);
	}

	function describeSkippedPath(entry: SkippedProjectPath): string {
		if (entry.reason === 'directory') return `${entry.name} (folder)`;
		if (entry.reason === 'missing_extension') return `${entry.name} (no supported extension)`;
		return `${entry.name} (unsupported type)`;
	}

	function notifyUnsupportedFiles(skippedPaths: SkippedProjectPath[]) {
		if (skippedPaths.length === 0) return;
		const visibleEntries = skippedPaths.slice(0, 4).map(describeSkippedPath);
		const remainingCount = skippedPaths.length - visibleEntries.length;
		const summary =
			remainingCount > 0
				? `${visibleEntries.join(', ')} +${remainingCount} more`
				: visibleEntries.join(', ');
		void errorState.catchError(
			new Error('Some files were skipped during upload.'),
			'Attach files',
			undefined,
			{
				description: `Attached supported files. Skipped: ${summary}.`
			}
		);
	}

	function fileNameFromPath(path: string): string {
		return path.split(/[/\\]/).pop() || path;
	}

	function fileExtension(path: string): string {
		return fileNameFromPath(path).split('.').pop()?.toLowerCase() || '';
	}

	async function classifyStagedPath(
		path: string
	): Promise<{ type: 'accepted'; path: string } | { type: 'skipped'; entry: SkippedProjectPath }> {
		try {
			const info = await stat(path);
			if (info.isDirectory) {
				return {
					type: 'skipped',
					entry: {
						name: fileNameFromPath(path),
						reason: 'directory'
					}
				};
			}
		} catch {
			// Fall back to extension-based classification when metadata cannot be read.
		}

		const ext = fileExtension(path);
		if (!ext) {
			return {
				type: 'skipped',
				entry: {
					name: fileNameFromPath(path),
					reason: 'missing_extension'
				}
			};
		}

		if (!isAllowedIntakeExtension(ext)) {
			return {
				type: 'skipped',
				entry: {
					name: fileNameFromPath(path),
					reason: 'unsupported_extension'
				}
			};
		}

		return { type: 'accepted', path };
	}

	// Tauri native drag-drop: web File.path is unavailable in webviews
	onMount(() => {
		if (!isTauri()) return;
		const webview = getCurrentWebviewWindow();
		const unlisten = webview.onDragDropEvent(async (event) => {
			if (event.payload.type === 'over') {
				isDraggingOver = true;
			} else if (event.payload.type === 'drop') {
				isDraggingOver = false;
				const paths: string[] = event.payload.paths;
				try {
					const { preprocessIntakeFiles } = await import('$lib/services/intake-preprocessing.js');
					const preprocessed = await preprocessIntakeFiles(paths.map((p) => ({ path: p })));

					const filesToAdd: StagedFile[] = [];
					const skippedList: SkippedProjectPath[] = [];

					for (const result of preprocessed) {
						const classification = await classifyStagedPath(result.path);
						if (classification.type === 'accepted') {
							filesToAdd.push({
								path: result.path,
								name: result.name || fileNameFromPath(result.path)
							});
						} else {
							const originalName = result.name || fileNameFromPath(result.path);
							skippedList.push({
								name: originalName,
								reason: classification.entry.reason
							});
						}
					}

					if (skippedList.length > 0) {
						notifyUnsupportedFiles(skippedList);
					}
					if (filesToAdd.length > 0) {
						newFiles = [...newFiles, ...filesToAdd];
					}
				} catch (err) {
					void errorState.catchError(
						err instanceof Error ? err : new Error(String(err)),
						'Attach files'
					);
				}
			} else if (event.payload.type === 'leave') {
				isDraggingOver = false;
			}
		});
		return () => {
			unlisten.then((fn) => fn());
		};
	});

	async function handleBrowse() {
		if (!isTauri()) return;
		try {
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
				const { preprocessIntakeFiles } = await import('$lib/services/intake-preprocessing.js');
				const preprocessed = await preprocessIntakeFiles(selected.map((p) => ({ path: p })));

				const filesToAdd: StagedFile[] = [];
				const skippedList: SkippedProjectPath[] = [];

				for (const result of preprocessed) {
					const classification = await classifyStagedPath(result.path);
					if (classification.type === 'accepted') {
						filesToAdd.push({
							path: result.path,
							name: result.name || fileNameFromPath(result.path)
						});
					} else {
						const originalName = result.name || fileNameFromPath(result.path);
						skippedList.push({
							name: originalName,
							reason: classification.entry.reason
						});
					}
				}

				if (skippedList.length > 0) {
					notifyUnsupportedFiles(skippedList);
				}
				if (filesToAdd.length > 0) {
					newFiles = [...newFiles, ...filesToAdd];
				}
			}
		} catch (err) {
			void errorState.catchError(
				err instanceof Error ? err : new Error(String(err)),
				'Browse files'
			);
		}
	}

	function removeExisting(fileId: string) {
		existingFiles = existingFiles.filter((f) => f.fileId !== fileId);
	}

	function canPreviewExistingFile(file: ExistingFile): boolean {
		return getGeneralFilePreviewKind(file.path) !== 'none';
	}

	function openExistingFilePreview(fileId: string) {
		void goto(resolve(`/preview/file/${fileId}`));
	}

	function removeNew(name: string, path: string) {
		newFiles = newFiles.filter((f) => !(f.name === name && f.path === path));
	}

	function handleDragOver(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
	}

	function handleDragLeave(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
	}
</script>

<div
	role="region"
	aria-label="File upload drop zone"
	class="flex min-h-0 flex-col gap-4"
	ondragover={handleDragOver}
	ondragleave={handleDragLeave}
>
	<!-- Upload Area -->
	<button
		type="button"
		onclick={handleBrowse}
		class={`ui-upload-dropzone ${isDraggingOver ? 'ui-upload-dropzone-active' : ''}`}
	>
		<UploadIcon class="muted size-8" />
		<div class="flex max-w-3xl flex-col items-center gap-2 text-center">
			<Text>{isDraggingOver ? 'Drop files now' : 'Drop project files here or click to browse'}</Text
			>
			<Meta>{uploadSummary}</Meta>
		</div>
	</button>

	{#if existingFiles.length > 0 || newFiles.length > 0}
		<!-- Flat File List -->
		<div class="space-y-3">
			<div class="flex items-center justify-between px-1">
				<Text as="span" class="shell-label">Project Files</Text>
			</div>

			<div class="grid gap-1.5 px-1">
				<!-- Existing Files -->
				{#each existingFiles as file (file.fileId)}
					<div class="ui-file-row">
						<div class="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
							<span class="ui-radius-pill size-1.5 shrink-0 bg-success"></span>
							<HardDriveIcon class="size-3.5 shrink-0" />
							<div title={file.name} class="min-w-0 flex-1">
								<Text as="span" class="shell-label min-w-0 truncate">
									{file.name}
								</Text>
							</div>
							<Badge variant="secondary" class="shrink-0">Saved</Badge>
						</div>
						<div class="flex items-center gap-1">
							{#if canPreviewExistingFile(file)}
								<Button
									variant="ghost"
									size="icon"
									class="size-7 shrink-0"
									title="Open preview"
									aria-label={`Open preview for ${file.name}`}
									onclick={() => openExistingFilePreview(file.fileId)}
								>
									<EyeIcon class="size-3.5" />
								</Button>
							{/if}
							<Button
								variant="ghost"
								size="icon"
								class="size-6 shrink-0"
								aria-label={`Remove ${file.name}`}
								onclick={() => removeExisting(file.fileId)}
							>
								<XIcon class="size-3.5" />
							</Button>
						</div>
					</div>
				{/each}

				<!-- New Files -->
				{#each newFiles as file (file.path)}
					<div
						class="ui-radius-md surface-brand-subtle flex items-center gap-3 overflow-hidden border border-dashed border-border/80 px-3 py-2"
					>
						<div class="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
							<FilePlusIcon class="muted-strong size-3.5" />
							<div title={file.name} class="min-w-0 flex-1">
								<Text as="span" class="shell-label min-w-0 truncate">
									{file.name}
								</Text>
							</div>
						</div>
						<Button
							variant="ghost"
							size="icon"
							class="size-6 shrink-0"
							aria-label={`Remove ${file.name}`}
							onclick={() => removeNew(file.name, file.path)}
						>
							<XIcon class="size-3.5" />
						</Button>
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>
