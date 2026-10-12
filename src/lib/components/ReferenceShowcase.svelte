<script lang="ts">
	/**
	 * @file ReferenceShowcase.svelte
	 * @description MANDATORY REFERENCE FOR AI AGENTS.
	 * Before creating any UI, read this file to copy established patterns.
	 * Follows the UI conventions in ARCHITECTURE.md.
	 */
	import { Button } from '$lib/components/ui/button/index.js';
	import { FieldLabelRow, Meta, Text } from '$lib/components/primitives/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TableHeaderLabel from '$lib/components/table-header-label.svelte';
	import TableTextCell from '$lib/components/table-text-cell.svelte';
	import { formatCurrency } from '$lib/utils/format.js';

	// DUMMY DATA FOR DEMO
	const demoRows = [
		{ id: '1', name: 'Aluminium Plate', qty: 5, unitPrice: 45.5, status: 'saved' },
		{ id: '2', name: 'Steel Bracket', qty: 12, unitPrice: 12.0, status: 'dirty' },
		{ id: '3', name: 'Custom Spacer', qty: 100, unitPrice: 0.85, status: 'none' }
	];
</script>

<div class="space-y-12 p-8">
	<!-- 1. TYPOGRAPHY (semantic classes only) -->
	<section class="space-y-4">
		<h1 class="h3">Typography Showcase</h1>
		<Text>
			This is a standard body paragraph using the <code
				class="relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm font-semibold"
				>.field-copy</code
			> class.
		</Text>
		<Text tone="muted">
			Secondary or helper text uses the <code
				class="relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm font-semibold"
				>.muted</code
			> class.
		</Text>
		<Meta>
			Small metadata or footer text uses the <code
				class="relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm font-semibold"
				>.caption</code
			> class.
		</Meta>
	</section>

	<!-- 2. BUTTONS & HUD DENSITY -->
	<section class="space-y-4">
		<h2 class="h4">HUD Controls</h2>
		<div class="flex items-center gap-2">
			<!-- Primary action: default height (32px = control-height-md), standard icon size (size-4) -->
			<Button size="default" class="gap-2">
				<PlusIcon class="size-4" />
				Add New Part
			</Button>

			<!-- Ghost/Secondary: Icon-only buttons (size="icon" = 36px = size-9 container, size-4 icon) -->
			<Button variant="ghost" size="icon" class="size-9">
				<SettingsIcon class="size-4" />
			</Button>

			<!-- Status Indicators (Dots) -->
			<div class="ms-4 flex items-center gap-4">
				<div class="flex items-center gap-1.5">
					<div class="status-dot-success"></div>
					<Meta as="span">Saved</Meta>
				</div>
				<div class="flex items-center gap-1.5">
					<div class="status-dot-warning"></div>
					<Meta as="span">Unsaved</Meta>
				</div>
				<div class="flex items-center gap-1.5">
					<div class="status-dot-muted"></div>
					<Meta as="span">Not Started</Meta>
				</div>
			</div>
		</div>
	</section>

	<section class="space-y-4">
		<h2 class="h4">Field Labels</h2>
		<div class="ui-radius-md border p-4">
			<FieldLabelRow
				for="showcase-workspace-name"
				tooltip="Owned label row for form labels and section labels with help icons."
			>
				Workspace name
			</FieldLabelRow>
			<Input id="showcase-workspace-name" size="sm" value="Acme Fabrication" class="mt-2" />
		</div>
	</section>

	<!-- 3. DATA TABLES (Industrial Density) -->
	<section class="space-y-4">
		<h2 class="h4">Industrial Data Table</h2>
		<div class="ui-radius-md border">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head><TableHeaderLabel text="Name" /></Table.Head>
						<Table.Head>
							<TableHeaderLabel text="Qty" align="right" />
						</Table.Head>
						<Table.Head>
							<TableHeaderLabel text="Unit Price" align="right" />
						</Table.Head>
						<Table.Head>
							<TableHeaderLabel text="Total" align="right" />
						</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each demoRows as row (row.id)}
						<Table.Row>
							<Table.Cell>
								<div class="flex items-center gap-2">
									<!-- Status Dot -->
									<div
										class={row.status === 'saved'
											? 'status-dot-success'
											: row.status === 'dirty'
												? 'status-dot-warning'
												: 'status-dot-muted'}
									></div>
									<TableTextCell text={row.name} />
								</div>
							</Table.Cell>
							<Table.Cell>
								<TableTextCell text={row.qty} align="right" tabular />
							</Table.Cell>
							<Table.Cell>
								<TableTextCell text={formatCurrency(row.unitPrice)} align="right" tabular />
							</Table.Cell>
							<Table.Cell>
								<TableTextCell
									text={formatCurrency(row.qty * row.unitPrice)}
									align="right"
									tabular
								/>
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</div>
	</section>
</div>
