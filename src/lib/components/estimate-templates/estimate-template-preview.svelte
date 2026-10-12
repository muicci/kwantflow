<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import TableHeaderLabel from '$lib/components/table-header-label.svelte';
	import TableTextCell from '$lib/components/table-text-cell.svelte';
	import { Meta, Panel, Text } from '$lib/components/primitives/index.js';
	import { getUnitLabel } from '$lib/constants/index.js';
	import type { EstimateTemplate } from '$lib/types/index.js';

	interface Props {
		open?: boolean;
		template?: EstimateTemplate | null;
	}

	let { open = $bindable(false), template = null }: Props = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.StandardFrame
		title={template?.name ?? 'Estimate Template'}
		description={template?.description || 'No description provided.'}
		class="ui-dialog-size-2xl"
		bodyClass="space-y-4"
	>
		<div class="grid gap-4 md:grid-cols-2">
			<Panel as="div">
				<Meta>Scope Summary</Meta>
				<Text class="mt-1">{template?.estimate.scope_summary || '—'}</Text>
			</Panel>
			<Panel as="div">
				<Meta>Takeoff Items</Meta>
				<Text class="mt-1 tabular-nums">{template?.estimate.takeoff_items.length ?? 0}</Text>
			</Panel>
		</div>

		<div class="ui-radius-lg border">
			<Table.Root>
				<Table.Header class="bg-muted">
					<Table.Row>
						<Table.Head><TableHeaderLabel text="Item" /></Table.Head>
						<Table.Head><TableHeaderLabel text="Components" align="right" /></Table.Head>
						<Table.Head><TableHeaderLabel text="Qty" align="right" /></Table.Head>
						<Table.Head><TableHeaderLabel text="Unit" /></Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#if template && template.estimate.takeoff_items.length > 0}
						{#each template.estimate.takeoff_items as item (item.id)}
							<Table.Row>
								<Table.Cell>
									<div class="flex flex-col">
										<TableTextCell text={item.name} />
										<TableTextCell text={item.description} tone="secondary" />
									</div>
								</Table.Cell>
								<Table.Cell
									><TableTextCell
										text={item.cost_components.length}
										align="right"
										tabular
									/></Table.Cell
								>
								<Table.Cell><TableTextCell text={item.quantity} align="right" tabular /></Table.Cell
								>
								<Table.Cell
									><TableTextCell text={getUnitLabel(item.unit)} tone="secondary" /></Table.Cell
								>
							</Table.Row>
						{/each}
					{:else}
						<Table.Row>
							<Table.Cell colspan={4} class="h-28 text-center">
								<Text tone="muted" as="span">No takeoff items saved.</Text>
							</Table.Cell>
						</Table.Row>
					{/if}
				</Table.Body>
			</Table.Root>
		</div>
	</Dialog.StandardFrame>
</Dialog.Root>
