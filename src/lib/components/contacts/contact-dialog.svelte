<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { open as openDialog } from '@tauri-apps/plugin-dialog';
	import BuildingIcon from '@lucide/svelte/icons/building';
	import NetworkIcon from '@lucide/svelte/icons/network';
	import NotebookPenIcon from '@lucide/svelte/icons/notebook-pen';
	import UserIcon from '@lucide/svelte/icons/user';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import StarIcon from '@lucide/svelte/icons/star';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import * as Empty from '$lib/components/ui/empty/index.js';

	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import SearchableMultiSelect from '$lib/components/searchable-multi-select.svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import {
		FieldError,
		FieldLabel,
		FieldLabelRow,
		FieldShell,
		Meta,
		Panel,
		Text
	} from '$lib/components/primitives/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import PhoneInput from '$lib/components/phone-input.svelte';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import TooltipIconButton from '$lib/components/tooltip-icon-button.svelte';
	import CircularImagePicker from '$lib/components/circular-image-picker.svelte';
	import { contactsState } from '$lib/state/contacts.svelte.js';
	import { errorState } from '$lib/state/errors.svelte.js';
	import { materialsState } from '$lib/state/materials.svelte.js';
	import { labourRatesState } from '$lib/state/labour-rates.svelte.js';
	import { equipmentRatesState } from '$lib/state/equipment-rates.svelte.js';
	import { subcontractRatesState } from '$lib/state/subcontract-rates.svelte.js';
	import { workspaceState } from '$lib/state/workspace.svelte.js';
	import { contactFormSchema, type ContactFormValues } from '$lib/schemas/index.js';
	import type { Contact, ContactRole } from '$lib/types/index.js';
	import ContactDialogSelf from './contact-dialog.svelte';
	import {
		BRAND_LOGO_EXTENSIONS,
		WORKSPACE_COUNTRY_OPTIONS,
		formatIdentifierLabel,
		getWorkspaceCountryProfile
	} from '$lib/constants/index.js';
	import { CONTACT_ROLE_OPTIONS } from '$lib/services/contact-normalisation.js';
	import { isTauri } from '$lib/utils/env.js';
	import { getFieldInvalidTone } from '$lib/utils/field-errors.js';

	interface Props {
		open?: boolean;
		contact?: Contact | null;
		hideTrigger?: boolean;
		kindMode?: 'auto' | 'company' | 'person';
		linkedCompanyId?: string | null;
	}

	type ContactStep = 'profile' | 'people' | 'details' | 'relations';
	type ContactField = keyof ContactFormValues;

	let {
		open = $bindable(false),
		contact = null,
		hideTrigger = false,
		kindMode = 'auto',
		linkedCompanyId = null
	}: Props = $props();
	const id = $props.id();

	let activeStep: ContactStep = $state('profile');
	let isSaving = $state(false);
	let tagsInput = $state('');
	let stagedLogoPath = $state<string | null>(null);
	let stagedLogoPreviewUrl = $state('');
	let persistedLogoPreviewUrl = $state('');
	let isPersonDialogOpen = $state(false);
	let personToEdit = $state<Contact | null>(null);
	let personToDelete = $state<Contact | null>(null);
	let isDeletePersonDialogOpen = $state(false);
	let showArchivedPeople = $state(false);
	let fieldErrors = $state<Record<string, string[] | undefined>>({});
	let selectedMaterialIds = $state<string[]>([]);
	let selectedLabourRateIds = $state<string[]>([]);
	let selectedEquipmentRateIds = $state<string[]>([]);
	let selectedSubcontractRateIds = $state<string[]>([]);
	let relationshipCataloguesHydrated = $state(false);
	let relationshipCataloguesLoading = $state(false);
	const effectiveKind = $derived.by<'company' | 'person'>(() => {
		if (kindMode === 'company' || kindMode === 'person') return kindMode;
		return contact?.kind === 'person' ? 'person' : 'company';
	});
	const isCompanyMode = $derived(effectiveKind === 'company');
	let formValues = $state<ContactFormValues>({
		kind: 'company',
		country_code: workspaceState.countryCode || 'AU',
		display_name: '',
		name: '',
		company_name: '',
		person_first_name: '',
		person_last_name: '',
		role_title: '',
		linked_company_id: '',
		is_primary_company_contact: false,
		contact_name: '',
		email: '',
		website: '',
		phone: '',
		phone_country_code: workspaceState.countryCode || 'AU',
		phone_e164: '',
		abn: '',
		business_id_label: workspaceState.businessIdLabel || 'Business ID',
		business_id_value: '',
		tax_id_label: workspaceState.taxIdLabel || 'Tax ID',
		tax_id_value: '',
		address: '',
		notes: '',
		logo_file_path: '',
		custom_role_label: '',
		roles: ['customer'],
		tags: [],
		is_active: true
	});

	const nav = $derived(
		isCompanyMode
			? [
					{ id: 'profile' as const, name: 'Profile', icon: BuildingIcon },
					{ id: 'people' as const, name: 'People', icon: UserIcon },
					{ id: 'details' as const, name: 'Details', icon: NotebookPenIcon },
					{ id: 'relations' as const, name: 'Relations', icon: NetworkIcon }
				]
			: [{ id: 'profile' as const, name: 'Profile', icon: UserIcon }]
	);
	const materialOptions = $derived(
		materialsState.list
			.filter((item) => item.is_active !== false || selectedMaterialIds.includes(item.id))
			.map((item) => ({
				value: item.id,
				label: item.name,
				keywords: [item.code ?? '', item.category ?? '', item.specification ?? '']
			}))
	);
	const labourRateOptions = $derived(
		labourRatesState.list
			.filter((item) => item.is_active !== false || selectedLabourRateIds.includes(item.id))
			.map((item) => ({
				value: item.id,
				label: item.name,
				keywords: [item.code ?? '', item.category ?? '', item.work_center ?? '']
			}))
	);
	const equipmentRateOptions = $derived(
		equipmentRatesState.list
			.filter((item) => item.is_active !== false || selectedEquipmentRateIds.includes(item.id))
			.map((item) => ({
				value: item.id,
				label: item.name,
				keywords: [item.code ?? '', item.category ?? '', item.work_center ?? '']
			}))
	);
	const subcontractRateOptions = $derived(
		subcontractRatesState.list
			.filter((item) => item.is_active !== false || selectedSubcontractRateIds.includes(item.id))
			.map((item) => ({
				value: item.id,
				label: item.name,
				keywords: [item.code ?? '', item.category ?? '']
			}))
	);
	const showStepNav = $derived(nav.length > 1);

	const linkedPersonCompany = $derived.by(() => {
		if (isCompanyMode) return null;
		const companyId = (
			formValues.linked_company_id ||
			linkedCompanyId ||
			contact?.linked_company_id ||
			''
		).trim();
		if (!companyId) return null;
		return (
			contactsState.allCompanies.find((existingContact) => existingContact.id === companyId) ?? null
		);
	});
	const linkedPeople = $derived(contact?.id ? contactsState.getLinkedPeople(contact.id) : []);
	const archivedPeople = $derived(
		contact?.id
			? contactsState
					.getLinkedPeople(contact.id, true)
					.filter((person) => person.is_active === false)
			: []
	);
	const selectedCountryProfile = $derived(getWorkspaceCountryProfile(formValues.country_code));
	const logoPreviewUrl = $derived(stagedLogoPreviewUrl || persistedLogoPreviewUrl);
	const companyInitials = $derived.by(() => {
		const source = (formValues.display_name || formValues.company_name || 'Company').trim();
		return source
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((segment) => segment[0]?.toUpperCase() ?? '')
			.join('');
	});

	function syncSelectedCatalogueIds(companyId: string): void {
		selectedMaterialIds = companyId
			? materialsState.list
					.filter((item) =>
						(item.linkedCompanies ?? []).some((company) => company.id === companyId)
					)
					.map((item) => item.id)
			: [];
		selectedLabourRateIds = companyId
			? labourRatesState.list
					.filter((item) =>
						(item.linkedCompanies ?? []).some((company) => company.id === companyId)
					)
					.map((item) => item.id)
			: [];
		selectedEquipmentRateIds = companyId
			? equipmentRatesState.list
					.filter((item) =>
						(item.linkedCompanies ?? []).some((company) => company.id === companyId)
					)
					.map((item) => item.id)
			: [];
		selectedSubcontractRateIds = companyId
			? subcontractRatesState.list
					.filter((item) =>
						(item.linkedCompanies ?? []).some((company) => company.id === companyId)
					)
					.map((item) => item.id)
			: [];
	}

	$effect(() => {
		if (!open) return;
		activeStep = 'profile';
		fieldErrors = {};
		stagedLogoPath = null;
		stagedLogoPreviewUrl = '';
		showArchivedPeople = false;
		relationshipCataloguesHydrated = false;
		relationshipCataloguesLoading = false;
		const companyId = contact?.id ?? '';
		untrack(() => syncSelectedCatalogueIds(companyId));
		const linkedPersonCompanyId = (contact?.linked_company_id ?? linkedCompanyId ?? '').trim();
		const linkedCompany = linkedPersonCompanyId
			? (contactsState.allCompanies.find(
					(existingContact) => existingContact.id === linkedPersonCompanyId
				) ?? null)
			: null;
		const personCountryCode = linkedCompany?.country_code ?? (workspaceState.countryCode || 'AU');
		const personCountryProfile = getWorkspaceCountryProfile(personCountryCode);
		if (contact) {
			formValues = {
				kind: effectiveKind,
				country_code: isCompanyMode ? contact.country_code : personCountryCode,
				display_name: contact.display_name || contact.name,
				name: contact.name,
				company_name: contact.company_name ?? contact.name,
				person_first_name: contact.person_first_name ?? '',
				person_last_name: contact.person_last_name ?? '',
				role_title: contact.role_title ?? '',
				linked_company_id: linkedPersonCompanyId,
				is_primary_company_contact: contact.is_primary_company_contact ?? false,
				contact_name: contact.contact_name ?? '',
				email: contact.email ?? '',
				website: contact.website ?? '',
				phone: contactsState.formatPhoneDraft(
					contact.phone ?? '',
					isCompanyMode ? (contact.phone_country_code ?? contact.country_code) : personCountryCode
				),
				phone_country_code: isCompanyMode
					? (contact.phone_country_code ?? contact.country_code)
					: personCountryCode,
				phone_e164: contact.phone_e164 ?? '',
				abn: contact.abn ?? '',
				business_id_label: isCompanyMode
					? (contact.business_id_label ?? 'Business ID')
					: personCountryProfile.businessIdLabel,
				business_id_value: contact.business_id_value ?? contact.abn ?? '',
				tax_id_label: isCompanyMode
					? (contact.tax_id_label ?? 'Tax ID')
					: personCountryProfile.taxIdLabel,
				tax_id_value: contact.tax_id_value ?? '',
				address: contact.address ?? '',
				notes: contact.notes ?? '',
				logo_file_path: contact.logo_file_path ?? '',
				custom_role_label: contact.custom_role_label ?? '',
				roles: contact.roles ?? [],
				tags: contact.tags ?? [],
				is_active: contact.is_active ?? true
			};
			tagsInput = (contact.tags ?? []).join(', ');
		} else {
			formValues = {
				kind: effectiveKind,
				country_code: isCompanyMode ? workspaceState.countryCode || 'AU' : personCountryCode,
				display_name: '',
				name: '',
				company_name: '',
				person_first_name: '',
				person_last_name: '',
				role_title: '',
				linked_company_id: linkedPersonCompanyId,
				is_primary_company_contact: false,
				contact_name: '',
				email: '',
				website: '',
				phone: '',
				phone_country_code: isCompanyMode ? workspaceState.countryCode || 'AU' : personCountryCode,
				phone_e164: '',
				abn: '',
				business_id_label: isCompanyMode
					? workspaceState.businessIdLabel || 'Business ID'
					: personCountryProfile.businessIdLabel,
				business_id_value: '',
				tax_id_label: isCompanyMode
					? workspaceState.taxIdLabel || 'Tax ID'
					: personCountryProfile.taxIdLabel,
				tax_id_value: '',
				address: '',
				notes: '',
				logo_file_path: '',
				custom_role_label: '',
				roles: effectiveKind === 'company' ? ['customer'] : [],
				tags: [],
				is_active: true
			};
			tagsInput = '';
		}
	});

	$effect(() => {
		if (!open || !isCompanyMode || activeStep !== 'relations' || relationshipCataloguesHydrated) {
			return;
		}

		relationshipCataloguesHydrated = true;
		relationshipCataloguesLoading = true;
		const companyId = contact?.id ?? '';
		void Promise.all([
			materialsState.hydrate(),
			labourRatesState.hydrate(),
			equipmentRatesState.hydrate(),
			subcontractRatesState.hydrate()
		]).finally(() => {
			if (!open || (contact?.id ?? '') !== companyId) return;
			if (companyId) syncSelectedCatalogueIds(companyId);
			relationshipCataloguesLoading = false;
		});
	});

	$effect(() => {
		let cancelled = false;
		if (!stagedLogoPath) {
			stagedLogoPreviewUrl = '';
			return;
		}

		void (async () => {
			const preview = await contactsState.getAppLocalFileUrl(stagedLogoPath);
			if (!cancelled) {
				stagedLogoPreviewUrl = preview;
			}
		})();

		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		let cancelled = false;
		let objectUrl: string | null = null;
		if (stagedLogoPath || !formValues.logo_file_path) {
			persistedLogoPreviewUrl = '';
			return;
		}

		void (async () => {
			const preview = await contactsState.getVaultImagePreviewUrl(formValues.logo_file_path ?? '');
			if (cancelled) {
				URL.revokeObjectURL(preview);
				return;
			}
			objectUrl = preview;
			persistedLogoPreviewUrl = preview;
		})();

		return () => {
			cancelled = true;
			persistedLogoPreviewUrl = '';
			if (objectUrl) URL.revokeObjectURL(objectUrl);
		};
	});

	$effect(() => {
		const nextPhoneCountryCode =
			formValues.kind === 'company'
				? formValues.country_code
				: (linkedPersonCompany?.country_code ?? (workspaceState.countryCode || 'AU'));
		if (formValues.phone_country_code !== nextPhoneCountryCode) {
			formValues.phone_country_code = nextPhoneCountryCode;
		}
	});

	function resolveFieldStep(field: ContactField): ContactStep {
		if (isCompanyMode) {
			if (
				[
					'kind',
					'country_code',
					'display_name',
					'company_name',
					'email',
					'website',
					'phone',
					'phone_country_code',
					'phone_e164',
					'abn',
					'business_id_label',
					'business_id_value',
					'tax_id_label',
					'tax_id_value',
					'address',
					'logo_file_path'
				].includes(field)
			) {
				return 'profile';
			}
			return 'details';
		}

		return 'profile';
	}

	function buildCandidate(): ContactFormValues {
		const personCountryCode =
			linkedPersonCompany?.country_code ?? (workspaceState.countryCode || 'AU');
		const personCountryProfile = getWorkspaceCountryProfile(personCountryCode);
		const personName = [formValues.person_first_name ?? '', formValues.person_last_name ?? '']
			.map((value) => value.trim())
			.filter(Boolean)
			.join(' ');
		const companyName =
			(formValues.company_name ?? '').trim() || (formValues.display_name ?? '').trim();
		const displayName =
			(formValues.display_name ?? '').trim() ||
			(formValues.kind === 'company' ? companyName : personName || companyName);

		return {
			...formValues,
			kind: effectiveKind,
			display_name: displayName,
			name: displayName,
			company_name: formValues.kind === 'company' ? companyName : '',
			person_first_name: (formValues.person_first_name ?? '').trim(),
			person_last_name: (formValues.person_last_name ?? '').trim(),
			role_title: (formValues.role_title ?? '').trim(),
			contact_name: '',
			website: formValues.kind === 'company' ? (formValues.website?.trim() ?? '') : '',
			address: formValues.kind === 'company' ? (formValues.address?.trim() ?? '') : '',
			notes: formValues.kind === 'company' ? (formValues.notes?.trim() ?? '') : '',
			logo_file_path: formValues.logo_file_path?.trim() ?? '',
			custom_role_label:
				formValues.kind === 'company' ? (formValues.custom_role_label?.trim() ?? '') : '',
			tags:
				formValues.kind === 'company'
					? tagsInput
							.split(',')
							.map((tag) => tag.trim())
							.filter(Boolean)
					: [],
			country_code: formValues.kind === 'company' ? formValues.country_code : personCountryCode,
			phone_country_code:
				formValues.kind === 'company' ? formValues.country_code : personCountryCode,
			business_id_label:
				formValues.kind === 'company'
					? selectedCountryProfile.businessIdLabel
					: personCountryProfile.businessIdLabel,
			business_id_value:
				formValues.kind === 'company' ? (formValues.business_id_value ?? '').trim() : '',
			tax_id_label:
				formValues.kind === 'company'
					? selectedCountryProfile.taxIdLabel
					: personCountryProfile.taxIdLabel,
			tax_id_value: formValues.kind === 'company' ? (formValues.tax_id_value ?? '').trim() : '',
			abn:
				formValues.kind === 'company' && selectedCountryProfile.businessIdLabel === 'ABN'
					? (formValues.business_id_value ?? '')
					: ''
		};
	}

	async function focusField(field: ContactField) {
		activeStep = resolveFieldStep(field);
		await tick();
		document.getElementById(`${id}-${field}`)?.focus();
	}

	async function focusFirstError(errors: Record<string, string[] | undefined>) {
		const firstField = (Object.keys(formValues) as ContactField[]).find(
			(field) => errors[field]?.length
		);
		if (firstField) {
			await focusField(firstField);
		}
	}

	async function handleLogoPick(): Promise<void> {
		if (!isTauri()) return;
		const selected = await openDialog({
			multiple: false,
			filters: [
				{
					name: 'Logos',
					extensions: [...BRAND_LOGO_EXTENSIONS]
				}
			]
		});
		if (typeof selected === 'string') {
			stagedLogoPath = selected;
		}
	}

	async function handleSave() {
		fieldErrors = {};
		const candidate = buildCandidate();
		const result = contactFormSchema.safeParse(candidate);
		if (!result.success) {
			fieldErrors = result.error.flatten().fieldErrors as Record<string, string[] | undefined>;
			toast.error('Validation failed');
			await focusFirstError(fieldErrors);
			return;
		}

		const duplicateContact = contactsState.findMatchingContact(result.data, contact?.id);
		if (duplicateContact) {
			const duplicateField: ContactField =
				result.data.kind === 'company' ? 'display_name' : 'person_first_name';
			fieldErrors = {
				...fieldErrors,
				[duplicateField]: [
					result.data.kind === 'company'
						? 'A company with this name or identifier already exists'
						: 'A person with this name or email already exists for the selected company'
				]
			};
			toast.error('Validation failed');
			await focusField(duplicateField);
			return;
		}

		isSaving = true;
		let recordSaved = false;
		let saveStage: 'contact' | 'logo' | 'relationships' = 'contact';
		try {
			let savedContact: Contact | null = null;
			if (contact) {
				savedContact = await contactsState.updateContact(contact.id, result.data);
			} else {
				savedContact = await contactsState.addContact(result.data);
			}
			recordSaved = savedContact !== null;

			if (savedContact && isCompanyMode) {
				if (stagedLogoPath) {
					saveStage = 'logo';
					const nextLogoPath = await contactsState.storeCompanyLogo(
						workspaceState.id,
						savedContact.id,
						stagedLogoPath
					);
					if (
						contact?.logo_file_path &&
						contact.logo_file_path !== nextLogoPath &&
						!contact.logo_file_path.startsWith('/')
					) {
						await contactsState.removeVaultFile(contact.logo_file_path);
					}
					savedContact =
						(await contactsState.updateContact(savedContact.id, {
							...result.data,
							logo_file_path: nextLogoPath
						})) ?? savedContact;
				} else if (contact?.logo_file_path && !result.data.logo_file_path) {
					saveStage = 'logo';
					await contactsState.removeVaultFile(contact.logo_file_path);
					savedContact =
						(await contactsState.updateContact(savedContact.id, {
							...result.data,
							logo_file_path: ''
						})) ?? savedContact;
				}

				saveStage = 'relationships';
				await contactsState.replaceCompanyCatalogueLinks({
					companyId: savedContact.id,
					materialIds: selectedMaterialIds,
					labourRateIds: selectedLabourRateIds,
					equipmentRateIds: selectedEquipmentRateIds,
					subcontractRateIds: selectedSubcontractRateIds
				});
				await Promise.all([
					materialsState.refresh(),
					labourRatesState.refresh(),
					equipmentRatesState.refresh(),
					subcontractRatesState.refresh()
				]);
			}
			open = false;
		} catch (error) {
			if (saveStage === 'logo') {
				await errorState.catchError(error, 'Save company logo');
			}
			if (recordSaved) open = false;
		} finally {
			isSaving = false;
		}
	}

	async function handleDeletePerson() {
		if (!personToDelete) return;
		await contactsState.deletePerson(personToDelete.id);
		isDeletePersonDialogOpen = false;
		personToDelete = null;
	}
