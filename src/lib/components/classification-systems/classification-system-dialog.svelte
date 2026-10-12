<script lang="ts">
	import { tick, untrack } from 'svelte';
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
	import { classificationSystemsState } from '$lib/state/classification-systems.svelte.js';
	import { CLASSIFICATION_SYSTEM_TYPE_OPTIONS } from '$lib/constants/index.js';
	import {
		classificationSystemFormSchema,
		type ClassificationSystemFormValues
	} from '$lib/schemas/index.js';
	import type { ClassificationSystem } from '$lib/types/index.js';
	import { getErrorMessage } from '$lib/utils/runtime-form-errors.js';
	import { findFirstErrorField } from '$lib/utils/validation-navigation.js';
	import { getFieldInvalidTone } from '$lib/utils/field-errors.js';
	import { ALIAS_FIELD_HELP_TEXT, ALIAS_INPUT_PLACEHOLDER } from '$lib/constants/alias-guidance.js';
	import { parseAliasesInput } from '$lib/utils/aliases.js';
	import { toast } from 'svelte-sonner';
	import PlusIcon from '@lucide/svelte/icons/plus';

	interface Props {
		open?: boolean;
		system?: ClassificationSystem | null;
		hideTrigger?: boolean;
	}

	let { open = $bindable(false), system = null, hideTrigger = false }: Props = $props();
	let isSaving = $state(false);
	let fieldErrors = $state<Record<string, string[] | undefined>>({});
	let formValues = $state<ClassificationSystemFormValues>({
		name: '',
		code: '',
		classification_type: 'custom',
		aliases: [],
		is_default: false
	});
	let aliasesInput = $state('');
	let initialisedDialogKey = $state<string | null>(null);
	type ClassificationField = keyof ClassificationSystemFormValues;
	const classificationFieldIdMap: Record<ClassificationField, string> = {
		name: 'classification-system-name',
		code: 'classification-system-code',
		classification_type: 'classification-system-type',
		aliases: 'classification-system-aliases',
		is_default: 'classification-system-type'
	};

	function getDialogSeedKey(): string {
		return system ? system.id : '__new__';
	}

	$effect(() => {
		if (!open) {
			if (initialisedDialogKey !== null) initialisedDialogKey = null;
			return;
		}
		const dialogSeedKey = getDialogSeedKey();
		if (initialisedDialogKey === dialogSeedKey) return;
		initialisedDialogKey = dialogSeedKey;
		const shouldDefaultNewSystem = !system
			? untrack(() => classificationSystemsState.list.length === 0)
			: false;
		fieldErrors = {};
		formValues = system
			? {
					name: system.name,
					code: system.code,
					classification_type: system.classification_type,
					aliases: system.aliases,
					is_default: system.is_default
				}
			: {
					name: '',
					code: '',
					classification_type: 'custom',
					aliases: [],
					is_default: shouldDefaultNewSystem
				};
		aliasesInput = formValues.aliases.join('; ');
	});

	async function focusClassificationField(field: ClassificationField) {
		await tick();
		document.getElementById(classificationFieldIdMap[field])?.focus();
	}

	async function focusFirstClassificationError(errors: Record<string, string[] | undefined>) {
		const firstField = findFirstErrorField<ClassificationField>(
			['name', 'code', 'classification_type', 'is_default'],
			errors
		);
		if (firstField) {
			await focusClassificationField(firstField);
		}
	}

	function closeDialog() {
		fieldErrors = {};
		open = false;
	}

	async function handleSave() {
		fieldErrors = {};
		formValues.aliases = parseAliasesInput(aliasesInput);
		const result = classificationSystemFormSchema.safeParse(formValues);
		if (!result.success) {
			fieldErrors = result.error.flatten().fieldErrors as Record<string, string[] | undefined>;
			toast.error('Validation failed');
			await focusFirstClassificationError(fieldErrors);
			return;
		}
		isSaving = true;
		try {
			if (system) {
				await classificationSystemsState.updateClassificationSystem(system.id, result.data);
			} else {
				await classificationSystemsState.addClassificationSystem(result.data);
			}
			closeDialog();
		} catch (error) {
			const message = getErrorMessage(error);
			if (message.startsWith('Classification system "') && message.includes('already exists')) {
				fieldErrors = { ...fieldErrors, name: [message] };
				await focusClassificationField('name');
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
		Add Classification System
	</Button>
{/if}

<Dialog.Root bind:open>
	<Dialog.FormFrame
		title={system ? `Edit ${system.name}` : 'New Classification System'}
		description={system
			? 'Review and update the classification system details.'
			: 'Create a classification system for cost codes and estimate matching.'}
	>
		<div class="flex flex-col gap-4">
			<FieldShell>
				<FieldLabel for="classification-system-name">System Name</FieldLabel>
				<Input
					id="classification-system-name"
					bind:value={formValues.name}
					invalidTone={getFieldInvalidTone(fieldErrors.name)}
					placeholder="e.g. CSI MasterFormat"
				/>
				<FieldError errors={fieldErrors.name} />
			</FieldShell>
			<div class="grid gap-4 md:grid-cols-2">
				<FieldShell>
					<FieldLabel for="classification-system-code">Code</FieldLabel>
					<Input
						id="classification-system-code"
						bind:value={formValues.code}
						placeholder="Optional shorthand"
					/>
				</FieldShell>
				<FieldShell>
					<FieldLabel for="classification-system-type">Type</FieldLabel>
					<Select.Root
						type="single"
						value={formValues.classification_type}
						onValueChange={(value) => {
							if (value)
								formValues.classification_type =
									value as ClassificationSystemFormValues['classification_type'];
						}}
					>
						<Select.Trigger id="classification-system-type" class="w-full">
							{CLASSIFICATION_SYSTEM_TYPE_OPTIONS.find(
								(option) => option.value === formValues.classification_type
							)?.label}
						</Select.Trigger>
						<Select.Content>
							{#each CLASSIFICATION_SYSTEM_TYPE_OPTIONS as option (option.value)}
								<Select.Item value={option.value}>{option.label}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</FieldShell>
			</div>
			<FieldShell>
				<FieldLabelRow for="classification-system-aliases" tooltip={ALIAS_FIELD_HELP_TEXT}
					>Aliases</FieldLabelRow
				>
				<Textarea
					id="classification-system-aliases"
					bind:value={aliasesInput}
					class="ui-field-note-sm"
					placeholder={ALIAS_INPUT_PLACEHOLDER}
				/>
				<FieldError errors={fieldErrors.aliases} />
			</FieldShell>
			<Dialog.ToggleRow
				bind:checked={formValues.is_default}
				label="Default system"
				tooltip="New estimates can use this classification system by default."
			/>
		</div>

		{#snippet footer()}
			<Button variant="secondary" onclick={closeDialog}>Cancel</Button>
			<Button variant="brand" onclick={handleSave} disabled={isSaving} loading={isSaving}>
				{isSaving
					? 'Saving...'
					: system
						? 'Update Classification System'
						: 'Save Classification System'}
			</Button>
		{/snippet}
	</Dialog.FormFrame>
</Dialog.Root>
