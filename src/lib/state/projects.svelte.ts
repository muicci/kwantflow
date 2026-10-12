import { invoke } from '@tauri-apps/api/core';
import { toast } from 'svelte-sonner';
import { dbService } from '../services/db';
import { createLogger } from '../services/logger.js';
import { storeService } from '../services/store';
import { errorState } from './errors.svelte';
import { contactsState } from './contacts.svelte';
import { workspaceState } from './workspace.svelte';
import type { Project, Asset, AssetFile } from '$lib/types/index.js';
import { PriorityLevel, ProjectStatus } from '../constants/index.js';
import { isTauri } from '../utils/env';
import {
	resolveProjectContactLink,
	resolveProjectRequesterLink
} from '$lib/utils/project-contact.js';
import {
	hashFileBytes,
	readVaultFile,
	removeDerivedPreviewCacheForSource,
	removePreparedEvidenceCacheForSource,
	removeVaultFile
} from '$lib/services/assets.js';
import { buildMergedManualOrderIds } from '$lib/utils/manual-order.js';
import { appTabsState } from './app-tabs.svelte.js';
import { explorerState } from './explorer.svelte.js';
import { MAX_ASSET_FILES } from '$lib/services/ai-drafting.js';
import { SvelteMap } from 'svelte/reactivity';

const log = createLogger('projectsState');

function splitRequesterName(fullName: string): {
	displayName: string;
	firstName: string;
	lastName: string;
} {
	const parts = fullName
		.trim()
		.split(/\s+/)
		.map((part) => part.trim())
		.filter(Boolean);
	const displayName = parts.join(' ');
	if (parts.length === 0) {
		return { displayName: '', firstName: '', lastName: '' };
	}
	if (parts.length === 1) {
		return { displayName, firstName: parts[0], lastName: '' };
	}
	return {
		displayName,
		firstName: parts[0],
		lastName: parts.slice(1).join(' ')
	};
}

function matchesProjectSearch(project: Project, query: string): boolean {
	const q = query.toLowerCase().trim();
	if (!q) return true;

	return [
		project.rfq_number,
		project.contact_name ?? '',
		project.contact_name_snapshot ?? '',
		project.requester_contact_name ?? '',
		project.requester_name_snapshot ?? '',
		project.project_name ?? ''
	].some((value) => value.toLowerCase().includes(q));
}

export function emailProjectKey(
	sourceEmailIntegrationId: string | null | undefined,
	sourceEmailMessageId: string
): string {
	return `${sourceEmailIntegrationId ?? ''}:${sourceEmailMessageId}`;
}

/**
 * ProjectsState — The Single Authority for the RFQ project list and active selection.
 * Data flows from SQLite via dbService. Active selection persisted via storeService.
 */
class ProjectsState {
	private upsertProject(nextProject: Project): void {
		const index = this.list.findIndex((project) => project.id === nextProject.id);
		if (index === -1) {
			this.list = [...this.list, nextProject];
		} else {
			this.list = this.list.map((project, currentIndex) =>
				currentIndex === index ? nextProject : project
			);
		}

		if (this.workspaceProject?.id === nextProject.id) {
			this.workspaceProject = nextProject;
		}
	}

	private async reportSavedProjectRefreshFailure(
		error: unknown,
		projectId: string,
		rfqNumber: string,
		databasePath: string | null
	): Promise<void> {
		await errorState.catchError(
			error,
			`RFQ ${rfqNumber} saved`,
			() => {
				void (async () => {
					if (dbService.getDatabasePath() !== databasePath) {
						throw new Error('Return to the saved workspace before refreshing this RFQ.');
					}
					const project = await dbService.getProjectById(projectId);
					if (dbService.getDatabasePath() !== databasePath) {
						throw new Error('Return to the saved workspace before refreshing this RFQ.');
					}
					if (!project) throw new Error('The saved RFQ could not be reloaded.');
					this.upsertProject(project);
					explorerState.syncProjects(this.list);
					await explorerState.refreshProjectBranch(projectId);
				})().catch((refreshError) =>
					this.reportSavedProjectRefreshFailure(refreshError, projectId, rfqNumber, databasePath)
				);
			},
			{
				description:
					dbService.getDatabasePath() === databasePath
						? 'Your RFQ and files were saved. Retry to refresh the view.'
						: 'Your RFQ and files were saved in another workspace. Return to that workspace to refresh the view.'
			}
		);
	}

	private removeProjects(ids: string[]): void {
		const removedIds = new Set(ids);
		this.list = this.list.filter((project) => !removedIds.has(project.id));
		if (this.workspaceProject && removedIds.has(this.workspaceProject.id)) {
			this.clearWorkspaceShell();
		}
	}

