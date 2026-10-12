<script lang="ts">
	import { tick } from 'svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { FieldError, FieldLabel, FieldShell } from '$lib/components/primitives/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import FormHelpTooltip from '$lib/components/form-help-tooltip.svelte';
	import { classificationSystemsState } from '$lib/state/classification-systems.svelte.js';
	import { costCodeFormSchema, type CostCodeFormValues } from '$lib/schemas/index.js';
	import type { CostCode } from '$lib/types/index.js';
	import { getErrorMessage } from '$lib/utils/runtime-form-errors.js';
	import { findFirstErrorField } from '$lib/utils/validation-navigation.js';
	import { getFieldInvalidTone } from '$lib/utils/field-errors.js';
	import { toast } from 'svelte-sonner';
	import GitBranchPlusIcon from '@lucide/svelte/icons/git-branch-plus';
	import ClipboardListIcon from '@lucide/svelte/icons/clipboard-list';
	import PlusIcon from '@lucide/svelte/icons/plus';

	interface Props {
		open?: boolean;
		costCode?: CostCode | null;
		classificationSystemId: string;
		hideTrigger?: boolean;
	}

	let {
		open = $bindable(false),
		costCode = null,
		classificationSystemId,
		hideTrigger = false
	}: Props = $props();

	type CostCodeStep = 'details' | 'structure';
	type CostCodeField = keyof CostCodeFormValues;
	let activeStep: CostCodeStep = $state('details');
	let isSaving = $state(false);
	let fieldErrors = $state<Record<string, string[] | undefined>>({});
	let formValues = $state<CostCodeFormValues>({
		parent_id: null,
		code: '',
		name: '',
		description: '',
		is_active: true,
		sort_order: 0
	});
	let parentValue = $state('__none__');
	let sortOrderInput = $state<string | number>('');

	const nav = [
		{ id: 'details' as const, name: 'Details', icon: ClipboardListIcon },
		{ id: 'structure' as const, name: 'Structure', icon: GitBranchPlusIcon }
	];
	const costCodeFieldStepMap: Record<CostCodeField, CostCodeStep> = {
		parent_id: 'structure',
		code: 'details',
		name: 'details',
		description: 'details',
		is_active: 'structure',
		sort_order: 'details'
	};
	const costCodeFieldIdMap: Record<CostCodeField, string> = {
		parent_id: 'cost-code-parent',
		code: 'cost-code-code',
		name: 'cost-code-name',
		description: 'cost-code-description',
		is_active: 'cost-code-parent',
		sort_order: 'cost-code-order'
	};

	const excludedParentIds = $derived.by(() => {
		if (!costCode) return [] as string[];
		const childrenByParent: Record<string, string[]> = {};
		for (const item of classificationSystemsState.costCodes) {
			if (!item.parent_id) continue;
			const siblings = childrenByParent[item.parent_id] ?? [];
			siblings.push(item.id);
			childrenByParent[item.parent_id] = siblings;
		}
		const excluded = [costCode.id];
		const stack = [...(childrenByParent[costCode.id] ?? [])];
		while (stack.length > 0) {
			const current = stack.pop();
			if (!current || excluded.includes(current)) continue;
			excluded.push(current);
			stack.push(...(childrenByParent[current] ?? []));
		}
		return excluded;
	});

	const parentOptions = $derived(
		classificationSystemsState.costCodes.filter((item) => !excludedParentIds.includes(item.id))
	);

	function buildInitialFormValues(): CostCodeFormValues {
		if (costCode) {
			return {
				parent_id: costCode.parent_id ?? null,
				code: costCode.code,
				name: costCode.name,
				description: costCode.description ?? '',
				is_active: costCode.is_active,
				sort_order: costCode.sort_order
			};
		}

		return {
			parent_id: null,
			code: '',
			name: '',
			description: '',
			is_active: true,
			sort_order: classificationSystemsState.costCodes.length
		};
	}

	$effect(() => {
		if (!open) return;
		activeStep = 'details';
		fieldErrors = {};
		const initialFormValues = buildInitialFormValues();
		formValues = initialFormValues;
		parentValue = initialFormValues.parent_id ?? '__none__';
		sortOrderInput = costCode ? String(costCode.sort_order) : '';
	});

	function getTrimmedSortOrderInput(): string {
		if (typeof sortOrderInput === 'number') {
			return Number.isFinite(sortOrderInput) ? String(sortOrderInput) : '';
		}
		return sortOrderInput.trim();
	}

	async function focusCostCodeField(field: CostCodeField) {
		activeStep = costCodeFieldStepMap[field];
		await tick();
		document.getElementById(costCodeFieldIdMap[field])?.focus();
	}

	async function focusFirstCostCodeError(errors: Record<string, string[] | undefined>) {
		const firstField = findFirstErrorField<CostCodeField>(
			['code', 'name', 'sort_order', 'parent_id', 'description', 'is_active'],
			errors
		);
		if (firstField) {
			await focusCostCodeField(firstField);
		}
	}

	async function handleSave() {
		fieldErrors = {};
		const normalizedSortOrder = getTrimmedSortOrderInput();
		if (normalizedSortOrder === '') {
			fieldErrors = { sort_order: ['Sort order is required'] };
			toast.error('Validation failed');
			await focusCostCodeField('sort_order');
			return;
		}
		formValues.sort_order = normalizedSortOrder === '' ? Number.NaN : Number(normalizedSortOrder);
		const result = costCodeFormSchema.safeParse(formValues);
		if (!result.success) {
			fieldErrors = result.error.flatten().fieldErrors as Record<string, string[] | undefined>;
			toast.error('Validation failed');
			await focusFirstCostCodeError(fieldErrors);
			return;
		}
		isSaving = true;
		try {
			if (costCode) {
				await classificationSystemsState.updateCostCode(costCode.id, result.data);
			} else {
				await classificationSystemsState.addCostCode(classificationSystemId, result.data);
			}
			open = false;
		} catch (error) {
			const message = getErrorMessage(error);
			if (message.startsWith('Cost code "') && message.includes('already exists')) {
				fieldErrors = { ...fieldErrors, code: [message] };
				await focusCostCodeField('code');
				return;
			}
			if (message.includes('parent') || message.includes('Parent cost code')) {
				fieldErrors = { ...fieldErrors, parent_id: [message] };
				await focusCostCodeField('parent_id');
				return;
			}
		} finally {
			isSaving = false;
		}
	}
