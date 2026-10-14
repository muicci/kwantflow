import { toast } from 'svelte-sonner';
import { dbService } from '../services/db';
import { createLogger } from '../services/logger.js';
import { errorState } from './errors.svelte';
import type { WbsNode } from '$lib/types/index.js';
import type { WbsNodeFormValues } from '$lib/schemas/index.js';

const log = createLogger('wbsState');

class WbsState {
	private hydrateToken = 0;

	private sortNodes(items: WbsNode[]): WbsNode[] {
		return [...items].sort(
			(left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name)
		);
	}

	private upsertNode(nextNode: WbsNode): void {
		this.list = this.sortNodes(
			this.list.filter((item) => item.id !== nextNode.id).concat(nextNode)
		);
	}

	private removeNodes(ids: string[]): void {
		const removedIds = [...ids];
		let changed = true;
		while (changed) {
			changed = false;
			for (const item of this.list) {
				if (
					item.parent_id &&
					removedIds.includes(item.parent_id) &&
					!removedIds.includes(item.id)
				) {
					removedIds.push(item.id);
					changed = true;
				}
			}
		}
		this.list = this.list.filter((item) => !removedIds.includes(item.id));
	}

	list: WbsNode[] = $state([]);
	projectId: string | null = $state(null);
	searchQuery = $state('');

	filtered: WbsNode[] = $derived.by(() => {
		if (!this.searchQuery.trim()) return this.list;
		const q = this.searchQuery.toLowerCase().trim();
		return this.list.filter(
			(item) =>
				item.name.toLowerCase().includes(q) ||
				(item.code ?? '').toLowerCase().includes(q) ||
				item.type.toLowerCase().includes(q)
		);
	});

	async hydrate(projectId: string): Promise<void> {
		const hydrateToken = ++this.hydrateToken;
		if (this.projectId !== projectId) {
			this.searchQuery = '';
			this.list = [];
		}
		this.projectId = projectId;
		try {
			const nextNodes = await dbService.getWbsNodes(projectId);
			if (this.projectId === projectId && hydrateToken === this.hydrateToken) {
				this.list = nextNodes;
			}
		} catch (error) {
			log.error('Failed to hydrate', error);
		}
	}

	async refresh(): Promise<void> {
		if (!this.projectId) {
			this.list = [];
			return;
		}
		await this.hydrate(this.projectId);
	}

	async addNode(projectId: string, data: WbsNodeFormValues): Promise<void> {
		try {
			const id = crypto.randomUUID();
			await dbService.addWbsNode(id, projectId, data);
			const createdNode = await dbService.getWbsNodeById(id);
			if (createdNode && this.projectId === projectId) {
				this.upsertNode(createdNode);
			} else if (this.projectId === projectId) {
				await this.hydrate(projectId);
			}
			toast.success(`Structure node ${data.name} created`);
		} catch (error) {
			await errorState.catchError(error, `Create structure node ${data.name}`);
			throw error;
		}
	}

	async updateNode(id: string, data: WbsNodeFormValues): Promise<void> {
		try {
			await dbService.updateWbsNode(id, data);
			const updatedNode = await dbService.getWbsNodeById(id);
			if (updatedNode && this.projectId === updatedNode.project_id) {
				this.upsertNode(updatedNode);
			} else {
				await this.refresh();
			}
			toast.success(`Structure node "${data.name}" updated`);
		} catch (error) {
			await errorState.catchError(error, `Update structure node "${data.name}"`);
			throw error;
		}
	}

	async deleteNode(id: string): Promise<void> {
		try {
			const name = this.list.find((item) => item.id === id)?.name ?? id;
			await dbService.deleteWbsNode(id);
			this.removeNodes([id]);
			toast.success(`Structure node "${name}" deleted`);
		} catch (error) {
			await errorState.catchError(error, `Delete structure node ${id}`);
		}
	}

	async bulkDeleteNodes(ids: string[]): Promise<void> {
		try {
			await dbService.bulkDeleteWbsNodes(ids);
			this.removeNodes(ids);
			toast.success(
				`Successfully deleted ${ids.length} Structure node${ids.length > 1 ? 's' : ''}`
			);
		} catch (error) {
			await errorState.catchError(error, `Bulk delete (${ids.length} Structure nodes)`);
		}
	}
}

export const wbsState = new WbsState();
