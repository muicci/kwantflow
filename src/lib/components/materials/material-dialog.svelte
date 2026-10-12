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
	import { materialsState } from '$lib/state/materials.svelte.js';
	import { contactsState } from '$lib/state/contacts.svelte.js';
	import { MATERIAL_UNIT_OPTIONS, CURRENCY_OPTIONS } from '$lib/constants/index.js';
	import {
		materialCatalogItemFormSchema,
		type MaterialCatalogItemFormValues
	} from '$lib/schemas/index.js';
	import type { MaterialCatalogueItem } from '$lib/types/index.js';
	import { getErrorMessage } from '$lib/utils/runtime-form-errors.js';
	import { findFirstErrorField } from '$lib/utils/validation-navigation.js';
	import { getFieldInvalidTone } from '$lib/utils/field-errors.js';
	import { ALIAS_FIELD_HELP_TEXT, ALIAS_INPUT_PLACEHOLDER } from '$lib/constants/alias-guidance.js';
	import { parseAliasesInput } from '$lib/utils/aliases.js';
	import { workspaceState } from '$lib/state/workspace.svelte.js';
	import { toast } from 'svelte-sonner';
	import ClipboardListIcon from '@lucide/svelte/icons/clipboard-list';
	import CoinsIcon from '@lucide/svelte/icons/coins';
	import PlusIcon from '@lucide/svelte/icons/plus';

	interface Props {
		open?: boolean;
		material?: MaterialCatalogueItem | null;
		hideTrigger?: boolean;
	}

	let { open = $bindable(false), material = null, hideTrigger = false }: Props = $props();

	type MaterialStep = 'details' | 'pricing' | 'companies';
	type MaterialField = keyof MaterialCatalogItemFormValues;
	let activeStep: MaterialStep = $state('details');
	let isSaving = $state(false);
	let fieldErrors = $state<Record<string, string[] | undefined>>({});
	let aliasesInput = $state('');
	let selectedCompanyIds = $state<string[]>([]);
	let formValues = $state<MaterialCatalogItemFormValues>({
		code: '',
		name: '',
		category: '',
		specification: '',
		aliases: [],
		unit: 'ea',
		default_rate: 0,
		currency_code: void 0 as MaterialCatalogItemFormValues['currency_code'],
		is_active: true
	});
	let defaultRateInput = $state<string | number>('');
	// currencyCodeInput is the UI value; synced to formValues.currency_code on save
	let currencyCodeInput = $state(workspaceState.currencyCode);

	const nav = [
		{ id: 'details' as const, name: 'Details', icon: ClipboardListIcon },
		{ id: 'pricing' as const, name: 'Pricing', icon: CoinsIcon },
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
	const materialFieldStepMap: Partial<Record<MaterialField, MaterialStep>> = {
		code: 'details',
		name: 'details',
		category: 'details',
		specification: 'details',
		aliases: 'details',
		unit: 'details',
		default_rate: 'pricing',
		is_active: 'pricing'
	};
	const materialFieldIdMap: Partial<Record<MaterialField, string>> = {
		code: 'material-code',
		name: 'material-name',
		category: 'material-category',
		specification: 'material-specification',
		aliases: 'material-aliases',
		unit: 'material-unit',
		default_rate: 'material-rate',
		is_active: 'material-rate'
	};

	$effect(() => {
		if (!open) return;
		activeStep = 'details';
		fieldErrors = {};
		formValues = material
			? {
					code: material.code ?? '',
					name: material.name,
					category: material.category ?? '',
					specification: material.specification ?? '',
					aliases: material.aliases ?? [],
					unit: material.unit,
					default_rate: material.default_rate,
					is_active: material.is_active
				}
			: {
					code: '',
					name: '',
					category: '',
					specification: '',
					aliases: [],
					unit: 'ea',
					default_rate: 0,
					is_active: true
				};
		defaultRateInput = material ? String(material.default_rate) : '';
		aliasesInput = (material?.aliases ?? []).join('; ');
		selectedCompanyIds = (material?.linkedCompanies ?? []).map((company) => company.id);
	});

	function getTrimmedDefaultRateInput(): string {
		if (typeof defaultRateInput === 'number') {
			return Number.isFinite(defaultRateInput) ? String(defaultRateInput) : '';
		}
		return defaultRateInput.trim();
	}

	async function focusMaterialField(field: MaterialField) {
		activeStep = materialFieldStepMap[field] ?? 'details';
		await tick();
		document.getElementById(materialFieldIdMap[field] ?? 'material-name')?.focus();
	}

	async function focusFirstMaterialError(errors: Record<string, string[] | undefined>) {
		const firstField = findFirstErrorField<MaterialField>(
			['name', 'unit', 'default_rate', 'code', 'category', 'specification', 'aliases', 'is_active'],
			errors
		);
		if (firstField) {
			await focusMaterialField(firstField);
		}
	}

	async function handleSave() {
		fieldErrors = {};
		const normalizedDefaultRate = getTrimmedDefaultRateInput();
		if (normalizedDefaultRate === '') {
			fieldErrors = { default_rate: ['Default rate is required'] };
			toast.error('Validation failed');
			await focusMaterialField('default_rate');
			return;
		}
		formValues.default_rate =
			normalizedDefaultRate === '' ? Number.NaN : Number(normalizedDefaultRate);
		formValues.aliases = parseAliasesInput(aliasesInput);
		formValues.currency_code = (currencyCodeInput ||
			undefined) as MaterialCatalogItemFormValues['currency_code'];
		const result = materialCatalogItemFormSchema.safeParse(formValues);
		if (!result.success) {
			fieldErrors = result.error.flatten().fieldErrors as Record<string, string[] | undefined>;
			toast.error('Validation failed');
			await focusFirstMaterialError(fieldErrors);
			return;
		}

		isSaving = true;
		let recordSaved = false;
		try {
			let targetId = material?.id;
			if (material) {
				await materialsState.updateMaterial(material.id, result.data);
			} else {
				targetId = await materialsState.addMaterial(result.data);
			}
			recordSaved = true;
			if (targetId) {
				await materialsState.replaceLinkedCompanies(targetId, selectedCompanyIds);
			}
			open = false;
		} catch (error) {
			const message = getErrorMessage(error);
			if (message.includes('Material code') && message.includes('already exists')) {
				fieldErrors = { ...fieldErrors, code: [message] };
				await focusMaterialField('code');
				return;
			}
			if (message.startsWith('Material "') && message.includes('already exists')) {
				fieldErrors = { ...fieldErrors, name: [message] };
				await focusMaterialField('name');
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
		Add Material
	</Button>
{/if}

<Dialog.Root bind:open>
	<Dialog.WorkflowFrame
		title={material ? `Edit ${material.name}` : 'New Material'}
		description={material
			? 'Review and update the material details and pricing.'
			: 'Create a material record with details and pricing.'}
		steps={nav}
		{activeStep}
		onStepSelect={(stepId) => {
			activeStep = stepId as MaterialStep;
		}}
	>
		{#if activeStep === 'details'}
			<div class="flex flex-col gap-4">
				<FieldShell invalidTone={getFieldInvalidTone(fieldErrors.name)}>
					<FieldLabel for="material-name">Material Name</FieldLabel>
					<Input
						id="material-name"
						bind:value={formValues.name}
						invalidTone={getFieldInvalidTone(fieldErrors.name)}
						placeholder="e.g. Mild Steel Plate"
					/>
					<FieldError errors={fieldErrors.name} />
				</FieldShell>
				<div class="grid gap-4 md:grid-cols-2">
					<FieldShell>
						<FieldLabel for="material-code">Code</FieldLabel>
						<Input id="material-code" bind:value={formValues.code} placeholder="Optional code" />
					</FieldShell>
					<FieldShell invalidTone={getFieldInvalidTone(fieldErrors.unit)}>
						<FieldLabel for="material-unit">Unit</FieldLabel>
						<Select.Root
							type="single"
							value={String(formValues.unit)}
							onValueChange={(value) => {
								if (value) formValues.unit = value as MaterialCatalogItemFormValues['unit'];
							}}
						>
							<Select.Trigger
								id="material-unit"
								class="w-full"
								invalidTone={getFieldInvalidTone(fieldErrors.unit)}
							>
								{MATERIAL_UNIT_OPTIONS.find((option) => option.value === formValues.unit)?.label}
							</Select.Trigger>
							<Select.Content>
								{#each MATERIAL_UNIT_OPTIONS as option (option.value)}
									<Select.Item value={option.value}>{option.label}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
						<FieldError errors={fieldErrors.unit} />
					</FieldShell>
				</div>
				<div class="grid gap-4 md:grid-cols-2">
					<FieldShell>
						<FieldLabel for="material-category">Category</FieldLabel>
						<Input
							id="material-category"
							bind:value={formValues.category}
							placeholder="e.g. Steel, Concrete, Consumable"
						/>
					</FieldShell>
					<FieldShell>
						<FieldLabel for="material-specification">Specification</FieldLabel>
						<Input
							id="material-specification"
							bind:value={formValues.specification}
							placeholder="Grade, finish, thickness, or notes"
						/>
					</FieldShell>
				</div>
				<FieldShell>
					<FieldLabelRow for="material-aliases" tooltip={ALIAS_FIELD_HELP_TEXT}
						>Aliases</FieldLabelRow
					>
					<Input
						id="material-aliases"
						bind:value={aliasesInput}
						placeholder={ALIAS_INPUT_PLACEHOLDER}
					/>
				</FieldShell>
			</div>
		{:else if activeStep === 'pricing'}
			<div class="flex flex-col gap-4">
				<div class="grid gap-4 md:grid-cols-2">
					<FieldShell invalidTone={getFieldInvalidTone(fieldErrors.default_rate)}>
						<FieldLabel for="material-rate">Default Rate</FieldLabel>
						<Input
							id="material-rate"
							type="number"
							min="0"
							step="0.01"
							placeholder="0.00"
							class="text-right tabular-nums"
							invalidTone={getFieldInvalidTone(fieldErrors.default_rate)}
							bind:value={defaultRateInput}
						/>
						<FieldError errors={fieldErrors.default_rate} />
					</FieldShell>
					<FieldShell>
						<FieldLabel for="material-currency">Currency</FieldLabel>
						<Select.Root
							type="single"
							value={currencyCodeInput}
							onValueChange={(value) => {
								if (value) currencyCodeInput = value;
							}}
						>
							<Select.Trigger id="material-currency" class="w-full">
								{currencyCodeInput
									? `${currencyCodeInput} — ${CURRENCY_OPTIONS.find((o) => o.code === currencyCodeInput)?.symbol ?? ''}`
									: 'Select currency'}
							</Select.Trigger>
							<Select.Content>
								{#each CURRENCY_OPTIONS as option (option.code)}
									<Select.Item value={option.code}
										>{option.code} — {option.symbol} {option.label}</Select.Item
									>
								{/each}
							</Select.Content>
						</Select.Root>
					</FieldShell>
				</div>
				<Dialog.ToggleRow
					bind:checked={formValues.is_active}
					label="Active material"
					tooltip="Inactive materials stay available for history but won’t be suggested."
				/>
			</div>
		{:else if activeStep === 'companies'}
			<FieldShell>
				<FieldLabel for="material-companies">Linked Companies</FieldLabel>
				<SearchableMultiSelect
					id="material-companies"
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
				{isSaving ? 'Saving...' : material ? 'Update Material' : 'Save Material'}
			</Button>
		{/snippet}
	</Dialog.WorkflowFrame>
</Dialog.Root>
