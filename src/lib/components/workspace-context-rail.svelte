<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { Asset, Project } from '$lib/types/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Text } from '$lib/components/primitives/index.js';
	import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
	import { SidebarSeparator } from '$lib/components/ui/sidebar/index.js';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import { IsMobile } from '$lib/hooks/is-mobile.svelte.js';
	import { cn } from '$lib/utils.js';
	import { errorState } from '$lib/state/errors.svelte.js';
	import { tick } from 'svelte';

	type EstimateStatus = 'saved' | 'dirty' | 'not_started';
	type AppHref =
		| `/project/${string}`
		| `/project/${string}/asset/${string}`
		| `/project/${string}/quote`
		| `/project/${string}/quote/pdf`
		| `/project/${string}/wbs`;

	let {
		project,
		assets,
		open,
		canOpenPdfPreview,
		pdfPreviewBlockerMessage = null,
		getEstimateStatus,
		onOpenChange
	}: {
		project: Project;
		assets: Asset[];
		open: boolean;
		canOpenPdfPreview: boolean;
		pdfPreviewBlockerMessage: string | null;
		getEstimateStatus: (assetId: string) => EstimateStatus;
		onOpenChange: (open: boolean) => void;
	} = $props();

	const isMobileViewport = new IsMobile();
	const pathname = $derived(page.url.pathname);
	const hasAssets = $derived(assets.length > 0);
	const mobileInsetClass = $derived(isMobileViewport.current ? 'pt-8' : '');

	let containerRef = $state<HTMLDivElement | null>(null);

	$effect(() => {
		if (open && containerRef) {
			tick().then(() => {
				if (!containerRef) return;
				setTimeout(() => {
					if (!containerRef || !containerRef.isConnected || !open) return;
					if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
					const rect = containerRef.getBoundingClientRect();
					const style = window.getComputedStyle(containerRef);
					if (style.display === 'none' || rect.width === 0) {
						errorState.captureLayoutWarning(
							'Workspace Context Rail remains hidden despite open state',
							{
								className: containerRef.className,
								display: style.display,
								width: style.width,
								rectWidth: rect.width
							}
						);
					}
				}, 300);
			});
		}
	});

	function workspaceAssetHref(assetId: string): `/project/${string}/asset/${string}` {
		return `/project/${project.id}/asset/${assetId}`;
	}

	function navigateTo(path: AppHref): void {
		if (isMobileViewport.current) {
			onOpenChange(false);
		}
		void goto(resolve(path));
	}
</script>

