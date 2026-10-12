import { invoke } from '@tauri-apps/api/core';
import { toast } from 'svelte-sonner';
import { dbService } from '../services/db';
import { createLogger } from '../services/logger.js';
import { errorState } from './errors.svelte';
import type { LabourRateCard } from '$lib/types/index.js';
import type { LabourRateCardFormValues } from '$lib/schemas/index.js';
import { isTauri } from '../utils/env';
import { buildDuplicateCode, buildDuplicateName } from '$lib/utils/duplicate-records.js';
import type { SetupImportDuplicateMode } from '$lib/services/setup-import.js';

type ImportSummary = {
	created: number;
	updated: number;
	skipped: number;
};

const log = createLogger('labourRatesState');

function normaliseLookupValue(value: string | null | undefined): string {
	return (value ?? '').trim().toLowerCase();
}

function buildImportToast(summary: ImportSummary): string {
	if (summary.updated === 0 && summary.skipped === 0) {
		return `Imported ${summary.created} labour rate${summary.created === 1 ? '' : 's'}`;
	}

	const parts: string[] = [];
	if (summary.created > 0) parts.push(`${summary.created} imported`);
	if (summary.updated > 0) parts.push(`${summary.updated} updated`);
	if (summary.skipped > 0) parts.push(`${summary.skipped} kept existing`);
	return `Labour rate import complete: ${parts.join(' · ')}`;
}

class LabourRatesState {
	private upsertLabourRate(nextRate: LabourRateCard): void {
		const nextList = this.list.filter((item) => item.id !== nextRate.id).concat(nextRate);
		this.list = nextList.sort((left, right) => left.name.localeCompare(right.name));
	}

	private removeLabourRates(ids: string[]): void {
		const removedIds = new Set(ids);
		this.list = this.list.filter((item) => !removedIds.has(item.id));
	}

	private findMatchingLabourRate(row: LabourRateCardFormValues): LabourRateCard | null {
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

	list: LabourRateCard[] = $state([]);
	searchQuery = $state('');

	filtered: LabourRateCard[] = $derived.by(() => {
		if (!this.searchQuery.trim()) return this.list;
		const q = this.searchQuery.toLowerCase().trim();
		return this.list.filter(
			(item) =>
				item.name.toLowerCase().includes(q) ||
				(item.code ?? '').toLowerCase().includes(q) ||
				(item.category ?? '').toLowerCase().includes(q) ||
				(item.work_center ?? '').toLowerCase().includes(q) ||
				item.unit.toLowerCase().includes(q)
		);
	});

	async hydrate(): Promise<void> {
		try {
			this.list = await dbService.getLabourRateCards(true);
		} catch (error) {
			log.error('Failed to hydrate', error);
		}
	}

	async refresh(): Promise<void> {
		try {
			this.list = await dbService.getLabourRateCards(true);
		} catch (error) {
			log.error('Failed to refresh', error);
		}
	}

	async replaceLinkedCompanies(labourRateId: string, companyIds: string[]): Promise<void> {
		try {
			await dbService.replaceCatalogueRecordCompanyLinks('labour_rates', labourRateId, companyIds);
			await this.refresh();
		} catch (error) {
			await errorState.catchError(error, 'Update labour-rate company relationships');
			throw error;
		}
	}

	async addLabourRate(data: LabourRateCardFormValues): Promise<string> {
		try {
			const id = isTauri() ? await invoke<string>('generate_uuid') : crypto.randomUUID();
			await dbService.addLabourRateCard(id, data);
			const createdRate = await dbService.getLabourRateCardById(id);
			if (createdRate) {
				this.upsertLabourRate(createdRate);
			} else {
				await this.refresh();
			}
			toast.success(`Labour rate ${data.name} created`);
			return id;
		} catch (error) {
			await errorState.catchError(error, `Create labour rate ${data.name}`);
			throw error;
		}
	}

	async updateLabourRate(id: string, data: LabourRateCardFormValues): Promise<void> {
		try {
			await dbService.updateLabourRateCard(id, data);
			const updatedRate = await dbService.getLabourRateCardById(id);
			if (updatedRate) {
				this.upsertLabourRate(updatedRate);
			} else {
				await this.refresh();
			}
			toast.success(`Labour rate "${data.name}" updated`);
		} catch (error) {
			await errorState.catchError(error, `Update labour rate "${data.name}"`);
			throw error;
		}
	}

	async duplicateLabourRate(id: string): Promise<void> {
		try {
			const current = this.list.find((item) => item.id === id);
			if (!current) throw new Error('Labour rate not found');
			const nextId = isTauri() ? await invoke<string>('generate_uuid') : crypto.randomUUID();
			await dbService.addLabourRateCard(nextId, {
				code: buildDuplicateCode(
					current.code,
					this.list.filter((item) => item.id !== id).map((item) => item.code)
				),
				name: buildDuplicateName(
					current.name,
					this.list.filter((item) => item.id !== id).map((item) => item.name)
				),
				category: current.category ?? '',
				work_center: current.work_center ?? '',
				aliases: current.aliases ?? [],
				unit: current.unit,
				default_rate: current.default_rate,
				is_active: current.is_active
			});
			const duplicatedRate = await dbService.getLabourRateCardById(nextId);
			if (duplicatedRate) {
				this.upsertLabourRate(duplicatedRate);
			} else {
				await this.refresh();
			}
			toast.success(`Labour rate "${current.name}" duplicated`);
		} catch (error) {
			await errorState.catchError(error, `Duplicate labour rate ${id}`);
		}
	}

	async deleteLabourRate(id: string): Promise<void> {
		try {
			const name = this.list.find((item) => item.id === id)?.name ?? id;
			await dbService.deleteLabourRateCard(id);
			this.removeLabourRates([id]);
			toast.success(`Labour rate "${name}" deleted`);
		} catch (error) {
			await errorState.catchError(error, `Delete labour rate ${id}`);
		}
	}

	async bulkDeleteLabourRates(ids: string[]): Promise<void> {
		try {
			await dbService.bulkDeleteLabourRateCards(ids);
			this.removeLabourRates(ids);
			toast.success(`Successfully deleted ${ids.length} labour rate${ids.length > 1 ? 's' : ''}`);
		} catch (error) {
			await errorState.catchError(error, `Bulk delete (${ids.length} labour rates)`);
		}
	}

	async importLabourRates(
		rows: LabourRateCardFormValues[],
		mode: SetupImportDuplicateMode = 'keep_existing',
		options: { feedback?: boolean } = {}
	): Promise<ImportSummary> {
		const feedback = options.feedback !== false;
		const summary: ImportSummary = { created: 0, updated: 0, skipped: 0 };
		try {
			for (const row of rows) {
				const existingRate = this.findMatchingLabourRate(row);
				if (existingRate) {
					if (mode === 'keep_existing') {
						summary.skipped += 1;
						continue;
					}

					await dbService.updateLabourRateCard(existingRate.id, row);
					const updatedRate = await dbService.getLabourRateCardById(existingRate.id);
					if (updatedRate) {
						this.upsertLabourRate(updatedRate);
					} else {
						await this.refresh();
					}
					summary.updated += 1;
					continue;
				}

				const id = isTauri() ? await invoke<string>('generate_uuid') : crypto.randomUUID();
				await dbService.addLabourRateCard(id, row);
				const createdRate = await dbService.getLabourRateCardById(id);
				if (createdRate) {
					this.upsertLabourRate(createdRate);
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
				await errorState.catchError(error, `Import ${rows.length} labour rates`);
			}
			throw error;
		}
	}
}

export const labourRatesState = new LabourRatesState();
