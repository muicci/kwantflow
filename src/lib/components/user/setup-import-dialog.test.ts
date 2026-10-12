import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SvelteMap } from 'svelte/reactivity';
import type {
	SetupImportSheetAnalysis,
	SetupImportSheetPreview,
	SetupImportWorkbook
} from '$lib/services/setup-import.js';
import SetupImportDialog from './test-setup-import-dialog-host.svelte';

const mocks = vi.hoisted(() => ({
	open: vi.fn(),
	readFile: vi.fn(),
	readTextFile: vi.fn(),
	allowExternalFileRead: vi.fn(),
	loadFile: vi.fn(),
	applyImport: vi.fn(),
	clear: vi.fn(),
	catchError: vi.fn(),
	toastSuccess: vi.fn(),
	onDragDropEvent: vi.fn(),
	sheet: null as SetupImportSheetAnalysis | null,
	workbooks: null as SvelteMap<string, SetupImportWorkbook> | null,
	sessionFlags: null as SvelteMap<string, boolean> | null,
	preview: null as SetupImportSheetPreview | null,
	imported: false
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open }));
vi.mock('@tauri-apps/plugin-fs', () => ({
	readFile: mocks.readFile,
	readTextFile: mocks.readTextFile
}));
vi.mock('@tauri-apps/api/webviewWindow', () => ({
	getCurrentWebviewWindow: () => ({ onDragDropEvent: mocks.onDragDropEvent })
}));
vi.mock('$lib/utils/env.js', () => ({ isTauri: () => true }));
vi.mock('$lib/services/external-file-access.js', () => ({
	allowExternalFileRead: mocks.allowExternalFileRead
}));
vi.mock('svelte-sonner', () => ({ toast: { success: mocks.toastSuccess } }));
vi.mock('$lib/state/setup-import.svelte.js', async () => {
	mocks.workbooks = new (await import('svelte/reactivity')).SvelteMap();
	mocks.sessionFlags = new (await import('svelte/reactivity')).SvelteMap();
	return {
		setupImportState: {
			digest: (await import('$lib/services/setup-import.js')).buildSetupImportSchemaDigest(),
			get hasAnalysis() {
				return !!mocks.sheet && !!mocks.workbooks?.get('current');
			},
			get activeSheet() {
				return mocks.sheet;
			},
			get activeSheetId() {
				return mocks.sheet?.sheetId ?? null;
			},
			get activeSheetPreview() {
				return mocks.preview;
			},
			get sheets() {
				return mocks.sheet ? [mocks.sheet] : [];
			},
			get workbook() {
				return mocks.workbooks?.get('current') ?? null;
			},
			get sourcePath() {
				const workbook = mocks.workbooks?.get('current');
				return workbook ? `/synthetic/${workbook.fileName}` : null;
			},
			get readySheetCount() {
				return mocks.sheet && !mocks.imported ? 1 : 0;
			},
			get importedSheetCount() {
				return mocks.imported ? 1 : 0;
			},
			get hasPendingImportRefresh() {
				return mocks.sessionFlags?.get('pending-refresh') ?? false;
			},
			sheetPreviews: { get: () => mocks.preview },
			getImportPreflight: () => ({
				canApply: !!mocks.sheet && !mocks.imported,
				readySheetIds: mocks.sheet && !mocks.imported ? [mocks.sheet.sheetId] : [],
				blockedSheetIds: [],
				dependencyErrors: [],
				remediationRequired: false
			}),
			getSheet: () => mocks.sheet,
			getSheetSessionState: () => (mocks.imported ? 'imported' : 'not_imported'),
			getSheetImportResult: () => null,
			getSheetDuplicateSummary: () => null,
			getRepeatedValueIssues: () => [],
			getTargetFieldOptions: () => ['name', 'unit', 'default_rate'],
			isSheetExplicitlyIgnored: () => false,
			isSheetResolved: () => true,
			isLoading: false,
			isImporting: false,
			loadFile: mocks.loadFile,
			applyImport: mocks.applyImport,
			clear: mocks.clear
		}
	};
});
vi.mock('$lib/state/errors.svelte.js', () => ({ errorState: { catchError: mocks.catchError } }));

