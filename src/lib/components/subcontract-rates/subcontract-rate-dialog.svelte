<script lang="ts">
	import { tick } from 'svelte';
	import ClipboardListIcon from '@lucide/svelte/icons/clipboard-list';
	import CoinsIcon from '@lucide/svelte/icons/coins';
	import PlusIcon from '@lucide/svelte/icons/plus';

	import { Button } from '$lib/components/ui/button/index.js';
	import SearchableMultiSelect from '$lib/components/searchable-multi-select.svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import {
		FieldError,
		FieldLabel,
		FieldLabelRow,
		FieldShell
	} from '$lib/components/primitives/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import {
		subcontractRateCardFormSchema,
		type SubcontractRateCardFormValues
	} from '$lib/schemas/index.js';
	import { subcontractRatesState } from '$lib/state/subcontract-rates.svelte.js';
	import { contactsState } from '$lib/state/contacts.svelte.js';
	import type { SubcontractRateCard } from '$lib/types/index.js';
	import { getErrorMessage } from '$lib/utils/runtime-form-errors.js';
	import { findFirstErrorField } from '$lib/utils/validation-navigation.js';
	import { getFieldInvalidTone } from '$lib/utils/field-errors.js';
	import { ALIAS_FIELD_HELP_TEXT, ALIAS_INPUT_PLACEHOLDER } from '$lib/constants/alias-guidance.js';
	import { parseAliasesInput } from '$lib/utils/aliases.js';
	import { toast } from 'svelte-sonner';
	import { SUBCONTRACT_RATE_UNIT_OPTIONS, CURRENCY_OPTIONS } from '$lib/constants/index.js';
	import { workspaceState } from '$lib/state/workspace.svelte.js';

	interface Props {
		open?: boolean;
		subcontractRate?: SubcontractRateCard | null;
		hideTrigger?: boolean;
	}

	let { open = $bindable(false), subcontractRate = null, hideTrigger = false }: Props = $props();

	type SubcontractStep = 'details' | 'rate' | 'companies';
	type SubcontractField = keyof SubcontractRateCardFormValues;
	let activeStep: SubcontractStep = $state('details');
	let isSaving = $state(false);
	let fieldErrors = $state<Record<string, string[] | undefined>>({});
	let aliasesInput = $state('');
	let selectedCompanyIds = $state<string[]>([]);
	let formValues = $state<SubcontractRateCardFormValues>({
		code: '',
		name: '',
		category: '',
		aliases: [],
		unit: 'lot',
		default_rate: 0,
		currency_code: void 0 as SubcontractRateCardFormValues['currency_code'],
		is_active: true
	});
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
	const fieldStepMap: Partial<Record<SubcontractField, SubcontractStep>> = {
		code: 'details',
		name: 'details',
		category: 'details',
		aliases: 'details',
		unit: 'rate',
		default_rate: 'rate',
		currency_code: 'rate',
		is_active: 'rate'
	};
	const fieldIdMap: Partial<Record<SubcontractField, string>> = {
		code: 'subcontract-rate-code',
		name: 'subcontract-rate-name',
		category: 'subcontract-rate-category',
		aliases: 'subcontract-rate-aliases',
		unit: 'subcontract-rate-unit',
		default_rate: 'subcontract-rate-default-rate',
		currency_code: 'subcontract-rate-currency',
		is_active: 'subcontract-rate-default-rate'
	};

	$effect(() => {
		if (!open) return;
		activeStep = 'details';
		fieldErrors = {};
		formValues = subcontractRate
			? {
					code: subcontractRate.code ?? '',
					name: subcontractRate.name,
					category: subcontractRate.category ?? '',
					aliases: subcontractRate.aliases ?? [],
					unit: subcontractRate.unit,
					default_rate: subcontractRate.default_rate,
					currency_code: void 0 as SubcontractRateCardFormValues['currency_code'],
					is_active: subcontractRate.is_active
				}
			: {
					code: '',
					name: '',
					category: '',
					aliases: [],
					unit: 'lot',
					default_rate: 0,
					currency_code: void 0 as SubcontractRateCardFormValues['currency_code'],
					is_active: true
				};
		currencyCodeInput = subcontractRate?.currency_code ?? workspaceState.currencyCode;
		defaultRateInput = subcontractRate ? String(subcontractRate.default_rate) : '';
		aliasesInput = (subcontractRate?.aliases ?? []).join('; ');
		selectedCompanyIds = (subcontractRate?.linkedCompanies ?? []).map((company) => company.id);
	});

	function getTrimmedDefaultRateInput(): string {
		if (typeof defaultRateInput === 'number') {
			return Number.isFinite(defaultRateInput) ? String(defaultRateInput) : '';
		}
		return defaultRateInput.trim();
	}

	async function focusField(field: SubcontractField) {
		activeStep = fieldStepMap[field] ?? 'details';
		await tick();
		document.getElementById(fieldIdMap[field] ?? 'subcontract-rate-name')?.focus();
	}

	async function focusFirstError(errors: Record<string, string[] | undefined>) {
		const firstField = findFirstErrorField<SubcontractField>(
			['name', 'unit', 'default_rate', 'code', 'category', 'aliases', 'currency_code', 'is_active'],
			errors
		);
		if (firstField) await focusField(firstField);
	}

	async function handleSave() {
		fieldErrors = {};
		const normalizedDefaultRate = getTrimmedDefaultRateInput();
		if (normalizedDefaultRate === '') {
			fieldErrors = { default_rate: ['Default rate is required'] };
			toast.error('Validation failed');
			await focusField('default_rate');
			return;
		}
		formValues.default_rate = Number(normalizedDefaultRate);
		formValues.aliases = parseAliasesInput(aliasesInput);
		formValues.currency_code = (currencyCodeInput ||
			undefined) as SubcontractRateCardFormValues['currency_code'];
		const result = subcontractRateCardFormSchema.safeParse(formValues);
		if (!result.success) {
			fieldErrors = result.error.flatten().fieldErrors as Record<string, string[] | undefined>;
			toast.error('Validation failed');
			await focusFirstError(fieldErrors);
			return;
		}

		isSaving = true;
		let recordSaved = false;
		try {
			let targetId = subcontractRate?.id;
			if (subcontractRate) {
				await subcontractRatesState.updateSubcontractRate(subcontractRate.id, result.data);
			} else {
				targetId = await subcontractRatesState.addSubcontractRate(result.data);
			}
			recordSaved = true;
			if (targetId) {
				await subcontractRatesState.replaceLinkedCompanies(targetId, selectedCompanyIds);
			}
			open = false;
		} catch (error) {
			const message = getErrorMessage(error);
			if (message.includes('Subcontract rate code') && message.includes('already exists')) {
				fieldErrors = { ...fieldErrors, code: [message] };
				await focusField('code');
				return;
			}
			if (message.startsWith('Subcontract rate "') && message.includes('already exists')) {
				fieldErrors = { ...fieldErrors, name: [message] };
				await focusField('name');
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
		Add Subcontract Rate
	</Button>
{/if}

<Dialog.Root bind:open>
	<Dialog.WorkflowFrame
		title={subcontractRate ? `Edit ${subcontractRate.name}` : 'New Subcontract Rate'}
		description={subcontractRate
			? 'Review and update the subcontract rate details and pricing.'
			: 'Create a subcontract rate with the core details and pricing.'}
		steps={nav}
		{activeStep}
		onStepSelect={(stepId) => {
			activeStep = stepId as SubcontractStep;
		}}
	>
		{#if activeStep === 'details'}
			<div class="flex flex-col gap-4">
				<FieldShell>
					<FieldLabel for="subcontract-rate-name">Rate Name</FieldLabel>
					<Input
						id="subcontract-rate-name"
						bind:value={formValues.name}
						invalidTone={getFieldInvalidTone(fieldErrors.name)}
						placeholder="e.g. On-site Crane Hire"
					/>
					<FieldError errors={fieldErrors.name} />
				</FieldShell>

				<div class="grid gap-4 md:grid-cols-2">
					<FieldShell>
						<FieldLabel for="subcontract-rate-code">Code</FieldLabel>
						<Input
							id="subcontract-rate-code"
							bind:value={formValues.code}
							invalidTone={getFieldInvalidTone(fieldErrors.code)}
							placeholder="Optional reference"
						/>
						<FieldError errors={fieldErrors.code} />
					</FieldShell>
				</div>

				<FieldShell>
					<FieldLabel for="subcontract-rate-category">Category</FieldLabel>
					<Input
						id="subcontract-rate-category"
						bind:value={formValues.category}
						invalidTone={getFieldInvalidTone(fieldErrors.category)}
						placeholder="Optional trade or category"
					/>
					<FieldError errors={fieldErrors.category} />
				</FieldShell>
				<FieldShell>
					<FieldLabelRow for="subcontract-rate-aliases" tooltip={ALIAS_FIELD_HELP_TEXT}
						>Aliases</FieldLabelRow
					>
					<Input
						id="subcontract-rate-aliases"
						bind:value={aliasesInput}
						placeholder={ALIAS_INPUT_PLACEHOLDER}
					/>
				</FieldShell>
			</div>
		{:else if activeStep === 'rate'}
			<div class="flex flex-col gap-4">
				<div class="grid gap-4 md:grid-cols-2">
					<FieldShell>
						<FieldLabel for="subcontract-rate-unit">Unit</FieldLabel>
						<Select.Root
							type="single"
							name="subcontract-rate-unit"
							value={String(formValues.unit)}
							onValueChange={(value) => {
								formValues.unit = value as SubcontractRateCardFormValues['unit'];
							}}
						>
							<Select.Trigger id="subcontract-rate-unit" class="w-full">
								{SUBCONTRACT_RATE_UNIT_OPTIONS.find((option) => option.value === formValues.unit)
									?.label ?? formValues.unit}
							</Select.Trigger>
							<Select.Content>
								{#each SUBCONTRACT_RATE_UNIT_OPTIONS as option (option.value)}
									<Select.Item value={option.value} label={option.label} />
								{/each}
							</Select.Content>
						</Select.Root>
						<FieldError errors={fieldErrors.unit} />
					</FieldShell>
					<FieldShell>
						<FieldLabel for="subcontract-rate-default-rate">Default Rate</FieldLabel>
						<Input
							id="subcontract-rate-default-rate"
							bind:value={defaultRateInput}
							type="number"
							step="0.01"
							min="0"
							invalidTone={getFieldInvalidTone(fieldErrors.default_rate)}
							class="text-right tabular-nums"
							placeholder="0.00"
						/>
						<FieldError errors={fieldErrors.default_rate} />
					</FieldShell>
					<FieldShell>
						<FieldLabel for="subcontract-rate-currency">Currency</FieldLabel>
						<Select.Root
							type="single"
							value={currencyCodeInput}
							onValueChange={(value) => {
								if (value) currencyCodeInput = value;
							}}
						>
							<Select.Trigger id="subcontract-rate-currency" class="w-full">
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
				</div>

				<Dialog.ToggleRow
					bind:checked={formValues.is_active}
					label="Active rate"
					tooltip="Inactive rates stay in the catalogue but are hidden from default pickers."
				/>
			</div>
		{:else if activeStep === 'companies'}
			<FieldShell>
				<FieldLabel for="subcontract-rate-companies">Linked Companies</FieldLabel>
				<SearchableMultiSelect
					id="subcontract-rate-companies"
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
				{isSaving ? 'Saving…' : subcontractRate ? 'Save Changes' : 'Create Subcontract Rate'}
			</Button>
		{/snippet}
	</Dialog.WorkflowFrame>
</Dialog.Root>
