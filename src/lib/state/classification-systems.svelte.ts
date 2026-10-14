import { toast } from 'svelte-sonner';
import { dbService } from '../services/db';
import { createLogger } from '../services/logger.js';
import { errorState } from './errors.svelte';
import type {
	ClassificationSystem,
	CostCode,
	WbsNode,
	MaterialCatalogueItem,
	LabourRateCard,
	EquipmentRateCard,
	SubcontractRateCard,
	CostComponentPreset,
	EstimateTemplate
} from '$lib/types/index.js';
import type { ClassificationSystemFormValues, CostCodeFormValues } from '$lib/schemas/index.js';
import { buildDuplicateCode, buildDuplicateName } from '$lib/utils/duplicate-records.js';
import { SvelteMap } from 'svelte/reactivity';
import {
	analyseCostCodeHierarchy,
	type SetupImportDuplicateMode
} from '$lib/services/setup-import.js';

type ImportSummary = {
	created: number;
	updated: number;
	skipped: number;
};

const log = createLogger('classificationSystemsState');

function normaliseLookupValue(value: string | null | undefined): string {
	return (value ?? '').trim().toLowerCase();
}

function buildImportToast(summary: ImportSummary, noun: string): string {
	if (summary.updated === 0 && summary.skipped === 0) {
		return `Imported ${summary.created} ${noun}${summary.created === 1 ? '' : 's'}`;
	}

	const parts: string[] = [];
	if (summary.created > 0) parts.push(`${summary.created} imported`);
	if (summary.updated > 0) parts.push(`${summary.updated} updated`);
	if (summary.skipped > 0) parts.push(`${summary.skipped} kept existing`);
	return `${noun.charAt(0).toUpperCase()}${noun.slice(1)} import complete: ${parts.join(' · ')}`;
}

class ClassificationSystemsState {
	private listHydrationRequestId = 0;
	private listMutationVersion = 0;

	private applyHydratedClassificationSystems(
		items: ClassificationSystem[],
		requestId: number,
		mutationVersionAtStart: number
	): void {
		if (requestId !== this.listHydrationRequestId) {
			log.debug('Skipped stale classification-system hydration response', {
				reason: 'superseded_request',
				requestId,
				currentRequestId: this.listHydrationRequestId
			});
			return;
		}
		if (mutationVersionAtStart !== this.listMutationVersion) {
			log.debug('Skipped stale classification-system hydration response', {
				reason: 'newer_local_mutation',
				requestId,
				mutationVersionAtStart,
				currentMutationVersion: this.listMutationVersion
			});
			return;
		}
		this.list = items;
	}

	private sortSystems(items: ClassificationSystem[]): ClassificationSystem[] {
		return [...items].sort((left, right) => {
			if (left.is_default !== right.is_default) {
				return left.is_default ? -1 : 1;
			}
			return left.name.localeCompare(right.name);
		});
	}

	private upsertClassificationSystem(nextSystem: ClassificationSystem): void {
		this.listMutationVersion += 1;
		this.list = this.sortSystems(
			this.list.filter((item) => item.id !== nextSystem.id).concat(nextSystem)
		);
	}

	private removeClassificationSystems(ids: string[]): void {
		this.listMutationVersion += 1;
		this.list = this.list.filter((item) => !ids.includes(item.id));
		if (this.activeSystemId && ids.includes(this.activeSystemId)) {
			this.activeSystemId = null;
			this.costCodes = [];
			this.costCodeSearchQuery = '';
			this.hydratedCostCodesSystemId = null;
		}
	}

	private sortCostCodes(items: CostCode[]): CostCode[] {
		return [...items].sort(
			(left, right) => left.sort_order - right.sort_order || left.code.localeCompare(right.code)
		);
	}

	private upsertCostCode(nextCode: CostCode): void {
		this.costCodes = this.sortCostCodes(
			this.costCodes.filter((item) => item.id !== nextCode.id).concat(nextCode)
		);
	}

