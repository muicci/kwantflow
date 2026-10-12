import { invoke } from '@tauri-apps/api/core';
import { toast } from 'svelte-sonner';
import { dbService } from '../services/db';
import { createLogger } from '../services/logger.js';
import { errorState } from './errors.svelte';
import type { MaterialCatalogueItem } from '$lib/types/index.js';
import type { MaterialCatalogItemFormValues } from '$lib/schemas/index.js';
import { isTauri } from '../utils/env';
import { buildDuplicateCode, buildDuplicateName } from '$lib/utils/duplicate-records.js';
import type { SetupImportDuplicateMode } from '$lib/services/setup-import.js';

type ImportSummary = {
	created: number;
	updated: number;
	skipped: number;
};

const log = createLogger('materialsState');

function normaliseLookupValue(value: string | null | undefined): string {
	return (value ?? '').trim().toLowerCase();
}

function buildImportToast(summary: ImportSummary): string {
	if (summary.updated === 0 && summary.skipped === 0) {
		return `Imported ${summary.created} material${summary.created === 1 ? '' : 's'}`;
	}

	const parts: string[] = [];
	if (summary.created > 0) parts.push(`${summary.created} imported`);
	if (summary.updated > 0) parts.push(`${summary.updated} updated`);
	if (summary.skipped > 0) parts.push(`${summary.skipped} kept existing`);
	return `Material import complete: ${parts.join(' · ')}`;
}

class MaterialsState {
	private upsertMaterial(nextMaterial: MaterialCatalogueItem): void {
		const nextList = this.list.filter((item) => item.id !== nextMaterial.id).concat(nextMaterial);
		this.list = nextList.sort((left, right) => left.name.localeCompare(right.name));
	}

	private removeMaterials(ids: string[]): void {
		const removedIds = new Set(ids);
		this.list = this.list.filter((item) => !removedIds.has(item.id));
	}

	private findMatchingMaterial(row: MaterialCatalogItemFormValues): MaterialCatalogueItem | null {
		const normalizedCode = normaliseLookupValue(row.code);
		if (normalizedCode) {
			const codeMatch = this.list.find(
				(item) => normaliseLookupValue(item.code) === normalizedCode
			);
			if (codeMatch) return codeMatch;
		}

		const normalizedName = normaliseLookupValue(row.name);
		return this.list.find((item) => normaliseLookupValue(item.name) === normalizedName) ?? null;
	}

	list: MaterialCatalogueItem[] = $state([]);
	searchQuery = $state('');

	filtered: MaterialCatalogueItem[] = $derived.by(() => {
		if (!this.searchQuery.trim()) return this.list;
		const q = this.searchQuery.toLowerCase().trim();
		return this.list.filter(
			(item) =>
				item.name.toLowerCase().includes(q) ||
				(item.code ?? '').toLowerCase().includes(q) ||
				(item.category ?? '').toLowerCase().includes(q) ||
				(item.specification ?? '').toLowerCase().includes(q) ||
				item.unit.toLowerCase().includes(q)
		);
	});

	async hydrate(): Promise<void> {
		try {
			this.list = await dbService.getMaterialCatalogueItems(true);
		} catch (error) {
			log.error('Failed to hydrate', error);
		}
	}

	async refresh(): Promise<void> {
		try {
			this.list = await dbService.getMaterialCatalogueItems(true);
		} catch (error) {
			log.error('Failed to refresh', error);
		}
	}

	async replaceLinkedCompanies(materialId: string, companyIds: string[]): Promise<void> {
		try {
			await dbService.replaceCatalogueRecordCompanyLinks('materials', materialId, companyIds);
			await this.refresh();
		} catch (error) {
			await errorState.catchError(error, 'Update material company relationships');
			throw error;
		}
	}

	async addMaterial(data: MaterialCatalogItemFormValues): Promise<string> {
		try {
			const id = isTauri() ? await invoke<string>('generate_uuid') : crypto.randomUUID();
			await dbService.addMaterialCatalogueItem(id, data);
			const createdMaterial = await dbService.getMaterialCatalogueItemById(id);
			if (createdMaterial) {
				this.upsertMaterial(createdMaterial);
			} else {
				await this.refresh();
			}
			toast.success(`Material ${data.name} created`);
			return id;
		} catch (error) {
			await errorState.catchError(error, `Create material ${data.name}`);
			throw error;
		}
	}