	private async ingestProjectFiles(
		projectId: string,
		files: Array<{ path: string; name?: string | null }>
	): Promise<
		Array<{ storedPath: string; fileName: string; byteSize: number; contentHash: string | null }>
	> {
		if (files.length === 0) return [];

		// Preprocess intake files: HEIC→JPEG, ZIP→extract
		const { preprocessIntakeFiles } = await import('$lib/services/intake-preprocessing.js');
		const expanded = await preprocessIntakeFiles(files);

		const ingestedFiles: Array<{
			storedPath: string;
			fileName: string;
			byteSize: number;
			contentHash: string | null;
		}> = [];

		for (const file of expanded) {
			const fileName = (file.name ?? file.path.split(/[/\\]/).pop()) || file.path;
			let storedPath: string | null = null;
			try {
				storedPath = isTauri()
					? await invoke<string>('ingest_file', {
							projectId,
							sourcePath: file.path
						})
					: file.path;
				const bytes = isTauri() ? await readVaultFile(storedPath) : new Uint8Array();

				ingestedFiles.push({
					storedPath,
					fileName,
					byteSize: bytes.byteLength,
					contentHash: bytes.byteLength > 0 ? await hashFileBytes(bytes) : null
				});
			} catch (error) {
				const stagedPaths = ingestedFiles.map((ingestedFile) => ingestedFile.storedPath);
				if (storedPath) stagedPaths.push(storedPath);
				const cleanupPromises = stagedPaths.flatMap((stagedPath) => [
					removeDerivedPreviewCacheForSource(stagedPath).catch((cleanupError) => {
						log.error('Failed to clean up derived preview cache', cleanupError);
					}),
					removePreparedEvidenceCacheForSource(stagedPath).catch((cleanupError) => {
						log.error('Failed to clean up prepared AI evidence cache', cleanupError);
					}),
					removeVaultFile(stagedPath).catch((cleanupError) => {
						log.error('Failed to clean up ingested file', cleanupError);
					})
				]);
				await Promise.allSettled(cleanupPromises);

				const message = error instanceof Error && error.message ? `: ${error.message}` : '';
				throw new Error(`Failed to ingest ${fileName} into the local vault${message}`, {
					cause: error
				});
			}
		}

		return ingestedFiles;
	}

	private async resolveContactForSave(
		contactName?: string,
		contactId?: string | null
	): Promise<{
		contactId: string | null;
		contactNameSnapshot: string | null;
		createdContact: { id: string; name: string } | null;
	}> {
		return resolveProjectContactLink({
			contacts: contactsState.companyContacts.map((contact) => ({
				id: contact.id,
				name: contact.display_name || contact.name
			})),
			contactId,
			contactName,
			findContactByName: async (name: string) => {
				const existingContact = await dbService.findContactByName(name);
				return existingContact?.kind === 'company' ? existingContact : null;
			},
			createContact: async (name: string) => {
				const existingContact = await dbService.findContactByName(name);
				if (existingContact?.kind === 'company') {
					return {
						id: existingContact.id,
						name: existingContact.name
					};
				}
				if (existingContact) {
					throw new Error(
						`A contact named ${existingContact.name} already exists. Select the existing company or enter a unique company name.`
					);
				}

				const id = isTauri() ? await invoke<string>('generate_uuid') : crypto.randomUUID();
				await dbService.addContact(id, {
					country_code: workspaceState.countryCode || 'AU',
					name,
					display_name: name,
					kind: 'company',
					company_name: name,
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
					custom_role_label: '',
					roles: ['customer'],
					tags: [],
					is_active: true
				});
				await contactsState.refresh();
				return { id, name };
			}
		});
	}

	private async resolveRequesterForSave(
		companyId: string | null,
		requesterName?: string,
		requesterId?: string | null,
		requesterEmail?: string,
		requesterPhone?: string
	): Promise<{
		requesterContactId: string | null;
		requesterNameSnapshot: string | null;
		createdRequester: { id: string; name: string } | null;
	}> {
		const linkedPeople = companyId
			? contactsState.getLinkedPeople(companyId).map((contact) => ({
					id: contact.id,
					name: contact.display_name || contact.name,
					email: contact.email
				}))
			: contactsState.list
					.filter((contact) => contact.kind === 'person' && !contact.linked_company_id)
					.map((contact) => ({
						id: contact.id,
						name: contact.display_name || contact.name,
						email: contact.email
					}));

		return resolveProjectRequesterLink({
			requesters: linkedPeople,
			requesterId,
			requesterName,
			findRequesterByName: async (name: string) => {
				const existing = linkedPeople.find(
					(contact) => contact.name.trim().toLowerCase() === name.trim().toLowerCase()
				);
				if (existing) return existing;
				const existingContact = await dbService.findContactByName(name);
				return existingContact?.kind === 'person' &&
					(!companyId || existingContact.linked_company_id === companyId)
					? { id: existingContact.id, name: existingContact.display_name || existingContact.name }
					: null;
			},
			createRequester: async (name: string) => {
				const existingRequester = linkedPeople.find(
					(contact) => contact.name.trim().toLowerCase() === name.trim().toLowerCase()
				);
				if (existingRequester) {
					return existingRequester;
				}

				const id = isTauri() ? await invoke<string>('generate_uuid') : crypto.randomUUID();
				const requester = splitRequesterName(name);
				await dbService.addContact(id, {
					country_code: workspaceState.countryCode || 'AU',
					name: requester.displayName,
					display_name: requester.displayName,
					kind: 'person',
					company_name: '',
					person_first_name: requester.firstName,
					person_last_name: requester.lastName,
					role_title: '',
					linked_company_id: companyId || '',
					is_primary_company_contact: false,
					contact_name: '',
					email: requesterEmail || '',
					website: '',
					phone: requesterPhone || '',
					phone_country_code: workspaceState.countryCode || 'AU',
					phone_e164: '',
					abn: '',
					business_id_label: workspaceState.businessIdLabel || 'Business ID',
					business_id_value: '',
					tax_id_label: workspaceState.taxIdLabel || 'Tax ID',
					tax_id_value: '',
					address: '',
					notes: '',
					custom_role_label: '',
					roles: ['customer'],
					tags: [],
					is_active: true
				});
				await contactsState.refresh();
				return { id, name };
			}
		});
	}

