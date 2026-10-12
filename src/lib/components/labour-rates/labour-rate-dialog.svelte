<script lang="ts">
	import { tick } from 'svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import SearchableMultiSelect from '$lib/components/searchable-multi-select.svelte';
	import {
		FieldError,
		FieldLabel,
		FieldLabelRow,
		FieldShell
	} from '$lib/components/primitives/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { labourRatesState } from '$lib/state/labour-rates.svelte.js';
	import { contactsState } from '$lib/state/contacts.svelte.js';
	import { LABOUR_RATE_UNIT_OPTIONS, CURRENCY_OPTIONS } from '$lib/constants/index.js';
	import { labourRateCardFormSchema, type LabourRateCardFormValues } from '$lib/schemas/index.js';
	import { workspaceState } from '$lib/state/workspace.svelte.js';
	import type { LabourRateCard } from '$lib/types/index.js';
	import { getErrorMessage } from '$lib/utils/runtime-form-errors.js';
	import { findFirstErrorField } from '$lib/utils/validation-navigation.js';
	import { getFieldInvalidTone } from '$lib/utils/field-errors.js';
	import { ALIAS_FIELD_HELP_TEXT, ALIAS_INPUT_PLACEHOLDER } from '$lib/constants/alias-guidance.js';
	import { parseAliasesInput } from '$lib/utils/aliases.js';
	import { toast } from 'svelte-sonner';
	import ClipboardListIcon from '@lucide/svelte/icons/clipboard-list';
	import CoinsIcon from '@lucide/svelte/icons/coins';
	import PlusIcon from '@lucide/svelte/icons/plus';

	interface Props {
		open?: boolean;
		labourRate?: LabourRateCard | null;
		hideTrigger?: boolean;
	}

	let { open = $bindable(false), labourRate = null, hideTrigger = false }: Props = $props();

	type LabourStep = 'details' | 'rate' | 'companies';
	type LabourField = keyof LabourRateCardFormValues;
	let activeStep: LabourStep = $state('details');
	let isSaving = $state(false);
	let fieldErrors = $state<Record<string, string[] | undefined>>({});
	let aliasesInput = $state('');
	let selectedCompanyIds = $state<string[]>([]);
	let formValues = $state<LabourRateCardFormValues>({
		code: '',
		name: '',
		category: '',
		work_center: '',
		aliases: [],
		unit: 'hr',
		default_rate: 0,
		currency_code: void 0 as LabourRateCardFormValues['currency_code'],
		is_active: true
	});
	// currencyCodeInput is the UI value; synced to formValues.currency_code on save
	let currencyCodeInput = $state(workspaceState.currencyCode);
	let defaultRateInput = $state<string | number>('');

	const nav = [
		{ id: 'details' as const, name: 'Details', icon: ClipboardListIcon },
		{ id: 'rate' as const, name: 'Rate', icon: CoinsIcon },
		{ id: 'companies' as const, name: 'Companies', icon: ClipboardListIcon }
	];
	const companyOptions = $derived(
		contactsState.allCompanies
			.filter((company) => company.is_active !== false || selectedCompanyIds.includes(company.id))
			.map((company) => ({
				value: company.id,
				label: company.display_name || company.name,
				keywords: [company.name, company.email ?? '', company.company_name ?? '']
			}))
	);
	const labourFieldStepMap: Partial<Record<LabourField, LabourStep>> = {
		code: 'details',
		name: 'details',
		category: 'details',
		work_center: 'details',
		aliases: 'details',
		unit: 'rate',
		default_rate: 'rate',
		currency_code: 'rate',
		is_active: 'rate'
	};
	const labourFieldIdMap: Partial<Record<LabourField, string>> = {
		code: 'labour-rate-code',
		name: 'labour-rate-name',
		category: 'labour-rate-category',
		work_center: 'labour-rate-work-center',
		aliases: 'labour-rate-aliases',
		unit: 'labour-rate-unit',
		default_rate: 'labour-rate-default-rate',
		currency_code: 'labour-rate-currency',
		is_active: 'labour-rate-default-rate'
	};

	$effect(() => {
		if (!open) return;
		activeStep = 'details';
		fieldErrors = {};
		formValues = labourRate
			? {
					code: labourRate.code ?? '',
					name: labourRate.name,
					category: labourRate.category ?? '',
					work_center: labourRate.work_center ?? '',
					aliases: labourRate.aliases ?? [],
					unit: labourRate.unit,
					default_rate: labourRate.default_rate,
					currency_code: void 0 as LabourRateCardFormValues['currency_code'],
					is_active: labourRate.is_active
				}
			: {
					code: '',
					name: '',
					category: '',
					work_center: '',
					aliases: [],
					unit: 'hr',
					default_rate: 0,
					currency_code: void 0 as LabourRateCardFormValues['currency_code'],
					is_active: true
				};
		currencyCodeInput = labourRate?.currency_code ?? workspaceState.currencyCode;
		defaultRateInput = labourRate ? String(labourRate.default_rate) : '';
		aliasesInput = (labourRate?.aliases ?? []).join('; ');
		selectedCompanyIds = (labourRate?.linkedCompanies ?? []).map((company) => company.id);
	});

	function getTrimmedDefaultRateInput(): string {
		if (typeof defaultRateInput === 'number') {
			return Number.isFinite(defaultRateInput) ? String(defaultRateInput) : '';
		}
		return defaultRateInput.trim();
	}

	async function focusLabourField(field: LabourField) {
		activeStep = labourFieldStepMap[field] ?? 'details';
		await tick();
		document.getElementById(labourFieldIdMap[field] ?? 'labour-rate-name')?.focus();
	}

	async function focusFirstLabourError(errors: Record<string, string[] | undefined>) {
		const firstField = findFirstErrorField<LabourField>(
			['name', 'unit', 'default_rate', 'code', 'category', 'work_center', 'aliases', 'is_active'],
			errors
		);
		if (firstField) {
			await focusLabourField(firstField);
		}
	}

	async function handleSave() {
		fieldErrors = {};
		const normalizedDefaultRate = getTrimmedDefaultRateInput();
		if (normalizedDefaultRate === '') {
			fieldErrors = { default_rate: ['Default rate is required'] };
			toast.error('Validation failed');
			await focusLabourField('default_rate');
			return;
		}
		formValues.default_rate =
			normalizedDefaultRate === '' ? Number.NaN : Number(normalizedDefaultRate);
		formValues.aliases = parseAliasesInput(aliasesInput);
		formValues.currency_code = (currencyCodeInput ||
			undefined) as LabourRateCardFormValues['currency_code'];
		const result = labourRateCardFormSchema.safeParse(formValues);
		if (!result.success) {
			fieldErrors = result.error.flatten().fieldErrors as Record<string, string[] | undefined>;
			toast.error('Validation failed');
			await focusFirstLabourError(fieldErrors);
			return;
		}

		isSaving = true;
		let recordSaved = false;
		try {
			let targetId = labourRate?.id;
			if (labourRate) {
				await labourRatesState.updateLabourRate(labourRate.id, result.data);
			} else {
				targetId = await labourRatesState.addLabourRate(result.data);
			}
			recordSaved = true;
			if (targetId) {
				await labourRatesState.replaceLinkedCompanies(targetId, selectedCompanyIds);
			}
			open = false;
		} catch (error) {
			const message = getErrorMessage(error);
			if (message.includes('Labour rate code') && message.includes('already exists')) {
				fieldErrors = { ...fieldErrors, code: [message] };
				await focusLabourField('code');
				return;
			}
			if (message.startsWith('Labour rate "') && message.includes('already exists')) {
				fieldErrors = { ...fieldErrors, name: [message] };
				await focusLabourField('name');
				return;
			}
			if (recordSaved) open = false;
		} finally {
			isSaving = false;
		}
	}