describe('setup spreadsheet input failures', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.open.mockReset().mockResolvedValue('/synthetic/setup.csv');
		mocks.allowExternalFileRead.mockReset().mockImplementation(async (path: string) => path);
		mocks.readTextFile.mockReset().mockResolvedValue('Name,Rate\nWelder,80');
		mocks.readFile.mockReset().mockResolvedValue(new Uint8Array([1, 2]));
		mocks.loadFile.mockReset().mockResolvedValue(undefined);
		mocks.applyImport.mockReset();
		mocks.clear.mockReset().mockImplementation(() => {
			mocks.workbooks?.delete('current');
			mocks.sheet = null;
			mocks.sessionFlags?.clear();
		});
		mocks.onDragDropEvent.mockReset().mockResolvedValue(() => {});
		mocks.sheet = null;
		mocks.workbooks?.clear();
		mocks.preview = null;
		mocks.imported = false;
		mocks.sessionFlags?.clear();
		mocks.catchError.mockResolvedValue(undefined);
	});

	afterEach(cleanup);

	it('reports a failed native picker and permits choosing the file again', async () => {
		const error = new Error('File picker unavailable');
		mocks.open.mockRejectedValueOnce(error);
		const view = render(SetupImportDialog, { open: true });
		const choose = view.getByRole('button', { name: 'Choose File' });
		await fireEvent.click(choose);
		await waitFor(() =>
			expect(mocks.catchError).toHaveBeenCalledWith(error, 'Choose setup spreadsheet')
		);
		expect((choose as HTMLButtonElement).disabled).toBe(false);
		await fireEvent.click(choose);
		await waitFor(() => expect(mocks.loadFile).toHaveBeenCalledOnce());
	});

	it.each(['permission', 'csv read', 'xlsx read'])(
		'reports a %s failure before analysis and permits retry',
		async (failure) => {
			const error = new Error(`Failed ${failure}`);
			if (failure === 'permission') mocks.allowExternalFileRead.mockRejectedValueOnce(error);
			if (failure === 'csv read') mocks.readTextFile.mockRejectedValueOnce(error);
			if (failure === 'xlsx read') {
				mocks.open.mockResolvedValue('/synthetic/setup.xlsx');
				mocks.readFile.mockRejectedValueOnce(error);
			}
			const view = render(SetupImportDialog, { open: true });
			const choose = view.getByRole('button', { name: 'Choose File' });
			await fireEvent.click(choose);
			await waitFor(() =>
				expect(mocks.catchError).toHaveBeenCalledWith(error, 'Read setup spreadsheet')
			);
			expect(mocks.loadFile).not.toHaveBeenCalled();
			expect((choose as HTMLButtonElement).disabled).toBe(false);
			await fireEvent.click(choose);
			await waitFor(() => expect(mocks.loadFile).toHaveBeenCalledOnce());
		}
	);

	it('preserves the state layer error without reporting analysis rejection twice', async () => {
		const error = new Error('Invalid workbook');
		mocks.loadFile.mockImplementationOnce(async () => {
			await mocks.catchError(error, 'Analyse setup import setup.csv');
			throw error;
		});
		const view = render(SetupImportDialog, { open: true });
		await fireEvent.click(view.getByRole('button', { name: 'Choose File' }));
		await waitFor(() => expect(mocks.catchError).toHaveBeenCalledOnce());
		expect(mocks.catchError).toHaveBeenCalledWith(error, 'Analyse setup import setup.csv');
		expect(mocks.clear).not.toHaveBeenCalled();
	});

	it('treats picker cancellation as a normal outcome', async () => {
		mocks.open.mockResolvedValue(null);
		const view = render(SetupImportDialog, { open: true });
		await fireEvent.click(view.getByRole('button', { name: 'Choose File' }));
		expect(mocks.allowExternalFileRead).not.toHaveBeenCalled();
		expect(mocks.loadFile).not.toHaveBeenCalled();
		expect(mocks.catchError).not.toHaveBeenCalled();
	});

	it('ignores a picker result from a closed and reopened empty dialog', async () => {
		let select!: (path: string) => void;
		mocks.open.mockReturnValueOnce(new Promise<string>((resolve) => (select = resolve)));
		const view = render(SetupImportDialog, { open: true });
		await fireEvent.click(view.getByRole('button', { name: 'Choose File' }));
		await view.rerender({ open: false });
		await waitFor(() => expect(view.queryByRole('dialog')).toBeNull());
		await view.rerender({ open: true });
		await view.findByRole('button', { name: 'Choose File' });
		select('/synthetic/stale.csv');
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(mocks.allowExternalFileRead).not.toHaveBeenCalled();
		expect(mocks.loadFile).not.toHaveBeenCalled();
	});

	it.each(['csv', 'xlsx'])(
		'ignores a %s read from a closed and reopened empty dialog',
		async (extension) => {
			let finishRead!: () => void;
			const reading = new Promise<void>((resolve) => (finishRead = resolve));
			mocks.open.mockResolvedValue(`/synthetic/stale.${extension}`);
			if (extension === 'csv') {
				mocks.readTextFile.mockImplementationOnce(async () => {
					await reading;
					return 'Name,Unit,Rate\nWelder,hr,90';
				});
			} else {
				mocks.readFile.mockImplementationOnce(async () => {
					await reading;
					return new Uint8Array([1, 2]);
				});
			}
			const view = render(SetupImportDialog, { open: true });
			await fireEvent.click(view.getByRole('button', { name: 'Choose File' }));
			await waitFor(() => expect(mocks.allowExternalFileRead).toHaveBeenCalledOnce());
			await view.rerender({ open: false });
			await waitFor(() => expect(view.queryByRole('dialog')).toBeNull());
			await view.rerender({ open: true });
			await view.findByRole('button', { name: 'Choose File' });
			finishRead();
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(mocks.loadFile).not.toHaveBeenCalled();
		}
	);

	it('retries only setup completion after a committed import and prevents overlapping retries', async () => {
		prepareReadyWorkbook();
		let finish!: () => void;
		const completion = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const onImported = vi
			.fn()
			.mockRejectedValueOnce(new Error('Cannot save setup progress'))
			.mockReturnValueOnce(completion);
		const view = render(SetupImportDialog, { open: true, onImported });
		await fireEvent.click(view.getByRole('button', { name: 'Import 1 Ready Sheet' }));
		const retry = await view.findByRole('button', { name: 'Finish setup' });
		expect((retry as HTMLButtonElement).disabled).toBe(false);
		expect(mocks.applyImport).toHaveBeenCalledOnce();
		expect(mocks.clear).not.toHaveBeenCalled();
		expect(mocks.toastSuccess).toHaveBeenCalledOnce();
		await fireEvent.click(retry);
		const finishing = view.getByRole('button', { name: 'Finishing setup...' });
		expect((finishing as HTMLButtonElement).disabled).toBe(true);
		expect(view.getByRole('dialog').querySelector('.ui-dialog-workbench-body')).toHaveProperty(
			'inert',
			true
		);
		expect((view.getByRole('button', { name: 'Replace file' }) as HTMLButtonElement).disabled).toBe(
			true
		);
		await fireEvent.click(finishing);
		expect(onImported).toHaveBeenCalledTimes(2);
		finish();
		await waitFor(() => expect(view.queryByRole('dialog')).toBeNull());
		expect(mocks.applyImport).toHaveBeenCalledOnce();
		expect(mocks.toastSuccess).toHaveBeenCalledOnce();
		expect(mocks.clear).toHaveBeenCalled();
	});

	it('finishes onboarding only after a committed import refresh succeeds', async () => {
		prepareReadyWorkbook();
		const onImported = vi.fn();
		mocks.applyImport.mockImplementationOnce(async () => {
			mocks.imported = true;
			mocks.sessionFlags?.set('pending-refresh', true);
			return null;
		});
		mocks.applyImport.mockImplementationOnce(async () => {
			mocks.sessionFlags?.set('pending-refresh', false);
			return { sheetResults: [{ sheetId: 'labour', created: 1 }] };
		});
		const view = render(SetupImportDialog, { open: true, onImported });
		await fireEvent.click(view.getByRole('button', { name: 'Import 1 Ready Sheet' }));
		const retry = await view.findByRole('button', { name: 'Refresh imported data' });
		expect((retry as HTMLButtonElement).disabled).toBe(false);
		expect(onImported).not.toHaveBeenCalled();
		expect(mocks.toastSuccess).not.toHaveBeenCalled();
		await fireEvent.click(retry);
		await waitFor(() => expect(view.queryByRole('dialog')).toBeNull());
		expect(onImported).toHaveBeenCalledOnce();
		expect(mocks.applyImport).toHaveBeenCalledTimes(2);
		expect(mocks.toastSuccess).toHaveBeenCalledOnce();
	});

	it('preserves completion retry after failed replacement and clears it for a new workbook', async () => {
		prepareReadyWorkbook();
		const onImported = vi.fn().mockRejectedValue(new Error('Cannot save setup progress'));
		const view = render(SetupImportDialog, { open: true, onImported });
		await fireEvent.click(view.getByRole('button', { name: 'Import 1 Ready Sheet' }));
		await view.findByRole('button', { name: 'Finish setup' });
		const readError = new Error('Permission denied');
		mocks.allowExternalFileRead.mockRejectedValueOnce(readError);
		await fireEvent.click(view.getByRole('button', { name: 'Replace file' }));
		await waitFor(() =>
			expect(mocks.catchError).toHaveBeenCalledWith(readError, 'Read setup spreadsheet')
		);
		expect((view.getByRole('button', { name: 'Finish setup' }) as HTMLButtonElement).disabled).toBe(
			false
		);
		mocks.loadFile.mockImplementationOnce(async () => {
			prepareReadyWorkbook('replacement.csv');
		});
		await fireEvent.click(view.getByRole('button', { name: 'Replace file' }));
		await view.findByRole('button', { name: 'Import 1 Ready Sheet' });
		expect(view.queryByRole('button', { name: 'Finish setup' })).toBeNull();
		expect(mocks.applyImport).toHaveBeenCalledOnce();
		expect(onImported).toHaveBeenCalledOnce();
	});

	it('ignores a native drop while setup completion is running', async () => {
		prepareReadyWorkbook();
		let finish!: () => void;
		const onImported = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
		const view = render(SetupImportDialog, { open: true, onImported });
		await fireEvent.click(view.getByRole('button', { name: 'Import 1 Ready Sheet' }));
		await view.findByRole('button', { name: 'Finishing setup...' });
		await mocks.onDragDropEvent.mock.calls[0][0]({
			payload: { type: 'drop', paths: ['/synthetic/replacement.csv'] }
		});
		expect(mocks.allowExternalFileRead).not.toHaveBeenCalled();
		expect(mocks.loadFile).not.toHaveBeenCalled();
		finish();
		await waitFor(() => expect(view.queryByRole('dialog')).toBeNull());
	});

	it.each(['csv', 'xlsx'])(
		'does not replace a workbook if Finish setup starts during a pending %s read',
		async (extension) => {
			prepareReadyWorkbook();
			let finish!: () => void;
			const onImported = vi
				.fn()
				.mockRejectedValueOnce(new Error('Cannot save setup progress'))
				.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)));
			const view = render(SetupImportDialog, { open: true, onImported });
			await fireEvent.click(view.getByRole('button', { name: 'Import 1 Ready Sheet' }));
			await view.findByRole('button', { name: 'Finish setup' });
			let finishRead!: () => void;
			const reading = new Promise<void>((resolve) => (finishRead = resolve));
			mocks.open.mockResolvedValue(`/synthetic/replacement.${extension}`);
			if (extension === 'csv') {
				mocks.readTextFile.mockImplementationOnce(async () => {
					await reading;
					return 'Name,Unit,Rate\nWelder,hr,90';
				});
			} else {
				mocks.readFile.mockImplementationOnce(async () => {
					await reading;
					return new Uint8Array([1, 2]);
				});
			}
			await fireEvent.click(view.getByRole('button', { name: 'Replace file' }));
			await waitFor(() => expect(mocks.allowExternalFileRead).toHaveBeenCalledOnce());
			await fireEvent.click(view.getByRole('button', { name: 'Finish setup' }));
			finishRead();
			await waitFor(() => expect(onImported).toHaveBeenCalledTimes(2));
			expect(mocks.loadFile).not.toHaveBeenCalled();
			expect(mocks.workbooks?.get('current')?.fileName).toBe('labour.csv');
			finish();
			await waitFor(() => expect(view.queryByRole('dialog')).toBeNull());
			expect(mocks.loadFile).not.toHaveBeenCalled();
		}
	);

	it('keeps Close available after completion failure without repeating import or completion', async () => {
		prepareReadyWorkbook();
		const onImported = vi.fn().mockRejectedValue(new Error('Cannot save setup progress'));
		const view = render(SetupImportDialog, { open: true, onImported });
		await fireEvent.click(view.getByRole('button', { name: 'Import 1 Ready Sheet' }));
		await view.findByRole('button', { name: 'Finish setup' });
		await fireEvent.click(view.getByText('Close', { selector: 'button' }));
		await waitFor(() => expect(view.queryByRole('dialog')).toBeNull());
		expect(mocks.applyImport).toHaveBeenCalledOnce();
		expect(onImported).toHaveBeenCalledOnce();
		expect(mocks.workbooks?.get('current')).toBeUndefined();
	});

	it.each(['success', 'failure'])(
		'does not clear a reopened workbook after stale callback %s',
		async (result) => {
			prepareReadyWorkbook();
			let finish!: () => void;
			let fail!: (error: Error) => void;
			const onImported = vi.fn(
				() =>
					new Promise<void>((resolve, reject) => {
						finish = resolve;
						fail = reject;
					})
			);
			const view = render(SetupImportDialog, { open: true, onImported });
			await fireEvent.click(view.getByRole('button', { name: 'Import 1 Ready Sheet' }));
			await view.findByRole('button', { name: 'Finishing setup...' });
			await view.rerender({ open: false, onImported });
			await waitFor(() => expect(view.queryByRole('dialog')).toBeNull());
			prepareReadyWorkbook('reopened.csv');
			await view.rerender({ open: true, onImported });
			const clearCount = mocks.clear.mock.calls.length;
			if (result === 'success') finish();
			else fail(new Error('Late setup failure'));
			await view.findByRole('button', { name: 'Import 1 Ready Sheet' });
			expect(view.getByRole('dialog')).toBeTruthy();
			expect(view.queryByRole('button', { name: 'Finish setup' })).toBeNull();
			expect(mocks.clear).toHaveBeenCalledTimes(clearCount);
			expect(mocks.workbooks?.get('current')?.fileName).toBe('reopened.csv');
			expect(mocks.applyImport).toHaveBeenCalledOnce();
		}
	);
});

