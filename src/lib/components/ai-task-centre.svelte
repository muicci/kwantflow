<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import MoreHorizontalIcon from '@lucide/svelte/icons/more-horizontal';
	import SparkleIcon from '@lucide/svelte/icons/sparkle';
	import XIcon from '@lucide/svelte/icons/x';
	import { Meta, Text } from '$lib/components/primitives/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as ScrollArea from '$lib/components/ui/scroll-area/index.js';
	import { aiState } from '$lib/state/ai.svelte.js';
	import type { AppShellHref } from '$lib/utils/app-shell-href.js';

	let {
		iconButtonClass = 'size-8 ui-radius-md'
	}: {
		iconButtonClass?: string;
	} = $props();

	const taskEntries = $derived(aiState.taskEntries);
	const actionableTaskCount = $derived(aiState.actionableTaskCount);
	const DISMISS_ANIMATION_MS = 160;
	let removingTaskRunIds = $state<string[]>([]);
	let taskMenuOpen = $state(false);
	let activeTaskRunId = $state<string | null>(null);

	function buildAssetRoute(projectId: string, assetId: string): string {
		return `/project/${projectId}/asset/${assetId}`;
	}

	function taskState(entry: (typeof taskEntries)[number]) {
		return aiState.getAssetRunState(entry.assetId);
	}

	function taskStatusLabel(status: string, isCancelling: boolean): string {
		if (isCancelling) return 'Cancelling';
		switch (status) {
			case 'queued':
				return 'Queued';
			case 'preprocessing':
				return 'Preparing files';
			case 'extracting':
				return 'Reading files';
			case 'drafting':
				return 'Building draft';
			case 'applied':
				return 'Draft applied';
			case 'failed':
				return 'Draft failed';
			case 'cancelled':
				return 'Draft cancelled';
			default:
				return status;
		}
	}

	function buildTaskSummary(entry: (typeof taskEntries)[number]): string {
		const state = taskState(entry);
		const parts = [entry.projectLabel, taskStatusLabel(entry.status, state.isCancelling)].filter(
			Boolean
		);
		if (entry.status === 'queued') {
			const position = aiState.getQueuePosition(entry.assetId);
			if (position !== null) {
				parts.push(`Queue ${position}`);
			}
		}
		return parts.join(' · ');
	}

	function taskDotClass(entry: (typeof taskEntries)[number]): string {
		const state = taskState(entry);
		if (state.isCancelling) return 'status-dot-warning';
		switch (entry.status) {
			case 'queued':
			case 'preprocessing':
			case 'extracting':
			case 'drafting':
				return 'status-dot-success';
			case 'applied':
				return 'status-dot-success';
			case 'failed':
				return 'status-dot-destructive';
			case 'cancelled':
				return 'status-dot-muted';
			default:
				return 'status-dot-brand';
		}
	}

	async function openAsset(entry: (typeof taskEntries)[number]): Promise<void> {
		const route = buildAssetRoute(entry.projectId, entry.assetId);
		if (page.url.pathname === route) {
			return;
		}

		await goto(resolve(route as AppShellHref));
	}

	async function cancelTask(entry: (typeof taskEntries)[number]): Promise<void> {
		await aiState.cancelRunForAsset(entry.assetId);
	}

	function markTaskRemoving(runId: string): void {
		if (removingTaskRunIds.includes(runId)) return;
		removingTaskRunIds = [...removingTaskRunIds, runId];
	}

	function clearTaskRemoving(runId: string): void {
		if (!removingTaskRunIds.includes(runId)) return;
		removingTaskRunIds = removingTaskRunIds.filter((current) => current !== runId);
	}

	function dismissTask(entry: (typeof taskEntries)[number]): void {
		if (removingTaskRunIds.includes(entry.runId)) return;
		markTaskRemoving(entry.runId);
		globalThis.setTimeout(() => {
			void aiState.dismissTaskEntry(entry.runId);
			clearTaskRemoving(entry.runId);
		}, DISMISS_ANIMATION_MS);
	}

	function onCardKeydown(event: KeyboardEvent, entry: (typeof taskEntries)[number]): void {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		void openAsset(entry);
	}

	function isActive(status: string): boolean {
		return (
			status === 'queued' ||
			status === 'preprocessing' ||
			status === 'extracting' ||
			status === 'drafting'
		);
	}

	function setActiveTask(entryRunId: string | null): void {
		activeTaskRunId = taskMenuOpen ? entryRunId : null;
	}

	function setActiveTaskOnFocus(event: FocusEvent, entryRunId: string): void {
		const currentTarget = event.currentTarget;
		if (!(currentTarget instanceof HTMLElement)) return;
		if (!currentTarget.matches(':focus-visible')) return;
		setActiveTask(entryRunId);
	}

	function clearActiveTaskOnBlur(event: FocusEvent, entryRunId: string): void {
		const currentTarget = event.currentTarget;
		if (!(currentTarget instanceof HTMLElement)) return;
		const nextTarget = event.relatedTarget;
		if (nextTarget instanceof Node && currentTarget.contains(nextTarget)) return;
		if (activeTaskRunId === entryRunId) {
			activeTaskRunId = null;
		}
	}

	$effect(() => {
		if (taskMenuOpen) return;
		activeTaskRunId = null;
	});
