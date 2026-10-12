<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import {
		clampQuoteOptionMarkupPercentage,
		estimateTotalCost,
		estimateTotalPrice,
		getQuoteEngine
	} from '$lib/state/quote.svelte.js';
	import { quoteOptionPresetFormSchema } from '$lib/schemas/index.js';
	import type { QuoteOptionPresetFormValues } from '$lib/schemas/index.js';
	import { formatCurrency } from '$lib/utils/format.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import BooleanStateBadge from '$lib/components/boolean-state-badge.svelte';
	import { Input, InputAffix } from '$lib/components/ui/input/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import FormHelpTooltip from '$lib/components/form-help-tooltip.svelte';
	import TableHeaderLabel from '$lib/components/table-header-label.svelte';
	import {
		FieldError,
		FieldLabel,
		FieldLabelRow,
		FieldShell,
		Inline,
		Meta,
		Panel,
		SectionLabel,
		Stack,
		Text
	} from '$lib/components/primitives/index.js';
	import { getProjectCompanyDisplayName } from '$lib/utils/project-contact.js';
	import { getFieldInvalidTone } from '$lib/utils/field-errors.js';

	import BookmarkPlusIcon from '@lucide/svelte/icons/bookmark-plus';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import StarIcon from '@lucide/svelte/icons/star';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import MoreHorizontalIcon from '@lucide/svelte/icons/more-horizontal';
	import FileDownIcon from '@lucide/svelte/icons/file-down';
	import { invoke } from '@tauri-apps/api/core';
	import { errorState } from '$lib/state/errors.svelte.js';
	import { toast } from 'svelte-sonner';
	import {
		generateQuoteXlsxBytes,
		buildCostBreakdownRows
	} from '$lib/services/quote-excel-export.js';

	let { data } = $props();
	const engine = getQuoteEngine();
	type AppHref = `/project/${string}/asset/${string}`;

	const workingAssets = $derived(data.assets.filter((a) => engine.isSelected(a.id)));
	const hasAssets = $derived(data.assets.length > 0);
	const activeOption = $derived(engine.getActiveQuoteOption());
	let estimatesReady = $state(false);
	let estimateLoadVersion = 0;
	let resetDialogOpen = $state(false);
	let resettingQuoteWorkspace = $state(false);
	let savePresetDialogOpen = $state(false);
	let managePresetsDialogOpen = $state(false);
	let overwritePresetDialogOpen = $state(false);
	let savingPreset = $state(false);
	let updatingPreset = $state(false);
	let deletingPreset = $state(false);
	let overwritingPreset = $state(false);
	let managedPresetId = $state<string | null>(null);
	let pendingPresetOverwrite = $state<{
		targetPresetId: string;
		targetPresetLabel: string;
		values: QuoteOptionPresetFormValues;
	} | null>(null);
	let savePresetFieldErrors = $state<Partial<Record<keyof QuoteOptionPresetFormValues, string[]>>>(
		{}
	);
	let managePresetFieldErrors = $state<
		Partial<Record<keyof QuoteOptionPresetFormValues, string[]>>
	>({});
	let savePresetFormValues = $state<QuoteOptionPresetFormValues>({
		label: '',
		lead_time: '2 weeks',
		markup_percentage: 0,
		material_markup_percentage: null,
		labour_markup_percentage: null,
		equipment_markup_percentage: null,
		subcontract_markup_percentage: null,
		notes: ''
	});
	let managePresetFormValues = $state<QuoteOptionPresetFormValues>({
		label: '',
		lead_time: '2 weeks',
		markup_percentage: 0,
		material_markup_percentage: null,
		labour_markup_percentage: null,
		equipment_markup_percentage: null,
		subcontract_markup_percentage: null,
		notes: ''
	});

	$effect(() => {
		const assetIds = workingAssets.map((asset) => asset.id);
		if (assetIds.length === 0) {
			estimatesReady = true;
			return;
		}

		const version = ++estimateLoadVersion;
		estimatesReady = false;
		void engine.hydrateEstimatesForAssets(assetIds).then(() => {
			if (estimateLoadVersion === version) {
				estimatesReady = true;
			}
		});
	});

	const quantities = $derived(
		Object.fromEntries(workingAssets.map((a) => [a.id, engine.getQuantity(a.id)]))
	);
	const selected = $derived(
		Object.fromEntries(workingAssets.map((a) => [a.id, engine.isPdfIncluded(a.id)]))
	);

	const allSelected = $derived(
		workingAssets.length > 0 && workingAssets.every((a) => selected[a.id])
	);
	const someSelected = $derived(workingAssets.some((a) => selected[a.id]) && !allSelected);

	function toggleSelectAll() {
		const newVal = !allSelected;
		for (const a of workingAssets) {
			engine.setPdfInclusion(a.id, newVal);
		}
	}

	let exportingExcel = $state(false);

	async function handleExportExcel() {
		exportingExcel = true;
		try {
			const lineItems = workingAssets.map((asset) => {
				const est = engine.getEstimate(asset.id);
				const cost = estimateTotalPrice(
					est,
					activeOption.markup_percentage,
					activeOption.material_markup_percentage,
					activeOption.labour_markup_percentage,
					activeOption.equipment_markup_percentage,
					activeOption.subcontract_markup_percentage
				);
				const unitPrice = engine.roundPrices ? Math.ceil(cost) : cost;
				const qty = engine.getQuantity(asset.id);
				return {
					assetName: asset.display_name,
					scopeSummary: est.scope_summary || '',
					quantity: qty,
					leadTime: activeOption.lead_time,
					estCost: cost,
					markupPercent: activeOption.markup_percentage,
					unitPrice,
					lineTotal: unitPrice * qty
				};
			});

			const costBreakdownRows = workingAssets.flatMap((asset) => {
				const est = engine.getEstimate(asset.id);
				return buildCostBreakdownRows(asset.display_name, est.takeoff_items);
			});

			const grandTotal = lineItems.reduce((sum, item) => sum + item.lineTotal, 0);

			const bytes = await generateQuoteXlsxBytes({
				rfqNumber: data.project.rfq_number,
				lineItems,
				costBreakdownRows,
				grandTotal
			});

			await invoke('save_quote_xlsx', {
				rfqNumber: data.project.rfq_number,
				bytes: Array.from(bytes),
				openFile: true
			});

			toast.success('Quote exported to Excel');
		} catch (error) {
			await errorState.catchError(error, 'Export quote to Excel');
		} finally {
			exportingExcel = false;
		}
	}

	async function handleReset() {
		resettingQuoteWorkspace = true;
		try {
			await engine.resetAll();
			resetDialogOpen = false;
		} finally {
			resettingQuoteWorkspace = false;
		}
	}

	function unitCost(assetId: string): number {
		return estimateTotalCost(engine.getEstimate(assetId));
	}

	function quotedUnitPrice(assetId: string): number {
		const est = engine.getEstimate(assetId);
		if (!est) return 0;
		const raw = estimateTotalPrice(
			est,
			activeOption.markup_percentage,
			activeOption.material_markup_percentage,
			activeOption.labour_markup_percentage,
			activeOption.equipment_markup_percentage,
			activeOption.subcontract_markup_percentage
		);
		return engine.roundPrices ? Math.ceil(raw) : raw;
	}

	function quotedTotalPrice(assetId: string): number {
		return quotedUnitPrice(assetId) * (quantities[assetId] || 1);
	}

	const selectedCount = $derived(workingAssets.filter((a) => selected[a.id]).length);
	const grandTotal = $derived(
		workingAssets.reduce((sum, a) => (selected[a.id] ? sum + quotedTotalPrice(a.id) : sum), 0)
	);

	const totalCols = $derived(7);

	function navigateToAsset(assetId: string) {
		goto(resolve(`/project/${data.project.id}/asset/${assetId}` as AppHref));
	}

	function buildPresetFormValues(source: {
		label: string;
		lead_time: string;
		markup_percentage: number;
		material_markup_percentage: number | null;
		labour_markup_percentage: number | null;
		equipment_markup_percentage: number | null;
		subcontract_markup_percentage: number | null;
		notes: string;
	}): QuoteOptionPresetFormValues {
		return {
			label: source.label,
			lead_time: source.lead_time,
			markup_percentage: clampQuoteOptionMarkupPercentage(source.markup_percentage),
			material_markup_percentage: source.material_markup_percentage,
			labour_markup_percentage: source.labour_markup_percentage,
			equipment_markup_percentage: source.equipment_markup_percentage,
			subcontract_markup_percentage: source.subcontract_markup_percentage,
			notes: source.notes
		};
	}

	function parsePresetFormValues(values: QuoteOptionPresetFormValues) {
		function toNumberOrNull(val: unknown): number | null {
			if (val === null || val === undefined || val === '') return null;
			const n = Number(val);
			return Number.isNaN(n) ? null : n;
		}
		const parsed = quoteOptionPresetFormSchema.safeParse({
			label: values.label,
			lead_time: values.lead_time,
			markup_percentage: clampQuoteOptionMarkupPercentage(values.markup_percentage),
			material_markup_percentage: toNumberOrNull(values.material_markup_percentage),
			labour_markup_percentage: toNumberOrNull(values.labour_markup_percentage),
			equipment_markup_percentage: toNumberOrNull(values.equipment_markup_percentage),
			subcontract_markup_percentage: toNumberOrNull(values.subcontract_markup_percentage),
			notes: values.notes
		});
		if (parsed.success) {
			return {
				success: true as const,
				data: parsed.data
			};
		}
		return {
			success: false as const,
			errors: parsed.error.flatten().fieldErrors
		};
	}

	function formatMarkupSummary(markupPercentage: number): string {
		return `${markupPercentage > 0 ? '+' : ''}${markupPercentage}%`;
	}

	function normalisePresetLabel(label: string): string {
		return label.trim().toLocaleLowerCase();
	}

	function findPresetByLabel(label: string, excludePresetId?: string | null) {
		const normalisedLabel = normalisePresetLabel(label);
		if (!normalisedLabel) return undefined;
		return engine.quoteOptionPresets.find(
			(preset) =>
				preset.id !== excludePresetId && normalisePresetLabel(preset.label) === normalisedLabel
		);
	}

	function openSavePresetDialog() {
		savePresetFieldErrors = {};
		savePresetFormValues = buildPresetFormValues(activeOption);
		savePresetDialogOpen = true;
	}

	function syncManagedPresetForm(presetId: string | null) {
		managedPresetId = presetId;
		managePresetFieldErrors = {};
		const preset = presetId ? engine.getQuoteOptionPreset(presetId) : null;
		managePresetFormValues = preset
			? buildPresetFormValues(preset)
			: {
					label: '',
					lead_time: '2 weeks',
					markup_percentage: 0,
					material_markup_percentage: null,
					labour_markup_percentage: null,
					equipment_markup_percentage: null,
					subcontract_markup_percentage: null,
					notes: ''
				};
	}

	function openManagePresetsDialog() {
		syncManagedPresetForm(engine.quoteOptionPresets[0]?.id ?? null);
		managePresetsDialogOpen = true;
	}

	async function handleSavePreset() {
		const parsed = parsePresetFormValues(savePresetFormValues);
		if (!parsed.success) {
			savePresetFieldErrors = parsed.errors;
			return;
		}

		const duplicatePreset = findPresetByLabel(parsed.data.label);
		if (duplicatePreset) {
			pendingPresetOverwrite = {
				targetPresetId: duplicatePreset.id,
				targetPresetLabel: duplicatePreset.label,
				values: parsed.data
			};
			overwritePresetDialogOpen = true;
			return;
		}

		savingPreset = true;
		savePresetFieldErrors = {};
		try {
			await engine.saveQuoteOptionAsPreset(activeOption.id, parsed.data);
			savePresetDialogOpen = false;
		} catch {
			// errorState handles the toast and logging in quote state
		} finally {
			savingPreset = false;
		}
	}

	async function handleUpdatePreset() {
		if (!managedPresetId) return;
		const parsed = parsePresetFormValues(managePresetFormValues);
		if (!parsed.success) {
			managePresetFieldErrors = parsed.errors;
			return;
		}

		const duplicatePreset = findPresetByLabel(parsed.data.label, managedPresetId);
		if (duplicatePreset) {
			managePresetFieldErrors = {
				label: [`Preset label "${duplicatePreset.label}" already exists`]
			};
			return;
		}

		updatingPreset = true;
		managePresetFieldErrors = {};
		try {
			await engine.updateQuoteOptionPreset(managedPresetId, parsed.data);
			syncManagedPresetForm(managedPresetId);
		} catch {
			// errorState handles the toast and logging in quote state
		} finally {
			updatingPreset = false;
		}
	}

	async function handleDeleteManagedPreset() {
		if (!managedPresetId) return;
		const nextPresetId =
			engine.quoteOptionPresets.find((preset) => preset.id !== managedPresetId)?.id ?? null;
		deletingPreset = true;
		try {
			await engine.deleteQuoteOptionPreset(managedPresetId);
			syncManagedPresetForm(nextPresetId);
		} catch {
			// errorState handles the toast and logging in quote state
		} finally {
			deletingPreset = false;
		}
	}

	async function handleConfirmPresetOverwrite() {
		if (!pendingPresetOverwrite) return;
		overwritingPreset = true;
		try {
			await engine.updateQuoteOptionPreset(
				pendingPresetOverwrite.targetPresetId,
				pendingPresetOverwrite.values
			);
			overwritePresetDialogOpen = false;
			savePresetDialogOpen = false;
			pendingPresetOverwrite = null;
		} catch {
			// errorState handles the toast and logging in quote state
		} finally {
			overwritingPreset = false;
		}
	}
