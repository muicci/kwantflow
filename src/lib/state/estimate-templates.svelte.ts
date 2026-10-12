import { invoke } from '@tauri-apps/api/core';
import { toast } from 'svelte-sonner';
import { dbService } from '../services/db';
import { createLogger } from '../services/logger.js';
import { errorState } from './errors.svelte';
import type { EstimateTemplate } from '$lib/types/index.js';
import type { EstimateTemplateFormValues } from '$lib/schemas/index.js';
import { isTauri } from '../utils/env';
import {
	buildEmptyEstimateTemplatePayload,
	type SetupImportDuplicateMode,
	type SetupImportEstimateTemplateRow
} from '$lib/services/setup-import.js';

type ImportSummary = {
	created: number;
	updated: number;
	skipped: number;
};

const log = createLogger('estimateTemplatesState');

function normaliseLookupValue(value: string | null | undefined): string {
	return (value ?? '').trim().toLowerCase();
}

function findAliasMatch(aliases: string[] | undefined, target: string): boolean {
	return (aliases ?? []).some((alias) => normaliseLookupValue(alias) === target);
}

function buildImportToast(summary: ImportSummary): string {
	if (summary.updated === 0 && summary.skipped === 0) {
		return `Imported ${summary.created} estimate template${summary.created === 1 ? '' : 's'}`;
	}

	const parts: string[] = [];
	if (summary.created > 0) parts.push(`${summary.created} imported`);
	if (summary.updated > 0) parts.push(`${summary.updated} updated`);
	if (summary.skipped > 0) parts.push(`${summary.skipped} kept existing`);
	return `Estimate template import complete: ${parts.join(' · ')}`;
}

class EstimateTemplatesState {
	private upsertTemplate(nextTemplate: EstimateTemplate): void {
		const nextList = this.list.filter((item) => item.id !== nextTemplate.id).concat(nextTemplate);
		this.list = nextList.sort((left, right) => left.name.localeCompare(right.name));
	}

	private removeTemplates(ids: string[]): void {
		const removedIds = new Set(ids);
		this.list = this.list.filter((item) => !removedIds.has(item.id));
	}

	private findMatchingTemplate(row: EstimateTemplateFormValues): EstimateTemplate | null {
		const normalizedCode = normaliseLookupValue(row.code);
		if (normalizedCode) {
			const codeMatch = this.list.find(
				(item) => normaliseLookupValue(item.code) === normalizedCode
			);
			if (codeMatch) return codeMatch;
		}

		const normalizedName = normaliseLookupValue(row.name);
		return (
			this.list.find(
				(item) =>
					normaliseLookupValue(item.name) === normalizedName ||
					findAliasMatch(item.aliases, normalizedName)
			) ?? null
		);
	}

	list: EstimateTemplate[] = $state([]);
	searchQuery = $state('');

	filtered: EstimateTemplate[] = $derived.by(() => {
		if (!this.searchQuery.trim()) return this.list;
		const q = this.searchQuery.toLowerCase().trim();
		return this.list.filter(
			(item) =>
				item.name.toLowerCase().includes(q) ||
				(item.code ?? '').toLowerCase().includes(q) ||
				item.description.toLowerCase().includes(q) ||
				(item.aliases ?? []).some((alias) => alias.toLowerCase().includes(q))
		);
	});

	async hydrate(): Promise<void> {
		try {
			this.list = await dbService.getEstimateTemplates(true);
		} catch (error) {
			log.error('Failed to hydrate', error);
		}
	}

	async refresh(): Promise<void> {
		try {
			this.list = await dbService.getEstimateTemplates(true);
		} catch (error) {
			log.error('Failed to refresh', error);
		}
	}

	replaceFromSnapshot(items: EstimateTemplate[]): void {
		this.list = [...items];
	}

	async updateTemplate(id: string, data: EstimateTemplateFormValues): Promise<void> {
		try {
			const current = this.list.find((item) => item.id === id);
			if (!current) throw new Error('Template not found');
			await dbService.updateEstimateTemplate(id, data, current.estimate);
			const updatedTemplate = await dbService.getEstimateTemplateById(id);
			if (updatedTemplate) {
				this.upsertTemplate(updatedTemplate);
			} else {
				await this.refresh();
			}
			toast.success(`Estimate template "${data.name}" updated`);
		} catch (error) {
			await errorState.catchError(error, `Update estimate template "${data.name}"`);
			throw error;
		}
	}

