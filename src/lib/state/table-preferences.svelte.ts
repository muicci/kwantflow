import { storeService } from '$lib/services/store.js';
import { DEFAULT_TABLE_PAGE_SIZES } from '$lib/utils/table-pagination.js';
import { errorState } from './errors.svelte';

export const TABLE_PAGE_SIZE_IDS = {
	contacts: 'contacts',
	rfqs: 'rfqs',
	materials: 'materials',
	labourRates: 'labourRates',
	equipmentRates: 'equipmentRates',
	subcontractRates: 'subcontractRates',
	classificationSystems: 'classificationSystems',
	costCodes: 'costCodes',
	costComponentPresets: 'costComponentPresets',
	estimateTemplates: 'estimateTemplates',
	wbs: 'wbs',
	projectStructureTemplates: 'projectStructureTemplates'
} as const;

const LEGACY_TABLE_PAGE_SIZE_ID_ALIASES: Partial<Record<TablePageSizeId, string[]>> = {
	contacts: ['customers']
};

export type TablePageSizeId = (typeof TABLE_PAGE_SIZE_IDS)[keyof typeof TABLE_PAGE_SIZE_IDS];

type TablePageSizeOptions = readonly number[];

const getFallbackPageSize = (options: TablePageSizeOptions): number =>
	options[0] ?? DEFAULT_TABLE_PAGE_SIZES[0];

const isAllowedPageSize = (value: unknown, options: TablePageSizeOptions): value is number =>
	typeof value === 'number' && Number.isFinite(value) && options.includes(value);

class TablePreferencesState {
	private pageSizesByTable: Record<string, number> = $state({});
	private hydratedTableIds = new Set<TablePageSizeId>();
	private pendingLoads = new Map<TablePageSizeId, Promise<number>>();

	getCachedPageSize(
		tableId: TablePageSizeId,
		options: TablePageSizeOptions = DEFAULT_TABLE_PAGE_SIZES
	): number {
		const cachedPageSize = this.pageSizesByTable[tableId];
		return isAllowedPageSize(cachedPageSize, options)
			? cachedPageSize
			: getFallbackPageSize(options);
	}

	async hydratePageSize(
		tableId: TablePageSizeId,
		options: TablePageSizeOptions = DEFAULT_TABLE_PAGE_SIZES
	): Promise<number> {
		if (this.hydratedTableIds.has(tableId)) {
			return this.getCachedPageSize(tableId, options);
		}

		const existingLoad = this.pendingLoads.get(tableId);
		if (existingLoad) return existingLoad;

		const loadPromise = this.loadPageSize(tableId, options).finally(() => {
			this.pendingLoads.delete(tableId);
		});

		this.pendingLoads.set(tableId, loadPromise);
		return loadPromise;
	}

	async setPageSize(
		tableId: TablePageSizeId,
		pageSize: number,
		options: TablePageSizeOptions = DEFAULT_TABLE_PAGE_SIZES
	): Promise<void> {
		const nextPageSize = isAllowedPageSize(pageSize, options)
			? pageSize
			: getFallbackPageSize(options);

		this.pageSizesByTable = {
			...this.pageSizesByTable,
			[tableId]: nextPageSize
		};
		this.hydratedTableIds.add(tableId);

		try {
			await storeService.setTablePageSize(tableId, nextPageSize);
		} catch (error) {
			await errorState.catchError(error, 'Save table page size');
		}
	}

	private async loadPageSize(
		tableId: TablePageSizeId,
		options: TablePageSizeOptions
	): Promise<number> {
		const fallbackPageSize = getFallbackPageSize(options);

		try {
			const tableIdsToTry = [tableId, ...(LEGACY_TABLE_PAGE_SIZE_ID_ALIASES[tableId] ?? [])];
			let resolvedPageSize = fallbackPageSize;

			for (const candidateTableId of tableIdsToTry) {
				const storedPageSize = await storeService.getTablePageSize(candidateTableId);
				if (isAllowedPageSize(storedPageSize, options)) {
					resolvedPageSize = storedPageSize;
					break;
				}
			}

			this.pageSizesByTable = {
				...this.pageSizesByTable,
				[tableId]: resolvedPageSize
			};
			return resolvedPageSize;
		} catch (error) {
			await errorState.catchError(error, 'Load table page size');
			this.pageSizesByTable = {
				...this.pageSizesByTable,
				[tableId]: fallbackPageSize
			};
			return fallbackPageSize;
		} finally {
			this.hydratedTableIds.add(tableId);
		}
	}
}

export const tablePreferencesState = new TablePreferencesState();
