<script lang="ts">
	import { Meta, Text } from '$lib/components/primitives/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { createLogger } from '$lib/services/logger.js';
	import TooltipIconButton from '$lib/components/tooltip-icon-button.svelte';
	import * as ScrollArea from '$lib/components/ui/scroll-area/index.js';
	import {
		disposeDerivedPreview,
		getDerivedPreview,
		type SpreadsheetDerivedPreview
	} from '$lib/services/derived-previews.js';

	import SheetIcon from '@lucide/svelte/icons/sheet';
	import Maximize2Icon from '@lucide/svelte/icons/maximize-2';
	import Minimize2Icon from '@lucide/svelte/icons/minimize-2';

	interface Props {
		filePath: string;
		expanded?: boolean;
		allowExpand?: boolean;
		detached?: boolean;
	}

	let {
		filePath,
		expanded = $bindable(false),
		allowExpand = true,
		detached = false
	}: Props = $props();

	let loading = $state(true);
	let error = $state(false);
	let preview = $state<SpreadsheetDerivedPreview | null>(null);
	let activePreview: SpreadsheetDerivedPreview | null = null;
	const log = createLogger('viewer.spreadsheet');
	let activeSheetIndex = $state(0);

	const activeSheet = $derived(preview?.sheets[activeSheetIndex] ?? null);

	$effect(() => {
		const path = filePath;
		loading = true;
		error = false;
		activeSheetIndex = 0;
		let cancelled = false;

		(async () => {
			try {
				const nextPreview = await getDerivedPreview(path);
				if (cancelled || filePath !== path || nextPreview.kind !== 'spreadsheet') {
					disposeDerivedPreview(nextPreview);
					return;
				}
				const previousPreview = activePreview;
				activePreview = nextPreview;
				preview = nextPreview;
				disposeDerivedPreview(previousPreview);
				loading = false;
			} catch (loadError) {
				if (cancelled || filePath !== path) return;
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

<div
	class="surface-faint relative flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden"
>
	{#if !loading && !error && preview}
		<div class="surface-strip-row surface-overlay-soft ui-viewer-strip z-10">
			<div class="flex min-w-0 items-center gap-2">
				<Meta as="span" class="tabular-nums">{preview.sheets.length} sheets</Meta>
				{#if activeSheet}
					<Meta as="span" class="tabular-nums">
						{activeSheet.rowCount} rows × {activeSheet.columnCount} columns
					</Meta>
				{/if}
			</div>
			{#if allowExpand && !detached}
				<TooltipIconButton
					tooltip={expanded ? 'Collapse' : 'Expand'}
					variant="ghost"
					size="icon-xs"
					onclick={() => (expanded = !expanded)}
				>
					{#if expanded}
						<Minimize2Icon class="size-3.5" />
					{:else}
						<Maximize2Icon class="size-3.5" />
					{/if}
				</TooltipIconButton>
			{/if}
		</div>

		{#if preview.sheets.length > 1}
			<div class="ui-viewer-subtabs">
				{#each preview.sheets as sheet, index (sheet.name)}
					<Button
						variant={activeSheetIndex === index ? 'secondary' : 'ghost'}
						size="sm"
						class="badge-label control-copy-sm control-height-sm gap-2 px-3"
						onclick={() => (activeSheetIndex = index)}
					>
						<SheetIcon class="size-3.5" />
						{sheet.name}
					</Button>
				{/each}
			</div>
		{/if}

		<ScrollArea.Root class="min-h-0 flex-1" orientation="both">
			{#if activeSheet}
				<div class="p-4">
					<table class="ui-derived-preview-table min-w-full border-collapse">
						<thead>
							<tr class="ui-table-header-surface border-b">
								{#each activeSheet.headers as header, headerIndex (`${headerIndex}:${header}`)}
									<th class="min-w-32 border-r px-3 py-2 text-left last:border-r-0">
										<Text as="span">{header || 'Column'}</Text>
									</th>
								{/each}
							</tr>
						</thead>
						<tbody>
							{#each activeSheet.rows as row, rowIndex (rowIndex)}
								<tr class="border-b last:border-b-0">
									{#each row as cell, cellIndex (`${rowIndex}:${cellIndex}`)}
										<td class="min-w-32 border-r px-3 py-2 align-top last:border-r-0">
											<Meta>{cell}</Meta>
										</td>
									{/each}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</ScrollArea.Root>
	{/if}

	{#if loading}
		<div class="surface-faint absolute inset-0 flex items-center justify-center">
			<Text tone="muted" class="animate-pulse">Generating preview…</Text>
		</div>
	{:else if error}
		<div class="surface-faint absolute inset-0 flex items-center justify-center">
			<div class="flex flex-col items-center gap-2 opacity-50">
				<SheetIcon class="muted size-16 stroke-1" />
				<Text tone="muted">Could not generate the spreadsheet preview</Text>
			</div>
		</div>
	{/if}
</div>
