import { storeService } from '$lib/services/store.js';
import {
	workspaceCreateDetailsSchema,
	type WorkspaceCreateDetailsValues
} from '$lib/schemas/index.js';
import { invoke } from '@tauri-apps/api/core';
import { controlDbService } from '$lib/services/control-db.js';
import { dbService } from '$lib/services/db.js';
import { createLogger } from '$lib/services/logger.js';
import type { WorkspaceRegistryEntry } from '$lib/types/index.js';
import {
	buildUniqueWorkspaceSlug,
	sanitiseBusinessNameCandidate,
	slugifyWorkspaceName
} from '$lib/utils/workspace-naming.js';
import { appState } from './app.svelte.js';
import { appTabsState } from './app-tabs.svelte.js';
import { profileState } from './profile.svelte.js';
import { workspaceState } from './workspace.svelte.js';

const log = createLogger('workspaceManagerState');

export type WorkspaceManagerCreateValues = WorkspaceCreateDetailsValues;

export const DEFAULT_WORKSPACE_MANAGER_CREATE_VALUES: WorkspaceManagerCreateValues = {
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

function mergeCreateDraft(
	values: Partial<WorkspaceManagerCreateValues> | null | undefined
): WorkspaceManagerCreateValues {
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

class WorkspaceManagerState {
	workspaces: WorkspaceRegistryEntry[] = $state([]);
	activeWorkspaceId: string | null = $state(null);
	isHydrated = $state(false);
	isCreating = $state(false);
	isSwitching = $state(false);
	switchingWorkspaceId: string | null = $state(null);
	isDeleting = $state(false);

	activeWorkspace: WorkspaceRegistryEntry | null = $derived(
		this.workspaces.find((workspace) => workspace.id === this.activeWorkspaceId) ?? null
	);

	canDeleteWorkspace: boolean = $derived(this.workspaces.length > 1);
	private applySnapshot(
		workspaces: WorkspaceRegistryEntry[],
		activeWorkspace: WorkspaceRegistryEntry | null
	): void {
		this.workspaces = workspaces;
		this.activeWorkspaceId = activeWorkspace?.id ?? null;
	}

	async hydrate(): Promise<void> {
		try {
			const [workspaces, activeWorkspace] = await Promise.all([
				controlDbService.getWorkspaceRegistry(),
				controlDbService.getActiveWorkspaceRegistryEntry()
			]);
			this.applySnapshot(workspaces, activeWorkspace);
		} finally {
			this.isHydrated = true;
		}
	}

	async refresh(): Promise<void> {
		const [workspaces, activeWorkspace] = await Promise.all([
			controlDbService.getWorkspaceRegistry(),
			controlDbService.getActiveWorkspaceRegistryEntry()
		]);
		this.applySnapshot(workspaces, activeWorkspace);
	}

	buildCreateDefaults(): WorkspaceManagerCreateValues {
		return mergeCreateDraft({
			workspaceName: '',
			countryCode: workspaceState.countryCode || 'AU',
			businessName: '',
			logoFilePath: '',
			businessContactFirstName: profileState.firstName,
			businessContactLastName: profileState.lastName,
			businessContactPhone: profileState.phone ?? '',
			businessContactEmail: profileState.email ?? '',
			businessIdValue: '',
			primaryOperatorRole: 'owner_founder',
			industry: ''
		});
	}

	async createWorkspace(values: WorkspaceManagerCreateValues): Promise<WorkspaceRegistryEntry> {
		if (this.isCreating) {
			throw new Error('Workspace creation is already in progress.');
		}
		this.isCreating = true;
		let workspaceId: string | null = null;
		try {
			const merged = mergeCreateDraft(values);
			const workspaceName = merged.workspaceName.trim();
			if (!workspaceName) {
				throw new Error('Workspace name is required.');
			}
			const parsed = workspaceCreateDetailsSchema.parse({ ...merged, workspaceName });
			const latestRegistry = await controlDbService.getWorkspaceRegistry();

			const now = new Date().toISOString();
			const controlCustomer = await controlDbService.upsertControlCustomerIdentity({
				displayName:
					sanitiseBusinessNameCandidate(parsed.businessName, workspaceName) || workspaceName
			});
			const workspaceSlug = buildUniqueWorkspaceSlug(
				slugifyWorkspaceName(workspaceName),
				latestRegistry
			);
			workspaceId = `${workspaceSlug}-${crypto.randomUUID().slice(0, 8)}`;
			const foundation = dbService.buildBootstrapFoundationCommandInput({
				workspaceId,
				displayName: workspaceName,
				countryCode: parsed.countryCode,
				businessName: parsed.businessName,
				logoFilePath: parsed.logoFilePath ?? '',
				businessContactFirstName: parsed.businessContactFirstName,
				businessContactLastName: parsed.businessContactLastName,
				primaryMemberFirstName: profileState.firstName,
				primaryMemberLastName: profileState.lastName,
				businessContactPhone: parsed.businessContactPhone ?? '',
				businessContactEmail: parsed.businessContactEmail || profileState.email || '',
				businessIdValue: parsed.businessIdValue ?? '',
				primaryOperatorRole: parsed.primaryOperatorRole,
				industry: parsed.industry ?? ''
			});
			const { integrationsState } = await import('./integrations.svelte.js');
			await integrationsState.resetForWorkspaceChange();
			let registryEntry: WorkspaceRegistryEntry;
			try {
				registryEntry = await storeService.withManagedFileMutation(() =>
					invoke<WorkspaceRegistryEntry>('create_workspace_command', {
						input: {
							workspaceId,
							customerId: controlCustomer.id,
							displayName: workspaceName,
							slug: workspaceSlug,
							isDefault: latestRegistry.length === 0,
							lastOpenedAt: now,
							foundation
						}
					})
				);
			} catch (error) {
				await appState.boot();
				throw error;
			}
			dbService.adoptActiveWorkspace(registryEntry.id);
			await dbService.init();
			await dbService.ensureDefaultClassificationSystem();

			await appState.boot();
			appTabsState.resetForWorkspaceChange();
			await appTabsState.persist();
			await this.refresh();
			log.info('Created workspace', {
				workspaceId: registryEntry.id,
				workspaceName: registryEntry.displayName
			});
			return registryEntry;
		} catch (error) {
			log.error('Workspace create failed', {
				workspaceId,
				error: error instanceof Error ? error.message : String(error)
			});
			throw error;
		} finally {
			this.isCreating = false;
		}
	}

	async switchWorkspace(workspaceId: string): Promise<void> {
		if (this.isSwitching || workspaceId === this.activeWorkspaceId) return;

		this.isSwitching = true;
		this.switchingWorkspaceId = workspaceId;
		try {
			const entry = await controlDbService.getWorkspaceRegistryEntry(workspaceId);
			if (!entry) {
				throw new Error('Workspace not found.');
			}

			const { assistantState } = await import('./assistant.svelte.js');
			await assistantState.resetForWorkspaceChange();
			const { integrationsState } = await import('./integrations.svelte.js');
			await integrationsState.resetForWorkspaceChange();
			const activated = await invoke<WorkspaceRegistryEntry>('activate_workspace_command', {
				input: { workspaceId }
			});
			dbService.adoptActiveWorkspace(activated.id);
			await dbService.init();
			await appState.boot();
			appTabsState.resetForWorkspaceChange();
			await appTabsState.persist();
			await this.refresh();
			log.info('Switched workspace', { workspaceId });
		} catch (error) {
			await appState.boot();
			throw error;
		} finally {
			this.isSwitching = false;
			this.switchingWorkspaceId = null;
		}
	}

	async deleteWorkspace(workspaceId: string, confirmationName: string): Promise<void> {
		if (this.isDeleting) {
			throw new Error('Workspace deletion is already in progress.');
		}

		const workspaces = await controlDbService.getWorkspaceRegistry();
		if (workspaces.length <= 1) {
			throw new Error('At least one workspace is required.');
		}

		const target = workspaces.find((workspace) => workspace.id === workspaceId);
		if (!target) {
			throw new Error('Workspace not found.');
		}
		if (confirmationName.trim() !== target.displayName.trim()) {
			throw new Error('Type the workspace name exactly to delete it.');
		}

		this.isDeleting = true;
		try {
			const deletingActiveWorkspace = workspaceId === this.activeWorkspaceId;

			if (deletingActiveWorkspace) {
				const { assistantState } = await import('./assistant.svelte.js');
				await assistantState.resetForWorkspaceChange();
				const { integrationsState } = await import('./integrations.svelte.js');
				await integrationsState.resetForWorkspaceChange();
			}

			const nextActiveWorkspace = await storeService.withManagedFileMutation(() =>
				invoke<WorkspaceRegistryEntry | null>('delete_workspace_command', {
					input: { workspaceId }
				})
			);

			if (deletingActiveWorkspace && nextActiveWorkspace) {
				dbService.adoptActiveWorkspace(nextActiveWorkspace.id);
				await dbService.init();
				await appState.boot();
			}

			await this.refresh();
			log.info('Deleted workspace', { workspaceId });
		} finally {
			this.isDeleting = false;
		}
	}
}

export const workspaceManagerState = new WorkspaceManagerState();