{#snippet railContent()}
	<div
		class={`flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground ${mobileInsetClass}`}
	>
		<ScrollArea class="flex-1">
			<nav class="flex flex-col gap-1 p-2">
				<Button
					variant="ghost"
					size="sm"
					type="button"
					class={`control-copy-sm ui-selectable-row control-height-sm justify-start border-0 px-3 ${
						pathname === `/project/${project.id}`
							? 'ui-selectable-row-active'
							: 'ui-selectable-row-inactive hover:text-accent-foreground'
					}`}
					onclick={() => navigateTo(`/project/${project.id}`)}
				>
					Estimate
				</Button>

				<div class="relative ml-2 flex flex-col gap-0.5 pr-1 pb-2 pl-3">
					<div
						aria-hidden="true"
						class="ui-radius-pill ui-rail-connector absolute top-1 bottom-2 left-2 w-px"
					></div>
					{#each assets as asset (asset.id)}
						{@const status = getEstimateStatus(asset.id)}
						<div class="relative">
							<span
								aria-hidden="true"
								class="ui-rail-connector absolute top-1/2 -left-2 h-px w-2 -translate-y-1/2"
							></span>

							<Button
								variant="ghost"
								size="sm"
								type="button"
								class={`control-copy-sm ui-selectable-row ui-workspace-asset-nav-row ui-radius-sm control-height-sm relative min-w-0 justify-start gap-2 border-0 ${
									pathname === workspaceAssetHref(asset.id)
										? 'ui-selectable-row-active'
										: 'ui-selectable-row-inactive hover:text-accent-foreground'
								}`}
								onclick={() => navigateTo(workspaceAssetHref(asset.id))}
							>
								<span
									class={`ui-radius-pill size-1.5 shrink-0 ${
										status === 'saved'
											? 'bg-success'
											: status === 'dirty'
												? 'bg-warning'
												: 'status-dot-muted'
									}`}
								></span>
								<div class="min-w-0 flex-1 text-left" title={asset.display_name}>
									<Text as="span" class="shell-label min-w-0 truncate text-start">
										{asset.display_name}
									</Text>
								</div>
							</Button>
						</div>
					{/each}
				</div>

				<Button
					variant="ghost"
					size="sm"
					type="button"
					disabled={!hasAssets}
					class={`control-copy-sm ui-selectable-row control-height-sm justify-start border-0 px-3 ${
						pathname === `/project/${project.id}/quote` && hasAssets
							? 'ui-selectable-row-active'
							: 'ui-selectable-row-inactive hover:text-accent-foreground'
					}`}
					onclick={() => navigateTo(`/project/${project.id}/quote`)}
				>
					Quote
				</Button>

				{#if !canOpenPdfPreview && pdfPreviewBlockerMessage}
					<Tooltip.Root>
						<Tooltip.Trigger>
							{#snippet child({ props })}
								<span {...props} class="inline-flex">
									<Button
										variant="ghost"
										size="sm"
										type="button"
										disabled={true}
										class={`control-copy-sm ui-selectable-row control-height-sm justify-start border-0 px-3 opacity-50 ${
											pathname === `/project/${project.id}/quote/pdf`
												? 'ui-selectable-row-active'
												: 'ui-selectable-row-inactive hover:text-accent-foreground'
										}`}
									>
										PDF Preview
									</Button>
								</span>
							{/snippet}
						</Tooltip.Trigger>
						<Tooltip.Content side="right" sideOffset={4}>
							{pdfPreviewBlockerMessage}
						</Tooltip.Content>
					</Tooltip.Root>
				{:else}
					<Button
						variant="ghost"
						size="sm"
						type="button"
						disabled={!canOpenPdfPreview}
						class={`control-copy-sm ui-selectable-row control-height-sm justify-start border-0 px-3 ${
							pathname === `/project/${project.id}/quote/pdf` && canOpenPdfPreview
								? 'ui-selectable-row-active'
								: 'ui-selectable-row-inactive hover:text-accent-foreground'
						}`}
						onclick={() => navigateTo(`/project/${project.id}/quote/pdf`)}
					>
						PDF Preview
					</Button>
				{/if}

				<SidebarSeparator class="my-2" />

				<Button
					variant="ghost"
					size="sm"
					type="button"
					class={`control-copy-sm ui-selectable-row control-height-sm justify-start border-0 px-3 ${
						pathname === `/project/${project.id}/wbs`
							? 'ui-selectable-row-active'
							: 'ui-selectable-row-inactive hover:text-accent-foreground'
					}`}
					onclick={() => navigateTo(`/project/${project.id}/wbs`)}
				>
					Project Structure
				</Button>
			</nav>
		</ScrollArea>
	</div>
{/snippet}

{#if isMobileViewport.current}
	<Sheet.Root bind:open={() => open, (value) => onOpenChange(value)}>
		<Sheet.Content
			side="right"
			class="ui-sheet-size-lg bg-sidebar p-0 text-sidebar-foreground [&>button]:hidden"
		>
			<Sheet.Header class="sr-only">
				<Sheet.Title>Workspace navigation</Sheet.Title>
				<Sheet.Description>Shows asset and project workspace navigation.</Sheet.Description>
			</Sheet.Header>
			{@render railContent()}
		</Sheet.Content>
	</Sheet.Root>
{:else}
	<div
		bind:this={containerRef}
		class={cn(
			'flex shrink-0 overflow-hidden bg-sidebar',
			open ? 'ui-rail-width-md border-l' : 'w-0 border-l-0'
		)}
		style="transition: width var(--duration-fast) var(--ease-standard), border-width var(--duration-fast) var(--ease-standard);"
	>
		{#if open}
			<div class="ui-rail-width-md flex-1">
				{@render railContent()}
			</div>
		{/if}
	</div>
{/if}
