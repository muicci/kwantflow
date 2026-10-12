<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import TableHeaderLabel from '$lib/components/table-header-label.svelte';
	import TableTextCell from '$lib/components/table-text-cell.svelte';
	import { Text } from '$lib/components/primitives/index.js';
	import { getUnitLabel } from '$lib/constants/index.js';
	import type { CostComponentPreset } from '$lib/types/index.js';
	import { formatCurrency } from '$lib/utils/format.js';

	interface Props {
		open?: boolean;
		preset?: CostComponentPreset | null;
	}

	let { open = $bindable(false), preset = null }: Props = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.StandardFrame
		title={preset?.name ?? 'Cost Preset'}
		description={preset?.description || 'No description provided.'}
		class="ui-dialog-size-2xl"
		bodyClass="space-y-4"
	>
		<div class="ui-radius-lg border">
			<Table.Root>
				<Table.Header class="bg-muted">
					<Table.Row>
						<Table.Head><TableHeaderLabel text="Category" /></Table.Head>
						<Table.Head><TableHeaderLabel text="Name" /></Table.Head>
						<Table.Head><TableHeaderLabel text="Qty" align="right" /></Table.Head>
						<Table.Head><TableHeaderLabel text="Unit" /></Table.Head>
						<Table.Head><TableHeaderLabel text="Rate" align="right" /></Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#if preset && preset.components.length > 0}
						{#each preset.components as component, index (`${component.name}-${index}`)}
							<Table.Row>
								<Table.Cell><TableTextCell text={component.category} /></Table.Cell>
								<Table.Cell>
									<div class="flex flex-col">
										<TableTextCell text={component.name} />
										<TableTextCell text={component.description} tone="secondary" />
									</div>
								</Table.Cell>
								<Table.Cell
									><TableTextCell text={component.quantity} align="right" tabular /></Table.Cell
								>
								<Table.Cell
									><TableTextCell
										text={getUnitLabel(component.unit)}
										tone="secondary"
									/></Table.Cell
								>
								<Table.Cell
									><TableTextCell
										text={formatCurrency(component.unit_rate)}
										align="right"
										tabular
									/></Table.Cell
								>
							</Table.Row>
						{/each}
					{:else}
						<Table.Row>
							<Table.Cell colspan={5} class="h-28 text-center">
								<Text tone="muted" as="span">No components saved.</Text>
							</Table.Cell>
						</Table.Row>
					{/if}
				</Table.Body>
			</Table.Root>
		</div>
	</Dialog.StandardFrame>
</Dialog.Root>