	private async reconcileWorkspaceCollections(projectId: string): Promise<void> {
		if (this.workspaceProject?.id !== projectId) return;

		const [assets, files] = await Promise.all([
			this.getAssetsForProject(projectId),
			this.getProjectFiles(projectId)
		]);
		this.workspaceAssets = assets;
		this.workspaceUnassignedFiles = files.filter((file) => !file.asset_id);
	}

	private resolveWorkspaceProjectIdForAsset(assetId: string): string | null {
		const asset = this.workspaceAssets.find((candidate) => candidate.id === assetId);
		if (!asset) return null;
		return this.workspaceProject?.id ?? asset.project_id;
	}

	private resolveWorkspaceProjectIdForFile(fileId: string): string | null {
		if (this.workspaceUnassignedFiles.some((file) => file.id === fileId)) {
			return this.workspaceProject?.id ?? null;
		}

		const asset = this.workspaceAssets.find((candidate) =>
			candidate.files?.some((file) => file.id === fileId)
		);
		if (!asset) return null;
		return this.workspaceProject?.id ?? asset.project_id;
	}

	/** All loaded projects. */
	list: Project[] = $state([]);

	/** Currently selected project ID. */
	activeId: string | null = $state(null);

	/** Search query for real-time filtering. */
	searchQuery: string = $state('');

	/** Shared workspace snapshot for the active RFQ route family. */
	workspaceProject: Project | null = $state(null);
	workspaceAssets: Asset[] = $state([]);
	workspaceUnassignedFiles: AssetFile[] = $state([]);

	/** Derived: the currently active project object. */
	active: Project | null = $derived(
		this.activeId ? (this.list.find((p) => p.id === this.activeId) ?? null) : null
	);

	activeProjects: Project[] = $derived(
		this.list.filter((project) => project.status !== ProjectStatus.Archived)
	);

	archivedProjects: Project[] = $derived(
		this.list.filter((project) => project.status === ProjectStatus.Archived)
	);

	/** Map of source_email_integration_id + source_email_message_id → projects created from that email. */
	emailToProjectMap: SvelteMap<string, Array<{ id: string; project_name: string }>> = $derived.by(
		() => {
			const map = new SvelteMap<string, Array<{ id: string; project_name: string }>>();
			for (let i = 0; i < this.list.length; i++) {
				const p = this.list[i];
				if (p.source_email_message_id) {
					const key = emailProjectKey(p.source_email_integration_id, p.source_email_message_id);
					let existing = map.get(key);
					if (existing === undefined) {
						existing = [];
						map.set(key, existing);
					}
					existing.push({ id: p.id, project_name: p.project_name ?? p.rfq_number });
				}
			}
			return map;
		}
	);

	/** Derived: 5 most recent projects for the sidebar. */
	recent: Project[] = $derived(this.activeProjects.slice(0, 5));

	/** Derived: filtered project list based on search query. */
	filtered: Project[] = $derived.by(() => {
		return this.activeProjects.filter((project) => matchesProjectSearch(project, this.searchQuery));
	});

	filteredArchived: Project[] = $derived.by(() =>
		this.archivedProjects.filter((project) => matchesProjectSearch(project, this.searchQuery))
	);

	filteredAll: Project[] = $derived.by(() =>
		this.list.filter((project) => matchesProjectSearch(project, this.searchQuery))
	);

	/**
	 * Load ALL projects and restore active selection.
	 * Called during boot sequence. Sidebar reads `recent` (derived).
	 */
	async hydrate(): Promise<void> {
		try {
			this.list = await dbService.getProjects();

			// Restore persisted active project
			const savedId = await storeService.getActiveProjectId();
			if (savedId) {
				const exists = this.list.find((p) => p.id === savedId);
				if (exists) {
					this.activeId = savedId;
				} else {
					// Try to fetch it directly from DB (may not be in default query)
					const project = await dbService.getProjectById(savedId);
					if (project) {
						this.list = [project, ...this.list];
						this.activeId = savedId;
					}
				}
			}
		} catch (error) {
			log.error('Failed to hydrate', error);
		}
	}

	/** Set the active project and persist the selection. */
	async setActive(project: Project | null): Promise<void> {
		this.activeId = project?.id ?? null;
		await storeService.setActiveProjectId(this.activeId);
	}

	reset(): void {
		this.list = [];
		this.activeId = null;
		this.searchQuery = '';
		this.clearWorkspaceShell();
		explorerState.syncProjects([]);
	}

	/** Re-fetch all projects from the database. */
	async refresh(): Promise<void> {
		try {
			this.list = await dbService.getProjects();
			explorerState.syncProjects(this.list);
		} catch (error) {
			log.error('Failed to refresh', error);
		}
	}

	async getAssetsForProject(projectId: string): Promise<Asset[]> {
		return dbService.getAssetsForProject(projectId);
	}

	async getProjectFiles(projectId: string): Promise<AssetFile[]> {
		return dbService.getProjectFiles(projectId);
	}

	async loadDetachedPreviewAsset(projectId: string, assetId: string): Promise<Asset | null> {
		const asset = await dbService.getDetachedPreviewAsset(projectId, assetId);
		if (asset) {
			log.info('Loaded detached preview asset', {
				projectId,
				assetId,
				fileCount: asset.files?.length ?? 0
			});
			return asset;
		}

		log.warn('Detached preview asset was not found', {
			projectId,
			assetId
		});
		return null;
	}

