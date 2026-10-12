import { beforeEach, describe, expect, it, vi } from 'vitest';

const storeServiceMock = {
	getTablePageSize: vi.fn(),
	setTablePageSize: vi.fn()
};

const errorStateMock = {
	catchError: vi.fn()
};

vi.mock('../services/store', () => ({
	storeService: storeServiceMock
}));

vi.mock('./errors.svelte', () => ({
	errorState: errorStateMock
}));

describe('tablePreferencesState', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
	});

	it('hydrates a saved page size for a table and caches it', async () => {
		storeServiceMock.getTablePageSize.mockResolvedValueOnce(50);

		const { tablePreferencesState, TABLE_PAGE_SIZE_IDS } =
			await import('./table-preferences.svelte');

		const pageSize = await tablePreferencesState.hydratePageSize(TABLE_PAGE_SIZE_IDS.contacts);

		expect(pageSize).toBe(50);
		expect(tablePreferencesState.getCachedPageSize(TABLE_PAGE_SIZE_IDS.contacts)).toBe(50);
		expect(storeServiceMock.getTablePageSize).toHaveBeenCalledWith(TABLE_PAGE_SIZE_IDS.contacts);
	});

	it('falls back to the legacy customers page-size key for contacts', async () => {
		storeServiceMock.getTablePageSize.mockResolvedValueOnce(null).mockResolvedValueOnce(30);

		const { tablePreferencesState, TABLE_PAGE_SIZE_IDS } =
			await import('./table-preferences.svelte');

		const pageSize = await tablePreferencesState.hydratePageSize(TABLE_PAGE_SIZE_IDS.contacts);

		expect(pageSize).toBe(30);
		expect(storeServiceMock.getTablePageSize).toHaveBeenNthCalledWith(
			1,
			TABLE_PAGE_SIZE_IDS.contacts
		);
		expect(storeServiceMock.getTablePageSize).toHaveBeenNthCalledWith(2, 'customers');
	});

	it('falls back to the provided default when the saved value is missing or invalid', async () => {
		storeServiceMock.getTablePageSize.mockResolvedValueOnce(null).mockResolvedValueOnce(999);

		const { tablePreferencesState, TABLE_PAGE_SIZE_IDS } =
			await import('./table-preferences.svelte');

		expect(await tablePreferencesState.hydratePageSize(TABLE_PAGE_SIZE_IDS.materials)).toBe(10);
		expect(
			await tablePreferencesState.hydratePageSize(TABLE_PAGE_SIZE_IDS.materials, [10, 20, 30])
		).toBe(10);
	});

	it('persists page sizes independently per table', async () => {
		storeServiceMock.getTablePageSize.mockResolvedValue(null);
		storeServiceMock.setTablePageSize.mockResolvedValue(undefined);

		const { tablePreferencesState, TABLE_PAGE_SIZE_IDS } =
			await import('./table-preferences.svelte');

		await tablePreferencesState.setPageSize(TABLE_PAGE_SIZE_IDS.contacts, 50);
		await tablePreferencesState.setPageSize(TABLE_PAGE_SIZE_IDS.materials, 20);

		expect(storeServiceMock.setTablePageSize).toHaveBeenNthCalledWith(
			1,
			TABLE_PAGE_SIZE_IDS.contacts,
			50
		);
		expect(storeServiceMock.setTablePageSize).toHaveBeenNthCalledWith(
			2,
			TABLE_PAGE_SIZE_IDS.materials,
			20
		);
		expect(tablePreferencesState.getCachedPageSize(TABLE_PAGE_SIZE_IDS.contacts)).toBe(50);
		expect(tablePreferencesState.getCachedPageSize(TABLE_PAGE_SIZE_IDS.materials)).toBe(20);
	});
});
