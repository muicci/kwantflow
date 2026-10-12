<script lang="ts">
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
	import PanelTopIcon from '@lucide/svelte/icons/panel-top';
	import XIcon from '@lucide/svelte/icons/x';
	import { Meta } from '$lib/components/primitives/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { LocalAssistantPageReference } from '$lib/services/local-assistant-viewport-context.js';

	let {
		reference,
		attached = false,
		ondetach,
		onreattach
	}: {
		reference: LocalAssistantPageReference | null;
		attached?: boolean;
		ondetach?: () => void;
		onreattach?: () => void;
	} = $props();

	let isExpanded = $state(false);
</script>

{#if reference}
	<div class="ui-assistant-page-reference flex min-w-0 flex-col gap-2 px-2.5 py-2">
		<div class="flex min-w-0 items-center gap-2">
			<PanelTopIcon class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
			<Meta class="min-w-0 flex-1 truncate">
				{attached ? reference.label : `Page context off · ${reference.title}`}
			</Meta>
			<Button
				variant="ghost"
				size="icon-sm"
				class="ui-radius-md size-6 shrink-0"
				type="button"
				onclick={() => (isExpanded = !isExpanded)}
				aria-label={isExpanded ? 'Collapse page context list' : 'Expand page context list'}
			>
				{#if isExpanded}
					<ChevronUpIcon class="size-3.5" />
				{:else}
					<ChevronDownIcon class="size-3.5" />
				{/if}
			</Button>
		</div>
		{#if isExpanded}
			<div class="flex min-w-0 items-center gap-2 pl-5">
				<PanelTopIcon class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
				<Meta class="min-w-0 flex-1 truncate">
					{reference.title}{attached ? ' · Current page' : ' · Detached'}
				</Meta>
				<Button
					variant="ghost"
					size="icon-sm"
					class="ui-radius-md size-6 shrink-0"
					type="button"
					onclick={attached ? ondetach : onreattach}
					aria-label={attached ? 'Detach page context' : 'Attach page context'}
				>
					{#if attached}
						<XIcon class="size-3.5" />
					{:else}
						<ChevronDownIcon class="size-3.5" />
					{/if}
				</Button>
			</div>
		{/if}
	</div>
{/if}