	async updateMaterial(id: string, data: MaterialCatalogItemFormValues): Promise<void> {
		try {
			await dbService.updateMaterialCatalogueItem(id, data);
			const updatedMaterial = await dbService.getMaterialCatalogueItemById(id);
			if (updatedMaterial) {
				this.upsertMaterial(updatedMaterial);
			} else {
				await this.refresh();
			}
			toast.success(`Material "${data.name}" updated`);
		} catch (error) {
			await errorState.catchError(error, `Update material "${data.name}"`);
			throw error;
		}
	}

	async duplicateMaterial(id: string): Promise<void> {
		try {
			const current = this.list.find((item) => item.id === id);
			if (!current) throw new Error('Material not found');
			const nextId = isTauri() ? await invoke<string>('generate_uuid') : crypto.randomUUID();
			await dbService.addMaterialCatalogueItem(nextId, {
				code: buildDuplicateCode(
					current.code,
					this.list.filter((item) => item.id !== id).map((item) => item.code)
				),
				name: buildDuplicateName(
					current.name,
					this.list.filter((item) => item.id !== id).map((item) => item.name)
				),
				category: current.category ?? '',
				specification: current.specification ?? '',
				aliases: current.aliases ?? [],
				unit: current.unit,
				default_rate: current.default_rate,
				is_active: current.is_active
			});
			const duplicatedMaterial = await dbService.getMaterialCatalogueItemById(nextId);
			if (duplicatedMaterial) {
				this.upsertMaterial(duplicatedMaterial);
			} else {
				await this.refresh();
			}
			toast.success(`Material "${current.name}" duplicated`);
		} catch (error) {
			await errorState.catchError(error, `Duplicate material ${id}`);
		}
	}

	async deleteMaterial(id: string): Promise<void> {
		try {
			const name = this.list.find((item) => item.id === id)?.name ?? id;
			await dbService.deleteMaterialCatalogueItem(id);
			this.removeMaterials([id]);
			toast.success(`Material "${name}" deleted`);
		} catch (error) {
			await errorState.catchError(error, `Delete material ${id}`);
		}
	}

	async bulkDeleteMaterials(ids: string[]): Promise<void> {
		try {
			await dbService.bulkDeleteMaterialCatalogueItems(ids);
			this.removeMaterials(ids);
			toast.success(`Successfully deleted ${ids.length} material${ids.length > 1 ? 's' : ''}`);
		} catch (error) {
			await errorState.catchError(error, `Bulk delete (${ids.length} materials)`);
		}
	}

	async importMaterials(
		rows: MaterialCatalogItemFormValues[],
		mode: SetupImportDuplicateMode = 'keep_existing',
		options: { feedback?: boolean } = {}
	): Promise<ImportSummary> {
		const feedback = options.feedback !== false;
		const summary: ImportSummary = { created: 0, updated: 0, skipped: 0 };
		try {
			for (const row of rows) {
				const existingMaterial = this.findMatchingMaterial(row);
				if (existingMaterial) {
					if (mode === 'keep_existing') {
						summary.skipped += 1;
						continue;
					}

					await dbService.updateMaterialCatalogueItem(existingMaterial.id, row);
					const updatedMaterial = await dbService.getMaterialCatalogueItemById(existingMaterial.id);
					if (updatedMaterial) {
						this.upsertMaterial(updatedMaterial);
					} else {
						await this.refresh();
					}
					summary.updated += 1;
					continue;
				}

				const id = isTauri() ? await invoke<string>('generate_uuid') : crypto.randomUUID();
				await dbService.addMaterialCatalogueItem(id, row);
				const createdMaterial = await dbService.getMaterialCatalogueItemById(id);
				if (createdMaterial) {
					this.upsertMaterial(createdMaterial);
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
				await errorState.catchError(error, `Import ${rows.length} materials`);
			}
			throw error;
		}
	}
}

export const materialsState = new MaterialsState();
