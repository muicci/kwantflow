<script lang="ts">
	import { Eyebrow, Meta, Text } from '$lib/components/primitives/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import TableHeaderLabel from '$lib/components/table-header-label.svelte';
	import { formatIdentifierLabel } from '$lib/constants/index.js';
	import { formatCurrency, formatDate } from '$lib/utils/format.js';
	import type { QuoteRevision, QuoteRevisionOption } from '$lib/types/index.js';

	let {
		open = $bindable(false),
		revisions = [],
		isHydrated = true
	}: {
		open?: boolean;
		revisions?: QuoteRevision[];
		isHydrated?: boolean;
	} = $props();

	let activeRevisionId = $state<string | null>(null);

	function getSelectedOption(revision: QuoteRevision): QuoteRevisionOption | undefined {
		return (
			revision.options.find((option) => option.is_selected) ??
			revision.options.find((option) => option.is_default) ??
			revision.options[0]
		);
	}

	$effect(() => {
		if (!open) return;
		const nextRevisionId = revisions[0]?.id ?? null;
		if (!activeRevisionId || !revisions.some((revision) => revision.id === activeRevisionId)) {
			activeRevisionId = nextRevisionId;
		}
	});

	const activeRevision = $derived(
		revisions.find((revision) => revision.id === activeRevisionId) ?? revisions[0] ?? null
	);
	const activeOption = $derived(activeRevision ? getSelectedOption(activeRevision) : undefined);
	const revisionFacts = $derived.by(() => {
		if (!activeRevision) return [];

		return [
			{
				label: 'Revision',
				value: activeRevision.revision_label
			},
			{
				label: 'Issued',
				value: formatDate(activeRevision.issued_date)
			},
			{
				label: 'Valid until',
				value: activeRevision.valid_until_date
					? formatDate(activeRevision.valid_until_date)
					: 'Not recorded'
			},
			{
				label: 'Selected option',
				value: activeOption?.label ?? 'Option not recorded'
			}
		];
	});
	const contactSnapshotLines = $derived.by(() => {
		if (!activeRevision) return [];

		return [
			activeRevision.contact_business_id_value_snapshot
				? `${formatIdentifierLabel(activeRevision.contact_business_id_label_snapshot, 'Business ID')}: ${activeRevision.contact_business_id_value_snapshot}`
				: null,
			activeRevision.contact_tax_id_value_snapshot
				? `${formatIdentifierLabel(activeRevision.contact_tax_id_label_snapshot, 'Tax ID')}: ${activeRevision.contact_tax_id_value_snapshot}`
				: null,
			activeRevision.project_name_snapshot || null
		].filter((line): line is string => Boolean(line));
	});
	const businessSnapshotLines = $derived.by(() => {
		if (!activeRevision) return [];

		return [
			activeRevision.business_id_value_snapshot
				? `${formatIdentifierLabel(activeRevision.business_id_label_snapshot, 'Business ID')}: ${activeRevision.business_id_value_snapshot}`
				: null,
			activeRevision.tax_id_value_snapshot
				? `${formatIdentifierLabel(activeRevision.tax_id_label_snapshot, 'Tax ID')}: ${activeRevision.tax_id_value_snapshot}`
				: null,
			activeRevision.business_email_snapshot || null
		].filter((line): line is string => Boolean(line));
	});
</script>

