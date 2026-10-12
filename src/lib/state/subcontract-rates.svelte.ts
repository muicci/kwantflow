import { invoke } from '@tauri-apps/api/core';
import { toast } from 'svelte-sonner';

import { dbService } from '../services/db';
import { createLogger } from '../services/logger.js';
import { errorState } from './errors.svelte';
import { isTauri } from '../utils/env';
import { buildDuplicateCode, buildDuplicateName } from '$lib/utils/duplicate-records.js';

import type { SetupImportDuplicateMode } from '$lib/services/setup-import.js';
import type { SubcontractRateCard } from '$lib/types/index.js';
import type { SubcontractRateCardFormValues } from '$lib/schemas/index.js';

type ImportSummary = {
	created: number;
	updated: number;
	skipped: number;
};

const log = createLogger('subcontractRatesState');

function normaliseLookupValue(value: string | null | undefined): string {
	return (value ?? '').trim().toLowerCase();
}

function buildImportToast(summary: ImportSummary): string {
	if (summary.updated === 0 && summary.skipped === 0) {
		return `Imported ${summary.created} subcontract rate${summary.created === 1 ? '' : 's'}`;
	}

	const parts: string[] = [];
	if (summary.created > 0) parts.push(`${summary.created} imported`);
	if (summary.updated > 0) parts.push(`${summary.updated} updated`);
	if (summary.skipped > 0) parts.push(`${summary.skipped} kept existing`);
	return `Subcontract rate import complete: ${parts.join(' · ')}`;
}

class SubcontractRatesState {
	private upsertSubcontractRate(nextRate: SubcontractRateCard): void {
		const nextList = this.list.filter((item) => item.id !== nextRate.id).concat(nextRate);
		this.list = nextList.sort((left, right) => left.name.localeCompare(right.name));
	}

	private removeSubcontractRates(ids: string[]): void {
		const removedIds = new Set(ids);
		this.list = this.list.filter((item) => !removedIds.has(item.id));
	}