</script>

<DropdownMenu.Root bind:open={taskMenuOpen}>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				variant="ghost"
				size="icon"
				class={`relative ${iconButtonClass}`.trim()}
				type="button"
				aria-label="Open AI task centre"
			>
				<SparkleIcon class="size-3.5" strokeWidth={1.5} />
				{#if actionableTaskCount > 0}
					<span
						class="ui-radius-pill absolute top-0.5 right-0.5 size-2 bg-success"
						aria-hidden="true"
					>
					</span>
				{/if}
				<span class="sr-only">Open AI task centre</span>
			</Button>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content
		align="end"
		class="ui-task-center-popover ui-popover-width-lg ui-radius-lg overflow-hidden p-0 outline-hidden focus-visible:ring-0"
	>
		{#if taskEntries.length === 0}
			<div class="flex items-center justify-center px-3 py-6 text-center">
				<Text>No AI tasks yet.</Text>
			</div>
		{:else}
			<ScrollArea.Root class="max-h-80" orientation="vertical">
				<div class="divide-y">
					{#each taskEntries as entry (entry.runId)}
						{@const isRemoving = removingTaskRunIds.includes(entry.runId)}
						<div
							class={`overflow-hidden transition-all duration-150 ease-out ${
								isRemoving
									? 'pointer-events-none max-h-0 -translate-y-1 opacity-0'
									: 'max-h-32 translate-y-0 opacity-100'
							}`}
						>
							<div
								role="button"
								tabindex="0"
								aria-disabled={isRemoving}
								class="group/task hover-surface-subtle relative flex min-w-0 cursor-pointer items-start gap-2.5 px-4 py-3 pr-12 text-left outline-none focus-visible:outline-none"
								onpointerenter={() => setActiveTask(entry.runId)}
								onpointerleave={() => setActiveTask(null)}
								onfocusin={(event: FocusEvent) => setActiveTaskOnFocus(event, entry.runId)}
								onfocusout={(event: FocusEvent) => clearActiveTaskOnBlur(event, entry.runId)}
								onclick={() => void openAsset(entry)}
								onkeydown={(event: KeyboardEvent) => onCardKeydown(event, entry)}
								data-kf-ai-task-card
							>
								<span
									class={`mt-1 size-2 shrink-0 self-start ${taskDotClass(entry)} ${
										isActive(entry.status) ? 'animate-pulse' : ''
									}`}
									aria-hidden="true"
								></span>
								<div class="min-w-0 flex-1 pr-2">
									<div title={entry.assetName}>
										<Text class="truncate">{entry.assetName}</Text>
									</div>
									<div title={buildTaskSummary(entry)}>
										<Meta class="block truncate">{buildTaskSummary(entry)}</Meta>
									</div>
								</div>
								{#if isActive(entry.status)}
									<DropdownMenu.Root>
										<DropdownMenu.Trigger>
											{#snippet child({ props })}
												<Button
													{...props}
													variant="ghost"
													size="icon"
													class={`absolute top-2 right-2 size-7 transition-opacity ${
														activeTaskRunId === entry.runId
															? 'opacity-100'
															: 'pointer-events-none opacity-0'
													}`}
													type="button"
													tabindex={activeTaskRunId === entry.runId ? 0 : -1}
													onclick={(event: MouseEvent) => {
														event.stopPropagation();
														dismissTask(entry);
													}}
													aria-label={`Remove ${entry.assetName} from task list`}
													title="Remove from task list"
												>
													<MoreHorizontalIcon class="size-3.5" />
												</Button>
											{/snippet}
										</DropdownMenu.Trigger>
										<DropdownMenu.Content align="end" class="ui-menu-width-md ui-radius-lg">
											<DropdownMenu.Item
												variant="destructive"
												class="gap-2"
												onclick={() => void cancelTask(entry)}
											>
												<span>Cancel AI</span>
											</DropdownMenu.Item>
										</DropdownMenu.Content>
									</DropdownMenu.Root>
								{:else}
									<Button
										variant="ghost"
										size="icon"
										class={`absolute top-2 right-2 size-7 transition-opacity ${
											activeTaskRunId === entry.runId
												? 'opacity-100'
												: 'pointer-events-none opacity-0'
										}`}
										type="button"
										tabindex={activeTaskRunId === entry.runId ? 0 : -1}
										onclick={(event: MouseEvent) => {
											event.stopPropagation();
											dismissTask(entry);
										}}
										aria-label={`Remove ${entry.assetName} from task list`}
										title="Remove from task list"
									>
										<XIcon class="size-3.5" />
									</Button>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			</ScrollArea.Root>
		{/if}
	</DropdownMenu.Content>
</DropdownMenu.Root>
