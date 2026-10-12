<script lang="ts">
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { assistantState } from '$lib/state/assistant.svelte.js';

	const pendingSet = $derived(assistantState.pendingProposalSet);

	function handleClose(open: boolean) {
		assistantState.isProposalDialogOpen = open;
	}

	function formatProposalScope(scope: string): string {
		return scope
			.split('_')
			.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
			.join(' ');
	}

	function getProposalFieldSummary(fields: Record<string, unknown>): string {
		return Object.entries(fields)
			.filter(([_, val]) => val !== undefined && val !== null && val !== '')
			.map(([key, val]) => `${key}: ${typeof val === 'object' ? JSON.stringify(val) : val}`)
			.join(', ');
	}
</script>

<Dialog.Root bind:open={assistantState.isProposalDialogOpen} onOpenChange={handleClose}>
	{#if pendingSet}
		<Dialog.StandardFrame
			title={pendingSet.items.length === 1
				? 'Review action'
				: `Review ${pendingSet.items.length} actions`}
			class="ui-dialog-size-md"
			bodyClass="py-3"
			footerDensity="compact"
		>
			<div class="grid max-h-[50vh] gap-2 overflow-y-auto pr-1">
				{#each pendingSet.items as item (item.id)}
					<div class="ui-radius-md flex items-start gap-2 border border-border/60 bg-muted/20 p-2">
						<div
							class="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-accent/15"
						>
							{#if item.action === 'create'}
								<PlusIcon class="size-4 text-accent" />
							{:else}
								<PencilIcon class="size-4 text-accent" />
							{/if}
						</div>
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-1.5 font-mono text-foreground capitalize">
								{item.action}
								{formatProposalScope(item.scope)}
							</div>
							<div class="caption mt-0.5 text-muted-foreground">{item.summary}</div>
							{#if Object.keys(item.fields).length > 0}
								<div
									class="caption ui-radius-sm mt-1 bg-muted/40 px-2 py-1.5 font-mono leading-relaxed break-all whitespace-pre-wrap text-foreground/80"
								>
									{getProposalFieldSummary(item.fields)}
								</div>
							{/if}
						</div>

						{#if pendingSet.items.length > 1}
							<div class="ml-2 flex shrink-0 items-center gap-2 self-center">
								<Button
									variant="secondary"
									size="sm"
									class="h-8"
									onclick={() => assistantState.discardProposalItem(pendingSet.id, item.id)}
								>
									Reject
								</Button>
								<Button
									variant="brand"
									size="sm"
									class="h-8"
									onclick={() => assistantState.approveProposalItem(pendingSet.id, item.id)}
								>
									Approve
								</Button>
							</div>
						{/if}
					</div>
				{/each}
			</div>

			{#snippet footer()}
				<div class="flex w-full justify-end gap-2 py-3">
					{#if pendingSet.items.length === 1}
						<Button
							variant="secondary"
							size="sm"
							class="h-8"
							onclick={() => assistantState.discardProposalSet(pendingSet.id)}
						>
							Reject
						</Button>
						<Button
							variant="brand"
							size="sm"
							class="h-8"
							onclick={() => assistantState.approveProposalSet(pendingSet.id)}
						>
							Approve
						</Button>
					{:else}
						<Button
							variant="secondary"
							size="sm"
							class="h-8"
							onclick={() => assistantState.discardProposalSet(pendingSet.id)}
						>
							Reject all
						</Button>
						<Button
							variant="brand"
							size="sm"
							class="h-8"
							onclick={() => assistantState.approveProposalSet(pendingSet.id)}
						>
							Approve all
						</Button>
					{/if}
				</div>
			{/snippet}
		</Dialog.StandardFrame>
	{/if}
</Dialog.Root>