	async loadDetachedPreviewShell(projectId: string): Promise<{
		project: Project;
		assets: Asset[];
		unassignedFiles: AssetFile[];
	}> {
		const project = await dbService.getDetachedPreviewProject(projectId);
		if (!project) {
			log.warn('Detached preview project was not found', {
				projectId
			});
			throw new Error('RFQ not found');
		}

		log.info('Loaded detached preview shell', {
			projectId
		});
		return {
			project,
			assets: [],
			unassignedFiles: []
		};
	}

	async loadWorkspaceShell(projectId: string): Promise<{
		project: Project;
		assets: Asset[];
		unassignedFiles: AssetFile[];
	}> {
		const shell = await dbService.getWorkspaceShell(projectId);
		const project = shell.project;
		if (!project) {
			throw new Error('RFQ not found');
		}

		return {
			project,
			assets: shell.assets,
			unassignedFiles: shell.unassignedFiles
		};
	}

	setWorkspaceShell(shell: {
		project: Project;
		assets: Asset[];
		unassignedFiles: AssetFile[];
	}): void {
		this.workspaceProject = shell.project;
		this.workspaceAssets = shell.assets;
		this.workspaceUnassignedFiles = shell.unassignedFiles;
	}

	clearWorkspaceShell(): void {
		this.workspaceProject = null;
		this.workspaceAssets = [];
		this.workspaceUnassignedFiles = [];
	}

	async refreshWorkspaceShell(projectId: string): Promise<{
		project: Project;
		assets: Asset[];
		unassignedFiles: AssetFile[];
	}> {
		const shell = await this.loadWorkspaceShell(projectId);
		this.setWorkspaceShell(shell);
		await explorerState.refreshProjectBranch(projectId);
		return shell;
	}

	/** Find the next sequential RFQ number based on the highest numeric suffix in the DB. */
	async getNextRfqNumber(): Promise<string> {
		try {
			const projects = this.list.length > 0 ? this.list : await dbService.getProjects();
			if (projects.length === 0) return 'RFQ-1001';

			const numbers = projects
				.map((p) => {
					const match = p.rfq_number.match(/RFQ-(\d+)/);
					return match ? parseInt(match[1], 10) : 0;
				})
				.filter((n) => n > 0);

			const max = numbers.length > 0 ? Math.max(...numbers) : 1000;
			return `RFQ-${max + 1}`;
		} catch (error) {
			log.error('Failed to get next RFQ number', error);
			return `RFQ-${Date.now().toString().slice(-4)}`; // Fallback
		}
	}

	/** Add a new project and associated assets, then reconcile local state. */
	async addProject(
		rfqNumber: string,
		contactId?: string | null,
		contactName?: string,
		projectName?: string,
		dueDate?: string,
		priority?: PriorityLevel,
		status?: ProjectStatus,
		content?: string,
		note?: string,
		files?: Array<{ path: string; name?: string | null }>,
		requesterContactId?: string | null,
		requesterName?: string,
		sourceChannel: Project['source_channel'] = 'manual',
		sourceReference?: string,
		receivedDate?: string,
		submissionDeadlineAt?: string,
		estimatorName?: string,
		customerTenderReference?: string,
		addendumLabel?: string,
		addendumDate?: string,
		addendumNotes?: string,
		siteAddress?: string,
		deliveryAddress?: string,
		sourceEmailMessageId?: string,
		sourceEmailIntegrationId?: string,
		requesterEmail?: string,
		requesterPhone?: string
	): Promise<void> {
		const id = isTauri() ? await invoke<string>('generate_uuid') : crypto.randomUUID();
		const databasePath = dbService.getDatabasePath();
		let committed = false;
		let createdContactId: string | null = null;
		let createdRequesterId: string | null = null;
		let ingestedFiles: Array<{
			storedPath: string;
			fileName: string;
			byteSize: number;
			contentHash: string | null;
		}> = [];
		try {
			const resolvedContact = await this.resolveContactForSave(contactName, contactId);
			createdContactId = resolvedContact.createdContact?.id ?? null;
			const createdContactName = resolvedContact.createdContact?.name;
			const resolvedRequester = await this.resolveRequesterForSave(
				resolvedContact.contactId,
				requesterName,
				requesterContactId,
				requesterEmail,
				requesterPhone
			);
			createdRequesterId = resolvedRequester.createdRequester?.id ?? null;
			ingestedFiles = await this.ingestProjectFiles(id, files ?? []);
			const initialFiles = await Promise.all(
				ingestedFiles.map(async (file) => ({
					id: isTauri() ? await invoke<string>('generate_uuid') : crypto.randomUUID(),
					file_path: file.storedPath,
					original_name: file.fileName,
					byte_size: file.byteSize,
					content_hash: file.contentHash,
					document_type: '',
					revision_label: '',
					received_at: new Date().toISOString(),
					source_label: 'manual_upload',
					source_metadata: { originalName: file.fileName }
				}))
			);
			await dbService.createProjectWorkspace({
				id,
				rfqNumber,
				contactId: resolvedContact.contactId,
				contactNameSnapshot: resolvedContact.contactNameSnapshot ?? undefined,
				projectName,
				dueDate,
				receivedDate,
				submissionDeadlineAt,
				estimatorName,
				customerTenderReference,
				addendumLabel,
				addendumDate,
				addendumNotes,
				siteAddress,
				deliveryAddress,
				priority,
				status,
				content,
				note,
				requesterContactId: resolvedRequester.requesterContactId,
				requesterNameSnapshot: resolvedRequester.requesterNameSnapshot ?? undefined,
				sourceChannel,
				sourceReference,
				sourceEmailMessageId,
				sourceEmailIntegrationId,
				files: initialFiles
			});
			committed = true;
			if (createdContactName) {
				toast.success(`Company ${createdContactName} created`);
			}
			if (resolvedRequester.createdRequester?.name) {
				toast.success(`Person ${resolvedRequester.createdRequester.name} created`);
			}

			const createdProject = await dbService.getProjectById(id);
			if (createdProject) {
				this.upsertProject(createdProject);
				explorerState.syncProjects(this.list);
				await explorerState.refreshProjectBranch(createdProject.id);
			} else {
				await this.refresh();
				explorerState.syncProjects(this.list);
			}
			toast.success(`RFQ ${rfqNumber} created`, {
				id: `rfq-created-${id}`
			});
		} catch (error) {
			if (committed) {
				await this.reportSavedProjectRefreshFailure(error, id, rfqNumber, databasePath);
				return;
			}
			const cleanupPromises = ingestedFiles.flatMap((file) => [
				removeDerivedPreviewCacheForSource(file.storedPath).catch((cleanupError) => {
					log.error('Failed to clean up derived preview cache', cleanupError);
				}),
				removePreparedEvidenceCacheForSource(file.storedPath).catch((cleanupError) => {
					log.error('Failed to clean up prepared AI evidence cache', cleanupError);
				}),
				removeVaultFile(file.storedPath).catch((cleanupError) => {
					log.error('Failed to clean up ingested file', cleanupError);
				})
			]);
			await Promise.allSettled(cleanupPromises);

			if (createdRequesterId) {
				try {
					await dbService.deleteContact(createdRequesterId);
					await contactsState.refresh();
				} catch (cleanupError) {
					log.error('Failed to roll back inline requester', cleanupError);
				}
			}
			if (createdContactId) {
				try {
					await dbService.deleteContact(createdContactId);
					await contactsState.refresh();
				} catch (cleanupError) {
					log.error('Failed to roll back inline company', cleanupError);
				}
			}
			await errorState.catchError(error, `Create RFQ ${rfqNumber}`);
			throw error;
		}
	}