function prepareReadyWorkbook(fileName = 'labour.csv'): void {
	mocks.imported = false;
	const row = { Name: 'Welder', Unit: 'hr', Rate: '80' };
	mocks.sheet = {
		sheetId: 'labour',
		sheetName: 'Labour Rates',
		targetTable: 'labour_rates',
		readiness: 'ready',
		summary: 'One valid labour rate',
		unmatchedColumns: [],
		missingRequiredFields: [],
		mappings: [
			['Name', 'name'],
			['Unit', 'unit'],
			['Rate', 'default_rate']
		].map(([sourceColumn, targetField]) => ({
			sourceColumn,
			targetField,
			status: 'green',
			confidence: 'high',
			reason: 'Exact field match'
		}))
	};
	mocks.workbooks?.set('current', {
		fileName,
		fileExtension: 'csv',
		sheets: [
			{
				sheetId: 'labour',
				sheetName: 'Labour Rates',
				headers: Object.keys(row),
				headerIssues: [],
				rowCount: 1,
				rows: [row],
				sampleRows: [row]
			}
		]
	});
	mocks.preview = {
		validRows: [{ name: 'Welder', unit: 'hr', default_rate: 80 }],
		errors: [],
		blocked: false
	};
	mocks.applyImport.mockImplementation(async () => {
		mocks.imported = true;
		return { sheetResults: [{ sheetId: 'labour', created: 1 }] };
	});
}
