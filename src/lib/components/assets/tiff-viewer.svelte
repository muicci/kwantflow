<script lang="ts">
	import ImageViewer from './image-viewer.svelte';
	import FileIcon from '@lucide/svelte/icons/file';
	import { createLogger } from '$lib/services/logger.js';
	import { Text, Meta } from '$lib/components/primitives/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		disposeDerivedPreview,
		getDerivedPreview,
		type TiffDerivedPreview
	} from '$lib/services/derived-previews.js';

	interface Props {
		filePath: string;
		fileSource?: 'vault' | 'appLocal';
		expanded?: boolean;
		allowExpand?: boolean;
		detached?: boolean;
	}

	let {
		filePath,
		fileSource = 'vault',
		expanded = $bindable(false),
		allowExpand = true,
		detached = false
	}: Props = $props();

	let loading = $state(true);
	let error = $state(false);
	let preview = $state<TiffDerivedPreview | null>(null);
	let activePreview: TiffDerivedPreview | null = null;
	let activePage = $state(0);
	const log = createLogger('viewer.tiff');

	const currentImage = $derived(preview?.images[activePage] ?? null);

	$effect(() => {
		const path = filePath;
		const source = fileSource;
		loading = true;
		error = false;
		activePage = 0;
		let cancelled = false;

		(async () => {
			try {
				const nextPreview = await getDerivedPreview(path, { fileSource: source });
				if (
					cancelled ||
					filePath !== path ||
					fileSource !== source ||
					nextPreview.kind !== 'tiff'
				) {
					disposeDerivedPreview(nextPreview);
					return;
				}
				const previousPreview = activePreview;
				activePreview = nextPreview;
				preview = nextPreview;
				disposeDerivedPreview(previousPreview);
				loading = false;
			} catch (loadError) {
				if (cancelled || filePath !== path || fileSource !== source) return;
				log.error('Load failed', { path, error: loadError });
				const previousPreview = activePreview;
				activePreview = null;
				preview = null;
				disposeDerivedPreview(previousPreview);
				error = true;
				loading = false;
			}
		})();

		return () => {
			cancelled = true;
			const previousPreview = activePreview;
			activePreview = null;
			preview = null;
			disposeDerivedPreview(previousPreview);
		};
	});
</script>

{#if preview && !loading && !error}
	<div
		class="relative flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden"
		style="background: var(--preview-bg, transparent);"
	>
		{#if preview.images.length > 1}
			<div class="surface-strip-row surface-overlay-soft ui-viewer-strip z-10">
				<div class="flex items-center gap-1">
					{#each preview.images as image, index (`page-${index}`)}
						{@const _unused = image}
						<Button
							variant={activePage === index ? 'secondary' : 'ghost'}
							size="sm"
							class="badge-label control-copy-sm control-height-sm"
							onclick={() => (activePage = index)}
						>
							Page {index + 1}
						</Button>
					{/each}
				</div>
				<Meta class="tabular-nums">{preview.pageCount} pages</Meta>
			</div>
		{/if}

		{#if currentImage}
			<ImageViewer
				{filePath}
				srcUrl={currentImage.svgUrl}
				useObjectTag={true}
				bind:expanded
				{allowExpand}
				{detached}
			/>
		{/if}
	</div>
{:else if loading}
	<div class="surface-faint flex h-full flex-1 items-center justify-center">
		<Text as="div" tone="muted" class="animate-pulse">Generating preview…</Text>
	</div>
{:else}
	<div class="surface-faint flex h-full flex-1 items-center justify-center">
		<div class="flex flex-col items-center gap-2 opacity-50">
			<FileIcon class="muted size-16 stroke-1" />
			<Text as="p" tone="muted">Could not generate the TIFF preview</Text>
		</div>
	</div>
{/if}
