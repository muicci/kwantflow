<script lang="ts">
	import { tick } from 'svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { FieldError, FieldLabel, FieldShell } from '$lib/components/primitives/index.js';
	import FormHelpTooltip from '$lib/components/form-help-tooltip.svelte';
	import { wbsState } from '$lib/state/wbs.svelte.js';
	import { WBS_NODE_TYPE_OPTIONS } from '$lib/constants/index.js';
	import { wbsNodeFormSchema, type WbsNodeFormValues } from '$lib/schemas/index.js';
	import type { WbsNode } from '$lib/types/index.js';
	import { getErrorMessage } from '$lib/utils/runtime-form-errors.js';
	import { findFirstErrorField } from '$lib/utils/validation-navigation.js';
	import { getFieldInvalidTone } from '$lib/utils/field-errors.js';
	import { toast } from 'svelte-sonner';
	import ClipboardListIcon from '@lucide/svelte/icons/clipboard-list';
	import GitBranchPlusIcon from '@lucide/svelte/icons/git-branch-plus';
	import PlusIcon from '@lucide/svelte/icons/plus';

	interface Props {
		open?: boolean;
		node?: WbsNode | null;
		projectId: string;
		hideTrigger?: boolean;
	}

	let { open = $bindable(false), node = null, projectId, hideTrigger = false }: Props = $props();

	type WbsStep = 'details' | 'placement';
	type WbsField = keyof WbsNodeFormValues;
	let activeStep: WbsStep = $state('details');
	let isSaving = $state(false);
	let fieldErrors = $state<Record<string, string[] | undefined>>({});
	let formValues = $state<WbsNodeFormValues>({
		parent_id: null,
		code: '',
		name: '',
		type: 'custom',
		sort_order: 0
	});
	let parentValue = $state('__none__');
	let sortOrderInput = $state<string | number>('');

	const nav = [
		{ id: 'details' as const, name: 'Details', icon: ClipboardListIcon },
		{ id: 'placement' as const, name: 'Placement', icon: GitBranchPlusIcon }
	];
	const wbsFieldStepMap: Record<WbsField, WbsStep> = {
		parent_id: 'placement',
		code: 'details',
		name: 'details',
		type: 'details',
		sort_order: 'placement'
	};
	const wbsFieldIdMap: Record<WbsField, string> = {
		parent_id: 'wbs-node-parent',
		code: 'wbs-node-code',
		name: 'wbs-node-name',
		type: 'wbs-node-type',
		sort_order: 'wbs-node-order'
	};

	const excludedParentIds = $derived.by(() => {
		if (!node) return [] as string[];
		const childrenByParent: Record<string, string[]> = {};
		for (const item of wbsState.list) {
			if (!item.parent_id) continue;
			const siblings = childrenByParent[item.parent_id] ?? [];
			siblings.push(item.id);
			childrenByParent[item.parent_id] = siblings;
		}
		const excluded = [node.id];
		const stack = [...(childrenByParent[node.id] ?? [])];
		while (stack.length > 0) {
			const current = stack.pop();
			if (!current || excluded.includes(current)) continue;
			excluded.push(current);
			stack.push(...(childrenByParent[current] ?? []));
		}
		return excluded;
	});

	const parentOptions = $derived(
		wbsState.list.filter((item) => !excludedParentIds.includes(item.id))
	);

	function buildInitialFormValues(): WbsNodeFormValues {
		if (node) {
			return {
				parent_id: node.parent_id ?? null,
				code: node.code ?? '',
				name: node.name,
				type: node.type,
				sort_order: node.sort_order
			};
		}

		return {
			parent_id: null,
			code: '',
			name: '',
			type: 'custom',
			sort_order: wbsState.list.length
		};
	}

	$effect(() => {
		if (!open) return;
		activeStep = 'details';
		fieldErrors = {};
		const initialFormValues = buildInitialFormValues();
		formValues = initialFormValues;
		parentValue = initialFormValues.parent_id ?? '__none__';
		sortOrderInput = node ? String(node.sort_order) : '';
	});

	function getTrimmedSortOrderInput(): string {
		if (typeof sortOrderInput === 'number') {
			return Number.isFinite(sortOrderInput) ? String(sortOrderInput) : '';
		}
		return sortOrderInput.trim();
	}

	async function focusWbsField(field: WbsField) {
		activeStep = wbsFieldStepMap[field];
		await tick();
		document.getElementById(wbsFieldIdMap[field])?.focus();
	}

	async function focusFirstWbsError(errors: Record<string, string[] | undefined>) {
		const firstField = findFirstErrorField<WbsField>(
			['name', 'type', 'sort_order', 'parent_id', 'code'],
			errors
		);
		if (firstField) {
			await focusWbsField(firstField);
		}
	}

	async function handleSave() {
		fieldErrors = {};
		const normalizedSortOrder = getTrimmedSortOrderInput();
		if (normalizedSortOrder === '') {
			fieldErrors = { sort_order: ['Sort order is required'] };
			toast.error('Validation failed');
			await focusWbsField('sort_order');
			return;
		}
		formValues.sort_order = normalizedSortOrder === '' ? Number.NaN : Number(normalizedSortOrder);
		const result = wbsNodeFormSchema.safeParse(formValues);
		if (!result.success) {
			fieldErrors = result.error.flatten().fieldErrors as Record<string, string[] | undefined>;
			toast.error('Validation failed');
			await focusFirstWbsError(fieldErrors);
			return;
		}
		isSaving = true;
		try {
			if (node) {
				await wbsState.updateNode(node.id, result.data);
			} else {
				await wbsState.addNode(projectId, result.data);
			}
			open = false;
		} catch (error) {
			const message = getErrorMessage(error);
			if (message.includes('parent WBS node') || message.includes('Selected WBS node')) {
				fieldErrors = { ...fieldErrors, parent_id: [message] };
				await focusWbsField('parent_id');
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
		Add Structure Node
	</Button>
{/if}

<Dialog.Root bind:open>
	<Dialog.WorkflowFrame
		title={node ? `Edit ${node.name}` : 'New Structure Node'}
		description={node
			? 'Review and update the structure node details and placement.'
			: 'Create a structure node for this project and choose its placement.'}
		steps={nav}
		{activeStep}
		onStepSelect={(stepId) => {
			activeStep = stepId as WbsStep;
		}}
	>
		{#if activeStep === 'details'}
			<div class="flex flex-col gap-4">
				<div class="grid gap-4 md:grid-cols-2">
					<FieldShell>
						<FieldLabel for="wbs-node-code">Code</FieldLabel>
						<Input id="wbs-node-code" bind:value={formValues.code} placeholder="Optional code" />
					</FieldShell>
					<FieldShell>
						<FieldLabel for="wbs-node-type">Type</FieldLabel>
						<Select.Root
							type="single"
							value={formValues.type}
							onValueChange={(value) => {
								if (value) formValues.type = value as WbsNodeFormValues['type'];
							}}
						>
							<Select.Trigger id="wbs-node-type" class="w-full">
								{WBS_NODE_TYPE_OPTIONS.find((option) => option.value === formValues.type)?.label}
							</Select.Trigger>
							<Select.Content>
								{#each WBS_NODE_TYPE_OPTIONS as option (option.value)}
									<Select.Item value={option.value}>{option.label}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</FieldShell>
				</div>
				<FieldShell>
					<FieldLabel for="wbs-node-name">Name</FieldLabel>
					<Input
						id="wbs-node-name"
						bind:value={formValues.name}
						invalidTone={getFieldInvalidTone(fieldErrors.name)}
						placeholder="e.g. Level 1, Kitchen, Phase A"
					/>
					<FieldError errors={fieldErrors.name} />
				</FieldShell>
			</div>
		{:else}
			<div class="flex flex-col gap-4">
				<div class="grid gap-4 md:grid-cols-2">
					<FieldShell>
						<div class="flex items-center gap-1.5 px-1">
							<FieldLabel for="wbs-node-parent">Parent Node</FieldLabel>
							<FormHelpTooltip
								content="Optional. Place this node under another node in the same project hierarchy."
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
							<Select.Trigger id="wbs-node-parent" class="w-full">
								{parentValue === '__none__'
									? 'Top-level node'
									: (parentOptions.find((item) => item.id === parentValue)?.name ??
										'Top-level node')}
							</Select.Trigger>
							<Select.Content>
								<Select.Item value="__none__">Top-level node</Select.Item>
								{#each parentOptions as option (option.id)}
									<Select.Item value={option.id}>{option.name}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
						<FieldError errors={fieldErrors.parent_id} />
					</FieldShell>
					<FieldShell>
						<div class="flex items-center gap-1.5 px-1">
							<FieldLabel for="wbs-node-order">Sort Order</FieldLabel>
							<FormHelpTooltip
								content="Controls display order within the same parent group. Lower numbers appear first."
							/>
						</div>
						<Input
							id="wbs-node-order"
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
			</div>
		{/if}

		{#snippet footer()}
			<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
			<Button variant="brand" onclick={handleSave} disabled={isSaving} loading={isSaving}>
				{isSaving ? 'Saving...' : node ? 'Update Structure Node' : 'Save Structure Node'}
			</Button>
		{/snippet}
	</Dialog.WorkflowFrame>
</Dialog.Root>
