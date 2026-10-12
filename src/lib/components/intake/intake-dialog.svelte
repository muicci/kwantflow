<script lang="ts">
	import { tick } from 'svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import ClipboardListIcon from '@lucide/svelte/icons/clipboard-list';
	import MailIcon from '@lucide/svelte/icons/mail';
	import PaperclipIcon from '@lucide/svelte/icons/paperclip';
	import FolderPlusIcon from '@lucide/svelte/icons/folder-plus';
	import DetailsPanel from './details-panel.svelte';
	import ContextPanel from './context-panel.svelte';
	import AssetsPanel from './assets-panel.svelte';
	import type { ExistingFile, StagedFile } from './assets-panel.svelte';
	import { projectsState } from '$lib/state/projects.svelte.js';
	import type { Project } from '$lib/types/index.js';
	import { PriorityLevel, ProjectStatus } from '$lib/constants/index.js';
	import { rfqSchema, type RfqValues } from '$lib/schemas/index.js';
	import { workspaceState } from '$lib/state/workspace.svelte.js';
	import { createLogger } from '$lib/services/logger.js';
	import { getErrorMessage } from '$lib/utils/runtime-form-errors.js';
	import { findFirstErrorField } from '$lib/utils/validation-navigation.js';
	import { toast } from 'svelte-sonner';

	interface Props {
		triggerClass?: string;
		open?: boolean;
		project?: Project | null;
		hideTrigger?: boolean;
		initialValues?: Partial<RfqValues>;
		initialFiles?: StagedFile[];
	}

	let {
		triggerClass = '',
		open = $bindable(false),
		project = null,
		hideTrigger = false,
		initialValues = {},
		initialFiles = []
	}: Props = $props();

	type IntakeStep = 'details' | 'context' | 'assets';
	type RfqField = keyof RfqValues;
	let activeStep: IntakeStep = $state('details');
	let isSubmitting = $state(false);
	let hasAttemptedSave = $state(false);
	let runtimeFieldErrors = $state<Record<string, string[] | undefined>>({});
	const log = createLogger('intakeDialog');

	// --- Native Svelte 5 Form State ---
	let formValues = $state<RfqValues>({
		rfq_number: '',
		company_contact_id: null,
		company_name: '',
		requester_contact_id: null,
		requester_name: '',
		project_name: '',
		due_date: '',
		received_date: '',
		submission_deadline_at: '',
		estimator_name: '',
		customer_tender_reference: '',
		addendum_label: '',
		addendum_date: '',
		addendum_notes: '',
		site_address: '',
		delivery_address: '',
		source_channel: 'manual',
		source_reference: null,
		source_email_message_id: null,
		priority: PriorityLevel.Medium,
		status: ProjectStatus.Draft,
		content: '',
		note: ''
	});

	let validationErrors = $derived.by(() => {
		const result = rfqSchema.safeParse(formValues);
		return result.success ? {} : result.error.flatten().fieldErrors;
	});

	let errors = $derived.by(() => ({
		...(hasAttemptedSave ? validationErrors : {}),
		...runtimeFieldErrors
	}));

	// Dual-source file state
	let existingFiles: ExistingFile[] = $state([]);
	let newFiles: StagedFile[] = $state([]);
	let contactEmail = $state('');
	let contactPhone = $state('');

	const nav = [
		{ id: 'details' as const, name: 'Details', icon: ClipboardListIcon },
		{ id: 'context' as const, name: 'Context', icon: MailIcon },
		{ id: 'assets' as const, name: 'Files', icon: PaperclipIcon }
	];
	const rfqFieldStepMap: Record<RfqField, IntakeStep> = {
		rfq_number: 'details',
		company_contact_id: 'details',
		company_name: 'details',
		requester_contact_id: 'details',
		requester_name: 'details',
		project_name: 'details',
		due_date: 'details',
		received_date: 'details',
		submission_deadline_at: 'details',
		estimator_name: 'details',
		customer_tender_reference: 'details',
		addendum_label: 'context',
		addendum_date: 'context',
		addendum_notes: 'context',
		site_address: 'context',
		delivery_address: 'context',
		source_channel: 'details',
		source_reference: 'details',
		source_email_message_id: 'details',
		source_email_integration_id: 'details',
		priority: 'details',
		status: 'details',
		content: 'context',
		note: 'context'
	};
	const rfqFieldIdSuffixMap: Record<RfqField, string> = {
		rfq_number: '-rfq-number',
		company_contact_id: '-company-name',
		company_name: '-company-name',
		requester_contact_id: '-requester-name',
		requester_name: '-requester-name',
		project_name: '-project-name',
		due_date: '-submission-deadline-at',
		received_date: '-received-date',
		submission_deadline_at: '-submission-deadline-at',
		estimator_name: '-estimator-name',
		customer_tender_reference: '-customer-tender-reference',
		addendum_label: '-addendum-label',
		addendum_date: '-addendum-date',
		addendum_notes: '-addendum-notes',
		site_address: '-site-address',
		delivery_address: '-delivery-address',
		source_channel: '-company-name',
		source_reference: '-company-name',
		source_email_message_id: '-company-name',
		source_email_integration_id: '-company-name',
		priority: '-priority',
		status: '-status',
		content: '-content',
		note: '-note'
	};

	async function generateRfqNumber(): Promise<string> {
		return await projectsState.getNextRfqNumber();
	}

	function hydrateSubmissionDeadlineValue(
		submissionDeadlineAt: string | null | undefined,
		legacyDueDate: string | null | undefined
	): string {
		const deadline = submissionDeadlineAt?.trim();
		if (deadline) return deadline;
		const dueDate = legacyDueDate?.trim();
		return dueDate ? `${dueDate}T17:00` : '';
	}

	async function hydrateForm() {
		activeStep = 'details';
		isSubmitting = false;
		hasAttemptedSave = false;
		runtimeFieldErrors = {};
		existingFiles = [];
		newFiles = [];

		if (project) {
			formValues = {
				rfq_number: project.rfq_number,
				company_contact_id: project.contact_id ?? null,
				company_name: project.contact_name_snapshot || project.contact_name || '',
				requester_contact_id: project.requester_contact_id ?? null,
				requester_name: project.requester_name_snapshot || project.requester_contact_name || '',
				project_name: project.project_name || '',
				due_date: project.due_date || '',
				received_date: project.received_date || '',
				submission_deadline_at: hydrateSubmissionDeadlineValue(
					project.submission_deadline_at,
					project.due_date
				),
				estimator_name: project.estimator_name || '',
				customer_tender_reference: project.customer_tender_reference || '',
				addendum_label: project.addendum_label || '',
				addendum_date: project.addendum_date || '',
				addendum_notes: project.addendum_notes || '',
				site_address: project.site_address || '',
				delivery_address: project.delivery_address || '',
				source_channel: project.source_channel || 'manual',
				source_reference: project.source_reference ?? null,
				source_email_message_id: project.source_email_message_id ?? null,
				source_email_integration_id: project.source_email_integration_id ?? null,
				priority: project.priority || PriorityLevel.Medium,
				status: project.status,
				content: project.content || '',
				note: project.note || ''
			};

			try {
				const projectFiles = await projectsState.getProjectFiles(project.id);
				const hydratedFiles: ExistingFile[] = [];
				for (const file of projectFiles) {
					hydratedFiles.push({
						fileId: file.id,
						name: file.original_name,
						path: file.file_path
					});
				}
				existingFiles = hydratedFiles;
			} catch (err) {
				log.error('Failed to hydrate assets', err);
			}
		} else {
			const newRfqNumber = await generateRfqNumber();
			formValues = {
				rfq_number: initialValues.rfq_number || newRfqNumber,
				company_contact_id: initialValues.company_contact_id ?? null,
				company_name: initialValues.company_name ?? '',
				requester_contact_id: initialValues.requester_contact_id ?? null,
				requester_name: initialValues.requester_name ?? '',
				project_name: initialValues.project_name || initialValues.content?.slice(0, 100) || '',
				submission_deadline_at: initialValues.submission_deadline_at ?? '',
				customer_tender_reference: initialValues.customer_tender_reference ?? '',
				estimator_name:
					initialValues.estimator_name ||
					workspaceState.businessContactName ||
					workspaceState.displayName ||
					'',
				site_address: initialValues.site_address ?? '',
				delivery_address: initialValues.delivery_address ?? '',
				due_date: initialValues.due_date ?? '',
				received_date: initialValues.received_date ?? '',
				source_channel: initialValues.source_channel ?? 'manual',
				source_reference: initialValues.source_reference ?? null,
				source_email_message_id: initialValues.source_email_message_id ?? null,
				source_email_integration_id: initialValues.source_email_integration_id ?? null,
				addendum_label: initialValues.addendum_label ?? '',
				addendum_date: initialValues.addendum_date ?? '',
				addendum_notes: initialValues.addendum_notes ?? '',
				priority: initialValues.priority ?? PriorityLevel.Medium,
				status: initialValues.status ?? ProjectStatus.Draft,
				content: initialValues.content ?? '',
				note: initialValues.note ?? ''
			};
			contactEmail = ((initialValues as Record<string, unknown>).contact_email as string) || '';
			contactPhone = ((initialValues as Record<string, unknown>).contact_phone as string) || '';
			if (initialFiles.length > 0) {
				newFiles = [...initialFiles];
			}
		}
	}

	$effect(() => {
		if (open) {
			hydrateForm();
		}
	});

	function clearRuntimeFieldErrors() {
		if (Object.keys(runtimeFieldErrors).length === 0) return;
		runtimeFieldErrors = {};
	}

	async function focusRfqField(field: RfqField) {
		activeStep = rfqFieldStepMap[field];
		await tick();
		const suffix = rfqFieldIdSuffixMap[field];
		const target = document.querySelector<HTMLElement>(`[id$="${suffix}"]`);
		target?.focus();
	}

	async function focusFirstRfqError(errors: Record<string, string[] | undefined>) {
		const firstField = findFirstErrorField<RfqField>(
			[
				'rfq_number',
				'company_name',
				'requester_name',
				'project_name',
				'received_date',
				'submission_deadline_at',
				'estimator_name',
				'customer_tender_reference',
				'priority',
				'status',
				'content',
				'note'
			],
			errors
		);
		if (firstField) {
			await focusRfqField(firstField);
		}
	}

	function deriveSubmissionDeadlineDate(): string | undefined {
		const deadline = formValues.submission_deadline_at?.trim();
		if (deadline) return deadline.split('T')[0] || deadline;
		return formValues.due_date || undefined;
	}

	async function handleSave() {
		if (isSubmitting) {
			return;
		}

		hasAttemptedSave = true;
		runtimeFieldErrors = {};
		const validationResult = rfqSchema.safeParse(formValues);
		if (!validationResult.success) {
			const schemaErrors = validationResult.error.flatten().fieldErrors;
			toast.error('Please fix form errors before saving.');
			await focusFirstRfqError(schemaErrors);
			return;
		}
		isSubmitting = true;
		try {
			const keptExisting = existingFiles.map((f) => ({
				path: f.path,
				existing: true as const,
				fileId: f.fileId
			}));
			const addedNew = newFiles.map((f) => ({ path: f.path, existing: false as const }));
			const allFiles = [...keptExisting, ...addedNew];
			const companyName = formValues.company_name?.trim() || undefined;
			const companyContactId = formValues.company_contact_id?.trim() || undefined;
			const requesterName = formValues.requester_name?.trim() || undefined;
			const requesterContactId = formValues.requester_contact_id?.trim() || undefined;
			const submissionDeadlineDate = deriveSubmissionDeadlineDate();

			if (project) {
				await projectsState.updateProject(
					project.id,
					formValues.rfq_number.trim(),
					companyContactId,
					companyName,
					formValues.project_name?.trim() || undefined,
					submissionDeadlineDate,
					formValues.priority as PriorityLevel,
					formValues.status as ProjectStatus,
					formValues.content?.trim() || undefined,
					formValues.note?.trim() || undefined,
					allFiles,
					requesterContactId,
					requesterName,
					formValues.source_channel,
					formValues.source_reference?.trim() || undefined,
					formValues.received_date || undefined,
					formValues.submission_deadline_at || undefined,
					formValues.estimator_name?.trim() || undefined,
					formValues.customer_tender_reference?.trim() || undefined,
					formValues.addendum_label?.trim() || undefined,
					formValues.addendum_date || undefined,
					formValues.addendum_notes?.trim() || undefined,
					formValues.site_address?.trim() || undefined,
					formValues.delivery_address?.trim() || undefined,
					formValues.source_email_message_id?.trim() || undefined,
					formValues.source_email_integration_id?.trim() || undefined,
					contactEmail || undefined,
					contactPhone || undefined
				);
			} else {
				await projectsState.addProject(
					formValues.rfq_number.trim(),
					companyContactId,
					companyName,
					formValues.project_name?.trim() || undefined,
					submissionDeadlineDate,
					formValues.priority as PriorityLevel,
					formValues.status as ProjectStatus,
					formValues.content?.trim() || undefined,
					formValues.note?.trim() || undefined,
					newFiles,
					requesterContactId,
					requesterName,
					formValues.source_channel,
					formValues.source_reference?.trim() || undefined,
					formValues.received_date || undefined,
					formValues.submission_deadline_at || undefined,
					formValues.estimator_name?.trim() || undefined,
					formValues.customer_tender_reference?.trim() || undefined,
					formValues.addendum_label?.trim() || undefined,
					formValues.addendum_date || undefined,
					formValues.addendum_notes?.trim() || undefined,
					formValues.site_address?.trim() || undefined,
					formValues.delivery_address?.trim() || undefined,
					formValues.source_email_message_id?.trim() || undefined,
					formValues.source_email_integration_id?.trim() || undefined,
					contactEmail || undefined,
					contactPhone || undefined
				);
			}
			open = false;
		} catch (err) {
			const message = getErrorMessage(err);
			if (
				message.includes('Failed to ingest') ||
				message.includes('local vault') ||
				message.includes('file')
			) {
				activeStep = 'assets';
				return;
			}
			if (
				message.includes('UNIQUE constraint failed: projects.contact_id, projects.rfq_number') ||
				message.includes('projects.contact_id, projects.rfq_number')
			) {
				runtimeFieldErrors = {
					rfq_number: ['This RFQ number already exists for the selected company.']
				};
				await focusRfqField('rfq_number');
				return;
			}
			if (
				message.includes('unique company name') ||
				message.includes('idx_contacts_workspace_company_name_unique')
			) {
				runtimeFieldErrors = {
					company_name: [
						message.includes('unique company name')
							? message
							: 'A company with this name already exists. Select it from the list or enter a new company name.'
					]
				};
				await focusRfqField('company_name');
				return;
			}
			if (message.includes('idx_contacts_workspace_person_company_name_unique')) {
				runtimeFieldErrors = {
					requester_name: [
						'A contact person with this name already exists for the selected company. Select them from the list or enter a new person name.'
					]
				};
				await focusRfqField('requester_name');
				return;
			}
			log.error(`Failed to ${project ? 'update' : 'create'} project`, err);
			toast.error(message || 'Something went wrong. Try again.');
		} finally {
			isSubmitting = false;
		}
	}