</script>

{#if !hideTrigger}
	<Button size="sm" class="gap-1.5" onclick={() => (open = true)}>
		<PlusIcon class="size-3.5" />
		Add Cost Code
	</Button>
{/if}

<Dialog.Root bind:open>
	<Dialog.WorkflowFrame
		title={costCode ? `Edit ${costCode.code}` : 'New Cost Code'}
		description={costCode
			? 'Review and update the cost code details and hierarchy.'
			: 'Create a cost code in the active classification system and choose its hierarchy.'}
		steps={nav}
		{activeStep}
		onStepSelect={(stepId) => {
			activeStep = stepId as CostCodeStep;
		}}
	>
		{#if activeStep === 'details'}
			<div class="flex flex-col gap-4">
				<div class="grid gap-4 md:grid-cols-2">
					<FieldShell>
						<FieldLabel for="cost-code-code">Code</FieldLabel>
						<Input
							id="cost-code-code"
							bind:value={formValues.code}
							invalidTone={getFieldInvalidTone(fieldErrors.code)}
							placeholder="e.g. 05 12 00"
						/>
						<FieldError errors={fieldErrors.code} />
					</FieldShell>
					<FieldShell>
						<div class="flex items-center gap-1.5 px-1">
							<FieldLabel for="cost-code-order">Sort Order</FieldLabel>
							<FormHelpTooltip
								content="Controls display order within the same parent group. Lower numbers appear first."
							/>
						</div>
						<Input
							id="cost-code-order"
							type="number"
							min="0"
							step="1"
							placeholder="0"
							invalidTone={getFieldInvalidTone(fieldErrors.sort_order)}
							class="text-right tabular-nums"
							bind:value={sortOrderInput}
						/>
						<FieldError errors={fieldErrors.sort_order} />
					</FieldShell>
				</div>
				<FieldShell>
					<FieldLabel for="cost-code-name">Name</FieldLabel>
					<Input
						id="cost-code-name"
						bind:value={formValues.name}
						invalidTone={getFieldInvalidTone(fieldErrors.name)}
						placeholder="e.g. Structural Steel Framing"
					/>
					<FieldError errors={fieldErrors.name} />
				</FieldShell>
				<FieldShell>
					<FieldLabel for="cost-code-description">Description</FieldLabel>
					<Textarea
						id="cost-code-description"
						bind:value={formValues.description}
						class="min-h-32 resize-none"
						rows={5}
						placeholder="Optional notes for this code."
					/>
				</FieldShell>
			</div>
		{:else}
			<div class="flex flex-col gap-4">
				<FieldShell>
					<div class="flex items-center gap-1.5 px-1">
						<FieldLabel for="cost-code-parent">Parent Node</FieldLabel>
						<FormHelpTooltip
							content="Optional. Place this code under another code in the same classification system."
						/>
					</div>
					<Select.Root
						type="single"
						value={parentValue}
						onValueChange={(value) => {
							parentValue = value ?? '__none__';
							formValues.parent_id = value && value !== '__none__' ? value : null;
						}}
					>
						<Select.Trigger id="cost-code-parent" class="w-full">
							{parentValue === '__none__'
								? 'Top-level code'
								: (parentOptions.find((item) => item.id === parentValue)?.code ?? 'Top-level code')}
						</Select.Trigger>
						<Select.Content>
							<Select.Item value="__none__">Top-level code</Select.Item>
							{#each parentOptions as option (option.id)}
								<Select.Item value={option.id}>{option.code} · {option.name}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
					<FieldError errors={fieldErrors.parent_id} />
				</FieldShell>
				<Dialog.ToggleRow
					bind:checked={formValues.is_active}
					label="Active cost code"
					tooltip="Inactive codes stay in history but won’t be suggested."
				/>
			</div>
		{/if}

		{#snippet footer()}
			<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
			<Button variant="brand" onclick={handleSave} disabled={isSaving} loading={isSaving}>
				{isSaving ? 'Saving...' : costCode ? 'Update Cost Code' : 'Save Cost Code'}
			</Button>
		{/snippet}
	</Dialog.WorkflowFrame>
</Dialog.Root>