	private removeCostCodes(ids: string[]): void {
		const removedIds = [...ids];
		let changed = true;
		while (changed) {
			changed = false;
			for (const item of this.costCodes) {
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
		this.costCodes = this.costCodes.filter((item) => !removedIds.includes(item.id));
	}

	private findMatchingClassificationSystem(
		row: ClassificationSystemFormValues
	): ClassificationSystem | null {
		const normalizedName = normaliseLookupValue(row.name);
		return this.list.find((item) => normaliseLookupValue(item.name) === normalizedName) ?? null;
	}

	list: ClassificationSystem[] = $state([]);
	searchQuery = $state('');
	costCodes: CostCode[] = $state([]);
	costCodeSearchQuery = $state('');
	activeSystemId: string | null = $state(null);
	private hydratedCostCodesSystemId: string | null = $state(null);

	filtered: ClassificationSystem[] = $derived.by(() => {
		if (!this.searchQuery.trim()) return this.list;
		const q = this.searchQuery.toLowerCase().trim();
		return this.list.filter(
			(item) =>
				item.name.toLowerCase().includes(q) ||
				item.classification_type.toLowerCase().includes(q) ||
				item.code.toLowerCase().includes(q) ||
				item.aliases.some((alias) => alias.toLowerCase().includes(q))
		);
	});

	filteredCostCodes: CostCode[] = $derived.by(() => {
		if (!this.costCodeSearchQuery.trim()) return this.costCodes;
		const q = this.costCodeSearchQuery.toLowerCase().trim();
		return this.costCodes.filter(
			(item) =>
				item.code.toLowerCase().includes(q) ||
				item.name.toLowerCase().includes(q) ||
				(item.description ?? '').toLowerCase().includes(q)
		);
	});

	async hydrate(): Promise<void> {
		const requestId = ++this.listHydrationRequestId;
		const mutationVersionAtStart = this.listMutationVersion;
		try {
			const systems = await dbService.getClassificationSystems();
			this.applyHydratedClassificationSystems(systems, requestId, mutationVersionAtStart);
		} catch (error) {
			log.error('Failed to hydrate', error);
		}
	}

	async refresh(): Promise<void> {
		const requestId = ++this.listHydrationRequestId;
		const mutationVersionAtStart = this.listMutationVersion;
		try {
			const systems = await dbService.getClassificationSystems();
			this.applyHydratedClassificationSystems(systems, requestId, mutationVersionAtStart);
		} catch (error) {
			log.error('Failed to refresh', error);
		}
	}

	async hydrateCostCodes(systemId: string, options: { force?: boolean } = {}): Promise<void> {
		if (this.activeSystemId !== systemId) {
			this.costCodeSearchQuery = '';
		}
		this.activeSystemId = systemId;
		if (!options.force && this.hydratedCostCodesSystemId === systemId) {
			return;
		}
		try {
			this.costCodes = await dbService.getCostCodes(systemId, true);
			this.hydratedCostCodesSystemId = systemId;
		} catch (error) {
			this.hydratedCostCodesSystemId = null;
			log.error('Failed to hydrate cost codes', error);
		}
	}

	async refreshCostCodes(): Promise<void> {
		if (!this.activeSystemId) {
			this.costCodes = [];
			this.hydratedCostCodesSystemId = null;
			return;
		}
		await this.hydrateCostCodes(this.activeSystemId, { force: true });
	}

	async selectSystem(systemId: string | null): Promise<void> {
		if (!systemId) {
			if (
				this.activeSystemId === null &&
				this.costCodes.length === 0 &&
				this.costCodeSearchQuery === '' &&
				this.hydratedCostCodesSystemId === null
			) {
				return;
			}
			this.activeSystemId = null;
			this.costCodes = [];
			this.costCodeSearchQuery = '';
			this.hydratedCostCodesSystemId = null;
			return;
		}
		if (this.activeSystemId === systemId && this.hydratedCostCodesSystemId === systemId) {
			return;
		}
		await this.hydrateCostCodes(systemId);
	}

	async loadWorkspaceReferenceData(projectId: string): Promise<{
		classificationSystems: ClassificationSystem[];
		costCodes: CostCode[];
		wbsNodes: WbsNode[];
		materialCatalogueItems: MaterialCatalogueItem[];
		labourRateCards: LabourRateCard[];
		equipmentRateCards: EquipmentRateCard[];
		subcontractRateCards: SubcontractRateCard[];
		costComponentPresets: CostComponentPreset[];
		estimateTemplates: EstimateTemplate[];
	}> {
		const classificationSystems = await dbService.getClassificationSystems();
		const materialCatalogueItems = await dbService.getMaterialCatalogueItems();
		const labourRateCards = await dbService.getLabourRateCards();
		const equipmentRateCards = await dbService.getEquipmentRateCards();
		const subcontractRateCards = await dbService.getSubcontractRateCards();
		const costComponentPresets = await dbService.getCostComponentPresets();
		const estimateTemplates = await dbService.getEstimateTemplates();
		const wbsNodes = await dbService.getWbsNodes(projectId);
		const costCodes = (
			await Promise.all(classificationSystems.map((system) => dbService.getCostCodes(system.id)))
		).flat();

		return {
			classificationSystems,
			costCodes,
			wbsNodes,
			materialCatalogueItems,
			labourRateCards,
			equipmentRateCards,
			subcontractRateCards,
			costComponentPresets,
			estimateTemplates
		};
	}

	async addClassificationSystem(data: ClassificationSystemFormValues): Promise<void> {
		try {
			const id = crypto.randomUUID();
			await dbService.addClassificationSystem(id, data);
			const createdSystem = await dbService.getClassificationSystemById(id);
			if (createdSystem) {
				this.upsertClassificationSystem(createdSystem);
			} else {
				await this.refresh();
			}
			toast.success(`Classification system ${data.name} created`);
		} catch (error) {
			await errorState.catchError(error, `Create classification system ${data.name}`);
			throw error;
		}
	}

	async updateClassificationSystem(
		id: string,
		data: ClassificationSystemFormValues
	): Promise<void> {
		try {
			await dbService.updateClassificationSystem(id, data);
			const updatedSystem = await dbService.getClassificationSystemById(id);
			if (updatedSystem) {
				this.upsertClassificationSystem(updatedSystem);
			} else {
				await this.refresh();
			}
			toast.success(`Classification system "${data.name}" updated`);
		} catch (error) {
			await errorState.catchError(error, `Update classification system "${data.name}"`);
			throw error;
		}
	}

	async duplicateClassificationSystem(id: string): Promise<void> {
		try {
			const current = this.list.find((item) => item.id === id);
			if (!current) throw new Error('Classification system not found');

			const nextSystemId = crypto.randomUUID();
			const costCodes = await dbService.getCostCodes(id, true);
			await dbService.addClassificationSystem(nextSystemId, {
				name: buildDuplicateName(
					current.name,
					this.list.filter((item) => item.id !== id).map((item) => item.name)
				),
				code: buildDuplicateCode(
					current.code,
					this.list.filter((item) => item.id !== id).map((item) => item.code)
				),
				classification_type: current.classification_type,
				aliases: current.aliases,
				is_default: false
			});

			const costCodeIdMap = new SvelteMap<string, string>();
			for (const code of costCodes) {
				costCodeIdMap.set(code.id, crypto.randomUUID());
			}

			for (const code of costCodes) {
				await dbService.addCostCode(costCodeIdMap.get(code.id)!, nextSystemId, {
					parent_id: code.parent_id ? (costCodeIdMap.get(code.parent_id) ?? null) : null,
					code: code.code,
					name: code.name,
					description: code.description,
					is_active: code.is_active,
					sort_order: code.sort_order
				});
			}

			const duplicatedSystem = await dbService.getClassificationSystemById(nextSystemId);
			if (duplicatedSystem) {
				this.upsertClassificationSystem(duplicatedSystem);
			} else {
				await this.refresh();
			}
			toast.success(`Classification system "${current.name}" duplicated`);
		} catch (error) {
			await errorState.catchError(error, `Duplicate classification system ${id}`);
		}
	}

	async deleteClassificationSystem(id: string): Promise<void> {
		try {
			const name = this.list.find((item) => item.id === id)?.name ?? id;
			await dbService.deleteClassificationSystem(id);
			this.removeClassificationSystems([id]);
			toast.success(`Classification system "${name}" deleted`);
		} catch (error) {
			await errorState.catchError(error, `Delete classification system ${id}`);
		}
	}

	async bulkDeleteClassificationSystems(ids: string[]): Promise<void> {
		try {
			await dbService.bulkDeleteClassificationSystems(ids);
			this.removeClassificationSystems(ids);
			toast.success(
				`Successfully deleted ${ids.length} classification system${ids.length > 1 ? 's' : ''}`
			);
		} catch (error) {
			await errorState.catchError(error, `Bulk delete (${ids.length} classification systems)`);
		}
	}

	async addCostCode(systemId: string, data: CostCodeFormValues): Promise<void> {
		try {
			const id = crypto.randomUUID();
			await dbService.addCostCode(id, systemId, data);
			const createdCode = await dbService.getCostCodeById(id);
			if (createdCode && this.activeSystemId === systemId) {
				this.upsertCostCode(createdCode);
			} else if (this.activeSystemId === systemId) {
				await this.hydrateCostCodes(systemId);
			}
			toast.success(`Cost code ${data.code} created`);
		} catch (error) {
			await errorState.catchError(error, `Create cost code ${data.code}`);
			throw error;
		}
	}

	async updateCostCode(id: string, data: CostCodeFormValues): Promise<void> {
		try {
			await dbService.updateCostCode(id, data);
			const updatedCode = await dbService.getCostCodeById(id);
			if (updatedCode && this.activeSystemId === updatedCode.classification_system_id) {
				this.upsertCostCode(updatedCode);
			} else {
				await this.refreshCostCodes();
			}
			toast.success(`Cost code "${data.code}" updated`);
		} catch (error) {
			await errorState.catchError(error, `Update cost code "${data.code}"`);
			throw error;
		}
	}

	async deleteCostCode(id: string): Promise<void> {
		try {
			const code = this.costCodes.find((item) => item.id === id)?.code ?? id;
			await dbService.deleteCostCode(id);
			this.removeCostCodes([id]);
			toast.success(`Cost code "${code}" deleted`);
		} catch (error) {
			await errorState.catchError(error, `Delete cost code ${id}`);
		}
	}

	async bulkDeleteCostCodes(ids: string[]): Promise<void> {
		try {
			await dbService.bulkDeleteCostCodes(ids);
			this.removeCostCodes(ids);
			toast.success(`Successfully deleted ${ids.length} cost code${ids.length > 1 ? 's' : ''}`);
		} catch (error) {
			await errorState.catchError(error, `Bulk delete (${ids.length} cost codes)`);
		}
	}

	async importClassificationSystems(
		rows: ClassificationSystemFormValues[],
		mode: SetupImportDuplicateMode = 'keep_existing',
		options: { feedback?: boolean } = {}
	): Promise<ClassificationSystem[]> {
		const feedback = options.feedback !== false;
		const importedSystems: ClassificationSystem[] = [];
		const summary: ImportSummary = { created: 0, updated: 0, skipped: 0 };
		try {
			for (const row of rows) {
				const existingSystem = this.findMatchingClassificationSystem(row);
				if (existingSystem) {
					if (mode === 'keep_existing') {
						importedSystems.push(existingSystem);
						summary.skipped += 1;
						continue;
					}

					await dbService.updateClassificationSystem(existingSystem.id, row);
					const updatedSystem = await dbService.getClassificationSystemById(existingSystem.id);
					if (updatedSystem) {
						importedSystems.push(updatedSystem);
						this.upsertClassificationSystem(updatedSystem);
					} else {
						await this.refresh();
						importedSystems.push(existingSystem);
					}
					summary.updated += 1;
					continue;
				}

				const id = crypto.randomUUID();
				await dbService.addClassificationSystem(id, row);
				const createdSystem = await dbService.getClassificationSystemById(id);
				if (createdSystem) {
					importedSystems.push(createdSystem);
					this.upsertClassificationSystem(createdSystem);
				} else {
					await this.refresh();
				}
				summary.created += 1;
			}
			if (feedback) {
				toast.success(buildImportToast(summary, 'classification system'));
			}
			return importedSystems;
		} catch (error) {
			if (feedback) {
				await errorState.catchError(error, `Import ${rows.length} classification systems`);
			}
			throw error;
		}
	}

	async importCostCodes(
		classificationSystemId: string,
		rows: CostCodeFormValues[],
		mode: SetupImportDuplicateMode = 'keep_existing',
		options: { feedback?: boolean } = {}
	): Promise<void> {
		const feedback = options.feedback !== false;
		const summary: ImportSummary = { created: 0, updated: 0, skipped: 0 };
		try {
			const existingByCode = new SvelteMap(
				(await dbService.getCostCodes(classificationSystemId, true)).map((item) => [
					normaliseLookupValue(item.code),
					item
				])
			);
			for (const row of rows) {
				const existingCode = existingByCode.get(normaliseLookupValue(row.code));
				if (existingCode) {
					if (mode === 'keep_existing') {
						summary.skipped += 1;
						continue;
					}

					await dbService.updateCostCode(existingCode.id, row);
					const updatedCostCode = await dbService.getCostCodeById(existingCode.id);
					if (updatedCostCode) {
						this.upsertCostCode(updatedCostCode);
						existingByCode.set(normaliseLookupValue(updatedCostCode.code), updatedCostCode);
					} else {
						await this.refreshCostCodes();
					}
					summary.updated += 1;
					continue;
				}

				const id = crypto.randomUUID();
				await dbService.addCostCode(id, classificationSystemId, row);
				const createdCostCode = await dbService.getCostCodeById(id);
				if (createdCostCode) {
					this.upsertCostCode(createdCostCode);
					existingByCode.set(normaliseLookupValue(createdCostCode.code), createdCostCode);
				} else {
					await this.refreshCostCodes();
				}
				summary.created += 1;
			}
			if (feedback) {
				toast.success(buildImportToast(summary, 'cost code'));
			}
		} catch (error) {
			if (feedback) {
				await errorState.catchError(error, `Import ${rows.length} cost codes`);
			}
			throw error;
		}
	}

	async importCostCodesWithHierarchy(
		classificationSystemId: string,
		rows: CostCodeFormValues[],
		mode: SetupImportDuplicateMode = 'keep_existing',
		options: { feedback?: boolean } = {}
	): Promise<void> {
		const feedback = options.feedback !== false;
		const summary: ImportSummary = { created: 0, updated: 0, skipped: 0 };
		try {
			const insertedIdsByCode = new SvelteMap<string, string>();
			const existingCostCodes = await dbService.getCostCodes(classificationSystemId, true);
			const existingByCode = new SvelteMap(
				existingCostCodes.map((item) => [normaliseLookupValue(item.code), item])
			);
			const hierarchy = analyseCostCodeHierarchy(rows, { existingCodes: existingCostCodes });
			if (hierarchy.issues.length > 0) {
				throw new Error(hierarchy.issues[0].message);
			}

			for (const { row } of hierarchy.orderedRows) {
				const normalizedCode = normaliseLookupValue(row.code);
				const normalizedParentRef = normaliseLookupValue(row.parent_id?.trim() || null);
				const parentId = row.parent_id
					? (insertedIdsByCode.get(normalizedParentRef) ??
						existingByCode.get(normalizedParentRef)?.id ??
						null)
					: null;
				const existingCode = existingByCode.get(normalizedCode);

				if (existingCode) {
					if (mode === 'keep_existing') {
						insertedIdsByCode.set(normalizedCode, existingCode.id);
						summary.skipped += 1;
						continue;
					}

					await dbService.updateCostCode(existingCode.id, {
						parent_id: parentId,
						code: row.code,
						name: row.name,
						description: row.description,
						is_active: row.is_active,
						sort_order: row.sort_order
					});
					const updatedCostCode = await dbService.getCostCodeById(existingCode.id);
					if (updatedCostCode) {
						this.upsertCostCode(updatedCostCode);
						existingByCode.set(normalizedCode, updatedCostCode);
					} else {
						await this.refreshCostCodes();
					}
					insertedIdsByCode.set(normalizedCode, existingCode.id);
					summary.updated += 1;
					continue;
				}

				const id = crypto.randomUUID();
				await dbService.addCostCode(id, classificationSystemId, {
					parent_id: parentId,
					code: row.code,
					name: row.name,
					description: row.description,
					is_active: row.is_active,
					sort_order: row.sort_order
				});
				const createdCostCode = await dbService.getCostCodeById(id);
				if (createdCostCode) {
					this.upsertCostCode(createdCostCode);
					existingByCode.set(normalizedCode, createdCostCode);
				} else {
					await this.refreshCostCodes();
				}
				insertedIdsByCode.set(normalizedCode, id);
				summary.created += 1;
			}

			if (feedback) {
				toast.success(buildImportToast(summary, 'cost code'));
			}
		} catch (error) {
			if (feedback) {
				await errorState.catchError(error, `Import ${rows.length} cost codes`);
			}
			throw error;
		}
	}
}

export const classificationSystemsState = new ClassificationSystemsState();