</script>

<Dialog.Root bind:open>
	{#if !project && !hideTrigger}
		<Dialog.Trigger>
			{#snippet child({ props })}
				<Button size="sm" class={triggerClass} {...props}>
					<FolderPlusIcon class="mr-2 h-4 w-4" />
					New RFQ
				</Button>
			{/snippet}
		</Dialog.Trigger>
	{/if}

	<Dialog.WorkflowFrame
		title={project ? `Edit ${project.rfq_number}` : 'New RFQ'}
		description={project
			? 'Review and update the RFQ details, context, and files.'
			: 'Create a new RFQ and add the initial context and files.'}
		steps={nav}
		{activeStep}
		onStepSelect={(stepId) => {
			activeStep = stepId as IntakeStep;
		}}
	>
		{#if activeStep === 'details'}
			<DetailsPanel bind:formValues fieldErrors={errors} onFormEdit={clearRuntimeFieldErrors} />
		{:else if activeStep === 'context'}
			<ContextPanel bind:formValues />
		{:else if activeStep === 'assets'}
			<AssetsPanel bind:existingFiles bind:newFiles />
		{/if}

		{#snippet footer()}
			<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
			<Button variant="brand" onclick={handleSave} disabled={isSubmitting} loading={isSubmitting}>
				{isSubmitting ? 'Saving...' : project ? 'Save Changes' : 'Create RFQ'}
			</Button>
		{/snippet}
	</Dialog.WorkflowFrame>
</Dialog.Root>
