<script lang="ts">
	import DatePickerField from '$lib/components/date-picker-field.svelte';
	import { Input } from '$lib/components/ui/input/index.js';
	import {
		FieldError,
		FieldHelp,
		FieldLabel,
		FieldShell,
		Meta,
		Text
	} from '$lib/components/primitives/index.js';
	import { onMount } from 'svelte';
	import * as Select from '$lib/components/ui/select/index.js';
	import { PriorityLevel, ProjectStatus, projectStatusLabel } from '$lib/constants/index.js';
	import type { RfqValues } from '$lib/schemas/index.js';
	import { contactsState } from '$lib/state/contacts.svelte.js';
	import {
		buildProjectContactLink,
		buildProjectRequesterLink,
		filterProjectContacts,
		filterProjectRequesters,
		getPrimaryProjectRequester
	} from '$lib/utils/project-contact.js';
	import { getFieldInvalidTone } from '$lib/utils/field-errors.js';

	interface Props {
		formValues: RfqValues;
		fieldErrors: Record<string, string[] | undefined>;
		onFormEdit?: () => void;
	}

	let { formValues = $bindable(), fieldErrors, onFormEdit = () => {} }: Props = $props();

	const id = $props.id();

	let companyPopoverOpen = $state(false);
	let requesterPopoverOpen = $state(false);

	const filteredCompanies = $derived.by(() =>
		filterProjectContacts(contactsState.companyContacts, formValues.company_name ?? '')
	);

	const companyLink = $derived(
		buildProjectContactLink(
			contactsState.companyContacts.map((contact) => ({
				id: contact.id,
				name: contact.display_name || contact.name,
				email: contact.email
			})),
			formValues.company_name ?? ''
		)
	);

	const availableRequesters = $derived(
		formValues.company_contact_id
			? contactsState.getLinkedPeople(formValues.company_contact_id)
			: []
	);
	const filteredRequesters = $derived.by(() =>
		filterProjectRequesters(
			availableRequesters.map((contact) => ({
				id: contact.id,
				name: contact.display_name || contact.name,
				contact_name: contact.role_title,
				email: contact.email
			})),
			formValues.requester_name ?? ''
		)
	);
	const requesterLink = $derived(
		buildProjectRequesterLink(
			availableRequesters.map((contact) => ({
				id: contact.id,
				name: contact.display_name || contact.name,
				contact_name: contact.role_title,
				email: contact.email
			})),
			formValues.requester_name ?? ''
		)
	);

	let showClearCompany = $derived((formValues.company_name ?? '').length > 0);
	let showClearRequester = $derived((formValues.requester_name ?? '').length > 0);

	let inputRef: HTMLInputElement | null = $state(null);
	let companyFieldRef: HTMLDivElement | null = $state(null);
	let requesterFieldRef: HTMLDivElement | null = $state(null);

	function getPrimaryRequesterForCompany(companyId: string | null) {
		return companyId
			? getPrimaryProjectRequester(
					contactsState.getLinkedPeople(companyId).map((contact) => ({
						id: contact.id,
						name: contact.display_name || contact.name,
						contact_name: contact.role_title,
						email: contact.email,
						is_primary_company_contact: contact.is_primary_company_contact
					}))
				)
			: null;
	}

	function selectCompany(name: string) {
		const link = buildProjectContactLink(
			contactsState.companyContacts.map((contact) => ({
				id: contact.id,
				name: contact.display_name || contact.name,
				email: contact.email
			})),
			name
		);
		formValues.company_name = link.contactName;
		formValues.company_contact_id = link.contactId;
		const primaryRequester = getPrimaryRequesterForCompany(link.contactId);
		formValues.requester_contact_id = primaryRequester?.id ?? null;
		formValues.requester_name = primaryRequester?.name ?? '';
		companyPopoverOpen = false;
		// Focus the next logical field instead of refocusing the same one
		// This prevents the focus handler from re-opening the popover
		const requesterInput = document.getElementById(`${id}-requester-name`);
		requesterInput?.focus();
	}

	function selectRequester(name: string) {
		const link = buildProjectRequesterLink(
			availableRequesters.map((contact) => ({
				id: contact.id,
				name: contact.display_name || contact.name,
				contact_name: contact.role_title,
				email: contact.email
			})),
			name
		);
		formValues.requester_name = link.contactName;
		formValues.requester_contact_id = link.contactId;
		requesterPopoverOpen = false;
		const projectNameInput = document.getElementById(`${id}-project-name`);
		projectNameInput?.focus();
	}

	function handleCompanyInput() {
		onFormEdit();
		formValues.company_contact_id = companyLink.contactId;
		formValues.requester_contact_id = null;
		if (!formValues.company_contact_id) {
			formValues.requester_name = formValues.requester_name ?? '';
		}
		// Only open if there are results and we actually have text
		const hasText = (formValues.company_name ?? '').length > 0;
		if (hasText && filteredCompanies.length > 0) {
			companyPopoverOpen = true;
		} else {
			companyPopoverOpen = false;
		}
	}

	function handleCompanyBlur() {
		companyPopoverOpen = false;
		if (!companyLink.contactId) {
			return;
		}

		formValues.company_contact_id = companyLink.contactId;
		const primaryRequester = getPrimaryRequesterForCompany(companyLink.contactId);
		formValues.requester_contact_id = primaryRequester?.id ?? null;
		formValues.requester_name = primaryRequester?.name ?? '';
	}

	function handleRequesterInput() {
		onFormEdit();
		formValues.requester_contact_id = requesterLink.contactId;
		const hasText = (formValues.requester_name ?? '').length > 0;
		if (hasText && filteredRequesters.length > 0 && formValues.company_contact_id) {
			requesterPopoverOpen = true;
		} else {
			requesterPopoverOpen = false;
		}
	}

	onMount(() => {
		function handlePointerDown(event: MouseEvent) {
			if (!companyFieldRef?.contains(event.target as Node)) {
				companyPopoverOpen = false;
			}
			if (!requesterFieldRef?.contains(event.target as Node)) {
				requesterPopoverOpen = false;
			}
		}

		document.addEventListener('mousedown', handlePointerDown);
		return () => document.removeEventListener('mousedown', handlePointerDown);
	});
