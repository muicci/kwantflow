import { storeService } from '$lib/services/store.js';
import {
	onboardingWorkspaceDetailsSchema,
	type OnboardingWorkspaceDetailsValues
} from '$lib/schemas/index.js';
import { invoke } from '@tauri-apps/api/core';
import { controlDbService } from '$lib/services/control-db.js';
import { dbService } from '$lib/services/db.js';
import { createLogger } from '$lib/services/logger.js';
import type { OnboardingStep, WorkspaceRegistryEntry } from '$lib/types/index.js';
import {
	buildUniqueWorkspaceSlug,
	sanitiseBusinessNameCandidate,
	slugifyWorkspaceName
} from '$lib/utils/workspace-naming.js';

import { generateUUID } from '$lib/utils/env.js';
import { workspaceState } from './workspace.svelte.js';

const log = createLogger('onboardingState');

export type OnboardingStepId = OnboardingStep;

export type WorkspaceSetupValues = OnboardingWorkspaceDetailsValues & {
	workspaceName: string;
};

const DEFAULT_WORKSPACE_VALUES: WorkspaceSetupValues = {
	workspaceName: '',
	countryCode: 'AU',
	businessName: '',
	logoFilePath: '',
	businessContactFirstName: '',
	businessContactLastName: '',
	businessContactPhone: '',
	businessContactEmail: '',
	businessIdValue: '',
	primaryOperatorRole: 'owner_founder',
	industry: ''
};

function mergeWorkspaceDraft(
	values: Partial<WorkspaceSetupValues> | null | undefined
): WorkspaceSetupValues {
	return {
		workspaceName: values?.workspaceName?.trim() ?? '',
		countryCode: values?.countryCode?.trim() || 'AU',
		businessName: values?.businessName?.trim() ?? '',
		logoFilePath: values?.logoFilePath?.trim() ?? '',
		businessContactFirstName: values?.businessContactFirstName?.trim() ?? '',
		businessContactLastName: values?.businessContactLastName?.trim() ?? '',
		businessContactPhone: values?.businessContactPhone?.trim() ?? '',
		businessContactEmail: values?.businessContactEmail?.trim().toLowerCase() ?? '',
		businessIdValue: values?.businessIdValue?.trim() ?? '',
		primaryOperatorRole: values?.primaryOperatorRole ?? 'owner_founder',
		industry: values?.industry?.trim() ?? ''
	};
}

class OnboardingState {
	currentStep: OnboardingStepId = $state('workspace_setup');
	bootstrapErrorMessage: string | null = $state(null);
	workspaceValues: WorkspaceSetupValues = $state({ ...DEFAULT_WORKSPACE_VALUES });
	activeWorkspaceId: string | null = $state(null);
	workspaceRegistry: WorkspaceRegistryEntry[] = $state([]);
	isRunningAction = $state(false);
	isHydrated = $state(false);

	isAccessReady = $derived(this.currentStep === 'ready');
	shouldGateApp = $derived(!this.isAccessReady);
	hasPendingWorkspaceSetup = $derived(
		(this.currentStep === 'workspace_setup' || this.currentStep === 'workspace_creation_failed') &&
			this.workspaceRegistry.some((entry) => entry.id === this.activeWorkspaceId)
	);

	private inferStep(snapshot?: {
		currentStep?: OnboardingStepId | null;
		completedAt?: string | null;
	}): OnboardingStepId {
		if (this.workspaceRegistry.length === 0) {
			return 'workspace_setup';
		}
		if (snapshot?.completedAt) return 'ready';
		if (
			snapshot?.currentStep === 'workspace_setup' ||
			snapshot?.currentStep === 'setup_import_optional' ||
			snapshot?.currentStep === 'local_ai_optional'
		) {
			return snapshot.currentStep;
		}
		return 'setup_import_optional';
	}

	async hydrate(): Promise<void> {
		try {
			const [onboarding, registry, activeWorkspace] = await Promise.all([
				controlDbService.getOnboardingState(),
				controlDbService.getWorkspaceRegistry(),
				controlDbService.getActiveWorkspaceRegistryEntry()
			]);

			this.workspaceRegistry = registry;
			this.activeWorkspaceId = activeWorkspace?.id ?? onboarding?.activeWorkspaceId ?? null;
			this.currentStep = onboarding?.currentStep ?? 'workspace_setup';
			this.currentStep = this.inferStep(onboarding ?? undefined);
			this.bootstrapErrorMessage = null;
			log.info('Hydrated local-first onboarding state', {
				currentStep: this.currentStep,
				activeWorkspaceId: this.activeWorkspaceId,
				workspaceCount: this.workspaceRegistry.length
			});
		} finally {
			this.isHydrated = true;
		}
	}