	async duplicateProject(id: string): Promise<void> {
		try {
			const nextRfqNumber = await this.getNextRfqNumber();
			const duplicatedProjectId = await dbService.duplicateProject(id, nextRfqNumber);
			const duplicatedProject = await dbService.getProjectById(duplicatedProjectId);
			if (duplicatedProject) {
				this.upsertProject(duplicatedProject);
				explorerState.syncProjects(this.list);
				await explorerState.refreshProjectBranch(duplicatedProject.id);
			} else {
				await this.refresh();
				explorerState.syncProjects(this.list);
			}
			toast.success('RFQ duplicated');
		} catch (error) {
			await errorState.catchError(error, `Duplicate RFQ ${id}`);
		}
	}

	async reorderProjects(visibleOrderedIds: string[]): Promise<void> {
		const previousList = [...this.list];
		try {
			const nextIds = buildMergedManualOrderIds(
				this.list.map((project) => project.id),
				visibleOrderedIds
			);
			const byId = new Map(this.list.map((project) => [project.id, project] as const));
			this.list = nextIds.map((projectId) => byId.get(projectId)!).filter(Boolean);
			await dbService.reorderProjects(nextIds);
			explorerState.syncProjects(this.list);
		} catch (error) {
			this.list = previousList;
			await errorState.catchError(error, 'Reorder RFQs');
		}
	}