</script>

{#if !hideTrigger}
	<Button size="sm" class="gap-1.5" onclick={() => (open = true)}>
		<PlusIcon class="size-3.5" />
		Add Labour Rate
	</Button>
{/if}

<Dialog.Root bind:open>
	<Dialog.WorkflowFrame
		title={labourRate ? `Edit ${labourRate.name}` : 'New Labour Rate'}
		description={labourRate
			? 'Review and update the labour rate details and pricing.'
			: 'Create a labour rate with the core details and pricing.'}
		steps={nav}
		{activeStep}
		onStepSelect={(stepId) => {
			activeStep = stepId as LabourStep;
		}}
	>
		{#if activeStep === 'details'}
			<div class="flex flex-col gap-4">
				<FieldShell>
					<FieldLabel for="labour-rate-name">Rate Name</FieldLabel>
					<Input
						id="labour-rate-name"
						bind:value={formValues.name}
						invalidTone={getFieldInvalidTone(fieldErrors.name)}
						placeholder="e.g. Fabrication Labour"
					/>
					<FieldError errors={fieldErrors.name} />
				</FieldShell>
				<div class="grid gap-4 md:grid-cols-2">
					<FieldShell>
						<FieldLabel for="labour-rate-code">Code</FieldLabel>
						<Input id="labour-rate-code" bind:value={formValues.code} placeholder="Optional code" />
					</FieldShell>
					<FieldShell>
						<FieldLabel for="labour-rate-work-center">Work Centre</FieldLabel>
						<Input
							id="labour-rate-work-center"
							bind:value={formValues.work_center}
							placeholder="e.g. Laser, Welding"
						/>
					</FieldShell>
				</div>
				<FieldShell>
					<FieldLabel for="labour-rate-category">Category</FieldLabel>
					<Input
						id="labour-rate-category"
						bind:value={formValues.category}
						placeholder="e.g. Fabrication, Installation, Site Labour"
					/>
				</FieldShell>
				<FieldShell>
					<FieldLabelRow for="labour-rate-aliases" tooltip={ALIAS_FIELD_HELP_TEXT}
						>Aliases</FieldLabelRow
					>
					<Input
						id="labour-rate-aliases"
						bind:value={aliasesInput}
						placeholder={ALIAS_INPUT_PLACEHOLDER}
					/>
				</FieldShell>
			</div>
		{:else if activeStep === 'rate'}
			<div class="flex flex-col gap-4">
				<div class="grid gap-4 md:grid-cols-2">
					<FieldShell>
						<FieldLabel for="labour-rate-unit">Unit</FieldLabel>
						<Select.Root
							type="single"
							value={String(formValues.unit)}
							onValueChange={(value) => {
								if (value) formValues.unit = value as LabourRateCardFormValues['unit'];
							}}
						>
							<Select.Trigger id="labour-rate-unit" class="w-full">
								{LABOUR_RATE_UNIT_OPTIONS.find((option) => option.value === formValues.unit)?.label}
							</Select.Trigger>
							<Select.Content>
								{#each LABOUR_RATE_UNIT_OPTIONS as option (option.value)}
									<Select.Item value={option.value}>{option.label}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
						<FieldError errors={fieldErrors.unit} />
					</FieldShell>
					<FieldShell>
						<FieldLabel for="labour-rate-currency">Currency</FieldLabel>
						<Select.Root
							type="single"
							value={currencyCodeInput}
							onValueChange={(value) => {
								if (value) currencyCodeInput = value;
							}}
						>
							<Select.Trigger id="labour-rate-currency" class="w-full">
								{CURRENCY_OPTIONS.find((option) => option.code === currencyCodeInput)?.label ??
									currencyCodeInput}
							</Select.Trigger>
							<Select.Content>
								{#each CURRENCY_OPTIONS as option (option.code)}
									<Select.Item value={option.code}>{option.label} ({option.code})</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
						<FieldError errors={fieldErrors.currency_code} />
					</FieldShell>
					<FieldShell>
						<FieldLabel for="labour-rate-default-rate">Default Rate</FieldLabel>
						<Input
							id="labour-rate-default-rate"
							type="number"
							min="0"
							step="0.01"
							placeholder="0.00"
							invalidTone={getFieldInvalidTone(fieldErrors.default_rate)}
							class="text-right tabular-nums"
							bind:value={defaultRateInput}
						/>
						<FieldError errors={fieldErrors.default_rate} />
					</FieldShell>
				</div>
				<Dialog.ToggleRow
					bind:checked={formValues.is_active}
					label="Active labour rate"
					tooltip="Inactive rate cards stay available for history but won’t be suggested."
				/>
			</div>
		{:else if activeStep === 'companies'}
			<FieldShell>
				<FieldLabel for="labour-rate-companies">Linked Companies</FieldLabel>
				<SearchableMultiSelect
					id="labour-rate-companies"
					options={companyOptions}
					bind:selectedValues={selectedCompanyIds}
					placeholder="Select linked companies"
					searchPlaceholder="Search companies..."
					emptyLabel="No companies found."
				/>
			</FieldShell>
		{/if}

		{#snippet footer()}
			<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
			<Button variant="brand" onclick={handleSave} disabled={isSaving} loading={isSaving}>
				{isSaving ? 'Saving...' : labourRate ? 'Update Labour Rate' : 'Save Labour Rate'}
			</Button>
		{/snippet}
	</Dialog.WorkflowFrame>
</Dialog.Root>