	private findMatchingSubcontractRate(
		row: SubcontractRateCardFormValues
	): SubcontractRateCard | null {
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

	list: SubcontractRateCard[] = $state([]);
	searchQuery = $state('');

	filtered: SubcontractRateCard[] = $derived.by(() => {
		if (!this.searchQuery.trim()) return this.list;
		const q = this.searchQuery.toLowerCase().trim();
		return this.list.filter(
			(item) =>
				item.name.toLowerCase().includes(q) ||
				(item.code ?? '').toLowerCase().includes(q) ||
				(item.category ?? '').toLowerCase().includes(q) ||
				item.unit.toLowerCase().includes(q)
		);
	});

	async hydrate(): Promise<void> {
		try {
			this.list = await dbService.getSubcontractRateCards(true);
		} catch (error) {
			log.error('Failed to hydrate', error);
		}
	}

	async refresh(): Promise<void> {
		try {
			this.list = await dbService.getSubcontractRateCards(true);
		} catch (error) {
			log.error('Failed to refresh', error);
		}
	}

	async replaceLinkedCompanies(subcontractRateId: string, companyIds: string[]): Promise<void> {
		try {
			await dbService.replaceCatalogueRecordCompanyLinks(
				'subcontract_rates',
				subcontractRateId,
				companyIds
			);
			await this.refresh();
		} catch (error) {
			await errorState.catchError(error, 'Update subcontract-rate company relationships');
			throw error;
		}
	}

	async addSubcontractRate(data: SubcontractRateCardFormValues): Promise<string> {
		try {
			const id = isTauri() ? await invoke<string>('generate_uuid') : crypto.randomUUID();
			await dbService.addSubcontractRateCard(id, data);
			const createdRate = await dbService.getSubcontractRateCardById(id);
			if (createdRate) {
				this.upsertSubcontractRate(createdRate);
			} else {
				await this.refresh();
			}
			toast.success(`Subcontract rate ${data.name} created`);
			return id;
		} catch (error) {
			await errorState.catchError(error, `Create subcontract rate ${data.name}`);
			throw error;
		}
	}

	async updateSubcontractRate(id: string, data: SubcontractRateCardFormValues): Promise<void> {
		try {
			await dbService.updateSubcontractRateCard(id, data);
			const updatedRate = await dbService.getSubcontractRateCardById(id);
			if (updatedRate) {
				this.upsertSubcontractRate(updatedRate);
			} else {
				await this.refresh();
			}
			toast.success(`Subcontract rate "${data.name}" updated`);
		} catch (error) {
			await errorState.catchError(error, `Update subcontract rate "${data.name}"`);
			throw error;
		}
	}

	async duplicateSubcontractRate(id: string): Promise<void> {
		try {
			const current = this.list.find((item) => item.id === id);
			if (!current) throw new Error('Subcontract rate not found');
			const nextId = isTauri() ? await invoke<string>('generate_uuid') : crypto.randomUUID();
			await dbService.addSubcontractRateCard(nextId, {
				code: buildDuplicateCode(
					current.code,
					this.list.filter((item) => item.id !== id).map((item) => item.code)
				),
				name: buildDuplicateName(
					current.name,
					this.list.filter((item) => item.id !== id).map((item) => item.name)
				),
				category: current.category ?? '',
				aliases: current.aliases ?? [],
				unit: current.unit,
				default_rate: current.default_rate,
				is_active: current.is_active
			});
			const duplicatedRate = await dbService.getSubcontractRateCardById(nextId);
			if (duplicatedRate) {
				this.upsertSubcontractRate(duplicatedRate);
			} else {
				await this.refresh();
			}
			toast.success(`Subcontract rate "${current.name}" duplicated`);
		} catch (error) {
			await errorState.catchError(error, `Duplicate subcontract rate ${id}`);
		}
	}

	async deleteSubcontractRate(id: string): Promise<void> {
		try {
			const name = this.list.find((item) => item.id === id)?.name ?? id;
			await dbService.deleteSubcontractRateCard(id);
			this.removeSubcontractRates([id]);
			toast.success(`Subcontract rate "${name}" deleted`);
		} catch (error) {
			await errorState.catchError(error, `Delete subcontract rate ${id}`);
		}
	}

	async bulkDeleteSubcontractRates(ids: string[]): Promise<void> {
		try {
			await dbService.bulkDeleteSubcontractRateCards(ids);
			this.removeSubcontractRates(ids);
			toast.success(
				`Successfully deleted ${ids.length} subcontract rate${ids.length > 1 ? 's' : ''}`
			);
		} catch (error) {
			await errorState.catchError(error, `Bulk delete (${ids.length} subcontract rates)`);
		}
	}

	async importSubcontractRates(
		rows: SubcontractRateCardFormValues[],
		mode: SetupImportDuplicateMode = 'keep_existing',
		options: { feedback?: boolean } = {}
	): Promise<ImportSummary> {
		const feedback = options.feedback !== false;
		const summary: ImportSummary = { created: 0, updated: 0, skipped: 0 };
		try {
			for (const row of rows) {
				const existingRate = this.findMatchingSubcontractRate(row);
				if (existingRate) {
					if (mode === 'keep_existing') {
						summary.skipped += 1;
						continue;
					}

					await dbService.updateSubcontractRateCard(existingRate.id, row);
					const updatedRate = await dbService.getSubcontractRateCardById(existingRate.id);
					if (updatedRate) {
						this.upsertSubcontractRate(updatedRate);
					} else {
						await this.refresh();
					}
					summary.updated += 1;
					continue;
				}

				const id = isTauri() ? await invoke<string>('generate_uuid') : crypto.randomUUID();
				await dbService.addSubcontractRateCard(id, row);
				const createdRate = await dbService.getSubcontractRateCardById(id);
				if (createdRate) {
					this.upsertSubcontractRate(createdRate);
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
				await errorState.catchError(error, `Import ${rows.length} subcontract rates`);
			}
			throw error;
		}
	}
}

export const subcontractRatesState = new SubcontractRatesState();