	/** Update project details. Preserves existing groupings and estimates. */
	async updateProject(
		id: string,
		rfqNumber?: string,
		contactId?: string | null,
		contactName?: string,
		projectName?: string,
		dueDate?: string,
		priority?: PriorityLevel,
		status?: ProjectStatus,
		content?: string,
		note?: string,
		files?: Array<{ path: string; existing?: boolean; fileId?: string; name?: string | null }>,
		requesterContactId?: string | null,
		requesterName?: string,
		sourceChannel: Project['source_channel'] = 'manual',
		sourceReference?: string,
		receivedDate?: string,
		submissionDeadlineAt?: string,
		estimatorName?: string,
		customerTenderReference?: string,
		addendumLabel?: string,
		addendumDate?: string,
		addendumNotes?: string,
		siteAddress?: string,
		deliveryAddress?: string,
		sourceEmailMessageId?: string,
		sourceEmailIntegrationId?: string,
		requesterEmail?: string,
		requesterPhone?: string
	): Promise<void> {
		let committed = false;
		const databasePath = dbService.getDatabasePath();
		const currentRfqNumber = this.list.find((p) => p.id === id)?.rfq_number ?? id;
		let createdContactId: string | null = null;
		let createdRequesterId: string | null = null;
		let ingestedFiles: Array<{
			storedPath: string;
			fileName: string;
			byteSize: number;
			contentHash: string | null;
		}> = [];
		try {
			const resolvedContact = await this.resolveContactForSave(contactName, contactId);
			createdContactId = resolvedContact.createdContact?.id ?? null;
			const createdContactName = resolvedContact.createdContact?.name;
			const resolvedRequester = await this.resolveRequesterForSave(
				resolvedContact.contactId,
				requesterName,
				requesterContactId,
				requesterEmail,
				requesterPhone
			);
			createdRequesterId = resolvedRequester.createdRequester?.id ?? null;
			const newFiles = (files ?? [])
				.filter((file) => !file.existing)
				.map((file) => ({ path: file.path, name: file.name }));
			ingestedFiles = await this.ingestProjectFiles(id, newFiles);
			const keepFileIds =
				files?.filter((file) => file.existing && file.fileId).map((file) => file.fileId!) ??
				undefined;
			const stagedFiles = await Promise.all(
				ingestedFiles.map(async (file) => ({
					id: isTauri() ? await invoke<string>('generate_uuid') : crypto.randomUUID(),
					file_path: file.storedPath,
					original_name: file.fileName,
					byte_size: file.byteSize,
					content_hash: file.contentHash,
					document_type: '',
					revision_label: '',
					received_at: new Date().toISOString(),
					source_label: 'manual_upload',
					source_metadata: { originalName: file.fileName }
				}))
			);
			await dbService.updateProjectWorkspace({
				id,
				rfqNumber: rfqNumber?.trim() || currentRfqNumber,
				contactId: resolvedContact.contactId,
				contactNameSnapshot: resolvedContact.contactNameSnapshot ?? undefined,
				projectName,
				dueDate,
				receivedDate,
				submissionDeadlineAt,
				estimatorName,
				customerTenderReference,
				addendumLabel,
				addendumDate,
				addendumNotes,
				siteAddress,
				deliveryAddress,
				priority,
				status,
				content,
				note,
				requesterContactId: resolvedRequester.requesterContactId,
				requesterNameSnapshot: resolvedRequester.requesterNameSnapshot ?? undefined,
				sourceChannel,
				sourceReference,
				sourceEmailMessageId,
				sourceEmailIntegrationId,
				keepFileIds,
				newFiles: stagedFiles
			});
			committed = true;
			if (createdContactName) {
				toast.success(`Company ${createdContactName} created`);
			}
			if (resolvedRequester.createdRequester?.name) {
				toast.success(`Person ${resolvedRequester.createdRequester.name} created`);
			}
			const updatedProject = await dbService.getProjectById(id);
			if (updatedProject) {
				this.upsertProject(updatedProject);
				explorerState.syncProjects(this.list);
				await explorerState.refreshProjectBranch(id);
			} else {
				await this.refresh();
				explorerState.syncProjects(this.list);
				await explorerState.refreshProjectBranch(id);
			}
			toast.success(`RFQ ${rfqNumber?.trim() || currentRfqNumber} updated`);
		} catch (error) {
			if (committed) {
				await this.reportSavedProjectRefreshFailure(
					error,
					id,
					rfqNumber?.trim() || currentRfqNumber,
					databasePath
				);
				return;
			}
			const cleanupPromises = ingestedFiles.flatMap((file) => [
				removeDerivedPreviewCacheForSource(file.storedPath).catch((cleanupError) => {
					log.error('Failed to clean up derived preview cache', cleanupError);
				}),
				removePreparedEvidenceCacheForSource(file.storedPath).catch((cleanupError) => {
					log.error('Failed to clean up prepared AI evidence cache', cleanupError);
				}),
				removeVaultFile(file.storedPath).catch((cleanupError) => {
					log.error('Failed to clean up ingested file', cleanupError);
				})
			]);
			await Promise.allSettled(cleanupPromises);
			if (createdRequesterId) {
				try {
					await dbService.deleteContact(createdRequesterId);
					await contactsState.refresh();
				} catch (cleanupError) {
					log.error('Failed to roll back inline requester', cleanupError);
				}
			}
			if (createdContactId) {
				try {
					await dbService.deleteContact(createdContactId);
					await contactsState.refresh();
				} catch (cleanupError) {
					log.error('Failed to roll back inline company', cleanupError);
				}
			}
			await errorState.catchError(error, `Update project ${rfqNumber?.trim() || id}`);
			throw error;
		}
	}

	async toggleFavourite(id: string): Promise<void> {
		const currentProject = this.list.find((project) => project.id === id);
		if (!currentProject) return;

		const nextFavourite = !currentProject.is_favourite;

		try {
			await dbService.setProjectFavourite(id, nextFavourite);
			const updatedProject = await dbService.getProjectById(id);
			if (updatedProject) {
				this.upsertProject(updatedProject);
				explorerState.syncProjects(this.list);
			} else {
				await this.refresh();
				explorerState.syncProjects(this.list);
			}
			toast.success(
				`RFQ ${currentProject.rfq_number} ${nextFavourite ? 'added to favourites' : 'removed from favourites'}`
			);
		} catch (error) {
			await errorState.catchError(error, `Toggle favourite ${id}`);
		}
	}

	// --- Asset Grouping CRUD ---

	async createAssetFromFiles(
		projectId: string,
		fileIds: string[],
		displayName: string
	): Promise<void> {
		try {
			const assetId = isTauri() ? await invoke<string>('generate_uuid') : crypto.randomUUID();
			await dbService.createAssetFromFiles(assetId, projectId, displayName, fileIds);
			await this.reconcileWorkspaceCollections(projectId);
			await explorerState.refreshProjectBranch(projectId);
			toast.success(
				`Asset "${displayName}" created from ${fileIds.length} file${fileIds.length === 1 ? '' : 's'}`
			);
		} catch (error) {
			await errorState.catchError(error, 'Create asset');
		}
	}