	async addTemplate(data: EstimateTemplateFormValues): Promise<void> {
		try {
			const id = isTauri() ? await invoke<string>('generate_uuid') : crypto.randomUUID();
			await dbService.addEstimateTemplate(id, data, buildEmptyEstimateTemplatePayload());
			const createdTemplate = await dbService.getEstimateTemplateById(id);
			if (createdTemplate) {
				this.upsertTemplate(createdTemplate);
			} else {
				await this.refresh();
			}
			toast.success(`Estimate template "${data.name}" created`);
		} catch (error) {
			await errorState.catchError(error, `Create estimate template "${data.name}"`);
			throw error;
		}
	}

	async duplicateTemplate(id: string): Promise<void> {
		try {
			const current = this.list.find((item) => item.id === id);
			if (!current) throw new Error('Template not found');
			const nextId = isTauri() ? await invoke<string>('generate_uuid') : crypto.randomUUID();
			await dbService.addEstimateTemplate(
				nextId,
				{
					code: '',
					name: `${current.name} Copy`,
					description: current.description,
					aliases: current.aliases ?? [],
					is_active: current.is_active
				},
				current.estimate
			);
			const duplicatedTemplate = await dbService.getEstimateTemplateById(nextId);
			if (duplicatedTemplate) {
				this.upsertTemplate(duplicatedTemplate);
			} else {
				await this.refresh();
			}
			toast.success(`Estimate template "${current.name}" duplicated`);
		} catch (error) {
			await errorState.catchError(error, `Duplicate estimate template ${id}`);
		}
	}

	async deleteTemplate(id: string): Promise<void> {
		try {
			const name = this.list.find((item) => item.id === id)?.name ?? id;
			await dbService.deleteEstimateTemplate(id);
			this.removeTemplates([id]);
			toast.success(`Estimate template "${name}" deleted`);
		} catch (error) {
			await errorState.catchError(error, `Delete estimate template ${id}`);
		}
	}

	async bulkDeleteTemplates(ids: string[]): Promise<void> {
		try {
			await dbService.bulkDeleteEstimateTemplates(ids);
			this.removeTemplates(ids);
			toast.success(
				`Successfully deleted ${ids.length} estimate template${ids.length > 1 ? 's' : ''}`
			);
		} catch (error) {
			await errorState.catchError(error, `Bulk delete (${ids.length} estimate templates)`);
		}
	}

	async importEstimateTemplates(
		rows: SetupImportEstimateTemplateRow[],
		mode: SetupImportDuplicateMode = 'keep_existing',
		options: { feedback?: boolean } = {}
	): Promise<ImportSummary> {
		const feedback = options.feedback !== false;
		const summary: ImportSummary = { created: 0, updated: 0, skipped: 0 };
		try {
			for (const row of rows) {
				const existingTemplate = this.findMatchingTemplate(row);
				if (existingTemplate) {
					if (mode === 'keep_existing') {
						summary.skipped += 1;
						continue;
					}

					await dbService.updateEstimateTemplate(
						existingTemplate.id,
						row,
						row.estimate_json ?? existingTemplate.estimate
					);
					const updatedTemplate = await dbService.getEstimateTemplateById(existingTemplate.id);
					if (updatedTemplate) {
						this.upsertTemplate(updatedTemplate);
					} else {
						await this.refresh();
					}
					summary.updated += 1;
					continue;
				}

				const id = isTauri() ? await invoke<string>('generate_uuid') : crypto.randomUUID();
				await dbService.addEstimateTemplate(
					id,
					row,
					row.estimate_json ?? buildEmptyEstimateTemplatePayload()
				);
				const createdTemplate = await dbService.getEstimateTemplateById(id);
				if (createdTemplate) {
					this.upsertTemplate(createdTemplate);
				} else {
					await this.refresh();
				}
				summary.created += 1;
			}
			if (feedback) {
				toast.success(buildImportToast(summary));
			}
			return summary;
		} catch (error) {
			if (feedback) {
				await errorState.catchError(error, `Import ${rows.length} estimate templates`);
			}
			throw error;
		}
	}
}

export const estimateTemplatesState = new EstimateTemplatesState();