</script>

<div class="flex flex-col gap-4">
	<div class="grid gap-4 md:grid-cols-2">
		<FieldShell invalidTone={getFieldInvalidTone(fieldErrors.rfq_number)}>
			<FieldLabel for="{id}-rfq-number">RFQ Number</FieldLabel>
			<Input
				id="{id}-rfq-number"
				bind:value={formValues.rfq_number}
				size="default"
				invalidTone={getFieldInvalidTone(fieldErrors.rfq_number)}
				placeholder="RFQ-1001"
				oninput={onFormEdit}
			/>
			<FieldError errors={fieldErrors.rfq_number} />
		</FieldShell>

		<FieldShell invalidTone={getFieldInvalidTone(fieldErrors.company_name)}>
			<FieldLabel for="{id}-company-name">Company</FieldLabel>
			<div bind:this={companyFieldRef} class="relative w-full">
				<Input
					id="{id}-company-name"
					bind:ref={inputRef}
					bind:value={formValues.company_name}
					size="default"
					invalidTone={getFieldInvalidTone(fieldErrors.company_name)}
					class="pr-8"
					placeholder="Select or type a company"
					autocomplete="off"
					onfocus={() => {
						if ((formValues.company_name ?? '').length > 0 && filteredCompanies.length > 0) {
							companyPopoverOpen = true;
						}
					}}
					onblur={handleCompanyBlur}
					oninput={handleCompanyInput}
					onkeydown={(e) => {
						if (e.key === 'Escape') {
							companyPopoverOpen = false;
						}
					}}
				/>
				{#if showClearCompany}
					<button
						type="button"
						class="ui-muted-action ui-radius-pill hover-surface-subtle absolute top-1/2 right-2 -translate-y-1/2 p-0.5"
						aria-label="Clear company"
						onclick={(e) => {
							e.stopPropagation();
							formValues.company_name = '';
							formValues.company_contact_id = null;
							formValues.requester_name = '';
							formValues.requester_contact_id = null;
							companyPopoverOpen = false;
							onFormEdit();
						}}
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							class="size-3.5"
						>
							<path d="M18 6 6 18" />
							<path d="m6 6 12 12" />
						</svg>
					</button>
				{/if}

				{#if companyPopoverOpen && filteredCompanies.length > 0}
					<div
						class="ui-radius-md absolute top-full right-0 left-0 z-50 mt-1 border bg-popover p-1 text-popover-foreground outline-hidden"
					>
						<div class="ui-scroll-panel-sm overflow-y-auto">
							<ul class="flex flex-col gap-0.5">
								{#each filteredCompanies as contact (contact.id)}
									<li>
										<button
											type="button"
											class="ui-radius-sm w-full px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground"
											onmousedown={(e) => e.preventDefault()}
											onclick={() => selectCompany(contact.name)}
										>
											<Text class="truncate">{contact.name}</Text>
											{#if contact.email}
												<Meta class="truncate">
													{contact.email}
												</Meta>
											{/if}
										</button>
									</li>
								{/each}
							</ul>
						</div>
					</div>
				{/if}
			</div>
			{#if fieldErrors.company_name}
				<FieldError errors={fieldErrors.company_name} />
			{:else if companyLink.shouldCreateContact}
				<FieldHelp>A new company will be created when you save this RFQ.</FieldHelp>
			{/if}
		</FieldShell>
	</div>

	<div class="grid gap-4 md:grid-cols-2">
		<FieldShell invalidTone={getFieldInvalidTone(fieldErrors.requester_name)}>
			<FieldLabel for="{id}-requester-name">Contact Person</FieldLabel>
			<div bind:this={requesterFieldRef} class="relative w-full">
				<Input
					id="{id}-requester-name"
					bind:value={formValues.requester_name}
					size="default"
					invalidTone={getFieldInvalidTone(fieldErrors.requester_name)}
					class="pr-8"
					placeholder="Select or type a person"
					autocomplete="off"
					onfocus={() => {
						if (
							formValues.company_contact_id &&
							(formValues.requester_name ?? '').length > 0 &&
							filteredRequesters.length > 0
						) {
							requesterPopoverOpen = true;
						}
					}}
					oninput={handleRequesterInput}
					onkeydown={(e) => {
						if (e.key === 'Escape') {
							requesterPopoverOpen = false;
						}
					}}
				/>
				{#if showClearRequester}
					<button
						type="button"
						class="ui-muted-action ui-radius-pill hover-surface-subtle absolute top-1/2 right-2 -translate-y-1/2 p-0.5"
						aria-label="Clear contact person"
						onclick={(e) => {
							e.stopPropagation();
							formValues.requester_name = '';
							formValues.requester_contact_id = null;
							requesterPopoverOpen = false;
							onFormEdit();
						}}
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							class="size-3.5"
						>
							<path d="M18 6 6 18" />
							<path d="m6 6 12 12" />
						</svg>
					</button>
				{/if}

				{#if requesterPopoverOpen && filteredRequesters.length > 0}
					<div
						class="ui-radius-md absolute top-full right-0 left-0 z-50 mt-1 border bg-popover p-1 text-popover-foreground outline-hidden"
					>
						<div class="ui-scroll-panel-sm overflow-y-auto">
							<ul class="flex flex-col gap-0.5">
								{#each filteredRequesters as requester (requester.id)}
									<li>
										<button
											type="button"
											class="ui-radius-sm w-full px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground"
											onmousedown={(e) => e.preventDefault()}
											onclick={() => selectRequester(requester.name)}
										>
											<Text class="truncate">{requester.name}</Text>
											{#if requester.contact_name || requester.email}
												<Meta class="truncate">
													{requester.contact_name || requester.email}
												</Meta>
											{/if}
										</button>
									</li>
								{/each}
							</ul>
						</div>
					</div>
				{/if}
			</div>
			{#if fieldErrors.requester_name}
				<FieldError errors={fieldErrors.requester_name} />
			{:else if !formValues.company_contact_id && (formValues.requester_name ?? '').trim().length > 0}
				<FieldHelp>
					Save the new company first and this person will be linked automatically.
				</FieldHelp>
			{:else if requesterLink.shouldCreateContact}
				<FieldHelp>A new person will be created for this company when you save.</FieldHelp>
			{/if}
		</FieldShell>

		<FieldShell>
			<FieldLabel for="{id}-project-name">Project Name</FieldLabel>
			<Input
				id="{id}-project-name"
				bind:value={formValues.project_name}
				size="default"
				placeholder="e.g. Bridge Renovation Stage 1"
				oninput={onFormEdit}
			/>
		</FieldShell>
	</div>

	<div class="grid gap-4 md:grid-cols-2">
		<FieldShell>
			<FieldLabel for="{id}-received-date">Received Date</FieldLabel>
			<DatePickerField
				id="{id}-received-date"
				bind:value={formValues.received_date}
				placeholder="Select received date"
				onChange={onFormEdit}
			/>
		</FieldShell>
		<FieldShell>
			<FieldLabel for="{id}-submission-deadline-at">Submission Deadline</FieldLabel>
			<DatePickerField
				id="{id}-submission-deadline-at"
				bind:value={formValues.submission_deadline_at}
				mode="datetime"
				placeholder="Select submission deadline"
				onChange={onFormEdit}
			/>
		</FieldShell>
	</div>

	<div class="grid gap-4 md:grid-cols-2">
		<FieldShell>
			<FieldLabel for="{id}-estimator-name">Estimator / Owner</FieldLabel>
			<Input
				id="{id}-estimator-name"
				bind:value={formValues.estimator_name}
				size="default"
				placeholder="Estimator or package owner"
				oninput={onFormEdit}
			/>
		</FieldShell>
		<FieldShell>
			<FieldLabel for="{id}-customer-tender-reference">Tender Reference</FieldLabel>
			<Input
				id="{id}-customer-tender-reference"
				bind:value={formValues.customer_tender_reference}
				size="default"
				placeholder="Customer tender or package ref"
				oninput={onFormEdit}
			/>
		</FieldShell>
	</div>

	<div class="grid gap-4 md:grid-cols-2">
		<FieldShell>
			<FieldLabel for="{id}-priority">Priority</FieldLabel>
			<Select.Root
				type="single"
				bind:value={formValues.priority}
				onValueChange={(val) => {
					onFormEdit();
					if (val) formValues.priority = val as PriorityLevel;
				}}
			>
				<Select.Trigger id="{id}-priority" class="w-full" size="default">
					{formValues.priority}
				</Select.Trigger>
				<Select.Content>
					{#each Object.values(PriorityLevel) as level (level)}
						<Select.Item value={level}>{level}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</FieldShell>

		<FieldShell>
			<FieldLabel for="{id}-status">Status</FieldLabel>
			<Select.Root
				type="single"
				bind:value={formValues.status}
				onValueChange={(val) => {
					onFormEdit();
					if (val) formValues.status = val as ProjectStatus;
				}}
			>
				<Select.Trigger id="{id}-status" class="w-full" size="default">
					{projectStatusLabel(formValues.status as ProjectStatus)}
				</Select.Trigger>
				<Select.Content>
					{#each Object.values(ProjectStatus) as status (status)}
						<Select.Item value={status}>
							{projectStatusLabel(status as ProjectStatus)}
						</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</FieldShell>
	</div>
</div>