	async addFilesToProject(
		projectId: string,
		files: Array<{ path: string; name?: string | null }>
	): Promise<void> {
		try {
			const project = this.list.find((p) => p.id === projectId);
			if (!project) {
				throw new Error('Project not found');
			}
			const existingFiles = await dbService.getProjectFiles(projectId);
			const keptExisting = existingFiles.map((f) => ({
				path: f.file_path,
				existing: true as const,
				fileId: f.id
			}));
			const addedNew = files.map((f) => ({ path: f.path, name: f.name, existing: false as const }));
			const allFiles = [...keptExisting, ...addedNew];

			await this.updateProject(
				project.id,
				project.rfq_number,
				project.contact_id,
				undefined, // contactName
				project.project_name || undefined,
				project.due_date || undefined,
				project.priority || undefined,
				project.status || undefined,
				project.content || undefined,
				project.note || undefined,
				allFiles,
				project.requester_contact_id,
				undefined, // requesterName
				project.source_channel || undefined,
				project.source_reference || undefined,
				project.received_date || undefined,
				project.submission_deadline_at || undefined,
				project.estimator_name || undefined,
				project.customer_tender_reference || undefined,
				project.addendum_label || undefined,
				project.addendum_date || undefined,
				project.addendum_notes || undefined,
				project.site_address || undefined,
				project.delivery_address || undefined,
				project.source_email_message_id || undefined,
				project.source_email_integration_id || undefined
			);
			await this.reconcileWorkspaceCollections(project.id);
		} catch (error) {
			await errorState.catchError(error, 'Add files to project');
		}
	}

	async addFilesToAsset(projectId: string, assetId: string, fileIds: string[]): Promise<void> {
		try {
			const asset = this.workspaceAssets.find((a) => a.id === assetId);
			const existingCount = asset?.files?.length ?? 0;
			if (existingCount >= MAX_ASSET_FILES) {
				toast.warning(
					`This scope item already has ${existingCount} file${existingCount === 1 ? '' : 's'}. ` +
						`You can group up to ${MAX_ASSET_FILES} files per scope item.`
				);
				return;
			}
			if (existingCount + fileIds.length > MAX_ASSET_FILES) {
				toast.warning(
					`You can group up to ${MAX_ASSET_FILES} files per scope item. ` +
						`This scope item already has ${existingCount} file${existingCount === 1 ? '' : 's'}.`
				);
				return;
			}
			await dbService.assignFilesToAsset(assetId, projectId, fileIds);
			await this.reconcileWorkspaceCollections(projectId);
			await explorerState.refreshProjectBranch(projectId);
			toast.success(
				`Added ${fileIds.length} file${fileIds.length === 1 ? '' : 's'} to the scope item`
			);
		} catch (error) {
			await errorState.catchError(error, 'Add files to scope item');
		}
	}

	async ungroupAsset(assetId: string): Promise<void> {
		try {
			const projectId = this.resolveWorkspaceProjectIdForAsset(assetId);
			const result = await dbService.ungroupAsset(assetId);
			if (projectId) {
				await this.reconcileWorkspaceCollections(projectId);
				await explorerState.refreshProjectBranch(projectId);
			}
			if (result.hadEstimate) {
				toast.warning('Estimate and cost components were deleted while files returned to review');
			}
			toast.success('Asset returned to the review pool');
		} catch (error) {
			await errorState.catchError(error, 'Ungroup asset');
		}
	}

	async removeFileFromAsset(fileId: string): Promise<void> {
		try {
			const projectId = this.resolveWorkspaceProjectIdForFile(fileId);
			await dbService.removeFileFromAsset(fileId);
			if (projectId) {
				await this.reconcileWorkspaceCollections(projectId);
				await explorerState.refreshProjectBranch(projectId);
			}
			toast.success('File returned to the review pool');
		} catch (error) {
			await errorState.catchError(error, 'Return file to review');
		}
	}

	async renameAsset(assetId: string, newName: string): Promise<void> {
		try {
			const projectId = this.resolveWorkspaceProjectIdForAsset(assetId);
			await dbService.updateAsset(assetId, { display_name: newName });
			if (projectId) {
				await this.reconcileWorkspaceCollections(projectId);
				await explorerState.refreshProjectBranch(projectId);
			}
			toast.success('Asset renamed');
		} catch (error) {
			await errorState.catchError(error, 'Rename asset');
		}
	}

	private async patchProjectStatus(id: string, nextStatus: ProjectStatus): Promise<Project> {
		const currentProject = this.list.find((project) => project.id === id);
		if (!currentProject) {
			throw new Error('RFQ not found');
		}

		await dbService.updateProject(
			id,
			currentProject.rfq_number,
			currentProject.contact_id ?? null,
			currentProject.contact_name_snapshot ?? undefined,
			currentProject.project_name,
			currentProject.due_date,
			currentProject.priority,
			nextStatus,
			currentProject.content,
			currentProject.note,
			currentProject.requester_contact_id ?? null,
			currentProject.requester_name_snapshot ?? undefined,
			currentProject.source_channel ?? 'manual',
			currentProject.source_reference ?? undefined
		);

		const updatedProject = await dbService.getProjectById(id);
		if (updatedProject) {
			this.upsertProject(updatedProject);
			explorerState.syncProjects(this.list);
			await explorerState.refreshProjectBranch(id);
			return updatedProject;
		}

		await this.refresh();
		explorerState.syncProjects(this.list);
		await explorerState.refreshProjectBranch(id);

		const refreshedProject = this.list.find((project) => project.id === id);
		if (!refreshedProject) {
			throw new Error('RFQ refresh failed after status update');
		}

		return refreshedProject;
	}

