<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Text } from '$lib/components/primitives/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import type { ProjectStructureTemplate } from '$lib/types/index.js';
	import TableTextCell from '../table-text-cell.svelte';
	import TableHeaderLabel from '../table-header-label.svelte';

	interface Props {
		open?: boolean;
		template?: ProjectStructureTemplate | null;
	}

	let { open = $bindable(false), template = null }: Props = $props();
	const parentNameById = $derived.by(() =>
		Object.fromEntries(template?.nodes.map((node) => [node.id, node.name]) ?? [])
	);
</script>

<Dialog.Root bind:open>
	<Dialog.StandardFrame
		title={template?.name ?? 'Project Structure Template'}
		description={template?.description || 'No description provided.'}
		class="ui-dialog-size-3xl"
		bodyClass="space-y-4"
	>
		<div class="ui-radius-lg border">
			<Table.Root>
				<Table.Header class="bg-muted">
					<Table.Row>
						<Table.Head><TableHeaderLabel text="Name" /></Table.Head>
						<Table.Head><TableHeaderLabel text="Type" /></Table.Head>
						<Table.Head><TableHeaderLabel text="Parent" /></Table.Head>
						<Table.Head><TableHeaderLabel text="Order" align="right" /></Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#if template && template.nodes.length > 0}
						{#each template.nodes as node (node.id)}
							<Table.Row>
								<Table.Cell>
									<div class="flex flex-col">
										<TableTextCell text={node.name} />
										<TableTextCell text={node.code} tone="secondary" />
									</div>
								</Table.Cell>
								<Table.Cell><TableTextCell text={node.type} tone="secondary" /></Table.Cell>
								<Table.Cell>
									<TableTextCell
										text={node.parent_id ? parentNameById[node.parent_id] : 'Top-level'}
										tone="secondary"
									/>
								</Table.Cell>
								<Table.Cell
									><TableTextCell text={node.sort_order} align="right" tabular /></Table.Cell
								>
							</Table.Row>
						{/each}
					{:else}
						<Table.Row>
							<Table.Cell colspan={4} class="h-28 text-center">
								<Text tone="muted" as="span">No structure nodes saved.</Text>
							</Table.Cell>
						</Table.Row>
					{/if}
				</Table.Body>
			</Table.Root>
		</div>
	</Dialog.StandardFrame>
</Dialog.Root>
