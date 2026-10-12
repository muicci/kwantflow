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
	import { equipmentRatesState } from '$lib/state/equipment-rates.svelte.js';
	import { contactsState } from '$lib/state/contacts.svelte.js';
	import { EQUIPMENT_RATE_UNIT_OPTIONS, CURRENCY_OPTIONS } from '$lib/constants/index.js';
	import { workspaceState } from '$lib/state/workspace.svelte.js';
	import {
		equipmentRateCardFormSchema,
		type EquipmentRateCardFormValues
	} from '$lib/schemas/index.js';
	import type { EquipmentRateCard } from '$lib/types/index.js';
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
		equipmentRate?: EquipmentRateCard | null;
		hideTrigger?: boolean;
	}

	let { open = $bindable(false), equipmentRate = null, hideTrigger = false }: Props = $props();

	type EquipmentStep = 'details' | 'rate' | 'companies';
	type EquipmentField = keyof EquipmentRateCardFormValues;
	let activeStep: EquipmentStep = $state('details');
	let isSaving = $state(false);
	let fieldErrors = $state<Record<string, string[] | undefined>>({});
	let aliasesInput = $state('');
	let selectedCompanyIds = $state<string[]>([]);
	let formValues = $state<EquipmentRateCardFormValues>({
		code: '',
		name: '',
		category: '',
		work_center: '',
		aliases: [],
		unit: 'hr',
		default_rate: 0,
		currency_code: void 0 as EquipmentRateCardFormValues['currency_code'],
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
	const equipmentFieldStepMap: Partial<Record<EquipmentField, EquipmentStep>> = {
		code: 'details',
		name: 'details',
		category: 'details',
		work_center: 'details',
		aliases: 'details',
		unit: 'rate',
		default_rate: 'rate',
		is_active: 'rate'
	};
	const equipmentFieldIdMap: Partial<Record<EquipmentField, string>> = {
		code: 'equipment-rate-code',
		name: 'equipment-rate-name',
		category: 'equipment-rate-category',
		work_center: 'equipment-rate-work-center',
		aliases: 'equipment-rate-aliases',
		unit: 'equipment-rate-unit',
		default_rate: 'equipment-rate-default-rate',
		is_active: 'equipment-rate-default-rate'
	};

	$effect(() => {
		if (!open) return;
		activeStep = 'details';
		fieldErrors = {};
		formValues = equipmentRate
			? {
					code: equipmentRate.code ?? '',
					name: equipmentRate.name,
					category: equipmentRate.category ?? '',
					work_center: equipmentRate.work_center ?? '',
					aliases: equipmentRate.aliases ?? [],
					unit: equipmentRate.unit,
					default_rate: equipmentRate.default_rate,
					currency_code: void 0 as EquipmentRateCardFormValues['currency_code'],
					is_active: equipmentRate.is_active
				}
			: {
					code: '',
					name: '',
					category: '',
					work_center: '',
					aliases: [],
					unit: 'hr',
					default_rate: 0,
					currency_code: void 0 as EquipmentRateCardFormValues['currency_code'],
					is_active: true
				};
		currencyCodeInput = equipmentRate?.currency_code ?? workspaceState.currencyCode;
		defaultRateInput = equipmentRate ? String(equipmentRate.default_rate) : '';
		aliasesInput = (equipmentRate?.aliases ?? []).join('; ');
		selectedCompanyIds = (equipmentRate?.linkedCompanies ?? []).map((company) => company.id);
	});

	function getTrimmedDefaultRateInput(): string {
		if (typeof defaultRateInput === 'number') {
			return Number.isFinite(defaultRateInput) ? String(defaultRateInput) : '';
		}
		return defaultRateInput.trim();
	}

	async function focusEquipmentField(field: EquipmentField) {
		activeStep = equipmentFieldStepMap[field] ?? 'details';
		await tick();
		document.getElementById(equipmentFieldIdMap[field] ?? 'equipment-rate-name')?.focus();
	}

	async function focusFirstEquipmentError(errors: Record<string, string[] | undefined>) {
		const firstField = findFirstErrorField<EquipmentField>(
			['name', 'unit', 'default_rate', 'code', 'category', 'work_center', 'aliases', 'is_active'],
			errors
		);
		if (firstField) {
			await focusEquipmentField(firstField);
		}
	}

	async function handleSave() {
		fieldErrors = {};
		const normalizedDefaultRate = getTrimmedDefaultRateInput();
		if (normalizedDefaultRate === '') {
			fieldErrors = { default_rate: ['Default rate is required'] };
			toast.error('Validation failed');
			await focusEquipmentField('default_rate');
			return;
		}
		formValues.default_rate = Number(normalizedDefaultRate);
		formValues.aliases = parseAliasesInput(aliasesInput);
		formValues.currency_code = (currencyCodeInput ||
			undefined) as EquipmentRateCardFormValues['currency_code'];
		const result = equipmentRateCardFormSchema.safeParse(formValues);
		if (!result.success) {
			fieldErrors = result.error.flatten().fieldErrors as Record<string, string[] | undefined>;
			toast.error('Validation failed');
			await focusFirstEquipmentError(fieldErrors);
			return;
		}

		isSaving = true;
		let recordSaved = false;
		try {
			let targetId = equipmentRate?.id;
			if (equipmentRate) {
				await equipmentRatesState.updateEquipmentRate(equipmentRate.id, result.data);
			} else {
				targetId = await equipmentRatesState.addEquipmentRate(result.data);
			}
			recordSaved = true;
			if (targetId) {
				await equipmentRatesState.replaceLinkedCompanies(targetId, selectedCompanyIds);
			}
			open = false;
		} catch (error) {
			const message = getErrorMessage(error);
			if (message.includes('Equipment rate code') && message.includes('already exists')) {
				fieldErrors = { ...fieldErrors, code: [message] };
				await focusEquipmentField('code');
				return;
			}
			if (message.startsWith('Equipment rate "') && message.includes('already exists')) {
				fieldErrors = { ...fieldErrors, name: [message] };
				await focusEquipmentField('name');
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
		Add Equipment Rate
	</Button>
{/if}

<Dialog.Root bind:open>
	<Dialog.WorkflowFrame
		title={equipmentRate ? `Edit ${equipmentRate.name}` : 'New Equipment Rate'}
		description={equipmentRate
			? 'Review and update the equipment rate details and pricing.'
			: 'Create an equipment rate with the core details and pricing.'}
		steps={nav}
		{activeStep}
		onStepSelect={(stepId) => {
			activeStep = stepId as EquipmentStep;
		}}
	>
		{#if activeStep === 'details'}
			<div class="flex flex-col gap-4">
				<FieldShell>
					<FieldLabel for="equipment-rate-name">Rate Name</FieldLabel>
					<Input
						id="equipment-rate-name"
						bind:value={formValues.name}
						invalidTone={getFieldInvalidTone(fieldErrors.name)}
						placeholder="e.g. Excavator"
					/>
					<FieldError errors={fieldErrors.name} />
				</FieldShell>
				<div class="grid gap-4 md:grid-cols-2">
					<FieldShell>
						<FieldLabel for="equipment-rate-code">Code</FieldLabel>
						<Input
							id="equipment-rate-code"
							bind:value={formValues.code}
							placeholder="Optional code"
						/>
					</FieldShell>
					<FieldShell>
						<FieldLabel for="equipment-rate-category">Category</FieldLabel>
						<Input
							id="equipment-rate-category"
							bind:value={formValues.category}
							placeholder="e.g. Plant, Machine"
						/>
					</FieldShell>
				</div>
				<FieldShell>
					<FieldLabel for="equipment-rate-work-center">Work Centre</FieldLabel>
					<Input
						id="equipment-rate-work-center"
						bind:value={formValues.work_center}
						placeholder="e.g. Workshop, Site Plant"
					/>
				</FieldShell>
				<FieldShell>
					<FieldLabelRow for="equipment-rate-aliases" tooltip={ALIAS_FIELD_HELP_TEXT}
						>Aliases</FieldLabelRow
					>
					<Input
						id="equipment-rate-aliases"
						bind:value={aliasesInput}
						placeholder={ALIAS_INPUT_PLACEHOLDER}
					/>
				</FieldShell>
			</div>
		{:else if activeStep === 'rate'}
			<div class="flex flex-col gap-4">
				<div class="grid gap-4 md:grid-cols-2">
					<FieldShell>
						<FieldLabel for="equipment-rate-unit">Unit</FieldLabel>
						<Select.Root
							type="single"
							value={String(formValues.unit)}
							onValueChange={(value) =>
								value && (formValues.unit = value as EquipmentRateCardFormValues['unit'])}
						>
							<Select.Trigger id="equipment-rate-unit" class="w-full">
								{EQUIPMENT_RATE_UNIT_OPTIONS.find((option) => option.value === formValues.unit)
									?.label}
							</Select.Trigger>
							<Select.Content>
								{#each EQUIPMENT_RATE_UNIT_OPTIONS as option (option.value)}
									<Select.Item value={option.value}>{option.label}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</FieldShell>
					<FieldShell>
						<FieldLabel for="equipment-rate-default-rate">Default Rate</FieldLabel>
						<Input
							id="equipment-rate-default-rate"
							bind:value={defaultRateInput}
							type="number"
							min="0"
							step="0.01"
							invalidTone={getFieldInvalidTone(fieldErrors.default_rate)}
							class="text-right tabular-nums"
							placeholder="0.00"
						/>
						<FieldError errors={fieldErrors.default_rate} />
					</FieldShell>
					<FieldShell>
						<FieldLabel for="equipment-rate-currency">Currency</FieldLabel>
						<Select.Root
							type="single"
							value={currencyCodeInput}
							onValueChange={(value) => {
								if (value) currencyCodeInput = value;
							}}
						>
							<Select.Trigger id="equipment-rate-currency" class="w-full">
								{CURRENCY_OPTIONS.find((option) => option.code === currencyCodeInput)?.label ??
									currencyCodeInput}
							</Select.Trigger>
							<Select.Content>
								{#each CURRENCY_OPTIONS as option (option.code)}
									<Select.Item value={option.code}>{option.label} ({option.code})</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
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
				<FieldLabel for="equipment-rate-companies">Linked Companies</FieldLabel>
				<SearchableMultiSelect
					id="equipment-rate-companies"
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
				{isSaving ? 'Saving...' : equipmentRate ? 'Update Equipment Rate' : 'Save Equipment Rate'}
			</Button>
		{/snippet}
	</Dialog.WorkflowFrame>
</Dialog.Root>
