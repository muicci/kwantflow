import { invoke } from '@tauri-apps/api/core';
import { toast } from 'svelte-sonner';
import { dbService } from '../services/db';
import { createLogger } from '../services/logger.js';
import { errorState } from './errors.svelte';
import type { ProjectStructureTemplate } from '$lib/types/index.js';
import type { ProjectStructureTemplateFormValues } from '$lib/schemas/index.js';
import { isTauri } from '../utils/env';

const log = createLogger('projectStructureTemplatesState');

class ProjectStructureTemplatesState {
	private upsertTemplate(nextTemplate: ProjectStructureTemplate): void {
		const nextList = this.list.filter((item) => item.id !== nextTemplate.id).concat(nextTemplate);
		this.list = nextList.sort((left, right) => left.name.localeCompare(right.name));
	}

	private removeTemplates(ids: string[]): void {
		this.list = this.list.filter((item) => !ids.includes(item.id));
	}

	list: ProjectStructureTemplate[] = $state([]);
	searchQuery = $state('');

	filtered: ProjectStructureTemplate[] = $derived.by(() => {
		if (!this.searchQuery.trim()) return this.list;
		const q = this.searchQuery.toLowerCase().trim();
		return this.list.filter(
			(item) =>
				item.name.toLowerCase().includes(q) ||
				(item.code ?? '').toLowerCase().includes(q) ||
				item.description.toLowerCase().includes(q)
		);
	});

	async hydrate(): Promise<void> {
		try {
			this.list = await dbService.getProjectStructureTemplates(true);
		} catch (error) {
			log.error('Failed to hydrate', error);
		}
	}

	async refresh(): Promise<void> {
		try {
			this.list = await dbService.getProjectStructureTemplates(true);
		} catch (error) {
			log.error('Failed to refresh', error);
		}
	}

	replaceFromSnapshot(items: ProjectStructureTemplate[]): void {
		this.list = [...items];
	}

	async createTemplate(
		data: ProjectStructureTemplateFormValues,
		nodes: ProjectStructureTemplate['nodes']
	): Promise<void> {
		try {
			const id = isTauri() ? await invoke<string>('generate_uuid') : crypto.randomUUID();
			await dbService.addProjectStructureTemplate(id, data, nodes);
			const createdTemplate = await dbService.getProjectStructureTemplateById(id);
			if (createdTemplate) {
				this.upsertTemplate(createdTemplate);
			} else {
				await this.refresh();
			}
			toast.success(`Project structure template "${data.name}" saved`);
		} catch (error) {
			await errorState.catchError(error, `Create project structure template "${data.name}"`);
			throw error;
		}
	}

	async updateTemplate(id: string, data: ProjectStructureTemplateFormValues): Promise<void> {
		try {
			const current = this.list.find((item) => item.id === id);
			if (!current) throw new Error('Template not found');
			await dbService.updateProjectStructureTemplate(id, data, current.nodes);
			const updatedTemplate = await dbService.getProjectStructureTemplateById(id);
			if (updatedTemplate) {
				this.upsertTemplate(updatedTemplate);
			} else {
				await this.refresh();
			}
			toast.success(`Project structure template "${data.name}" updated`);
		} catch (error) {
			await errorState.catchError(error, `Update project structure template "${data.name}"`);
			throw error;
		}
	}

	async updateTemplateContent(
		id: string,
		data: ProjectStructureTemplateFormValues,
		nodes: ProjectStructureTemplate['nodes']
	): Promise<void> {
		try {
			await dbService.updateProjectStructureTemplate(id, data, nodes);
			const updatedTemplate = await dbService.getProjectStructureTemplateById(id);
			if (updatedTemplate) {
				this.upsertTemplate(updatedTemplate);
			} else {
				await this.refresh();
			}
			toast.success(`Project structure template "${data.name}" updated`);
		} catch (error) {
			await errorState.catchError(error, `Update project structure template "${data.name}"`);
			throw error;
		}
	}

	async saveTemplateNodes(id: string, nodes: ProjectStructureTemplate['nodes']): Promise<void> {
		try {
			const current = this.list.find((item) => item.id === id);
			if (!current) throw new Error('Template not found');
			await dbService.updateProjectStructureTemplate(
				id,
				{
					code: current.code ?? '',
					name: current.name,
					description: current.description,
					is_active: current.is_active
				},
				nodes
			);
			const updatedTemplate = await dbService.getProjectStructureTemplateById(id);
			if (updatedTemplate) {
				this.upsertTemplate(updatedTemplate);
			} else {
				await this.refresh();
			}
			toast.success(`Project structure template "${current.name}" updated`);
		} catch (error) {
			await errorState.catchError(error, `Update project structure template nodes ${id}`);
			throw error;
		}
	}

	async duplicateTemplate(id: string): Promise<void> {
		try {
			const current = this.list.find((item) => item.id === id);
			if (!current) throw new Error('Template not found');
			const nextId = isTauri() ? await invoke<string>('generate_uuid') : crypto.randomUUID();
			const duplicatedNodes = current.nodes.map((node) => ({
				...node,
				id: crypto.randomUUID()
			}));
			const nodeIdMap = Object.fromEntries(
				current.nodes.map((node, index) => [node.id, duplicatedNodes[index]!.id])
			);
			const normalizedNodes = duplicatedNodes.map((node, index) => ({
				...node,
				template_id: nextId,
				parent_id: current.nodes[index]?.parent_id
					? (nodeIdMap[current.nodes[index]!.parent_id!] ?? null)
					: null
			}));
			await dbService.addProjectStructureTemplate(
				nextId,
				{
					code: '',
					name: `${current.name} Copy`,
					description: current.description,
					is_active: current.is_active
				},
				normalizedNodes
			);
			const duplicatedTemplate = await dbService.getProjectStructureTemplateById(nextId);
			if (duplicatedTemplate) {
				this.upsertTemplate(duplicatedTemplate);
			} else {
				await this.refresh();
			}
			toast.success(`Project structure template "${current.name}" duplicated`);
		} catch (error) {
			await errorState.catchError(error, `Duplicate project structure template ${id}`);
		}
	}

	async deleteTemplate(id: string): Promise<void> {
		try {
			const name = this.list.find((item) => item.id === id)?.name ?? id;
			await dbService.deleteProjectStructureTemplate(id);
			this.removeTemplates([id]);
			toast.success(`Project structure template "${name}" deleted`);
		} catch (error) {
			await errorState.catchError(error, `Delete project structure template ${id}`);
		}
	}

	async bulkDeleteTemplates(ids: string[]): Promise<void> {
		try {
			await dbService.bulkDeleteProjectStructureTemplates(ids);
			this.removeTemplates(ids);
			toast.success(
				`Successfully deleted ${ids.length} project structure template${ids.length > 1 ? 's' : ''}`
			);
		} catch (error) {
			await errorState.catchError(error, `Bulk delete (${ids.length} project structure templates)`);
		}
	}

	async applyTemplateToProject(templateId: string, projectId: string): Promise<void> {
		try {
			await dbService.applyProjectStructureTemplateToProject(templateId, projectId);
			const name = this.list.find((item) => item.id === templateId)?.name ?? templateId;
			toast.success(`Project structure template "${name}" applied`);
		} catch (error) {
			await errorState.catchError(error, `Apply project structure template ${templateId}`);
			throw error;
		}
	}
}

export const projectStructureTemplatesState = new ProjectStructureTemplatesState();