</script>

<div class="ui-route-frame overflow-hidden">
	<div class="ui-pane-shell flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
		<Inline justify="space-between" class="ui-pane-header ui-pane-header-compact px-4">
			<span class="title-copy">Quote Summary</span>
			<Inline gap="var(--space-4)">
				<label class="flex cursor-pointer items-center gap-2">
					<Checkbox
						checked={engine.roundPrices}
						onCheckedChange={(checked) => {
							engine.setRoundPrices(Boolean(checked));
						}}
					/>
					<SectionLabel>Round</SectionLabel>
				</label>
				<Button
					variant="secondary"
					size="xs"
					onclick={() => void handleExportExcel()}
					disabled={!estimatesReady || workingAssets.length === 0 || exportingExcel}
					class="gap-1.5"
				>
					<FileDownIcon class="size-3.5" />
					{exportingExcel ? 'Exporting…' : 'Export Excel'}
				</Button>
				<Button variant="secondary" size="xs" onclick={() => (resetDialogOpen = true)}>Reset</Button
				>
			</Inline>
		</Inline>

		<div class="min-h-0 flex-1 overflow-y-auto">
			<Stack gap="var(--space-3)" class="p-4">
				{#if !hasAssets}
					<div class="ui-empty-panel-card">
						<Text as="span" tone="muted" class="text-center">
							Create an asset in the Estimate workspace to unlock Quote and PDF Preview.
						</Text>
					</div>
				{:else if !estimatesReady}
					<div class="ui-empty-panel-card">
						<Text as="span" tone="muted" class="text-center"
							>Loading selected estimate details…</Text
						>
					</div>
				{:else}
					<div class="ui-table-shell ui-table-shell-strong">
						<div class="ui-table-shell-body">
							<Table.Root>
								<Table.Header class="ui-table-header-surface sticky top-0 z-10">
									<Table.Row>
										<Table.Head><TableHeaderLabel text="Asset" /></Table.Head>
										<Table.Head class="w-14 px-0 text-center">
											<div class="flex items-center justify-center">
												<Checkbox
													checked={allSelected}
													indeterminate={someSelected}
													onCheckedChange={toggleSelectAll}
													aria-label="Select all assets for PDF"
												/>
											</div>
										</Table.Head>
										<Table.Head class="w-24 min-w-24">
											<TableHeaderLabel text="Qty" align="right" />
										</Table.Head>
										<Table.Head class="w-24"><TableHeaderLabel text="Lead Time" /></Table.Head>
										<Table.Head>
											<TableHeaderLabel text="Est. Cost" align="right" />
										</Table.Head>
										<Table.Head>
											<TableHeaderLabel text="Unit Price" align="right" />
										</Table.Head>
										<Table.Head>
											<TableHeaderLabel text="Line Total" align="right" />
										</Table.Head>
									</Table.Row>
								</Table.Header>

								<Table.Body>
									{#each workingAssets as asset (asset.id)}
										{@const est = engine.getEstimate(asset.id)}
										<Table.Row
											class="group ui-table-row-selectable {selected[asset.id]
												? 'ui-table-row-selectable-active'
												: 'opacity-40'}"
										>
											<Table.Cell>
												<button
													type="button"
													onclick={() => navigateToAsset(asset.id)}
													class="table-copy text-foreground hover:underline"
												>
													<Text as="span" class="table-copy text-foreground">
														{asset.display_name}
													</Text>
												</button>
												{#if est.scope_summary}
													<Meta class="mt-0.5 max-w-xs truncate">{est.scope_summary}</Meta>
												{/if}
											</Table.Cell>
											<Table.Cell class="w-14 px-0 text-center">
												<div class="flex items-center justify-center">
													<Checkbox
														checked={selected[asset.id]}
														onCheckedChange={() => {
															engine.setPdfInclusion(asset.id, !engine.isPdfIncluded(asset.id));
														}}
														aria-label={`Include ${asset.display_name} in PDF`}
													/>
												</div>
											</Table.Cell>
											<Table.Cell class="w-24 min-w-24 text-right">
												<Input
													type="number"
													size="sm"
													min="1"
													placeholder="1"
													value={quantities[asset.id]}
													oninput={(e) => {
														engine.setQuantity(asset.id, parseInt(e.currentTarget.value) || 1);
													}}
													class="w-full text-right tabular-nums"
												/>
											</Table.Cell>
											<Table.Cell class="table-copy">{activeOption.lead_time}</Table.Cell>
											<Table.Cell class="text-right">
												<span class="table-copy muted tabular-nums"
													>{formatCurrency(unitCost(asset.id))}</span
												>
											</Table.Cell>
											<Table.Cell class="text-right">
												<span class="table-copy tabular-nums"
													>{formatCurrency(quotedUnitPrice(asset.id))}</span
												>
											</Table.Cell>
											<Table.Cell class="text-right">
												<span class="table-copy tabular-nums"
													>{formatCurrency(quotedTotalPrice(asset.id))}</span
												>
											</Table.Cell>
										</Table.Row>
									{:else}
										<Table.Row>
											<Table.Cell colspan={totalCols} class="h-24 text-center">
												<Text as="span" tone="muted">
													Select assets in the workspace to generate a quote.
												</Text>
											</Table.Cell>
										</Table.Row>
									{/each}
								</Table.Body>

								{#if workingAssets.length > 0}
									<Table.Footer>
										<Table.Row class="ui-table-footer-surface">
											<Table.Cell colspan={6} class="title-copy text-right">
												Grand Total ({selectedCount} of {workingAssets.length})
											</Table.Cell>
											<Table.Cell class="text-right">
												<span class="title-copy tabular-nums">
													{formatCurrency(grandTotal)}
												</span>
											</Table.Cell>
										</Table.Row>
									</Table.Footer>
								{/if}
							</Table.Root>
						</div>
					</div>
				{/if}
			</Stack>
		</div>
	</div>

	<aside
		class="ui-pane-width-md ui-viewer-shell ui-side-divider flex h-full min-h-0 flex-col overflow-hidden"
	>
		<Inline justify="space-between" class="ui-pane-header ui-pane-header-compact shrink-0 px-4">
			<Inline gap="var(--space-1-5)" class="min-w-0">
				<h4 class="title-copy">Quote Options</h4>
				<FormHelpTooltip content="Choose which commercial option appears on this quote." />
			</Inline>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Button variant="secondary" size="xs" class="gap-1.5 px-3" {...props}>
							<PlusIcon class="size-3.5" />
							Add Option
						</Button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end" class="ui-popover-width-sm ui-radius-lg">
					<DropdownMenu.Item onclick={() => void engine.addQuoteOption()}>
						<PlusIcon class="size-4" />
						<span>Blank option</span>
					</DropdownMenu.Item>
					<DropdownMenu.Separator />
					<DropdownMenu.Label>Saved presets</DropdownMenu.Label>
					{#if engine.quoteOptionPresets.length > 0}
						{#each engine.quoteOptionPresets as preset (preset.id)}
							<DropdownMenu.Item onclick={() => void engine.addQuoteOptionFromPreset(preset.id)}>
								<div class="flex min-w-0 flex-1 flex-col gap-0.5">
									<Text as="span" class="truncate">{preset.label}</Text>
									<Meta as="span">
										{formatMarkupSummary(preset.markup_percentage)} · {preset.lead_time}
									</Meta>
								</div>
							</DropdownMenu.Item>
						{/each}
					{:else}
						<DropdownMenu.Item disabled>No presets saved yet</DropdownMenu.Item>
					{/if}
					<DropdownMenu.Separator />
					<DropdownMenu.Item onclick={openManagePresetsDialog}>
						<BookmarkPlusIcon class="size-4" />
						<span>Manage presets</span>
					</DropdownMenu.Item>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		</Inline>
		<div class="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
			<Stack gap="var(--space-3)" class="shrink-0">
				<div class="flex flex-col gap-3 sm:flex-row sm:items-end">
					<FieldShell class="ui-field-width-sm w-full">
						<FieldLabelRow
							for="quote-option-select"
							tooltip="Choose which commercial option is used for the quote summary and PDF."
						>
							Active Option
						</FieldLabelRow>
						<Select.Root
							type="single"
							value={activeOption.id}
							onValueChange={(value) => {
								if (value) engine.setActiveQuoteOption(String(value));
							}}
						>
							<Select.Trigger id="quote-option-select" size="sm" class="w-full">
								{activeOption.label}
							</Select.Trigger>
							<Select.Content>
								{#each engine.quoteOptions as option (option.id)}
									<Select.Item value={option.id} label={option.label}>
										<div class="flex min-w-0 items-center justify-between gap-2">
											<span class="truncate">{option.label}</span>
											{#if option.is_default}
												<BooleanStateBadge
													value={true}
													trueLabel="Default"
													tone="default"
													falseMode="hidden"
													class="shrink-0"
												/>
											{/if}
										</div>
									</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</FieldShell>
					<Inline justify="flex-end" gap="var(--space-2)" class="flex-1">
						<Meta class="tabular-nums">
							{engine.quoteOptions.length} option{engine.quoteOptions.length === 1 ? '' : 's'}
						</Meta>
					</Inline>
				</div>

				<div class="grid gap-4">
					<div class="grid gap-3 sm:grid-cols-2">
						<FieldShell>
							<FieldLabelRow
								for="quote-option-label"
								tooltip="Shown in the option selector and quote output."
							>
								Option Label
							</FieldLabelRow>
							<Input
								id="quote-option-label"
								size="sm"
								value={activeOption.label}
								placeholder="e.g. Base option"
								oninput={(e) =>
									engine.updateQuoteOption(activeOption.id, {
										label: e.currentTarget.value
									})}
								class="w-full"
							/>
						</FieldShell>
						<FieldShell>
							<FieldLabelRow
								for="quote-option-lead-time"
								tooltip="Lead time shown for this quote option."
							>
								Lead Time
							</FieldLabelRow>
							<Input
								id="quote-option-lead-time"
								size="sm"
								value={activeOption.lead_time}
								placeholder="e.g. 2 weeks"
								oninput={(e) =>
									engine.updateQuoteOption(activeOption.id, {
										lead_time: e.currentTarget.value
									})}
								class="w-full"
							/>
						</FieldShell>
					</div>

					<div class="flex flex-col gap-4">
						<div class="flex flex-wrap items-end gap-3">
							<FieldShell class="shrink-0 sm:w-32">
								<FieldLabelRow
									for="quote-option-markup"
									tooltip="General markup percentage. Per-category values below override this when set."
								>
									Markup
								</FieldLabelRow>
								<InputAffix affix="%" numeric class="w-28">
									<Input
										id="quote-option-markup"
										size="sm"
										type="text"
										inputmode="decimal"
										placeholder="0.00"
										value={activeOption.markup_percentage
											? String(activeOption.markup_percentage)
											: ''}
										oninput={(e) =>
											engine.updateQuoteOption(activeOption.id, {
												markup_percentage: clampQuoteOptionMarkupPercentage(
													parseFloat(e.currentTarget.value) || 0
												)
											})}
										class="text-right tabular-nums"
									/>
								</InputAffix>
							</FieldShell>
							<Inline gap="var(--space-1)" class="sm:justify-end">
								<DropdownMenu.Root>
									<DropdownMenu.Trigger>
										{#snippet child({ props })}
											<Button {...props} variant="ghost" size="icon-sm">
												<MoreHorizontalIcon class="size-3.5" />
												<span class="sr-only">Option actions</span>
											</Button>
										{/snippet}
									</DropdownMenu.Trigger>
									<DropdownMenu.Content align="end" class="ui-popover-width-sm">
										<DropdownMenu.Item onclick={openSavePresetDialog}>
											<BookmarkPlusIcon class="size-4" />
											<span>Save as preset</span>
										</DropdownMenu.Item>
										<DropdownMenu.Item
											onclick={() => engine.setDefaultQuoteOption(activeOption.id)}
											disabled={activeOption.is_default}
										>
											<StarIcon class="size-4" />
											<span>{activeOption.is_default ? 'Default option' : 'Set as default'}</span>
										</DropdownMenu.Item>
										<DropdownMenu.Separator />
										<DropdownMenu.Item
											class="menu-item-destructive"
											disabled={engine.quoteOptions.length <= 1}
											onclick={() => engine.removeQuoteOption(activeOption.id)}
										>
											<Trash2Icon class="size-4" />
											<span>Remove option</span>
										</DropdownMenu.Item>
									</DropdownMenu.Content>
								</DropdownMenu.Root>
							</Inline>
						</div>
						{#if activeOption}
							<div class="grid grid-cols-2 gap-2">
								<FieldShell class="w-36">
									<FieldLabelRow
										for="quote-option-material-markup"
										tooltip="Overrides the general markup for material costs only. Leave blank to use the general markup."
									>
										Material
									</FieldLabelRow>
									<InputAffix affix="%" numeric>
										<Input
											id="quote-option-material-markup"
											size="sm"
											type="text"
											inputmode="decimal"
											placeholder="—"
											value={activeOption.material_markup_percentage != null
												? String(activeOption.material_markup_percentage)
												: ''}
											oninput={(e) =>
												engine.updateQuoteOption(activeOption.id, {
													material_markup_percentage: parseFloat(e.currentTarget.value) || null
												})}
											class="text-right tabular-nums"
										/>
									</InputAffix>
								</FieldShell>
								<FieldShell class="w-36">
									<FieldLabelRow
										for="quote-option-labour-markup"
										tooltip="Overrides the general markup for labour costs only. Leave blank to use the general markup."
									>
										Labour
									</FieldLabelRow>
									<InputAffix affix="%" numeric>
										<Input
											id="quote-option-labour-markup"
											size="sm"
											type="text"
											inputmode="decimal"
											placeholder="—"
											value={activeOption.labour_markup_percentage != null
												? String(activeOption.labour_markup_percentage)
												: ''}
											oninput={(e) =>
												engine.updateQuoteOption(activeOption.id, {
													labour_markup_percentage: parseFloat(e.currentTarget.value) || null
												})}
											class="text-right tabular-nums"
										/>
									</InputAffix>
								</FieldShell>
								<FieldShell class="w-36">
									<FieldLabelRow
										for="quote-option-equipment-markup"
										tooltip="Overrides the general markup for equipment costs only. Leave blank to use the general markup."
									>
										Equipment
									</FieldLabelRow>
									<InputAffix affix="%" numeric>
										<Input
											id="quote-option-equipment-markup"
											size="sm"
											type="text"
											inputmode="decimal"
											placeholder="—"
											value={activeOption.equipment_markup_percentage != null
												? String(activeOption.equipment_markup_percentage)
												: ''}
											oninput={(e) =>
												engine.updateQuoteOption(activeOption.id, {
													equipment_markup_percentage: parseFloat(e.currentTarget.value) || null
												})}
											class="text-right tabular-nums"
										/>
									</InputAffix>
								</FieldShell>
								<FieldShell class="w-36">
									<FieldLabelRow
										for="quote-option-subcontract-markup"
										tooltip="Overrides the general markup for subcontract costs only. Leave blank to use the general markup."
									>
										Subcontract
									</FieldLabelRow>
									<InputAffix affix="%" numeric>
										<Input
											id="quote-option-subcontract-markup"
											size="sm"
											type="text"
											inputmode="decimal"
											placeholder="—"
											value={activeOption.subcontract_markup_percentage != null
												? String(activeOption.subcontract_markup_percentage)
												: ''}
											oninput={(e) =>
												engine.updateQuoteOption(activeOption.id, {
													subcontract_markup_percentage: parseFloat(e.currentTarget.value) || null
												})}
											class="text-right tabular-nums"
										/>
									</InputAffix>
								</FieldShell>
							</div>
						{/if}

						<FieldShell>
							<FieldLabelRow
								for="quote-option-notes"
								tooltip="Printed on the quote for this option only."
							>
								Option Notes
							</FieldLabelRow>
							<Textarea
								id="quote-option-notes"
								size="default"
								value={activeOption.notes}
								oninput={(e) =>
									engine.updateQuoteOption(activeOption.id, {
										notes: e.currentTarget.value
									})}
								placeholder="Printed on the quote for this option only."
								class="min-h-28 resize-none"
							/>
						</FieldShell>
					</div>
				</div></Stack
			>

			<Separator class="my-4 shrink-0" />

			<Stack gap="var(--space-2)" class="shrink-0">
				<SectionLabel>Company</SectionLabel>
				<Input
					readonly
					size="default"
					value={getProjectCompanyDisplayName(data.project) || 'No company set'}
					class="w-full"
					placeholder="No company set"
				/>
			</Stack>
		</div>
	</aside>
</div>

<Dialog.Root bind:open={savePresetDialogOpen}>
	<Dialog.Content class="ui-dialog-size-sm">
		<Dialog.Header>
			<Dialog.Title>Save Quote Option Preset</Dialog.Title>
			<Dialog.Description>
				Store this commercial option as a reusable preset for future RFQs.
			</Dialog.Description>
		</Dialog.Header>
		<div class="space-y-4">
			<FieldShell invalidTone={getFieldInvalidTone(savePresetFieldErrors.label)}>
				<FieldLabel for="quote-preset-label">Preset Label</FieldLabel>
				<Input
					id="quote-preset-label"
					bind:value={savePresetFormValues.label}
					size="sm"
					invalidTone={getFieldInvalidTone(savePresetFieldErrors.label)}
					placeholder="e.g. Preferred Customer -10%"
				/>
				<FieldError errors={savePresetFieldErrors.label} />
			</FieldShell>
			<div class="grid gap-3 sm:grid-cols-2">
				<FieldShell invalidTone={getFieldInvalidTone(savePresetFieldErrors.lead_time)}>
					<FieldLabel for="quote-preset-lead-time">Lead Time</FieldLabel>
					<Input
						id="quote-preset-lead-time"
						bind:value={savePresetFormValues.lead_time}
						size="sm"
						invalidTone={getFieldInvalidTone(savePresetFieldErrors.lead_time)}
						placeholder="e.g. 2 weeks"
					/>
					<FieldError errors={savePresetFieldErrors.lead_time} />
				</FieldShell>
				<FieldShell invalidTone={getFieldInvalidTone(savePresetFieldErrors.markup_percentage)}>
					<FieldLabel for="quote-preset-markup">Markup</FieldLabel>
					<InputAffix affix="%" size="sm" numeric class="w-28">
						<Input
							id="quote-preset-markup"
							size="sm"
							type="text"
							inputmode="decimal"
							bind:value={savePresetFormValues.markup_percentage}
							invalidTone={getFieldInvalidTone(savePresetFieldErrors.markup_percentage)}
							class="text-right tabular-nums"
							placeholder="0.00"
						/>
					</InputAffix>
					<FieldError errors={savePresetFieldErrors.markup_percentage} />
				</FieldShell>
			</div>
			<div class="grid grid-cols-2 gap-2">
				<FieldShell class="w-36">
					<FieldLabelRow
						for="preset-material-markup"
						tooltip="Overrides the general markup for material costs only. Leave blank to use the general markup."
					>
						Material
					</FieldLabelRow>
					<InputAffix affix="%" size="sm" numeric>
						<Input
							id="preset-material-markup"
							size="sm"
							type="text"
							inputmode="decimal"
							bind:value={savePresetFormValues.material_markup_percentage}
							class="text-right tabular-nums"
							placeholder="—"
						/>
					</InputAffix>
				</FieldShell>
				<FieldShell class="w-36">
					<FieldLabelRow
						for="preset-labour-markup"
						tooltip="Overrides the general markup for labour costs only. Leave blank to use the general markup."
					>
						Labour
					</FieldLabelRow>
					<InputAffix affix="%" size="sm" numeric>
						<Input
							id="preset-labour-markup"
							size="sm"
							type="text"
							inputmode="decimal"
							bind:value={savePresetFormValues.labour_markup_percentage}
							class="text-right tabular-nums"
							placeholder="—"
						/>
					</InputAffix>
				</FieldShell>
				<FieldShell class="w-36">
					<FieldLabelRow
						for="preset-equipment-markup"
						tooltip="Overrides the general markup for equipment costs only. Leave blank to use the general markup."
					>
						Equipment
					</FieldLabelRow>
					<InputAffix affix="%" size="sm" numeric>
						<Input
							id="preset-equipment-markup"
							size="sm"
							type="text"
							inputmode="decimal"
							bind:value={savePresetFormValues.equipment_markup_percentage}
							class="text-right tabular-nums"
							placeholder="—"
						/>
					</InputAffix>
				</FieldShell>
				<FieldShell class="w-36">
					<FieldLabelRow
						for="preset-subcontract-markup"
						tooltip="Overrides the general markup for subcontract costs only. Leave blank to use the general markup."
					>
						Subcontract
					</FieldLabelRow>
					<InputAffix affix="%" size="sm" numeric>
						<Input
							id="preset-subcontract-markup"
							size="sm"
							type="text"
							inputmode="decimal"
							bind:value={savePresetFormValues.subcontract_markup_percentage}
							class="text-right tabular-nums"
							placeholder="—"
						/>
					</InputAffix>
				</FieldShell>
			</div>
			<FieldShell>
				<FieldLabel for="quote-preset-notes">Preset Notes</FieldLabel>
				<Textarea
					id="quote-preset-notes"
					size="sm"
					bind:value={savePresetFormValues.notes}
					placeholder="Optional preset notes for future quote options."
					class="min-h-24 resize-none"
				/>
			</FieldShell>
		</div>
		<Dialog.Footer density="compact">
			<Button variant="secondary" size="default" onclick={() => (savePresetDialogOpen = false)}
				>Cancel</Button
			>
			<Button
				variant="brand"
				size="default"
				onclick={() => void handleSavePreset()}
				disabled={savingPreset}
			>
				{savingPreset ? 'Saving…' : 'Save Preset'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={managePresetsDialogOpen}>
	<Dialog.Content class="ui-dialog-size-lg">
		<Dialog.Header>
			<Dialog.Title>Manage Quote Option Presets</Dialog.Title>
			<Dialog.Description>
				Review, update, or remove reusable commercial presets for this workspace.
			</Dialog.Description>
		</Dialog.Header>
		{#if engine.quoteOptionPresets.length === 0}
			<Panel as="div" tone="subtle">
				<Text>No presets saved yet.</Text>
				<Meta class="mt-1">Save a quote option as a preset to reuse it across RFQs.</Meta>
			</Panel>
		{:else}
			<div class="space-y-4">
				<FieldShell>
					<FieldLabel for="managed-quote-preset-select">Saved Preset</FieldLabel>
					<Select.Root
						type="single"
						value={managedPresetId ?? ''}
						onValueChange={(value) => syncManagedPresetForm(value ? String(value) : null)}
					>
						<Select.Trigger id="managed-quote-preset-select" size="default" class="w-full">
							{engine.getQuoteOptionPreset(managedPresetId ?? '')?.label ?? 'Select a preset'}
						</Select.Trigger>
						<Select.Content>
							{#each engine.quoteOptionPresets as preset (preset.id)}
								<Select.Item value={preset.id} label={preset.label}>
									<div class="flex min-w-0 flex-col gap-0.5">
										<span class="truncate">{preset.label}</span>
										<Meta as="span">
											{formatMarkupSummary(preset.markup_percentage)} · {preset.lead_time}
										</Meta>
									</div>
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</FieldShell>

				<div class="grid gap-3 sm:grid-cols-2">
					<FieldShell invalidTone={getFieldInvalidTone(managePresetFieldErrors.label)}>
						<FieldLabel for="managed-quote-preset-label">Preset Label</FieldLabel>
						<Input
							id="managed-quote-preset-label"
							bind:value={managePresetFormValues.label}
							size="sm"
							invalidTone={getFieldInvalidTone(managePresetFieldErrors.label)}
							placeholder="e.g. Preferred Customer -10%"
						/>
						<FieldError errors={managePresetFieldErrors.label} />
					</FieldShell>
					<FieldShell invalidTone={getFieldInvalidTone(managePresetFieldErrors.lead_time)}>
						<FieldLabel for="managed-quote-preset-lead-time">Lead Time</FieldLabel>
						<Input
							id="managed-quote-preset-lead-time"
							bind:value={managePresetFormValues.lead_time}
							size="sm"
							invalidTone={getFieldInvalidTone(managePresetFieldErrors.lead_time)}
							placeholder="e.g. 2 weeks"
						/>
						<FieldError errors={managePresetFieldErrors.lead_time} />
					</FieldShell>
				</div>

				<div class="flex flex-col gap-3 sm:flex-row sm:items-end">
					<FieldShell
						class="sm:w-36"
						invalidTone={getFieldInvalidTone(managePresetFieldErrors.markup_percentage)}
					>
						<FieldLabel for="managed-quote-preset-markup">Markup</FieldLabel>
						<InputAffix affix="%" size="sm" numeric class="w-28">
							<Input
								id="managed-quote-preset-markup"
								size="sm"
								type="text"
								inputmode="decimal"
								bind:value={managePresetFormValues.markup_percentage}
								invalidTone={getFieldInvalidTone(managePresetFieldErrors.markup_percentage)}
								class="text-right tabular-nums"
								placeholder="0.00"
							/>
						</InputAffix>
						<FieldError errors={managePresetFieldErrors.markup_percentage} />
					</FieldShell>
					<Meta as="div" class="ui-note-panel ui-note-panel-tight">
						{formatMarkupSummary(managePresetFormValues.markup_percentage)} ·
						{managePresetFormValues.lead_time || 'No lead time'}
					</Meta>
				</div>

				<div class="grid grid-cols-2 gap-2">
					<FieldShell class="w-36">
						<FieldLabelRow
							for="managed-material-markup"
							tooltip="Overrides the general markup for material costs only. Leave blank to use the general markup."
						>
							Material
						</FieldLabelRow>
						<InputAffix affix="%" size="sm" numeric>
							<Input
								id="managed-material-markup"
								size="sm"
								type="text"
								inputmode="decimal"
								bind:value={managePresetFormValues.material_markup_percentage}
								class="text-right tabular-nums"
								placeholder="—"
							/>
						</InputAffix>
					</FieldShell>
					<FieldShell class="w-36">
						<FieldLabelRow
							for="managed-labour-markup"
							tooltip="Overrides the general markup for labour costs only. Leave blank to use the general markup."
						>
							Labour
						</FieldLabelRow>
						<InputAffix affix="%" size="sm" numeric>
							<Input
								id="managed-labour-markup"
								size="sm"
								type="text"
								inputmode="decimal"
								bind:value={managePresetFormValues.labour_markup_percentage}
								class="text-right tabular-nums"
								placeholder="—"
							/>
						</InputAffix>
					</FieldShell>
					<FieldShell class="w-36">
						<FieldLabelRow
							for="managed-equipment-markup"
							tooltip="Overrides the general markup for equipment costs only. Leave blank to use the general markup."
						>
							Equipment
						</FieldLabelRow>
						<InputAffix affix="%" size="sm" numeric>
							<Input
								id="managed-equipment-markup"
								size="sm"
								type="text"
								inputmode="decimal"
								bind:value={managePresetFormValues.equipment_markup_percentage}
								class="text-right tabular-nums"
								placeholder="—"
							/>
						</InputAffix>
					</FieldShell>
					<FieldShell class="w-36">
						<FieldLabelRow
							for="managed-subcontract-markup"
							tooltip="Overrides the general markup for subcontract costs only. Leave blank to use the general markup."
						>
							Subcontract
						</FieldLabelRow>
						<InputAffix affix="%" size="sm" numeric>
							<Input
								id="managed-subcontract-markup"
								size="sm"
								type="text"
								inputmode="decimal"
								bind:value={managePresetFormValues.subcontract_markup_percentage}
								class="text-right tabular-nums"
								placeholder="—"
							/>
						</InputAffix>
					</FieldShell>
				</div>

				<FieldShell>
					<FieldLabel for="managed-quote-preset-notes">Preset Notes</FieldLabel>
					<Textarea
						id="managed-quote-preset-notes"
						size="sm"
						bind:value={managePresetFormValues.notes}
						placeholder="Optional preset notes for future quote options."
						class="min-h-24 resize-none"
					/>
				</FieldShell>
			</div>
		{/if}
		<Dialog.Footer density="compact">
			<Button variant="secondary" size="default" onclick={() => (managePresetsDialogOpen = false)}
				>Close</Button
			>
			{#if engine.quoteOptionPresets.length > 0}
				<Button
					variant="secondary"
					size="default"
					onclick={() => void handleDeleteManagedPreset()}
					disabled={deletingPreset}
				>
					{deletingPreset ? 'Deleting…' : 'Delete Preset'}
				</Button>
				<Button
					variant="brand"
					size="default"
					onclick={() => void handleUpdatePreset()}
					disabled={updatingPreset}
				>
					{updatingPreset ? 'Saving…' : 'Save Changes'}
				</Button>
			{/if}
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<AlertDialog.Root bind:open={overwritePresetDialogOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Overwrite saved preset?</AlertDialog.Title>
			<AlertDialog.Description>
				{#if pendingPresetOverwrite}
					A preset named "{pendingPresetOverwrite.targetPresetLabel}" already exists. Overwrite it
					with the current quote option values?
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer density="compact">
			<AlertDialog.Cancel
				disabled={overwritingPreset}
				onclick={() => {
					pendingPresetOverwrite = null;
				}}
			>
				Cancel
			</AlertDialog.Cancel>
			<AlertDialog.Action
				onclick={() => void handleConfirmPresetOverwrite()}
				disabled={overwritingPreset}
			>
				{overwritingPreset ? 'Overwriting…' : 'Overwrite preset'}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root bind:open={resetDialogOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Reset quote workspace?</AlertDialog.Title>
			<AlertDialog.Description>
				Delete saved estimate content for this RFQ and restore the default quote option, quantities,
				PDF inclusions, and rounding preferences.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer density="compact">
			<AlertDialog.Cancel disabled={resettingQuoteWorkspace}>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				variant="destructive"
				onclick={() => void handleReset()}
				disabled={resettingQuoteWorkspace}
			>
				{resettingQuoteWorkspace ? 'Resetting…' : 'Reset quote workspace'}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
