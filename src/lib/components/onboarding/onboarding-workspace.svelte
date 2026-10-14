<script lang="ts">
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import LoaderIcon from '@lucide/svelte/icons/loader';
	import { ZodError } from 'zod';
	import onboardingSidebarMarkUrl from '$lib/assets/branding/kwantflow-sidebar-mark.svg';
	import LocalAiSetupCard from '$lib/components/local-ai-setup-card.svelte';
	import PhoneInput from '$lib/components/phone-input.svelte';

	import {
		FieldError,
		FieldLabel,
		FieldShell,
		Meta,
		Text
	} from '$lib/components/primitives/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import SetupImportDialog from '$lib/components/user/setup-import-dialog.svelte';
	import {
		INDUSTRY_OPTIONS,
		ONBOARDING_OPERATOR_ROLE_OPTIONS,
		WORKSPACE_COUNTRY_OPTIONS,
		formatIdentifierLabel,
		getWorkspaceCountryProfile
	} from '$lib/constants/index.js';
	import { onboardingWorkspaceDetailsSchema } from '$lib/schemas/index.js';
	import { onboardingState, type WorkspaceSetupValues } from '$lib/state/onboarding.svelte.js';
	import { errorState } from '$lib/state/errors.svelte.js';

	const workspaceNameStepSchema = onboardingWorkspaceDetailsSchema.pick({
		workspaceName: true,
		countryCode: true
	});

	let workspaceValues = $state<WorkspaceSetupValues>({ ...onboardingState.workspaceValues });
	let workspaceErrors = $state<Record<string, string[] | undefined>>({});
	let isSubmittingWorkspace = $state(false);
	let isAdvancingImport = $state(false);
	let isAdvancingLocalAi = $state(false);
	let isImportDialogOpen = $state(false);
	let workspaceFormStep = $state<'name' | 'business'>('name');

	const isWorkspaceNameContinueDisabled = $derived(
		isSubmittingWorkspace || workspaceValues.workspaceName.trim().length < 2
	);
	const isWorkspaceBusinessSubmitDisabled = $derived(
		isSubmittingWorkspace ||
			!workspaceValues.businessName.trim() ||
			!workspaceValues.businessContactFirstName.trim() ||
			!workspaceValues.businessContactLastName.trim()
	);

	const selectedCountryProfile = $derived(getWorkspaceCountryProfile(workspaceValues.countryCode));
	const selectedCountryLabel = $derived(
		WORKSPACE_COUNTRY_OPTIONS.find((option) => option.code === workspaceValues.countryCode)
			?.label ?? 'Australia'
	);
	const selectedRoleLabel = $derived(
		ONBOARDING_OPERATOR_ROLE_OPTIONS.find(
			(option) => option.value === workspaceValues.primaryOperatorRole
		)?.label ?? 'Choose role'
	);
	const selectedIndustryLabel = $derived(
		(INDUSTRY_OPTIONS.find((option) => option.value === workspaceValues.industry)?.label ??
			workspaceValues.industry) ||
			'Choose industry'
	);
	$effect(() => {
		if (onboardingState.currentStep === 'workspace_setup') {
			workspaceValues = { ...onboardingState.workspaceValues };
			workspaceErrors = {};
			workspaceFormStep = 'name';
		}
	});

	$effect(() => {
		if (onboardingState.currentStep === 'workspace_creation_failed') {
			workspaceErrors = {};
			workspaceFormStep = 'name';
		}
	});

	async function handleWorkspaceNameContinue(): Promise<void> {
		workspaceErrors = {};
		workspaceValues.workspaceName = workspaceValues.workspaceName.trim();
		const workspaceNameLength = workspaceValues.workspaceName.length;
		if (workspaceNameLength === 0) {
			workspaceErrors.workspaceName = ['Workspace name is required'];
			return;
		}
		if (workspaceNameLength < 2) {
			workspaceErrors.workspaceName = ['Workspace name must be at least 2 characters'];
			return;
		}
		const parsed = workspaceNameStepSchema.safeParse(workspaceValues);
		if (!parsed.success) {
			workspaceErrors = parsed.error.flatten().fieldErrors as Record<string, string[] | undefined>;
			return;
		}

		onboardingState.bootstrapErrorMessage = null;
		workspaceFormStep = 'business';
	}

	function handleWorkspaceBusinessBack(): void {
		workspaceErrors = {};
		onboardingState.bootstrapErrorMessage = null;
		workspaceFormStep = 'name';
	}

	async function handleWorkspaceSubmit(): Promise<void> {
		if (isSubmittingWorkspace) return;
		workspaceErrors = {};

		if (!onboardingState.hasPendingWorkspaceSetup) {
			workspaceValues.workspaceName = workspaceValues.workspaceName.trim();
			workspaceValues.businessName = workspaceValues.businessName.trim();
			workspaceValues.businessContactFirstName = workspaceValues.businessContactFirstName.trim();
			workspaceValues.businessContactLastName = workspaceValues.businessContactLastName.trim();
			workspaceValues.businessContactPhone = workspaceValues.businessContactPhone.trim();
			workspaceValues.businessContactEmail = workspaceValues.businessContactEmail.trim();
			workspaceValues.businessIdValue = workspaceValues.businessIdValue.trim();

			const parsed = onboardingWorkspaceDetailsSchema.safeParse(workspaceValues);
			if (!parsed.success) {
				workspaceErrors = parsed.error.flatten().fieldErrors as Record<
					string,
					string[] | undefined
				>;
				return;
			}
		}

		isSubmittingWorkspace = true;
		try {
			await onboardingState.createWorkspace(workspaceValues);
		} catch (error) {
			if (error instanceof ZodError) {
				workspaceErrors = error.flatten().fieldErrors as Record<string, string[] | undefined>;
			}
		} finally {
			isSubmittingWorkspace = false;
		}
	}

	async function handleSkipImport(): Promise<void> {
		if (isAdvancingImport) return;
		isAdvancingImport = true;
		try {
			await onboardingState.completeSetupImportStep();
		} catch (error) {
			await errorState.catchError(error, 'Continue workspace setup');
		} finally {
			isAdvancingImport = false;
		}
	}

	async function handleImported(): Promise<void> {
		isAdvancingImport = true;
		try {
			await onboardingState.completeSetupImportStep();
			isImportDialogOpen = false;
		} catch (error) {
			await errorState.catchError(error, 'Continue workspace setup');
			throw error;
		} finally {
			isAdvancingImport = false;
		}
	}

	async function handleLocalAiContinue(): Promise<void> {
		if (isAdvancingLocalAi) return;
		isAdvancingLocalAi = true;
		try {
			await onboardingState.completeLocalAiStep();
		} catch (error) {
			await errorState.catchError(error, 'Finish workspace setup');
		} finally {
			isAdvancingLocalAi = false;
		}
	}