</script>

{#if !hideTrigger}
	<Button variant="brand" size="default" class="gap-1.5" onclick={() => (open = true)}>
		<PlusIcon class="size-3.5" />
		{kindMode === 'person' ? 'Add Person' : 'Add Company'}
	</Button>
{/if}

<Dialog.Root bind:open>
	{#if isCompanyMode}
		<Dialog.WorkflowFrame
			title={contact ? `Edit ${contact.display_name || contact.name}` : 'New Company'}
			description={contact
				? 'Review and update the company profile, people, and notes.'
				: 'Register a company in the workspace CRM and add the supporting details.'}
			steps={showStepNav ? nav : [nav[0]]}
			{activeStep}
			onStepSelect={(stepId) => {
				activeStep = stepId as ContactStep;
			}}
		>
			<div class="flex flex-col gap-4">
				{#if activeStep === 'profile'}
					{#if isCompanyMode}
						<div class="flex flex-col gap-4">
							<CircularImagePicker
								alt="Company logo"
								initials={companyInitials || 'C'}
								variant="logo"
								previewUrl={logoPreviewUrl}
								pending={Boolean(stagedLogoPath)}
								class="shrink-0"
								clearLabel="Remove logo"
								pickLabel="Upload logo"
								changeLabel="Upload logo"
								helperText="PNG, JPEG, or SVG used on this company profile."
								showActions
								onPick={() => void handleLogoPick()}
								onClear={() => {
									stagedLogoPath = null;
									stagedLogoPreviewUrl = '';
									formValues.logo_file_path = '';
								}}
							/>
							<div class="flex min-w-0 flex-col gap-4">
								<div class="grid gap-4 md:grid-cols-2">
									<FieldShell>
										<FieldLabel for="{id}-display_name">Company Name</FieldLabel>
										<Input
											id="{id}-display_name"
											bind:value={formValues.display_name}
											size="default"
											invalidTone={getFieldInvalidTone(fieldErrors.display_name)}
											placeholder="e.g. Atlas Structural"
										/>
										<FieldError errors={fieldErrors.display_name} />
									</FieldShell>
									<FieldShell>
										<FieldLabel for="{id}-country_code">Country</FieldLabel>
										<Select.Root type="single" bind:value={formValues.country_code}>
											<Select.Trigger
												id="{id}-country_code"
												size="default"
												class="w-full"
												invalidTone={getFieldInvalidTone(fieldErrors.country_code)}
											>
												{WORKSPACE_COUNTRY_OPTIONS.find(
													(option) => option.code === formValues.country_code
												)?.label ?? 'Australia'}
											</Select.Trigger>
											<Select.Content>
												{#each WORKSPACE_COUNTRY_OPTIONS as option (option.code)}
													<Select.Item value={option.code} class="menu-copy"
														>{option.label}</Select.Item
													>
												{/each}
											</Select.Content>
										</Select.Root>
										<FieldError errors={fieldErrors.country_code} />
									</FieldShell>
								</div>
								<div class="grid gap-4 md:grid-cols-2">
									<FieldShell>
										<FieldLabel for="{id}-email">Company Email</FieldLabel>
										<Input
											id="{id}-email"
											bind:value={formValues.email}
											type="email"
											autocomplete="email"
											size="default"
											invalidTone={getFieldInvalidTone(fieldErrors.email)}
											placeholder="estimating@company.com"
										/>
										<FieldError errors={fieldErrors.email} />
									</FieldShell>
									<FieldShell>
										<FieldLabel for="{id}-phone">Company Phone</FieldLabel>
										<PhoneInput
											id="{id}-phone"
											bind:value={formValues.phone}
											countryCode={formValues.phone_country_code}
											size="default"
											invalidTone={getFieldInvalidTone(fieldErrors.phone)}
											placeholder="Phone number"
										/>
										<FieldError errors={fieldErrors.phone} />
									</FieldShell>
								</div>
								<div class="grid gap-4 md:grid-cols-2">
									<FieldShell>
										<FieldLabel for="{id}-website">Website</FieldLabel>
										<Input
											id="{id}-website"
											bind:value={formValues.website}
											size="default"
											invalidTone={getFieldInvalidTone(fieldErrors.website)}
											placeholder="https://company.com"
										/>
										<FieldError errors={fieldErrors.website} />
									</FieldShell>
									<FieldShell>
										<FieldLabel for="{id}-business_id_value">
											{formatIdentifierLabel(selectedCountryProfile.businessIdLabel)}
										</FieldLabel>
										<Input
											id="{id}-business_id_value"
											bind:value={formValues.business_id_value}
											size="default"
											invalidTone={getFieldInvalidTone(fieldErrors.business_id_value)}
											class="tabular-nums"
											placeholder={`Enter ${formatIdentifierLabel(selectedCountryProfile.businessIdLabel)}`}
										/>
										<FieldError errors={fieldErrors.business_id_value} />
									</FieldShell>
								</div>
								<FieldShell>
									<FieldLabel for="{id}-address">Address</FieldLabel>
									<Textarea
										id="{id}-address"
										bind:value={formValues.address}
										size="default"
										invalidTone={getFieldInvalidTone(fieldErrors.address)}
										class="min-h-24 resize-none"
										placeholder="Street, suburb, state, postcode"
										rows={4}
									/>
									<FieldError errors={fieldErrors.address} />
								</FieldShell>
							</div>
						</div>
					{/if}
				{:else if activeStep === 'people'}
					<div class="flex flex-col gap-4">
						<div class="flex items-center justify-between gap-3">
							<FieldLabelRow tooltip="People at this company.">People</FieldLabelRow>
							<Button
								type="button"
								variant="brand"
								size="default"
								class="gap-2"
								disabled={!contact?.id || contact.is_active === false}
								onclick={() => {
									personToEdit = null;
									isPersonDialogOpen = true;
								}}
							>
								<PlusIcon class="size-3.5" />
								Add Person
							</Button>
						</div>
						{#if !contact?.id}
							<Empty.Root class="py-6">
								<Empty.Header>
									<Empty.Title>Save company first</Empty.Title>
									<Empty.Description>Save the company before adding people.</Empty.Description>
								</Empty.Header>
							</Empty.Root>
						{:else if linkedPeople.length === 0}
							<Empty.Root class="py-6">
								<Empty.Header>
									<Empty.Title>No people added yet</Empty.Title>
									<Empty.Description>Add the contacts who work at this company.</Empty.Description>
								</Empty.Header>
							</Empty.Root>
						{:else}
							<div class="grid gap-3 md:grid-cols-2">
								{#each linkedPeople as person (person.id)}
									<Panel as="div" class="flex flex-col gap-3">
										<div class="flex items-start justify-between gap-3">
											<div class="min-w-0">
												<Text class="title-copy truncate">
													{person.display_name || person.name}
												</Text>
												{#if person.role_title}
													<Meta class="truncate">{person.role_title}</Meta>
												{/if}
											</div>
											<TooltipIconButton
												tooltip={person.is_primary_company_contact
													? 'Primary contact'
													: 'Set as primary contact'}
												variant="ghost"
												size="icon-sm"
												onclick={() =>
													void contactsState.setPrimaryCompanyPerson(contact.id, person.id)}
											>
												<StarIcon
													class={`size-4 ${person.is_primary_company_contact ? 'fill-current text-primary' : ''}`}
												/>
											</TooltipIconButton>
										</div>
										<div class="flex flex-col gap-1">
											{#if person.email}
												<Text>{person.email}</Text>
											{/if}
											{#if person.phone}
												<Meta>{person.phone}</Meta>
											{/if}
										</div>
										<div class="flex justify-end gap-2">
											<Button
												type="button"
												variant="secondary"
												size="default"
												onclick={() => {
													personToEdit = person;
													isPersonDialogOpen = true;
												}}
											>
												Edit
											</Button>
											<Button
												type="button"
												variant="secondary"
												size="default"
												onclick={() => {
													personToDelete = person;
													isDeletePersonDialogOpen = true;
												}}
											>
												Delete
											</Button>
										</div>
									</Panel>
								{/each}
							</div>
						{/if}
						{#if archivedPeople.length > 0}
							<div class="flex flex-col gap-3">
								<Button
									type="button"
									variant="ghost"
									size="default"
									class="self-start px-2"
									onclick={() => (showArchivedPeople = !showArchivedPeople)}
								>
									Archived ({archivedPeople.length})
								</Button>
								{#if showArchivedPeople}
									<div class="grid gap-3 md:grid-cols-2">
										{#each archivedPeople as person (person.id)}
											<Panel as="div" tone="subtle" class="flex flex-col gap-3 border-dashed">
												<div class="min-w-0">
													<Text class="title-copy truncate">
														{person.display_name || person.name}
													</Text>
													{#if person.role_title}
														<Meta class="truncate">{person.role_title}</Meta>
													{/if}
												</div>
												<div class="flex flex-col gap-1">
													{#if person.email}
														<Text>{person.email}</Text>
													{/if}
													{#if person.phone}
														<Meta>{person.phone}</Meta>
													{/if}
												</div>
												<div class="flex justify-end gap-2">
													<Button
														type="button"
														variant="secondary"
														size="default"
														class="gap-2"
														onclick={() => void contactsState.restorePerson(person.id)}
													>
														<RotateCcwIcon class="size-3.5" />
														Restore
													</Button>
													<Button
														type="button"
														variant="secondary"
														size="default"
														onclick={() => {
															personToDelete = person;
															isDeletePersonDialogOpen = true;
														}}
													>
														Delete
													</Button>
												</div>
											</Panel>
										{/each}
									</div>
								{/if}
							</div>
						{/if}
					</div>
				{:else if activeStep === 'details'}
					<div class="flex flex-col gap-4">
						<div class="grid gap-4 md:grid-cols-2">
							<FieldShell>
								<FieldLabel for="{id}-roles">Type</FieldLabel>
								<Select.Root
									type="single"
									value={formValues.roles[0] ?? ''}
									onValueChange={(value) => {
										formValues.roles = value ? [value as ContactRole] : [];
									}}
								>
									<Select.Trigger id="{id}-roles" size="default" class="w-full min-w-0">
										<span class="block min-w-0 truncate">
											{CONTACT_ROLE_OPTIONS.find((option) => option.value === formValues.roles[0])
												?.label ?? 'Select company type'}
										</span>
									</Select.Trigger>
									<Select.Content>
										{#each CONTACT_ROLE_OPTIONS as option (option.value)}
											<Select.Item value={option.value} label={option.label} />
										{/each}
									</Select.Content>
								</Select.Root>
							</FieldShell>

							<FieldShell>
								<FieldLabel for="{id}-custom_role_label">Custom Type</FieldLabel>
								<Input
									id="{id}-custom_role_label"
									bind:value={formValues.custom_role_label}
									size="sm"
									invalidTone={getFieldInvalidTone(fieldErrors.custom_role_label)}
									placeholder="e.g. Fabricator, consultant, logistics partner"
								/>
								<FieldError errors={fieldErrors.custom_role_label} />
							</FieldShell>
						</div>

						<FieldShell>
							<FieldLabelRow
								for="{id}-tags"
								tooltip="Comma-separated tags for search and grouping."
							>
								Tags
							</FieldLabelRow>
							<Input
								id="{id}-tags"
								bind:value={tagsInput}
								size="sm"
								class="w-full"
								placeholder="Preferred, structural, vendor"
							/>
						</FieldShell>

						<FieldShell>
							<FieldLabel for="{id}-notes">Notes</FieldLabel>
							<Textarea
								id="{id}-notes"
								bind:value={formValues.notes}
								size="sm"
								invalidTone={getFieldInvalidTone(fieldErrors.notes)}
								class="max-h-48 min-h-24 resize-none"
								placeholder="Commercial notes, import context, or relationship details..."
								rows={4}
							/>
							<FieldError errors={fieldErrors.notes} />
						</FieldShell>
					</div>
				{:else if activeStep === 'relations'}
					<div class="grid gap-4 md:grid-cols-2">
						<FieldShell>
							<FieldLabelRow tooltip="Materials associated with this company."
								>Materials</FieldLabelRow
							>
							<SearchableMultiSelect
								options={materialOptions}
								bind:selectedValues={selectedMaterialIds}
								placeholder={relationshipCataloguesLoading
									? 'Loading materials...'
									: 'Select materials'}
								searchPlaceholder="Search materials..."
								emptyLabel="No materials found."
								disabled={relationshipCataloguesLoading}
							/>
						</FieldShell>
						<FieldShell>
							<FieldLabelRow tooltip="Labour rates associated with this company.">
								Labour rates
							</FieldLabelRow>
							<SearchableMultiSelect
								options={labourRateOptions}
								bind:selectedValues={selectedLabourRateIds}
								placeholder={relationshipCataloguesLoading
									? 'Loading labour rates...'
									: 'Select labour rates'}
								searchPlaceholder="Search labour rates..."
								emptyLabel="No labour rates found."
								disabled={relationshipCataloguesLoading}
							/>
						</FieldShell>
						<FieldShell>
							<FieldLabelRow tooltip="Equipment rates associated with this company.">
								Equipment rates
							</FieldLabelRow>
							<SearchableMultiSelect
								options={equipmentRateOptions}
								bind:selectedValues={selectedEquipmentRateIds}
								placeholder={relationshipCataloguesLoading
									? 'Loading equipment rates...'
									: 'Select equipment rates'}
								searchPlaceholder="Search equipment rates..."
								emptyLabel="No equipment rates found."
								disabled={relationshipCataloguesLoading}
							/>
						</FieldShell>
						<FieldShell>
							<FieldLabelRow tooltip="Subcontract rates associated with this company.">
								Subcontract rates
							</FieldLabelRow>
							<SearchableMultiSelect
								options={subcontractRateOptions}
								bind:selectedValues={selectedSubcontractRateIds}
								placeholder={relationshipCataloguesLoading
									? 'Loading subcontract rates...'
									: 'Select subcontract rates'}
								searchPlaceholder="Search subcontract rates..."
								emptyLabel="No subcontract rates found."
								disabled={relationshipCataloguesLoading}
							/>
						</FieldShell>
					</div>
				{/if}
			</div>

			{#snippet footer()}
				<Button variant="secondary" size="default" onclick={() => (open = false)}>Cancel</Button>
				<Button
					variant="brand"
					size="default"
					onclick={handleSave}
					disabled={isSaving}
					loading={isSaving}
				>
					{isSaving
						? 'Saving...'
						: contact
							? isCompanyMode
								? 'Update Company'
								: 'Update Person'
							: isCompanyMode
								? 'Save Company'
								: 'Save Person'}
				</Button>
			{/snippet}
		</Dialog.WorkflowFrame>
	{:else}
		<Dialog.FormFrame
			title={contact ? 'Edit Person' : 'New Person'}
			description={linkedPersonCompany
				? linkedPersonCompany.display_name || linkedPersonCompany.name
				: ''}
			class="ui-dialog-size-lg"
			bodyClass="flex flex-col gap-4"
		>
			<div class="grid gap-4 md:grid-cols-2">
				<FieldShell>
					<FieldLabel for="{id}-person_first_name">First Name</FieldLabel>
					<Input
						id="{id}-person_first_name"
						bind:value={formValues.person_first_name}
						size="sm"
						invalidTone={getFieldInvalidTone(fieldErrors.person_first_name)}
						placeholder="Alex"
					/>
					<FieldError errors={fieldErrors.person_first_name} />
				</FieldShell>
				<FieldShell>
					<FieldLabel for="{id}-person_last_name">Last Name</FieldLabel>
					<Input
						id="{id}-person_last_name"
						bind:value={formValues.person_last_name}
						size="sm"
						invalidTone={getFieldInvalidTone(fieldErrors.person_last_name)}
						placeholder="Nguyen"
					/>
					<FieldError errors={fieldErrors.person_last_name} />
				</FieldShell>
			</div>
			<FieldShell>
				<FieldLabel for="{id}-role_title">Role</FieldLabel>
				<Input
					id="{id}-role_title"
					bind:value={formValues.role_title}
					size="sm"
					class="w-full"
					placeholder="Estimator / Buyer / Project Manager"
				/>
			</FieldShell>
			<div class="grid gap-4 md:grid-cols-2">
				<FieldShell>
					<FieldLabel for="{id}-email">Email</FieldLabel>
					<Input
						id="{id}-email"
						bind:value={formValues.email}
						type="email"
						autocomplete="email"
						size="sm"
						invalidTone={getFieldInvalidTone(fieldErrors.email)}
						placeholder="person@company.com"
					/>
					<FieldError errors={fieldErrors.email} />
				</FieldShell>
				<FieldShell>
					<FieldLabel for="{id}-phone">Phone</FieldLabel>
					<PhoneInput
						id="{id}-phone"
						bind:value={formValues.phone}
						countryCode={formValues.phone_country_code}
						size="sm"
						invalidTone={getFieldInvalidTone(fieldErrors.phone)}
						placeholder="Phone number"
					/>
					<FieldError errors={fieldErrors.phone} />
				</FieldShell>
			</div>
			{#snippet footer()}
				<Button variant="secondary" size="default" onclick={() => (open = false)}>Cancel</Button>
				<Button
					variant="brand"
					size="default"
					onclick={handleSave}
					disabled={isSaving}
					loading={isSaving}
				>
					{isSaving ? 'Saving...' : contact ? 'Update Person' : 'Save Person'}
				</Button>
			{/snippet}
		</Dialog.FormFrame>
	{/if}
</Dialog.Root>

<AlertDialog.Root bind:open={isDeletePersonDialogOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete person?</AlertDialog.Title>
			<AlertDialog.Description>
				{#if personToDelete?.is_primary_company_contact}
					This permanently removes {personToDelete.display_name || personToDelete.name}. If another
					active person is linked to this company, Kwantflow will make them the primary contact
					automatically.
				{:else}
					This permanently removes {personToDelete?.display_name || personToDelete?.name} from the CRM.
					Any linked records will keep working and clear this person reference where needed.
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel
				onclick={() => {
					isDeletePersonDialogOpen = false;
					personToDelete = null;
				}}
			>
				Cancel
			</AlertDialog.Cancel>
			<AlertDialog.Action class="action-destructive" onclick={() => void handleDeletePerson()}>
				Delete person
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

{#if isCompanyMode && contact?.id}
	<ContactDialogSelf
		bind:open={isPersonDialogOpen}
		contact={personToEdit}
		hideTrigger
		kindMode="person"
		linkedCompanyId={contact.id}
	/>
{/if}
