<script lang="ts">
	import { onMount, tick } from 'svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		FieldError,
		FieldLabel,
		FieldLabelRow,
		FieldShell
	} from '$lib/components/primitives/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { estimateTemplatesState } from '$lib/state/estimate-templates.svelte.js';
	import {
		estimateTemplateFormSchema,
		type EstimateTemplateFormValues
	} from '$lib/schemas/index.js';
	import type { EstimateTemplate } from '$lib/types/index.js';
	import { getErrorMessage } from '$lib/utils/runtime-form-errors.js';
	import { findFirstErrorField } from '$lib/utils/validation-navigation.js';
	import { getFieldInvalidTone } from '$lib/utils/field-errors.js';
	import { ALIAS_FIELD_HELP_TEXT, ALIAS_INPUT_PLACEHOLDER } from '$lib/constants/alias-guidance.js';
	import { parseAliasesInput } from '$lib/utils/aliases.js';
	import { toast } from 'svelte-sonner';

	interface Props {
		open?: boolean;
		template?: EstimateTemplate | null;
	}

	function createFormValues(template: EstimateTemplate | null): EstimateTemplateFormValues {
		return {
			code: template?.code ?? '',
			name: template?.name ?? '',
			description: template?.description ?? '',
			aliases: template?.aliases ?? [],
			is_active: template?.is_active ?? true
		};
	}

	let { open = $bindable(false), template = null }: Props = $props();
	let isSaving = $state(false);
	let fieldErrors = $state<Record<string, string[] | undefined>>({});
	let formValues = $state<EstimateTemplateFormValues>(createFormValues(null));
	let aliasesInput = $state('');

	type TemplateField = keyof EstimateTemplateFormValues;
	const fieldIdMap: Record<TemplateField, string> = {
		code: 'estimate-template-code',
		name: 'estimate-template-name',
		description: 'estimate-template-description',
		aliases: 'estimate-template-aliases',
		is_active: 'estimate-template-status'
	};

	onMount(() => {
		formValues = createFormValues(template);
		aliasesInput = (template?.aliases ?? []).join('; ');
	});

	async function focusField(field: TemplateField) {
		await tick();
		document.getElementById(fieldIdMap[field])?.focus();
	}

	async function focusFirstError(errors: Record<string, string[] | undefined>) {
		const firstField = findFirstErrorField<TemplateField>(
			['name', 'code', 'description', 'aliases', 'is_active'],
			errors
		);
		if (firstField) await focusField(firstField);
	}

	async function handleSave() {
		fieldErrors = {};
		formValues.aliases = parseAliasesInput(aliasesInput);
		const result = estimateTemplateFormSchema.safeParse(formValues);
		if (!result.success) {
			fieldErrors = result.error.flatten().fieldErrors as Record<string, string[] | undefined>;
			toast.error('Validation failed');
			await focusFirstError(fieldErrors);
			return;
		}
		isSaving = true;
		try {
			if (template) {
				await estimateTemplatesState.updateTemplate(template.id, result.data);
			} else {
				await estimateTemplatesState.addTemplate(result.data);
			}
			open = false;
		} catch (error) {
			const message = getErrorMessage(error);
			if (message.includes('Template code') && message.includes('already exists')) {
				fieldErrors = { ...fieldErrors, code: [message] };
				await focusField('code');
				return;
			}
			if (message.startsWith('Template "') && message.includes('already exists')) {
				fieldErrors = { ...fieldErrors, name: [message] };
				await focusField('name');
				return;
			}
		} finally {
			isSaving = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.FormFrame
		title={template ? `Edit ${template.name}` : 'New Estimate Template'}
		description={template
			? 'Review and update the estimate template details.'
			: 'Create a reusable estimate template for quoting.'}
	>
		<div class="flex flex-col gap-4">
			<FieldShell>
				<FieldLabel for="estimate-template-name">Template Name</FieldLabel>
				<Input
					id="estimate-template-name"
					bind:value={formValues.name}
					invalidTone={getFieldInvalidTone(fieldErrors.name)}
					placeholder="e.g. Basic Fabrication Scope"
				/>
				<FieldError errors={fieldErrors.name} />
			</FieldShell>
			<div class="grid gap-4 md:grid-cols-2">
				<FieldShell>
					<FieldLabel for="estimate-template-code">Code</FieldLabel>
					<Input
						id="estimate-template-code"
						bind:value={formValues.code}
						placeholder="Optional code"
					/>
				</FieldShell>
				<FieldShell>
					<FieldLabel for="estimate-template-status">Status</FieldLabel>
					<Select.Root
						type="single"
						value={formValues.is_active ? 'active' : 'inactive'}
						onValueChange={(value) => {
							formValues.is_active = value !== 'inactive';
						}}
					>
						<Select.Trigger id="estimate-template-status" class="w-full">
							{formValues.is_active ? 'Active' : 'Inactive'}
						</Select.Trigger>
						<Select.Content>
							<Select.Item value="active">Active</Select.Item>
							<Select.Item value="inactive">Inactive</Select.Item>
						</Select.Content>
					</Select.Root>
				</FieldShell>
			</div>
			<FieldShell>
				<FieldLabel for="estimate-template-description">Description</FieldLabel>
				<Textarea
					id="estimate-template-description"
					bind:value={formValues.description}
					class="ui-field-note-md"
					placeholder="Optional template notes"
				/>
			</FieldShell>
			<FieldShell>
				<FieldLabelRow for="estimate-template-aliases" tooltip={ALIAS_FIELD_HELP_TEXT}
					>Aliases</FieldLabelRow
				>
				<Input
					id="estimate-template-aliases"
					bind:value={aliasesInput}
					placeholder={ALIAS_INPUT_PLACEHOLDER}
				/>
			</FieldShell>
		</div>

		{#snippet footer()}
			<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
			<Button variant="brand" onclick={handleSave} disabled={isSaving} loading={isSaving}>
				{isSaving ? 'Saving...' : template ? 'Save Changes' : 'Save Template'}
			</Button>
		{/snippet}
	</Dialog.FormFrame>
</Dialog.Root>
