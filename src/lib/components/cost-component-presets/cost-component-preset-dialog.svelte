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
	import { costComponentPresetsState } from '$lib/state/cost-component-presets.svelte.js';
	import {
		costComponentPresetFormSchema,
		type CostComponentPresetFormValues
	} from '$lib/schemas/index.js';
	import type { CostComponentPreset } from '$lib/types/index.js';
	import { getErrorMessage } from '$lib/utils/runtime-form-errors.js';
	import { findFirstErrorField } from '$lib/utils/validation-navigation.js';
	import { getFieldInvalidTone } from '$lib/utils/field-errors.js';
	import { ALIAS_FIELD_HELP_TEXT, ALIAS_INPUT_PLACEHOLDER } from '$lib/constants/alias-guidance.js';
	import { parseAliasesInput } from '$lib/utils/aliases.js';
	import { toast } from 'svelte-sonner';

	interface Props {
		open?: boolean;
		preset?: CostComponentPreset | null;
	}

	function createFormValues(preset: CostComponentPreset | null): CostComponentPresetFormValues {
		return {
			code: preset?.code ?? '',
			name: preset?.name ?? '',
			description: preset?.description ?? '',
			aliases: preset?.aliases ?? [],
			is_active: preset?.is_active ?? true
		};
	}

	let { open = $bindable(false), preset = null }: Props = $props();
	let isSaving = $state(false);
	let fieldErrors = $state<Record<string, string[] | undefined>>({});
	let formValues = $state<CostComponentPresetFormValues>(createFormValues(null));
	let aliasesInput = $state('');

	type PresetField = keyof CostComponentPresetFormValues;
	const fieldIdMap: Record<PresetField, string> = {
		code: 'cost-preset-code',
		name: 'cost-preset-name',
		description: 'cost-preset-description',
		aliases: 'cost-preset-aliases',
		is_active: 'cost-preset-status'
	};

	onMount(() => {
		formValues = createFormValues(preset);
		aliasesInput = (preset?.aliases ?? []).join('; ');
	});

	async function focusField(field: PresetField) {
		await tick();
		document.getElementById(fieldIdMap[field])?.focus();
	}

	async function focusFirstError(errors: Record<string, string[] | undefined>) {
		const firstField = findFirstErrorField<PresetField>(
			['name', 'code', 'description', 'aliases', 'is_active'],
			errors
		);
		if (firstField) await focusField(firstField);
	}

	async function handleSave() {
		fieldErrors = {};
		formValues.aliases = parseAliasesInput(aliasesInput);
		const result = costComponentPresetFormSchema.safeParse(formValues);
		if (!result.success) {
			fieldErrors = result.error.flatten().fieldErrors as Record<string, string[] | undefined>;
			toast.error('Validation failed');
			await focusFirstError(fieldErrors);
			return;
		}
		isSaving = true;
		try {
			if (preset) {
				await costComponentPresetsState.updatePreset(preset.id, result.data);
			} else {
				await costComponentPresetsState.addPreset(result.data);
			}
			open = false;
		} catch (error) {
			const message = getErrorMessage(error);
			if (message.includes('Preset code') && message.includes('already exists')) {
				fieldErrors = { ...fieldErrors, code: [message] };
				await focusField('code');
				return;
			}
			if (message.startsWith('Preset "') && message.includes('already exists')) {
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
		title={preset ? `Edit ${preset.name}` : 'New Cost Preset'}
		description={preset
			? 'Review and update the preset details.'
			: 'Create a reusable cost preset for estimating.'}
	>
		<div class="flex flex-col gap-4">
			<FieldShell>
				<FieldLabel for="cost-preset-name">Preset Name</FieldLabel>
				<Input
					id="cost-preset-name"
					bind:value={formValues.name}
					invalidTone={getFieldInvalidTone(fieldErrors.name)}
					placeholder="e.g. Fabrication Pack"
				/>
				<FieldError errors={fieldErrors.name} />
			</FieldShell>
			<div class="grid gap-4 md:grid-cols-2">
				<FieldShell>
					<FieldLabel for="cost-preset-code">Code</FieldLabel>
					<Input id="cost-preset-code" bind:value={formValues.code} placeholder="Optional code" />
				</FieldShell>
				<FieldShell>
					<FieldLabel for="cost-preset-status">Status</FieldLabel>
					<Select.Root
						type="single"
						value={formValues.is_active ? 'active' : 'inactive'}
						onValueChange={(value) => {
							formValues.is_active = value !== 'inactive';
						}}
					>
						<Select.Trigger id="cost-preset-status" class="w-full">
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
				<FieldLabel for="cost-preset-description">Description</FieldLabel>
				<Textarea
					id="cost-preset-description"
					bind:value={formValues.description}
					class="ui-field-note-md"
					placeholder="Optional preset notes"
				/>
			</FieldShell>
			<FieldShell>
				<FieldLabelRow for="cost-preset-aliases" tooltip={ALIAS_FIELD_HELP_TEXT}
					>Aliases</FieldLabelRow
				>
				<Input
					id="cost-preset-aliases"
					bind:value={aliasesInput}
					placeholder={ALIAS_INPUT_PLACEHOLDER}
				/>
			</FieldShell>
		</div>

		{#snippet footer()}
			<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
			<Button variant="brand" onclick={handleSave} disabled={isSaving} loading={isSaving}>
				{isSaving ? 'Saving...' : preset ? 'Save Changes' : 'Save Preset'}
			</Button>
		{/snippet}
	</Dialog.FormFrame>
</Dialog.Root>
