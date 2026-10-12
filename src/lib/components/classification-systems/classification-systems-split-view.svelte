<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import ClassificationSystemsTable from './classification-systems-table.svelte';
	import CostCodesTable from './cost-codes-table.svelte';
	import CostCodeDialog from './cost-code-dialog.svelte';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Text } from '$lib/components/primitives/index.js';
	import { classificationSystemsState } from '$lib/state/classification-systems.svelte.js';
	import type { CostCode } from '$lib/types/index.js';
	import {
		getClassificationRouteSyncAction,
		shouldShowCostCodeSheet
	} from './classification-systems.helpers.js';
	import XIcon from '@lucide/svelte/icons/x';

	interface Props {
		selectedSystemId?: string | null;
	}

	let { selectedSystemId = null }: Props = $props();
	let isHydrated = $state(false);
	let isAddCostCodeOpen = $state(false);
	let isEditCostCodeOpen = $state(false);
	let editingCostCode = $state<CostCode | null>(null);
	let innerWidth = $state(1440);
	const DOCKED_BREAKPOINT = 1280;
	let isClosingPanel = false;
	let isReturningToListRoute = false;
	let lastDialogResetSystemId: string | null = null;

	function resetCostCodeDialogs() {
		isAddCostCodeOpen = false;
		isEditCostCodeOpen = false;
		editingCostCode = null;
	}

	onMount(() => {
		let cancelled = false;

		void (async () => {
			await classificationSystemsState.hydrate();
			if (cancelled) return;
			isHydrated = true;
		})();

		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		const nextActiveSystemId = activeSystem?.id ?? null;
		if (lastDialogResetSystemId === nextActiveSystemId) return;
		lastDialogResetSystemId = nextActiveSystemId;
		resetCostCodeDialogs();
	});

	const activeSystem = $derived(
		classificationSystemsState.list.find(
			(item) => item.id === classificationSystemsState.activeSystemId
		) ?? null
	);
	const activeSystemId = $derived(activeSystem?.id ?? null);
	const useDockedPanel = $derived(innerWidth >= DOCKED_BREAKPOINT);
	const isSheetOpen = $derived(shouldShowCostCodeSheet(activeSystemId, useDockedPanel));
	const availableSystemIds = $derived(classificationSystemsState.list.map((item) => item.id));

	$effect(() => {
		if (!isHydrated) return;

		const nextSelectedSystemId = selectedSystemId ?? null;
		if (isReturningToListRoute) {
			if (nextSelectedSystemId === null) {
				isReturningToListRoute = false;
			}
			return;
		}

		const action = getClassificationRouteSyncAction({
			selectedSystemId: nextSelectedSystemId,
			activeSystemId: classificationSystemsState.activeSystemId,
			availableSystemIds
		});

		if (action.type === 'clear') {
			resetCostCodeDialogs();
			void classificationSystemsState.selectSystem(null);
			return;
		}

		if (action.type === 'select') {
			resetCostCodeDialogs();
			void classificationSystemsState.selectSystem(action.systemId);
			return;
		}

		if (action.type === 'recover-missing-route') {
			isReturningToListRoute = true;
			resetCostCodeDialogs();
			void classificationSystemsState.selectSystem(null);
			void goto(resolve('/classification-systems'), { replaceState: true });
		}
	});

	async function closePanel() {
		if (isClosingPanel) return;
		isClosingPanel = true;
		if (selectedSystemId) {
			isReturningToListRoute = true;
		}
		resetCostCodeDialogs();
		try {
			await classificationSystemsState.selectSystem(null);
			if (selectedSystemId) {
				await goto(resolve('/classification-systems'), { replaceState: true });
			}
		} catch (error) {
			isReturningToListRoute = false;
			throw error;
		} finally {
			isClosingPanel = false;
		}
	}

	function openAddCostCode() {
		editingCostCode = null;
		isEditCostCodeOpen = false;
		isAddCostCodeOpen = true;
	}

	function openEditCostCode(costCode: CostCode) {
		isAddCostCodeOpen = false;
		editingCostCode = costCode;
		isEditCostCodeOpen = true;
	}
</script>

{#snippet CostCodesPanelContent()}
	<div class="ui-pane-card h-full">
		<div class="ui-pane-card-header ui-route-header-sm items-start justify-between gap-3">
			<div class="flex items-start justify-between gap-3">
				<div class="min-w-0">
					<h2 class="h4 truncate">{activeSystem?.name ?? 'Cost Codes'}</h2>
					<Text as="p" tone="muted">Manage cost codes for this classification system.</Text>
				</div>
				<Button variant="ghost" size="icon-xs" class="xl:flex" onclick={closePanel}>
					<XIcon class="size-3.5" />
					<span class="sr-only">Close cost codes</span>
				</Button>
			</div>
		</div>
		<div class="flex min-h-0 flex-1 flex-col px-4 pb-3">
			{#if activeSystem}
				<CostCodesTable onAdd={openAddCostCode} onEdit={openEditCostCode} />
			{/if}
		</div>
	</div>
{/snippet}

<div class="flex h-full min-h-0">
	<section class="min-h-0 min-w-0 flex-1">
		<ClassificationSystemsTable />
	</section>

	{#if activeSystem && useDockedPanel}
		<aside class="ui-pane-width-lg min-h-0 min-w-0 shrink-0 pl-4">
			{@render CostCodesPanelContent()}
		</aside>
	{/if}
</div>

{#if activeSystem && !useDockedPanel}
	<Sheet.Root open={isSheetOpen} onOpenChange={(open) => (!open ? void closePanel() : undefined)}>
		<Sheet.Content side="right" class="ui-sheet-size-md p-0">
			{@render CostCodesPanelContent()}
		</Sheet.Content>
	</Sheet.Root>
{/if}

{#if activeSystem}
	<CostCodeDialog
		bind:open={isAddCostCodeOpen}
		classificationSystemId={activeSystem.id}
		hideTrigger
	/>
	<CostCodeDialog
		bind:open={isEditCostCodeOpen}
		classificationSystemId={activeSystem.id}
		costCode={editingCostCode}
		hideTrigger
	/>
{/if}

<svelte:window bind:innerWidth />
