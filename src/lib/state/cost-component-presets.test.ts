import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	addCostComponentPreset: vi.fn(),
	bulkDeleteCostComponentPresets: vi.fn(),
	getCostComponentPresetById: vi.fn(),
	getCostComponentPresets: vi.fn(),
	updateCostComponentPreset: vi.fn(),
	catchError: vi.fn(),
	createLogger: vi.fn(() => ({ error: vi.fn(), info: vi.fn() })),
	toast: { error: vi.fn(), success: vi.fn() },
	isTauri: vi.fn(() => false),
	invoke: vi.fn()
}));

vi.mock('../services/db', () => ({ dbService: mocks }));
vi.mock('../services/logger.js', () => ({ createLogger: mocks.createLogger }));
vi.mock('./errors.svelte', () => ({ errorState: { catchError: mocks.catchError } }));
vi.mock('../utils/env', () => ({ isTauri: mocks.isTauri }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('svelte-sonner', () => ({ toast: mocks.toast }));

import { costComponentPresetsState } from './cost-component-presets.svelte';

describe('costComponentPresetsState', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		costComponentPresetsState.list = [];
	});

	it('reports bulk-delete failures with the operation context', async () => {
		const failure = new Error('bulk delete failed');
		mocks.bulkDeleteCostComponentPresets.mockRejectedValueOnce(failure);

		await costComponentPresetsState.bulkDeletePresets(['preset-1', 'preset-2']);

		expect(mocks.catchError).toHaveBeenCalledWith(failure, 'Bulk delete (2 cost presets)');
		expect(costComponentPresetsState.list).toEqual([]);
	});

	it('reports import failures and rethrows them when feedback is enabled', async () => {
		const failure = new Error('import failed');
		mocks.addCostComponentPreset.mockRejectedValueOnce(failure);

		await expect(
			costComponentPresetsState.importCostComponentPresets([
				{
					name: 'Preset',
					code: 'P-1',
					description: '',
					aliases: [],
					is_active: true
				}
			])
		).rejects.toBe(failure);

		expect(mocks.catchError).toHaveBeenCalledWith(failure, 'Import 1 cost presets');
	});
});