<Dialog.Root bind:open>
	<Dialog.StandardFrame
		title="Revision History"
		description="Read-only commercial snapshot captured when the quote PDF was exported."
		class="ui-dialog-size-4xl ui-dialog-height-revision"
		bodyClass="ui-revision-history-body"
	>
		{#if !isHydrated}
			<div class="ui-pane-empty">
				<div class="ui-scroll-panel-card ui-pane-width-md">
					<Text>Loading revision history...</Text>
				</div>
			</div>
		{:else if revisions.length === 0}
			<div class="ui-pane-empty">
				<div class="ui-scroll-panel-card ui-pane-width-md">
					<Text>No revisions yet. Export a PDF from Quote to record the first revision.</Text>
				</div>
			</div>
		{:else}
			<div class="ui-revision-history-layout">
				<section class="ui-revision-history-rail" aria-label="Recorded revisions">
					<div class="ui-pane-card-header">
						<Eyebrow>Recorded revisions</Eyebrow>
					</div>
					<div class="ui-revision-history-list">
						{#each revisions as revision (revision.id)}
							{@const revisionOption = getSelectedOption(revision)}
							<button
								type="button"
								class="ui-revision-history-list-row"
								data-selected={revision.id === activeRevision?.id}
								onclick={() => {
									activeRevisionId = revision.id;
								}}
							>
								<div class="flex min-w-0 items-center justify-between gap-3">
									<Text as="span" class="truncate">{revision.revision_label}</Text>
									<Meta as="span" class="shrink-0">{formatDate(revision.issued_date)}</Meta>
								</div>
								{#if revisionOption}
									<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
										<Meta as="span">{revisionOption.label}</Meta>
										{#if revisionOption.lead_time}
											<Meta as="span">{revisionOption.lead_time}</Meta>
										{/if}
										<Meta as="span" class="tabular-nums">
											{formatCurrency(revisionOption.total_amount)}
										</Meta>
									</div>
								{/if}
							</button>
						{/each}
					</div>
				</section>

				{#if activeRevision}
					<div class="ui-revision-history-detail">
						<div class="ui-revision-history-summary-grid">
							<section class="ui-revision-history-card">
								<Eyebrow>Revision details</Eyebrow>
								<div class="ui-revision-history-fact-list">
									{#each revisionFacts as fact (fact.label)}
										<div class="ui-revision-history-fact-row">
											<span class="table-copy muted">{fact.label}</span>
											<span class="table-copy text-foreground">{fact.value}</span>
										</div>
									{/each}
								</div>
							</section>

							<section class="ui-revision-history-card">
								<Eyebrow>Snapshot</Eyebrow>
								<div class="ui-revision-history-fact-group">
									<span class="table-copy text-foreground">
										{activeRevision.contact_name_snapshot || 'No contact recorded'}
									</span>
									{#each contactSnapshotLines as line (`contact-${line}`)}
										<span class="table-copy muted">{line}</span>
									{/each}
								</div>
								<div class="ui-revision-history-fact-group">
									<span class="table-copy text-foreground">
										{activeRevision.business_name_snapshot}
									</span>
									{#each businessSnapshotLines as line (`business-${line}`)}
										<span class="table-copy muted">{line}</span>
									{/each}
								</div>
							</section>

							{#if activeRevision.package_attachments.length > 0}
								<section class="ui-revision-history-card ui-revision-history-card-span-2">
									<Eyebrow>
										Package attachments ({activeRevision.package_attachments.length})
									</Eyebrow>
									<div class="space-y-2">
										{#each activeRevision.package_attachments as attachment (`${attachment.file_name}-${attachment.status}`)}
											<div class="flex items-start justify-between gap-3">
												<div class="min-w-0">
													<span class="table-copy block truncate text-foreground">
														{attachment.file_name}
													</span>
													{#if attachment.reason}
														<span class="table-copy muted">
															{attachment.reason}
														</span>
													{/if}
												</div>
												<span class="table-copy muted shrink-0">
													{attachment.status === 'appended' ? 'Appended' : 'Omitted'}
												</span>
											</div>
										{/each}
									</div>
								</section>
							{/if}
						</div>

						{#if activeOption}
							<section class="space-y-3">
								<div class="grid gap-3 sm:grid-cols-3">
									<div class="space-y-1 sm:col-span-2">
										<Eyebrow>Commercial summary</Eyebrow>
										<span class="table-copy text-foreground">
											{activeOption.label}
											{#if activeOption.lead_time}
												· {activeOption.lead_time}
											{/if}
										</span>
										{#if activeOption.notes}
											<span class="table-copy muted">{activeOption.notes}</span>
										{/if}
									</div>
									<div class="space-y-1 text-left sm:text-right">
										<Eyebrow>Total</Eyebrow>
										<span class="table-copy text-foreground tabular-nums">
											{formatCurrency(activeOption.total_amount)}
										</span>
									</div>
								</div>

								<div class="ui-table-shell ui-table-shell-strong">
									<div class="ui-table-shell-body max-h-96 overflow-y-auto">
										<Table.Root>
											<Table.Header>
												<Table.Row>
													<Table.Head><TableHeaderLabel text="Asset" /></Table.Head>
													<Table.Head><TableHeaderLabel text="Description" /></Table.Head>
													<Table.Head><TableHeaderLabel text="Qty" align="right" /></Table.Head>
													<Table.Head><TableHeaderLabel text="Lead Time" /></Table.Head>
													<Table.Head
														><TableHeaderLabel text="Unit Price" align="right" /></Table.Head
													>
													<Table.Head
														><TableHeaderLabel text="Line Total" align="right" /></Table.Head
													>
												</Table.Row>
											</Table.Header>
											<Table.Body>
												{#each activeOption.line_items as item, index (`${item.file_name}-${index}`)}
													<Table.Row>
														<Table.Cell class="table-copy">{item.file_name}</Table.Cell>
														<Table.Cell>
															<span class="table-copy muted line-clamp-3 block max-w-md">
																{item.description || ' - '}
															</span>
														</Table.Cell>
														<Table.Cell class="table-copy text-right tabular-nums">
															{item.quantity}
														</Table.Cell>
														<Table.Cell class="table-copy">{item.lead_time}</Table.Cell>
														<Table.Cell class="table-copy text-right tabular-nums">
															{formatCurrency(item.unit_price)}
														</Table.Cell>
														<Table.Cell class="table-copy text-right tabular-nums">
															{formatCurrency(item.line_total)}
														</Table.Cell>
													</Table.Row>
												{:else}
													<Table.Row>
														<Table.Cell colspan={6} class="h-20 text-center">
															<Text as="span">No line items recorded for this revision.</Text>
														</Table.Cell>
													</Table.Row>
												{/each}
											</Table.Body>
										</Table.Root>
									</div>
								</div>

								<div class="ui-revision-history-totals">
									<div class="flex items-center justify-between gap-3">
										<span class="table-copy muted">Subtotal</span>
										<span class="table-copy text-foreground tabular-nums">
											{formatCurrency(activeOption.subtotal_amount)}
										</span>
									</div>
									<div class="flex items-center justify-between gap-3">
										<span class="table-copy muted">
											{activeRevision.tax_display_label_snapshot || 'Tax'}
											{#if activeRevision.tax_rate_percentage_snapshot != null}
												({activeRevision.tax_rate_percentage_snapshot}%)
											{/if}
										</span>
										<span class="table-copy text-foreground tabular-nums">
											{formatCurrency(activeOption.gst_amount)}
										</span>
									</div>
									<div class="flex items-center justify-between gap-3">
										<span class="table-copy text-foreground">Total</span>
										<span class="table-copy text-foreground tabular-nums">
											{formatCurrency(activeOption.total_amount)}
										</span>
									</div>
								</div>
							</section>
						{/if}
					</div>
				{/if}
			</div>
		{/if}
		{#snippet footer()}
			<Button variant="secondary" size="sm" onclick={() => (open = false)}>Close</Button>
		{/snippet}
	</Dialog.StandardFrame>
</Dialog.Root>
