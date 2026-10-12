import { SvelteMap } from 'svelte/reactivity';
import { dbService } from '$lib/services/db.js';
import { createLogger } from '$lib/services/logger.js';
import { errorState } from './errors.svelte.js';
import type { ExplorerPreviewFile, ExplorerProjectChildren, Project } from '$lib/types/index.js';

const log = createLogger('explorerState');

class ExplorerState {
	private hydratePromise: Promise<void> | null = null;
	private branchRequests = new SvelteMap<string, Promise<void>>();

	projects: Project[] = $state([]);
	projectChildren: Record<string, ExplorerProjectChildren | undefined> = $state({});
	loadingProjectIds: string[] = $state.raw([]);
	isHydrated = $state(false);
	isPreparingSearchTree = $state(false);
	hasLoadedFullTree = $state(false);

	private sortProjects(projects: Project[]): Project[] {
		return [...projects].sort((left, right) => {
			if (left.sort_order !== right.sort_order) {
				return left.sort_order - right.sort_order;
			}

			return right.created_at.localeCompare(left.created_at);
		});
	}

	async ensureHydrated(): Promise<void> {
		if (this.isHydrated) {
			log.debug('Skipped explorer hydration because state is already hydrated');
			return;
		}
		if (this.hydratePromise) {
			log.debug('Joined in-flight explorer hydration request');
			await this.hydratePromise;
			return;
		}

		this.hydratePromise = (async () => {
			try {
				this.projects = this.sortProjects(await dbService.getExplorerProjectSummaries());
				this.isHydrated = true;
				log.info('Hydrated explorer project summaries', {
					projectCount: this.projects.length
				});
			} catch (error) {
				log.error('Failed to hydrate explorer project summaries', { error });
				await errorState.catchError(error, 'Load Explorer');
			} finally {
				this.hydratePromise = null;
			}
		})();

		await this.hydratePromise;
	}

	private setProjectLoading(projectId: string, loading: boolean): void {
		this.loadingProjectIds = loading
			? [...new Set([...this.loadingProjectIds, projectId])]
			: this.loadingProjectIds.filter((id) => id !== projectId);
	}

	isProjectLoading(projectId: string): boolean {
		return this.loadingProjectIds.includes(projectId);
	}

	syncProjects(projects: Project[]): void {
		if (!this.isHydrated) return;

		const nextProjects = this.sortProjects(projects);
		const nextProjectIds = new Set(nextProjects.map((project) => project.id));
		const nextChildren: Record<string, ExplorerProjectChildren | undefined> = {};

		for (const projectId of Object.keys(this.projectChildren)) {
			if (nextProjectIds.has(projectId)) {
				nextChildren[projectId] = this.projectChildren[projectId];
			}
		}

		this.projects = nextProjects;
		this.projectChildren = nextChildren;
		this.loadingProjectIds = this.loadingProjectIds.filter((projectId) =>
			nextProjectIds.has(projectId)
		);
	}

	private shouldKeepBranchFresh(projectId: string): boolean {
		return this.hasLoadedFullTree || Boolean(this.projectChildren[projectId]?.loaded);
	}

	async loadProjectBranch(projectId: string, options: { force?: boolean } = {}): Promise<void> {
		if (this.projectChildren[projectId]?.loaded && !options.force) {
			log.debug('Skipped explorer branch load because branch is already loaded', { projectId });
			return;
		}

		const existingRequest = this.branchRequests.get(projectId);
		if (existingRequest) {
			log.debug('Joined in-flight explorer branch load', { projectId });
			await existingRequest;
			return;
		}

		this.setProjectLoading(projectId, true);

		const request = (async () => {
			try {
				this.projectChildren = {
					...this.projectChildren,
					[projectId]: await dbService.getExplorerProjectBranch(projectId)
				};
				log.info('Loaded explorer project branch', {
					projectId,
					forced: options.force ?? false
				});
			} catch (error) {
				log.error('Failed to load explorer project branch', { projectId, error });
				await errorState.catchError(error, 'Load Explorer files');
			} finally {
				this.setProjectLoading(projectId, false);
				this.branchRequests.delete(projectId);
			}
		})();

		this.branchRequests.set(projectId, request);
		await request;
	}

	async prepareSearchTree(query: string): Promise<void> {
		const trimmedQuery = query.trim();
		if (trimmedQuery.length === 0) {
			log.debug('Skipped explorer search tree preparation because query is empty');
			return;
		}

		await this.ensureHydrated();
		const pendingProjectIds = this.projects
			.map((project) => project.id)
			.filter((projectId) => !this.projectChildren[projectId]?.loaded);
		if (pendingProjectIds.length === 0) {
			this.hasLoadedFullTree = true;
			log.info('Explorer search tree already fully loaded', {
				query: trimmedQuery,
				projectCount: this.projects.length
			});
			return;
		}

		this.isPreparingSearchTree = true;
		try {
			await Promise.all(pendingProjectIds.map((projectId) => this.loadProjectBranch(projectId)));
			this.hasLoadedFullTree = true;
			log.info('Prepared explorer search tree', {
				query: trimmedQuery,
				projectCount: pendingProjectIds.length
			});
		} finally {
			this.isPreparingSearchTree = false;
		}
	}

	async refreshProjectBranch(projectId: string): Promise<void> {
		await this.ensureHydrated();
		if (!this.shouldKeepBranchFresh(projectId)) return;
		await this.loadProjectBranch(projectId, { force: true });
	}

	async getPreviewFile(fileId: string): Promise<ExplorerPreviewFile | null> {
		return dbService.getExplorerPreviewFile(fileId);
	}

	removeProjects(projectIds: string[]): void {
		if (projectIds.length === 0) return;

		const removedIds = new Set(projectIds);
		this.projects = this.projects.filter((project) => !removedIds.has(project.id));
		this.loadingProjectIds = this.loadingProjectIds.filter(
			(projectId) => !removedIds.has(projectId)
		);
		this.projectChildren = {
			...Object.fromEntries(
				Object.entries(this.projectChildren).filter(([projectId]) => !removedIds.has(projectId))
			)
		};
	}

	reset(): void {
		this.projects = [];
		this.projectChildren = {};
		this.loadingProjectIds = [];
		this.isHydrated = false;
		this.isPreparingSearchTree = false;
		this.hasLoadedFullTree = false;
		this.hydratePromise = null;
		this.branchRequests.clear();
	}
}

export const explorerState = new ExplorerState();
