<script lang="ts">
	import { getPdfThumbnail } from '$lib/services/pdf-thumbnail';
	import { getCadThumbnail } from '$lib/services/cad-thumbnail';
	import { getAssetUrl } from '$lib/services/assets';
	import {
		disposeDerivedPreview,
		getDerivedPreview,
		type DerivedPreview
	} from '$lib/services/derived-previews.js';
	import { createLogger } from '$lib/services/logger.js';
	import {
		getGeneralFileThumbnailKind,
		type GeneralFileThumbnailKind
	} from '$lib/constants/index.js';

	import BoxIcon from '@lucide/svelte/icons/box';
	import FileIcon from '@lucide/svelte/icons/file';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import SheetIcon from '@lucide/svelte/icons/sheet';
	import { Meta } from '$lib/components/primitives/index.js';

	interface Props {
		filePath: string;
	}

	let { filePath }: Props = $props();

	let thumbUrl: string | null = $state(null);
	let derivedPreview = $state<DerivedPreview | null>(null);
	let activeDerivedPreview: DerivedPreview | null = null;
	let loading = $state(false);
	let error = $state(false);
	let thumbnailRequestId = 0;
	const log = createLogger('assetThumbnail');

	const ext = $derived(filePath.split('.').pop()?.toLowerCase() || '');
	const thumbnailKind = $derived(getGeneralFileThumbnailKind(filePath));

	async function startThumbnailLoad(
		path: string,
		kind: GeneralFileThumbnailKind,
		requestId: number
	) {
		error = false;
		thumbUrl = null;
		loading = true;

		try {
			if (kind === 'pdf' || kind === 'cad') {
				const nextThumbUrl =
					kind === 'pdf' ? await getPdfThumbnail(path) : await getCadThumbnail(path);
				if (requestId !== thumbnailRequestId) return;
				thumbUrl = nextThumbUrl;
				error = !nextThumbUrl;
				return;
			}

			const nextPreview = await getDerivedPreview(path);
			if (requestId !== thumbnailRequestId) {
				disposeDerivedPreview(nextPreview);
				return;
			}
			const previousPreview = activeDerivedPreview;
			activeDerivedPreview = nextPreview;
			derivedPreview = nextPreview;
			disposeDerivedPreview(previousPreview);
		} catch (loadError) {
			if (requestId !== thumbnailRequestId) return;
			log.error(`${kind.toUpperCase()} thumbnail render failed`, { path, error: loadError });
			const previousPreview = activeDerivedPreview;
			activeDerivedPreview = null;
			derivedPreview = null;
			disposeDerivedPreview(previousPreview);
			error = true;
		} finally {
			if (requestId === thumbnailRequestId) {
				loading = false;
			}
		}
	}

	$effect(() => {
		const path = filePath;
		const kind = thumbnailKind;
		thumbnailRequestId += 1;
		const requestId = thumbnailRequestId;
		thumbUrl = null;
		loading = false;
		error = false;

		if (
			kind === 'pdf' ||
			kind === 'cad' ||
			kind === 'dxf' ||
			kind === 'document' ||
			kind === 'spreadsheet' ||
			kind === 'text'
		) {
			void startThumbnailLoad(path, kind, requestId);
		}

		return () => {
			const previousPreview = activeDerivedPreview;
			activeDerivedPreview = null;
			derivedPreview = null;
			disposeDerivedPreview(previousPreview);
		};
	});
</script>