</script>

<div class="ui-onboarding-split">
	<div class="ui-onboarding-pane">
		<div class="absolute top-14 left-6 z-10 sm:top-16 sm:left-8">
			<img
				src={onboardingSidebarMarkUrl}
				alt="Kwantflow"
				class="onboarding-corner-mark brand-logo block object-contain"
			/>
		</div>

		<div class="ui-onboarding-pane-content md:px-10">
			<div class="w-full max-w-sm pt-12 sm:pt-10">
				{#if onboardingState.currentStep === 'workspace_setup' || onboardingState.currentStep === 'workspace_creation_failed'}
					{#if onboardingState.hasPendingWorkspaceSetup}
						<section class="flex flex-col gap-6">
							<div class="flex flex-col gap-1.5">
								<p class="eyebrow">Step 1 of 3</p>
								<h1 class="h3">Finish workspace setup</h1>
								<Text as="p" tone="muted"
									>Your workspace already exists. Finish opening it on this device.</Text
								>
							</div>

							{#if onboardingState.bootstrapErrorMessage}
								<div class="status-panel status-panel-destructive">
									<div class="flex items-start gap-3">
										<CircleAlertIcon class="status-text-destructive mt-0.5 size-4" />
										<div class="min-w-0">
											<Text>We could not finish setup.</Text>
											<Meta>{onboardingState.bootstrapErrorMessage}</Meta>
										</div>
									</div>
								</div>
							{/if}

							<div class="flex items-center justify-end">
								<Button
									variant="brand"
									size="default"
									class="gap-2"
									onclick={() => void handleWorkspaceSubmit()}
									disabled={isSubmittingWorkspace}
								>
									{#if isSubmittingWorkspace}
										<LoaderIcon class="size-4 animate-spin" />
										Finishing setup...
									{:else}
										Retry workspace setup
										<ArrowRightIcon class="size-4" />
									{/if}
								</Button>
							</div>
						</section>
					{:else if workspaceFormStep === 'name'}
						<section class="flex flex-col gap-6">
							<div class="flex flex-col gap-1.5">
								<p class="eyebrow">Step 1 of 3</p>
								<h1 class="h3">Workspace name</h1>
								<Text as="p" tone="muted">Name the workspace you want to open on this device.</Text>
							</div>

							{#if onboardingState.bootstrapErrorMessage}
								<div class="status-panel status-panel-destructive">
									<div class="flex items-start gap-3">
										<CircleAlertIcon class="status-text-destructive mt-0.5 size-4" />
										<div class="min-w-0">
											<Text>We could not finish setup.</Text>
											<Meta>{onboardingState.bootstrapErrorMessage}</Meta>
										</div>
									</div>
								</div>
							{/if}

							<FieldShell>
								<FieldLabel for="workspace-name">Workspace name</FieldLabel>
								<Input
									id="workspace-name"
									bind:value={workspaceValues.workspaceName}
									size="sm"
									placeholder="e.g. Acme Fabrication"
									onblur={() => {
										workspaceValues.workspaceName = workspaceValues.workspaceName.trim();
									}}
								/>
								<FieldError errors={workspaceErrors.workspaceName} />
							</FieldShell>

							<div class="flex items-center justify-end">
								<Button
									variant="brand"
									size="default"
									class="gap-2"
									onclick={() => void handleWorkspaceNameContinue()}
									disabled={isWorkspaceNameContinueDisabled}
								>
									Continue
									<ArrowRightIcon class="size-4" />
								</Button>
							</div>
						</section>
					{:else if workspaceFormStep === 'business'}
						<section class="flex flex-col gap-6">
							<div class="flex flex-col gap-1.5">
								<p class="eyebrow">Step 1 of 3</p>
								<h1 class="h3">Business profile</h1>
								<Text as="p" tone="muted"
									>Add the business details Kwantflow uses across this workspace.</Text
								>
							</div>

							{#if onboardingState.bootstrapErrorMessage}
								<div class="status-panel status-panel-destructive">
									<div class="flex items-start gap-3">
										<CircleAlertIcon class="status-text-destructive mt-0.5 size-4" />
										<div class="min-w-0">
											<Text>We could not finish setup.</Text>
											<Meta>{onboardingState.bootstrapErrorMessage}</Meta>
										</div>
									</div>
								</div>
							{/if}

							<div class="grid gap-4">
								<div class="grid gap-4 md:grid-cols-2">
									<FieldShell>
										<FieldLabel>Country</FieldLabel>
										<Select.Root
											type="single"
											value={workspaceValues.countryCode}
											onValueChange={(value) => {
												workspaceValues.countryCode = value;
											}}
										>
											<Select.Trigger size="sm" class="w-full min-w-0">
												<span class="block min-w-0 truncate">{selectedCountryLabel}</span>
											</Select.Trigger>
											<Select.Content>
												{#each WORKSPACE_COUNTRY_OPTIONS as option (option.code)}
													<Select.Item value={option.code} label={option.label} />
												{/each}
											</Select.Content>
										</Select.Root>
										<FieldError errors={workspaceErrors.countryCode} />
									</FieldShell>

									<FieldShell>
										<FieldLabel for="business-name">Business name</FieldLabel>
										<Input
											id="business-name"
											bind:value={workspaceValues.businessName}
											size="sm"
											placeholder="e.g. Acme Fabrication"
											onblur={() => {
												workspaceValues.businessName = workspaceValues.businessName.trim();
											}}
										/>
										<FieldError errors={workspaceErrors.businessName} />
									</FieldShell>
								</div>

								<div class="grid gap-4 md:grid-cols-2">
									<FieldShell>
										<FieldLabel for="contact-first-name">First Name</FieldLabel>
										<Input
											id="contact-first-name"
											bind:value={workspaceValues.businessContactFirstName}
											size="sm"
											placeholder="First name"
											onblur={() => {
												workspaceValues.businessContactFirstName =
													workspaceValues.businessContactFirstName.trim();
											}}
										/>
										<FieldError errors={workspaceErrors.businessContactFirstName} />
									</FieldShell>
									<FieldShell>
										<FieldLabel for="contact-last-name">Last Name</FieldLabel>
										<Input
											id="contact-last-name"
											bind:value={workspaceValues.businessContactLastName}
											size="sm"
											placeholder="Last name"
											onblur={() => {
												workspaceValues.businessContactLastName =
													workspaceValues.businessContactLastName.trim();
											}}
										/>
										<FieldError errors={workspaceErrors.businessContactLastName} />
									</FieldShell>
								</div>

								<div class="grid gap-4 md:grid-cols-2">
									<FieldShell>
										<FieldLabel for="contact-phone">Contact phone</FieldLabel>
										<PhoneInput
											id="contact-phone"
											bind:value={workspaceValues.businessContactPhone}
											countryCode={workspaceValues.countryCode}
											size="sm"
											placeholder="Phone number"
										/>
										<FieldError errors={workspaceErrors.businessContactPhone} />
									</FieldShell>

									<FieldShell>
										<FieldLabel for="contact-email">Contact email</FieldLabel>
										<Input
											id="contact-email"
											type="email"
											autocomplete="email"
											bind:value={workspaceValues.businessContactEmail}
											size="sm"
											placeholder="contact@example.com"
											onblur={() => {
												workspaceValues.businessContactEmail =
													workspaceValues.businessContactEmail.trim();
											}}
										/>
										<FieldError errors={workspaceErrors.businessContactEmail} />
									</FieldShell>
								</div>

								<FieldShell>
									<FieldLabel for="business-id"
										>{formatIdentifierLabel(selectedCountryProfile.businessIdLabel)}</FieldLabel
									>
									<Input
										id="business-id"
										bind:value={workspaceValues.businessIdValue}
										size="sm"
										placeholder={`Enter ${formatIdentifierLabel(selectedCountryProfile.businessIdLabel)}`}
										onblur={() => {
											workspaceValues.businessIdValue = workspaceValues.businessIdValue.trim();
										}}
									/>
									<FieldError errors={workspaceErrors.businessIdValue} />
								</FieldShell>

								<div class="grid gap-4 md:grid-cols-2">
									<FieldShell>
										<FieldLabel>Role</FieldLabel>
										<Select.Root
											type="single"
											value={workspaceValues.primaryOperatorRole}
											onValueChange={(value) => {
												workspaceValues.primaryOperatorRole =
													value as WorkspaceSetupValues['primaryOperatorRole'];
											}}
										>
											<Select.Trigger size="sm" class="w-full min-w-0"
												><span class="block min-w-0 truncate">{selectedRoleLabel}</span
												></Select.Trigger
											>
											<Select.Content
												>{#each ONBOARDING_OPERATOR_ROLE_OPTIONS as option (option.value)}<Select.Item
														value={option.value}
														label={option.label}
													/>{/each}</Select.Content
											>
										</Select.Root>
										<FieldError errors={workspaceErrors.primaryOperatorRole} />
									</FieldShell>

									<FieldShell>
										<FieldLabel>Industry</FieldLabel>
										<Select.Root
											type="single"
											value={workspaceValues.industry}
											onValueChange={(value) => {
												workspaceValues.industry = value;
											}}
										>
											<Select.Trigger size="sm" class="w-full min-w-0"
												><span class="block min-w-0 truncate">{selectedIndustryLabel}</span
												></Select.Trigger
											>
											<Select.Content
												>{#each INDUSTRY_OPTIONS as option (option.value)}<Select.Item
														value={option.value}
														label={option.label}
													/>{/each}</Select.Content
											>
										</Select.Root>
										<FieldError errors={workspaceErrors.industry} />
									</FieldShell>
								</div>
							</div>

							<div class="flex items-center justify-between gap-3">
								<Button
									variant="secondary"
									size="default"
									type="button"
									class="gap-2"
									onclick={handleWorkspaceBusinessBack}
								>
									<ArrowLeftIcon class="size-4" />
									Previous
								</Button>
								<Button
									variant="brand"
									size="default"
									class="gap-2"
									onclick={() => void handleWorkspaceSubmit()}
									disabled={isWorkspaceBusinessSubmitDisabled}
								>
									{#if isSubmittingWorkspace}
										<LoaderIcon class="size-4 animate-spin" />
										Creating workspace...
									{:else}
										Create workspace
										<ArrowRightIcon class="size-4" />
									{/if}
								</Button>
							</div>
						</section>
					{/if}
				{:else if onboardingState.currentStep === 'setup_import_optional'}
					<section class="flex flex-col gap-6">
						<div class="flex flex-col gap-1.5">
							<p class="eyebrow">Step 2 of 3</p>
							<h1 class="h3 text-balance">Import your setup data</h1>
							<Text as="p" tone="muted">Bring in companies, rates, templates, and codes.</Text>
						</div>

						<button
							type="button"
							class="ui-upload-dropzone ui-empty-dropzone-lg w-full px-6 py-6 text-left"
							onclick={() => (isImportDialogOpen = true)}
						>
							<Text>Choose setup spreadsheet</Text>
							<Meta class="mt-2">CSV or XLSX. Review mappings before import.</Meta>
						</button>

						<div class="flex items-center justify-end gap-2">
							<Button
								variant="secondary"
								size="default"
								type="button"
								class="gap-2"
								onclick={() => void handleSkipImport()}
								disabled={isAdvancingImport}
							>
								{#if isAdvancingImport}
									<LoaderIcon class="size-4 animate-spin" />
									Finishing...
								{:else}
									Skip for now
								{/if}
							</Button>
							<Button
								variant="brand"
								size="default"
								type="button"
								class="gap-2"
								onclick={() => (isImportDialogOpen = true)}
							>
								Import data
								<ArrowRightIcon class="size-4" />
							</Button>
						</div>
					</section>
				{:else if onboardingState.currentStep === 'local_ai_optional'}
					<section class="flex flex-col gap-6">
						<div class="flex flex-col gap-1.5">
							<p class="eyebrow">Step 3 of 3</p>
							<h1 class="h3">Set up Kwantflow AI</h1>
							<Text as="p" tone="muted">Download now or finish later in Settings.</Text>
						</div>

						<LocalAiSetupCard compact />

						<div class="flex items-center justify-end gap-3">
							<Button
								variant="brand"
								size="default"
								class="gap-2"
								onclick={() => void handleLocalAiContinue()}
								disabled={isAdvancingLocalAi}
							>
								Continue
								<ArrowRightIcon class="size-4" />
							</Button>
						</div>
					</section>
				{:else}
					<section class="flex flex-col gap-5">
						<div class="ui-note-panel ui-note-panel-tight w-fit">
							<LoaderIcon class="muted-soft size-5 animate-spin" />
						</div>
						<div class="flex flex-col gap-2">
							<h1 class="h3">Opening workspace</h1>
							<Text as="p" tone="muted">Just a moment…</Text>
						</div>
					</section>
				{/if}
			</div>
		</div>
	</div>

	<div class="shell-surface relative hidden h-full lg:block">
		<img
			src="/images/onboarding-hero-industrial.jpg"
			alt="RFQ document control workspace"
			class="absolute inset-0 h-full w-full object-cover"
		/>
	</div>
</div>

<SetupImportDialog bind:open={isImportDialogOpen} onImported={handleImported} />