	async archiveProject(id: string): Promise<void> {
		const currentProject = this.list.find((project) => project.id === id);
		if (!currentProject) {
			throw new Error('RFQ not found');
		}
		if (currentProject.status === ProjectStatus.Archived) return;

		try {
			const updatedProject = await this.patchProjectStatus(id, ProjectStatus.Archived);
			toast.success(`RFQ ${updatedProject.rfq_number} archived`);
		} catch (error) {
			await errorState.catchError(error, `Archive project ${id}`);
		}
	}

	async restoreProject(id: string): Promise<void> {
		const currentProject = this.list.find((project) => project.id === id);
		if (!currentProject) {
			throw new Error('RFQ not found');
		}
		if (currentProject.status !== ProjectStatus.Archived) return;

		try {
			const updatedProject = await this.patchProjectStatus(id, ProjectStatus.Open);
			toast.success(`RFQ ${updatedProject.rfq_number} restored`);
		} catch (error) {
			await errorState.catchError(error, `Restore project ${id}`);
		}
	}

	async bulkArchiveProjects(ids: string[]): Promise<void> {
		try {
			const projectMap = new Map(this.list.map((p) => [p.id, p]));
			const validIds = ids.filter((id) => {
				const currentProject = projectMap.get(id);
				return currentProject && currentProject.status !== ProjectStatus.Archived;
			});

			if (validIds.length === 0) return;

			await dbService.updateProjectStatuses(validIds, ProjectStatus.Archived);

			// Update local state directly instead of re-fetching
			for (const id of validIds) {
				const project = projectMap.get(id);
				if (project) {
					project.status = ProjectStatus.Archived;
					this.upsertProject(project);
				}
			}

			explorerState.syncProjects(this.list);
			await Promise.all(validIds.map((id) => explorerState.refreshProjectBranch(id)));

			toast.success(
				`Successfully archived ${validIds.length} RFQ${validIds.length === 1 ? '' : 's'}`
			);
		} catch (error) {
			await errorState.catchError(error, `Bulk archive (${ids.length} RFQs)`);
		}
	}

	async bulkRestoreProjects(ids: string[]): Promise<void> {
		try {
			const projectMap = new Map(this.list.map((p) => [p.id, p]));
			const validIds = ids.filter((id) => {
				const currentProject = projectMap.get(id);
				return currentProject && currentProject.status === ProjectStatus.Archived;
			});

			if (validIds.length === 0) return;

			await dbService.updateProjectStatuses(validIds, ProjectStatus.Open);

			// Update local state directly instead of re-fetching
			for (const id of validIds) {
				const project = projectMap.get(id);
				if (project) {
					project.status = ProjectStatus.Open;
					this.upsertProject(project);
				}
			}

			explorerState.syncProjects(this.list);
			await Promise.all(validIds.map((id) => explorerState.refreshProjectBranch(id)));

			toast.success(
				`Successfully restored ${validIds.length} RFQ${validIds.length === 1 ? '' : 's'}`
			);
		} catch (error) {
			await errorState.catchError(error, `Bulk restore (${ids.length} RFQs)`);
		}
	}

	/** Delete a project and clear active selection if needed. */
	async deleteProject(id: string): Promise<void> {
		const currentProject = this.list.find((project) => project.id === id);
		if (currentProject?.status !== ProjectStatus.Archived) {
			await errorState.catchError(
				new Error('Archive the RFQ before permanently deleting it.'),
				`Delete project ${id}`
			);
			return;
		}

		try {
			const rfqNumber = currentProject?.rfq_number ?? id;

			await dbService.deleteProject(id);
			if (this.activeId === id) {
				await this.setActive(null);
			}
			this.removeProjects([id]);
			explorerState.removeProjects([id]);
			appTabsState.handleDeletedProjects([id]);
			toast.success(`RFQ ${rfqNumber} deleted`);
		} catch (error) {
			await errorState.catchError(error, `Delete project ${id}`);
		}
	}

	/** Bulk-delete multiple projects and fire a single summary toast. */
	async bulkDeleteProjects(ids: string[]): Promise<void> {
		const listMap = new Map(this.list.map((c) => [c.id, c]));
		const invalidIds = ids.filter((id) => {
			const project = listMap.get(id);
			return project?.status !== ProjectStatus.Archived;
		});
		if (invalidIds.length > 0) {
			await errorState.catchError(
				new Error('Archive RFQs before permanently deleting them.'),
				`Bulk delete (${ids.length} records)`
			);
			return;
		}

		try {
			await Promise.all(
				ids.map(async (id) => {
					await dbService.deleteProject(id);
					if (this.activeId === id) {
						await this.setActive(null);
					}
				})
			);
			this.removeProjects(ids);
			explorerState.removeProjects(ids);
			appTabsState.handleDeletedProjects(ids);
			toast.success(`Successfully deleted ${ids.length} RFQ${ids.length === 1 ? '' : 's'}`);
		} catch (error) {
			await errorState.catchError(error, `Bulk delete (${ids.length} records)`);
		}
	}
}

export const projectsState = new ProjectsState();