<div class="flex h-full w-full items-center justify-center">
	{#if thumbnailKind === 'pdf'}
		{#if thumbUrl && !loading}
			<img
				src={thumbUrl}
				alt=""
				loading="lazy"
				class="ui-thumbnail-image bg-background drop-shadow"
			/>
		{/if}

		{#if loading}
			<div class="badge-label muted animate-pulse opacity-60">Rendering PDF...</div>
		{/if}

		{#if error && !loading}
			<div class="relative flex flex-col items-center gap-2 opacity-50">
				<FileTextIcon class="muted size-8" />
				<div class="badge-label muted text-center">Thumbnail unavailable</div>
			</div>
		{/if}

		{#if !thumbUrl && !loading && !error}
			<div class="relative flex flex-col items-center gap-2 opacity-60">
				<FileTextIcon class="muted size-8" />
				<div class="badge-label muted text-center">PDF</div>
			</div>
		{/if}
	{:else if thumbnailKind === 'image'}
		<img src={getAssetUrl(filePath)} alt="" loading="lazy" class="ui-thumbnail-image" />
	{:else if thumbnailKind === 'cad'}
		{#if thumbUrl && !loading}
			<img src={thumbUrl} alt="" loading="lazy" class="ui-thumbnail-image" />
		{/if}

		{#if loading}
			<div class="relative flex animate-pulse flex-col items-center gap-2 opacity-60">
				<BoxIcon class="muted h-14 w-14 stroke-1" />
				<span class="badge-label muted relative -top-3">{ext}</span>
			</div>
		{/if}

		{#if error && !loading}
			<div class="relative flex flex-col items-center gap-2">
				<BoxIcon class="muted h-14 w-14 stroke-1" />
				<span class="badge-label muted ui-file-badge ui-file-badge-muted">
					{ext}
				</span>
			</div>
		{/if}

		{#if !thumbUrl && !loading && !error}
			<div class="relative flex flex-col items-center gap-2 opacity-60">
				<BoxIcon class="muted h-14 w-14 stroke-1" />
				<span class="badge-label muted relative -top-3">{ext}</span>
			</div>
		{/if}
	{:else if thumbnailKind === 'dxf'}
		{#if derivedPreview?.kind === 'dxf' && !loading}
			<img src={derivedPreview.svgUrl} alt="" loading="lazy" class="ui-thumbnail-image" />
		{:else if loading}
			<div class="relative flex animate-pulse flex-col items-center gap-2 opacity-60">
				<BoxIcon class="muted h-14 w-14 stroke-1" />
				<span class="badge-label muted relative -top-3">DXF</span>
			</div>
		{:else}
			<div class="relative flex flex-col items-center gap-2 opacity-60">
				<BoxIcon class="muted h-14 w-14 stroke-1" />
				<span class="badge-label muted relative -top-3">DXF</span>
			</div>
		{/if}
	{:else if thumbnailKind === 'document'}
		{#if derivedPreview?.kind === 'document' && !loading}
			<div class="asset-thumb-card ui-derived-preview-card">
				<div class="asset-thumb-header ui-derived-preview-header">
					<FileTextIcon class="size-3.5 shrink-0" />
					<span class="badge-label">DOCX</span>
				</div>
				<div class="asset-thumb-document" dir="ltr">
					<!-- eslint-disable-next-line svelte/no-at-html-tags -->
					{@html derivedPreview.html}
				</div>
			</div>
		{:else}
			<div class="relative flex flex-col items-center gap-2 opacity-60">
				<FileTextIcon class="muted h-10 w-10 stroke-1" />
				<span class="badge-label muted relative -top-2">DOCX</span>
			</div>
		{/if}
	{:else if thumbnailKind === 'spreadsheet'}
		{#if derivedPreview?.kind === 'spreadsheet' && !loading}
			<div class="asset-thumb-card ui-derived-preview-card">
				<div class="asset-thumb-header ui-derived-preview-header">
					<SheetIcon class="size-3.5 shrink-0" />
					<span class="badge-label">XLSX</span>
				</div>
				{#if derivedPreview.sheets[0]}
					<div class="asset-thumb-sheet">
						<div class="asset-thumb-grid asset-thumb-grid-header ui-thumb-grid-divider">
							{#each derivedPreview.sheets[0].headers.slice(0, 3) as header, index (`header:${index}`)}
								<Meta as="span" class="truncate">{header || 'Column'}</Meta>
							{/each}
						</div>
						{#each derivedPreview.sheets[0].rows.slice(0, 3) as row, rowIndex (`row:${rowIndex}`)}
							<div class="asset-thumb-grid ui-thumb-grid-divider">
								{#each row.slice(0, 3) as cell, cellIndex (`${rowIndex}:${cellIndex}`)}
									<Meta as="span" class="truncate">{cell || '—'}</Meta>
								{/each}
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{:else}
			<div class="relative flex flex-col items-center gap-2 opacity-60">
				<SheetIcon class="muted h-10 w-10 stroke-1" />
				<span class="badge-label muted relative -top-2">XLSX</span>
			</div>
		{/if}
	{:else if thumbnailKind === 'text'}
		{#if derivedPreview?.kind === 'text' && !loading}
			<div class="asset-thumb-card ui-derived-preview-card">
				<div class="asset-thumb-header ui-derived-preview-header">
					<FileTextIcon class="size-3.5 shrink-0" />
					<span class="badge-label">{ext.toUpperCase()}</span>
					<Meta as="span" class="tabular-nums">{derivedPreview.lineCount} lines</Meta>
				</div>
				<div class="asset-thumb-text">
					{#each derivedPreview.lines as line, index (`line:${index}`)}
						<Meta class="truncate">{line}</Meta>
					{/each}
					{#if derivedPreview.truncated}
						<Meta>More content available…</Meta>
					{/if}
				</div>
			</div>
		{:else}
			<div class="relative flex flex-col items-center gap-2 opacity-60">
				<FileTextIcon class="muted h-10 w-10 stroke-1" />
				<span class="badge-label muted relative -top-2">{ext.toUpperCase()}</span>
			</div>
		{/if}
	{:else}
		<div class="relative flex flex-col items-center gap-2">
			<FileIcon class="muted h-10 w-10 stroke-1" />
			<span class="badge-label muted relative -top-2">{ext.toUpperCase()}</span>
		</div>
	{/if}
</div>

<style>
	.asset-thumb-card {
		display: flex;
		height: 100%;
		width: 100%;
		flex-direction: column;
		overflow: hidden;
	}

	.asset-thumb-header {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.5rem;
	}

	.asset-thumb-document,
	.asset-thumb-sheet,
	.asset-thumb-text {
		flex: 1;
		overflow: hidden;
		padding: 0.5rem;
	}

	.asset-thumb-document {
		color: inherit;
	}

	.asset-thumb-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.375rem;
		padding: 0.375rem 0;
	}

	.asset-thumb-grid:first-child {
		padding-top: 0;
	}

	.asset-thumb-grid:last-child {
		border-bottom: none;
		padding-bottom: 0;
	}

	.asset-thumb-grid-header {
		color: inherit;
	}

	.asset-thumb-text {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	:global(.asset-thumb-document h1),
	:global(.asset-thumb-document h2),
	:global(.asset-thumb-document h3),
	:global(.asset-thumb-document h4),
	:global(.asset-thumb-document p),
	:global(.asset-thumb-document ul),
	:global(.asset-thumb-document ol),
	:global(.asset-thumb-document table) {
		margin: 0 0 0.5rem;
	}

	:global(.asset-thumb-document table) {
		width: 100%;
		border-collapse: collapse;
	}

	:global(.asset-thumb-document th),
	:global(.asset-thumb-document td) {
		border: 1px solid currentColor;
		padding: 0.25rem;
		text-align: left;
		vertical-align: top;
	}

	:global(.asset-thumb-document img) {
		max-width: 100%;
		height: auto;
	}
</style>
