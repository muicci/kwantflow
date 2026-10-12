import { invoke } from '@tauri-apps/api/core';
import { toast } from 'svelte-sonner';
import { dbService } from '../services/db';
import { createLogger } from '../services/logger.js';
import { errorState } from './errors.svelte';
import type { CostComponentPreset } from '$lib/types/index.js';
import type { CostComponentPresetFormValues } from '$lib/schemas/index.js';
import { isTauri } from '../utils/env';
import {
	buildEmptyCostPresetComponents,
	type SetupImportCostPresetRow,
	type SetupImportDuplicateMode
} from '$lib/services/setup-import.js';

type ImportSummary = {
	created: number;
	updated: number;
	skipped: number;
};

const log = createLogger('costComponentPresetsState');

function normaliseLookupValue(value: string | null | undefined): string {
	return (value ?? '').trim().toLowerCase();
}

function findAliasMatch(aliases: string[] | undefined, target: string): boolean {
	return (aliases ?? []).some((alias) => normaliseLookupValue(alias) === target);
}

function buildImportToast(summary: ImportSummary): string {
	if (summary.updated === 0 && summary.skipped === 0) {
		return `Imported ${summary.created} cost preset${summary.created === 1 ? '' : 's'}`;
	}

	const parts: string[] = [];
	if (summary.created > 0) parts.push(`${summary.created} imported`);
	if (summary.updated > 0) parts.push(`${summary.updated} updated`);
	if (summary.skipped > 0) parts.push(`${summary.skipped} kept existing`);
	return `Cost preset import complete: ${parts.join(' · ')}`;
}

class CostComponentPresetsState {
	private upsertPreset(nextPreset: CostComponentPreset): void {
		const nextList = this.list.filter((item) => item.id !== nextPreset.id).concat(nextPreset);
		this.list = nextList.sort((left, right) => left.name.localeCompare(right.name));
	}

	private removePresets(ids: string[]): void {
		const removedIds = new Set(ids);
		this.list = this.list.filter((item) => !removedIds.has(item.id));
	}

	private findMatchingPreset(row: CostComponentPresetFormValues): CostComponentPreset | null {
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

	list: CostComponentPreset[] = $state([]);
	searchQuery = $state('');

	filtered: CostComponentPreset[] = $derived.by(() => {
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
			this.list = await dbService.getCostComponentPresets(true);
		} catch (error) {
			log.error('Failed to hydrate', error);
		}
	}

	async refresh(): Promise<void> {
		try {
			this.list = await dbService.getCostComponentPresets(true);
		} catch (error) {
			log.error('Failed to refresh', error);
		}
	}

	replaceFromSnapshot(items: CostComponentPreset[]): void {
		this.list = [...items];
	}

	async updatePreset(id: string, data: CostComponentPresetFormValues): Promise<void> {
		try {
			const current = this.list.find((item) => item.id === id);
			if (!current) throw new Error('Preset not found');
			await dbService.updateCostComponentPreset(id, data, current.components);
			const updatedPreset = await dbService.getCostComponentPresetById(id);
			if (updatedPreset) {
				this.upsertPreset(updatedPreset);
			} else {
				await this.refresh();
			}
			toast.success(`Cost preset "${data.name}" updated`);
		} catch (error) {
			await errorState.catchError(error, `Update cost preset "${data.name}"`);
			throw error;
		}
	}

	async addPreset(data: CostComponentPresetFormValues): Promise<void> {
		try {
			const id = isTauri() ? await invoke<string>('generate_uuid') : crypto.randomUUID();
			await dbService.addCostComponentPreset(id, data, buildEmptyCostPresetComponents());
			const createdPreset = await dbService.getCostComponentPresetById(id);
			if (createdPreset) {
				this.upsertPreset(createdPreset);
			} else {
				await this.refresh();
			}
			toast.success(`Cost preset "${data.name}" created`);
		} catch (error) {
			await errorState.catchError(error, `Create cost preset "${data.name}"`);
			throw error;
		}
	}

	async duplicatePreset(id: string): Promise<void> {
		try {
			const current = this.list.find((item) => item.id === id);
			if (!current) throw new Error('Preset not found');
			const nextId = isTauri() ? await invoke<string>('generate_uuid') : crypto.randomUUID();
			await dbService.addCostComponentPreset(
				nextId,
				{
					code: '',
					name: `${current.name} Copy`,
					description: current.description,
					aliases: current.aliases ?? [],
					is_active: current.is_active
				},
				current.components
			);
			const duplicatedPreset = await dbService.getCostComponentPresetById(nextId);
			if (duplicatedPreset) {
				this.upsertPreset(duplicatedPreset);
			} else {
				await this.refresh();
			}
			toast.success(`Cost preset "${current.name}" duplicated`);
		} catch (error) {
			await errorState.catchError(error, `Duplicate cost preset ${id}`);
		}
	}

	async deletePreset(id: string): Promise<void> {
		try {
			const name = this.list.find((item) => item.id === id)?.name ?? id;
			await dbService.deleteCostComponentPreset(id);
			this.removePresets([id]);
			toast.success(`Cost preset "${name}" deleted`);
		} catch (error) {
			await errorState.catchError(error, `Delete cost preset ${id}`);
		}
	}

	async bulkDeletePresets(ids: string[]): Promise<void> {
		try {
			await dbService.bulkDeleteCostComponentPresets(ids);
			this.removePresets(ids);
			toast.success(`Successfully deleted ${ids.length} cost preset${ids.length > 1 ? 's' : ''}`);
		} catch (error) {
			await errorState.catchError(error, `Bulk delete (${ids.length} cost presets)`);
		}
	}

	async importCostComponentPresets(
		rows: SetupImportCostPresetRow[],
		mode: SetupImportDuplicateMode = 'keep_existing',
		options: { feedback?: boolean } = {}
	): Promise<ImportSummary> {
		const feedback = options.feedback !== false;
		const summary: ImportSummary = { created: 0, updated: 0, skipped: 0 };
		try {
			for (const row of rows) {
				const existingPreset = this.findMatchingPreset(row);
				if (existingPreset) {
					if (mode === 'keep_existing') {
						summary.skipped += 1;
						continue;
					}

					await dbService.updateCostComponentPreset(
						existingPreset.id,
						row,
						row.components_json ?? existingPreset.components
					);
					const updatedPreset = await dbService.getCostComponentPresetById(existingPreset.id);
					if (updatedPreset) {
						this.upsertPreset(updatedPreset);
					} else {
						await this.refresh();
					}
					summary.updated += 1;
					continue;
				}

				const id = isTauri() ? await invoke<string>('generate_uuid') : crypto.randomUUID();
				await dbService.addCostComponentPreset(
					id,
					row,
					row.components_json ?? buildEmptyCostPresetComponents()
				);
				const createdPreset = await dbService.getCostComponentPresetById(id);
				if (createdPreset) {
					this.upsertPreset(createdPreset);
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
				await errorState.catchError(error, `Import ${rows.length} cost presets`);
			}
			throw error;
		}
	}
}

export const costComponentPresetsState = new CostComponentPresetsState();
