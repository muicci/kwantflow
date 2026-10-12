<script lang="ts">
	import type { AssetFile } from '$lib/types/index.js';
	import { getGeneralFilePreviewKind } from '$lib/constants/index.js';
	import FileIcon from '@lucide/svelte/icons/file';
	import { Meta, Text } from '$lib/components/primitives/index.js';
	import ViewerLoadError from './viewer-load-error.svelte';

	interface Props {
		file: AssetFile | null;
		expanded?: boolean;
		allowExpand?: boolean;
		detached?: boolean;
		targetPdfPage?: number | null;
		targetCadViewLabel?: string | null;
		targetLocator?: Record<string, unknown> | null;
		emptyTitle?: string;
		emptyDescription?: string | null;
	}

	let {
		file,
		expanded = $bindable(false),
		allowExpand = true,
		detached = false,
		targetPdfPage = null,
		targetCadViewLabel = null,
		targetLocator = null,
		emptyTitle = 'This file is no longer available.',
		emptyDescription = 'Select another file to continue.'
	}: Props = $props();

	const filePath = $derived(file?.file_path ?? null);
	const fileCategory = $derived(filePath ? getGeneralFilePreviewKind(filePath) : 'none');
	const fileName = $derived(file?.original_name ?? '');
</script>

<div class="ui-viewer-shell flex h-full min-h-0 flex-1 flex-col">
	<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
		{#if file && filePath}
			{#if fileCategory === 'cad'}
				{#await import('./cad-viewer.svelte') then { default: CADViewer }}
					<CADViewer
						{filePath}
						bind:expanded
						{allowExpand}
						{detached}
						targetViewLabel={targetCadViewLabel}
					/>
				{:catch error}
					<ViewerLoadError {error} {fileName} />
				{/await}
			{:else if fileCategory === 'dxf' || fileCategory === 'dwg'}
				{#await import('./cad-2d-viewer.svelte') then { default: Cad2dViewer }}
					<Cad2dViewer {filePath} bind:expanded {allowExpand} {detached} />
				{:catch error}
					<ViewerLoadError {error} {fileName} />
				{/await}
			{:else if fileCategory === 'pdf'}
				{#await import('./pdf-viewer.svelte') then { default: PDFViewer }}
					<PDFViewer {filePath} bind:expanded {allowExpand} {detached} targetPage={targetPdfPage} />
				{:catch error}
					<ViewerLoadError {error} {fileName} />
				{/await}
			{:else if fileCategory === 'image'}
				{#await import('./image-viewer.svelte') then { default: ImageViewer }}
					<ImageViewer {filePath} bind:expanded {allowExpand} {detached} locator={targetLocator} />
				{:catch error}
					<ViewerLoadError {error} {fileName} />
				{/await}
			{:else if fileCategory === 'text'}
				{#await import('./text-viewer.svelte') then { default: TextViewer }}
					<TextViewer {filePath} bind:expanded {allowExpand} {detached} />
				{:catch error}
					<ViewerLoadError {error} {fileName} />
				{/await}
			{:else if fileCategory === 'document'}
				{#await import('./document-viewer.svelte') then { default: DocumentViewer }}
					<DocumentViewer {filePath} bind:expanded {allowExpand} {detached} />
				{:catch error}
					<ViewerLoadError {error} {fileName} />
				{/await}
			{:else if fileCategory === 'spreadsheet'}
				{#await import('./spreadsheet-viewer.svelte') then { default: SpreadsheetViewer }}
					<SpreadsheetViewer {filePath} bind:expanded {allowExpand} {detached} />
				{:catch error}
					<ViewerLoadError {error} {fileName} />
				{/await}
			{:else if fileCategory === 'tiff'}
				{#await import('./tiff-viewer.svelte') then { default: TiffViewer }}
					<TiffViewer {filePath} bind:expanded {allowExpand} {detached} />
				{:catch error}
					<ViewerLoadError {error} {fileName} />
				{/await}
			{:else if fileCategory === 'email'}
				{#await import('./email-file-viewer.svelte') then { default: EmailFileViewer }}
					<EmailFileViewer {filePath} />
				{:catch error}
					<ViewerLoadError {error} {fileName} />
				{/await}
			{:else if fileCategory === 'none'}
				<div class="ui-pane-empty">
					<div class="flex max-w-sm flex-col items-center gap-3 text-center">
						<FileIcon class="muted size-10" />
						<div class="grid gap-1">
							<Text tone="muted">Preview unavailable for this file type.</Text>
							<div title={fileName}>
								<Meta class="truncate">{fileName}</Meta>
							</div>
						</div>
					</div>
				</div>
			{/if}
		{:else}
			<div class="ui-pane-empty">
				<div class="flex max-w-sm flex-col items-center gap-3 text-center">
					<FileIcon class="muted size-10" />
					<div class="grid gap-1">
						<Text tone="muted">{emptyTitle}</Text>
						{#if emptyDescription}
							<Meta>{emptyDescription}</Meta>
						{/if}
					</div>
				</div>
			</div>
		{/if}
	</div>
</div>