	async createWorkspace(values: WorkspaceSetupValues): Promise<void> {
		if (this.isRunningAction) return;
		this.isRunningAction = true;
		this.bootstrapErrorMessage = null;
		this.currentStep = 'workspace_setup';

		let workspaceId: string | null = null;
		try {
			const now = new Date().toISOString();
			const latestRegistry = await controlDbService.getWorkspaceRegistry();
			const activeWorkspace = await controlDbService.getActiveWorkspaceRegistryEntry();
			let registryEntry = latestRegistry.find(
				(entry) => entry.id === (this.activeWorkspaceId ?? activeWorkspace?.id)
			);
			if (this.activeWorkspaceId && !registryEntry) {
				throw new Error(
					'The workspace being set up is missing from the local registry. Reopen Kwantflow to recover it.'
				);
			}
			if (!registryEntry) {
				const workspaceName = values.workspaceName.trim();
				if (!workspaceName) {
					throw new Error('Workspace name is required.');
				}
				const parsed = onboardingWorkspaceDetailsSchema.parse({ ...values, workspaceName });
				const customer = await controlDbService.upsertControlCustomerIdentity({
					displayName:
						sanitiseBusinessNameCandidate(parsed.businessName, workspaceName) || workspaceName
				});
				const workspaceSlug = buildUniqueWorkspaceSlug(
					slugifyWorkspaceName(workspaceName),
					latestRegistry
				);
				workspaceId = `${workspaceSlug}-${generateUUID().slice(0, 8)}`;
				const foundation = dbService.buildBootstrapFoundationCommandInput({
					workspaceId,
					displayName: workspaceName,
					countryCode: parsed.countryCode,
					businessName: parsed.businessName,
					logoFilePath: parsed.logoFilePath ?? '',
					businessContactFirstName: parsed.businessContactFirstName,
					businessContactLastName: parsed.businessContactLastName,
					primaryMemberFirstName: parsed.businessContactFirstName,
					primaryMemberLastName: parsed.businessContactLastName,
					businessContactPhone: parsed.businessContactPhone ?? '',
					businessContactEmail: parsed.businessContactEmail,
					businessIdValue: parsed.businessIdValue ?? '',
					primaryOperatorRole: parsed.primaryOperatorRole,
					industry: parsed.industry ?? ''
				});
				registryEntry = await storeService.withManagedFileMutation(() =>
					invoke<WorkspaceRegistryEntry>('create_workspace_command', {
						input: {
							workspaceId,
							customerId: customer.id,
							displayName: workspaceName,
							slug: workspaceSlug,
							isDefault: latestRegistry.length === 0,
							lastOpenedAt: now,
							foundation
						}
					})
				);
				this.workspaceValues = mergeWorkspaceDraft(values);
				this.workspaceRegistry = [...latestRegistry, registryEntry];
			} else {
				this.workspaceRegistry = latestRegistry;
			}
			// Native creation has already committed these records. A later failure must
			// resume this workspace, including after a process restart.
			workspaceId = registryEntry.id;
			this.activeWorkspaceId = registryEntry.id;
			dbService.adoptActiveWorkspace(registryEntry.id);
			await dbService.init();
			await dbService.ensureDefaultClassificationSystem();
			await workspaceState.hydrate();

			await controlDbService.upsertOnboardingState({
				currentStep: 'setup_import_optional',
				profileCompletedAt: now,
				firstWorkspaceCreatedAt: now,
				activeWorkspaceId: registryEntry.id
			});
			this.currentStep = 'setup_import_optional';
		} catch (error) {
			const fallbackMessage = 'We could not finish workspace setup.';
			const message =
				error instanceof Error
					? error.message
					: typeof error === 'string' && error.trim()
						? error
						: fallbackMessage;
			log.error('Workspace setup failed', {
				workspaceId,
				error: message
			});
			this.bootstrapErrorMessage = /closed pool/i.test(message)
				? fallbackMessage
				: message || fallbackMessage;
			this.currentStep = 'workspace_creation_failed';
			throw error;
		} finally {
			this.isRunningAction = false;
		}
	}

	async completeSetupImportStep(): Promise<void> {
		const now = new Date().toISOString();
		await controlDbService.upsertOnboardingState({
			currentStep: 'local_ai_optional',
			activeWorkspaceId: this.activeWorkspaceId,
			importDecidedAt: now
		});
		this.currentStep = 'local_ai_optional';
	}

	async returnToWorkspaceSetup(): Promise<void> {
		await controlDbService.upsertOnboardingState({
			currentStep: 'workspace_setup',
			activeWorkspaceId: this.activeWorkspaceId
		});
		this.currentStep = 'workspace_setup';
	}

	async completeLocalAiStep(): Promise<void> {
		const now = new Date().toISOString();
		await dbService.markWorkspaceOnboardingCompleted(now);
		await workspaceState.refresh();
		await controlDbService.upsertOnboardingState({
			currentStep: 'ready',
			activeWorkspaceId: this.activeWorkspaceId,
			localAiDecidedAt: now,
			completedAt: now
		});
		this.currentStep = 'ready';
	}

	async reset(activeWorkspaceId: string | null = this.activeWorkspaceId): Promise<void> {
		await controlDbService.upsertOnboardingState({
			currentStep: 'workspace_setup',
			profileCompletedAt: null,
			firstWorkspaceCreatedAt: null,
			importDecidedAt: null,
			localAiDecidedAt: null,
			completedAt: null,
			activeWorkspaceId
		});
		this.resetForTests();
		this.activeWorkspaceId = activeWorkspaceId;
	}

	resetForTests(): void {
		this.currentStep = 'workspace_setup';
		this.bootstrapErrorMessage = null;
		this.workspaceValues = { ...DEFAULT_WORKSPACE_VALUES };
		this.activeWorkspaceId = null;
		this.workspaceRegistry = [];
		this.isRunningAction = false;
		this.isHydrated = false;
	}
}

export const onboardingState = new OnboardingState();
