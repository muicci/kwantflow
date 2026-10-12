import type { QuoteRevision } from '$lib/types/index.js';
import { dbService } from '$lib/services/db.js';
import { errorState } from './errors.svelte';

class ProjectRevisionHistoryState {
	open = $state(false);
	projectId: string | null = $state(null);
	isHydrated = $state(false);
	revisions: QuoteRevision[] = $state([]);

	async openForProject(projectId: string): Promise<void> {
		this.projectId = projectId;
		this.open = true;
		await this.hydrate(projectId);
	}

	close(): void {
		this.open = false;
	}

	async hydrate(projectId: string): Promise<void> {
		this.isHydrated = false;
		try {
			this.revisions = await dbService.getQuoteRevisions(projectId);
			this.isHydrated = true;
		} catch (error) {
			this.revisions = [];
			await errorState.catchError(error, 'Load quote revisions');
		}
	}
}

export const projectRevisionHistoryState = new ProjectRevisionHistoryState();
