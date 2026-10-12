import { beforeEach, describe, expect, it, vi } from 'vitest';

const envMock = {
	isTauri: vi.fn()
};

const loadMock = vi.fn();
const loggerMock = {
	trace: vi.fn(),
	debug: vi.fn(),
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn()
};

vi.mock('../utils/env', () => ({
	isTauri: envMock.isTauri
}));

vi.mock('@tauri-apps/plugin-store', () => ({
	load: loadMock
}));

vi.mock('./logger.js', () => ({
	createLogger: () => loggerMock
}));

describe('storeService init', () => {
	beforeEach(async () => {
		vi.resetModules();
		vi.clearAllMocks();
		envMock.isTauri.mockReturnValue(true);

		const { storeService } = await import('./store');
		const serviceState = storeService as unknown as Record<string, unknown>;
		serviceState.store = null;
		serviceState.initialized = false;
		serviceState.initPromise = null;
	});

	it('deduplicates concurrent init calls', async () => {
		let loadPending = false;
		let resolveLoad: (value: unknown) => void = () => {
			throw new Error('Expected load() to be pending during concurrent init test.');
		};
		loadMock.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					loadPending = true;
					resolveLoad = resolve;
				})
		);

		const { storeService } = await import('./store');
		const initCalls = [storeService.init(), storeService.init(), storeService.init()];

		expect(loadMock).toHaveBeenCalledTimes(1);
		expect(loadPending).toBe(true);

		resolveLoad({
			get: vi.fn(),
			set: vi.fn(),
			save: vi.fn(),
			delete: vi.fn()
		});

		await Promise.all(initCalls);

		expect(loadMock).toHaveBeenCalledTimes(1);
		expect(loggerMock.info).toHaveBeenCalledWith('Store initialized.');
	});

	it('clears the in-flight init promise after a failure so init can retry', async () => {
		loadMock.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({
			get: vi.fn(),
			set: vi.fn(),
			save: vi.fn(),
			delete: vi.fn()
		});

		const { storeService } = await import('./store');

		await expect(storeService.init()).rejects.toThrow('boom');
		await expect(storeService.init()).resolves.toBeUndefined();

		expect(loadMock).toHaveBeenCalledTimes(2);
		expect(loggerMock.info).toHaveBeenCalledWith('Store initialized.');
	});

	it('waits for in-flight writes and saves before taking a backup', async () => {
		let finishWrite!: () => void;
		const setMock = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finishWrite = resolve;
				})
		);
		const saveMock = vi.fn().mockResolvedValue(undefined);
		loadMock.mockResolvedValueOnce({ set: setMock, save: saveMock });
		const { storeService } = await import('./store');
		await storeService.init();
		const write = storeService.set('fixture', 'before');
		const snapshot = vi.fn().mockResolvedValue('backup');
		const backup = storeService.withBackupSnapshot(snapshot);
		await Promise.resolve();
		expect(snapshot).not.toHaveBeenCalled();
		finishWrite();
		await write;
		await expect(backup).resolves.toBe('backup');
		expect(saveMock).toHaveBeenCalledTimes(2);
		expect(saveMock.mock.invocationCallOrder[1]).toBeLessThan(snapshot.mock.invocationCallOrder[0]);
	});

	it('holds new settings writes until the backup finishes', async () => {
		let finishSnapshot!: () => void;
		const setMock = vi.fn().mockResolvedValue(undefined);
		loadMock.mockResolvedValueOnce({ set: setMock, save: vi.fn().mockResolvedValue(undefined) });
		const { storeService } = await import('./store');
		await storeService.init();
		const backup = storeService.withBackupSnapshot(
			() =>
				new Promise<void>((resolve) => {
					finishSnapshot = resolve;
				})
		);
		await vi.waitFor(() => expect(finishSnapshot).toBeTypeOf('function'));
		const write = storeService.set('fixture', 'after');
		await Promise.resolve();
		expect(setMock).not.toHaveBeenCalled();
		finishSnapshot();
		await Promise.all([backup, write]);
		expect(setMock).toHaveBeenCalledWith('fixture', 'after');
	});

	it('drains managed file writes and holds new ones throughout the snapshot', async () => {
		let finishFirst!: () => void;
		let finishSnapshot!: () => void;
		const { storeService } = await import('./store');
		const first = storeService.withManagedFileMutation(
			() =>
				new Promise<void>((resolve) => {
					finishFirst = resolve;
				})
		);
		const snapshot = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finishSnapshot = resolve;
				})
		);
		const backup = storeService.withBackupSnapshot(snapshot);
		const laterMutation = vi.fn().mockResolvedValue(undefined);
		const later = storeService.withManagedFileMutation(laterMutation);
		await Promise.resolve();
		expect(snapshot).not.toHaveBeenCalled();
		expect(laterMutation).not.toHaveBeenCalled();
		finishFirst();
		await first;
		await vi.waitFor(() => expect(snapshot).toHaveBeenCalledTimes(1));
		expect(laterMutation).not.toHaveBeenCalled();
		finishSnapshot();
		await Promise.all([backup, later]);
		expect(laterMutation).toHaveBeenCalledTimes(1);
	});

	it('refuses to snapshot unsaved settings and releases waiting writes after failure', async () => {
		const setMock = vi.fn().mockResolvedValue(undefined);
		const saveMock = vi
			.fn()
			.mockRejectedValueOnce(new Error('Disk full'))
			.mockResolvedValue(undefined);
		loadMock.mockResolvedValueOnce({ set: setMock, save: saveMock });
		const { storeService } = await import('./store');
		await storeService.init();
		const snapshot = vi.fn();
		const backup = storeService.withBackupSnapshot(snapshot);
		const write = storeService.set('fixture', 'after');
		await expect(backup).rejects.toThrow('Disk full');
		await write;
		expect(snapshot).not.toHaveBeenCalled();
		expect(setMock).toHaveBeenCalledTimes(1);
	});

	it('returns an empty explorer tree state when nothing is stored', async () => {
		const getMock = vi.fn().mockResolvedValue(null);
		const { storeService } = await import('./store');
		const serviceState = storeService as unknown as Record<string, unknown>;
		serviceState.store = {
			get: getMock,
			set: vi.fn(),
			save: vi.fn(),
			delete: vi.fn()
		};
		serviceState.initialized = true;

		await expect(storeService.getExplorerTreeState()).resolves.toEqual({
			expandedProjectIds: [],
			collapsedAssetIds: []
		});
		expect(getMock).toHaveBeenCalledWith('explorerTreeState');
	});

	it('persists the explorer tree state snapshot in one store write', async () => {
		const setMock = vi.fn().mockResolvedValue(undefined);
		const saveMock = vi.fn().mockResolvedValue(undefined);
		const { storeService } = await import('./store');
		const serviceState = storeService as unknown as Record<string, unknown>;
		serviceState.store = {
			get: vi.fn(),
			set: setMock,
			save: saveMock,
			delete: vi.fn()
		};
		serviceState.initialized = true;

		await storeService.setExplorerTreeState({
			expandedProjectIds: ['project-1'],
			collapsedAssetIds: ['asset-2']
		});

		expect(setMock).toHaveBeenCalledWith('explorerTreeState', {
			expandedProjectIds: ['project-1'],
			collapsedAssetIds: ['asset-2']
		});
		expect(saveMock).toHaveBeenCalledTimes(1);
	});

	it('defaults the assistant preference to true when nothing is stored', async () => {
		const getMock = vi.fn().mockResolvedValue(null);
		const { storeService } = await import('./store');
		const serviceState = storeService as unknown as Record<string, unknown>;
		serviceState.store = {
			get: getMock,
			set: vi.fn(),
			save: vi.fn(),
			delete: vi.fn()
		};
		serviceState.initialized = true;

		await expect(storeService.getAssistantEnabled()).resolves.toBe(true);
		expect(getMock).toHaveBeenCalledWith('assistantEnabled');
	});

	it('persists the assistant preference with one store write', async () => {
		const setMock = vi.fn().mockResolvedValue(undefined);
		const saveMock = vi.fn().mockResolvedValue(undefined);
		const { storeService } = await import('./store');
		const serviceState = storeService as unknown as Record<string, unknown>;
		serviceState.store = {
			get: vi.fn(),
			set: setMock,
			save: saveMock,
			delete: vi.fn()
		};
		serviceState.initialized = true;

		await storeService.setAssistantEnabled(true);

		expect(setMock).toHaveBeenCalledWith('assistantEnabled', true);
		expect(saveMock).toHaveBeenCalledTimes(1);
	});
});
