import { beforeEach, describe, expect, it, vi } from 'vitest';

const envMock = {
	isTauri: vi.fn()
};

const assertRuntimeSchemaHealthMock = vi.fn();
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

vi.mock('./db-schema-health.js', () => ({
	assertRuntimeSchemaHealth: assertRuntimeSchemaHealthMock,
	inspectRuntimeSchemaHealth: vi.fn(),
	inspectRuntimeContractVersion: vi.fn()
}));

vi.mock('./logger.js', () => ({
	createLogger: () => loggerMock
}));

describe('dbService init', () => {
	beforeEach(async () => {
		vi.resetModules();
		vi.clearAllMocks();
		envMock.isTauri.mockReturnValue(true);
		assertRuntimeSchemaHealthMock.mockResolvedValue(undefined);

		const { dbService } = await import('./db');
		const serviceState = dbService as unknown as Record<string, unknown>;
		serviceState.db = null;
		serviceState.kysely = null;
		serviceState.initPromise = null;
		serviceState.readOnlyDbPromise = null;
	});

	it('deduplicates concurrent init calls', async () => {
		const fakeDb = {
			execute: vi.fn(),
			select: vi.fn()
		};
		let loadPending = false;
		let resolveLoad: (value: unknown) => void = () => {
			throw new Error(
				'Expected loadDatabaseWithCurrentBaseline() to be pending during concurrent init test.'
			);
		};

		const { dbService } = await import('./db');
		const serviceState = dbService as unknown as {
			loadDatabaseWithCurrentBaseline: () => Promise<unknown>;
			syncRuntimeContractState: (db: unknown) => Promise<void>;
		};

		vi.spyOn(serviceState, 'loadDatabaseWithCurrentBaseline').mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					loadPending = true;
					resolveLoad = resolve;
				})
		);
		vi.spyOn(serviceState, 'syncRuntimeContractState').mockResolvedValue(undefined);

		const initCalls = [dbService.init(), dbService.init(), dbService.init()];

		expect(serviceState.loadDatabaseWithCurrentBaseline).toHaveBeenCalledTimes(1);
		expect(loadPending).toBe(true);

		resolveLoad(fakeDb);
		await Promise.all(initCalls);

		expect(serviceState.loadDatabaseWithCurrentBaseline).toHaveBeenCalledTimes(1);
		expect(assertRuntimeSchemaHealthMock).toHaveBeenCalledTimes(1);
		expect(loggerMock.info).toHaveBeenCalledWith('Database initialized with Kysely.');
	});

	it('clears the in-flight init promise after a failure so init can retry', async () => {
		const fakeDb = {
			execute: vi.fn(),
			select: vi.fn()
		};

		const { dbService } = await import('./db');
		const serviceState = dbService as unknown as {
			loadDatabaseWithCurrentBaseline: () => Promise<unknown>;
			syncRuntimeContractState: (db: unknown) => Promise<void>;
		};

		vi.spyOn(serviceState, 'loadDatabaseWithCurrentBaseline')
			.mockRejectedValueOnce(new Error('boom'))
			.mockResolvedValueOnce(fakeDb);
		vi.spyOn(serviceState, 'syncRuntimeContractState').mockResolvedValue(undefined);

		await expect(dbService.init()).rejects.toThrow('boom');
		await expect(dbService.init()).resolves.toBeUndefined();

		expect(serviceState.loadDatabaseWithCurrentBaseline).toHaveBeenCalledTimes(2);
		expect(loggerMock.info).toHaveBeenCalledWith('Database initialized with Kysely.');
	});

	it('reuses the read-only database handle without requiring sql.close', async () => {
		const { dbService } = await import('./db');
		const serviceState = dbService as unknown as {
			init: () => Promise<void>;
			withReadOnlyDatabase: <T>(fn: (db: unknown) => Promise<T>) => Promise<T>;
		};
		vi.spyOn(serviceState, 'init').mockResolvedValue(undefined);

		const first = await serviceState.withReadOnlyDatabase(async (db) => db);
		const second = await serviceState.withReadOnlyDatabase(async (db) => db);

		expect(first).toBe(second);
		expect(serviceState.init).toHaveBeenCalledTimes(2);
	});

	it('waits for the workspace database initialiser before falling back to a separate read-only handle', async () => {
		const fakeDb = {
			execute: vi.fn(),
			select: vi.fn()
		};

		const { dbService } = await import('./db');
		const serviceState = dbService as unknown as {
			loadDatabaseWithCurrentBaseline: () => Promise<unknown>;
			syncRuntimeContractState: (db: unknown) => Promise<void>;
			withReadOnlyDatabase: <T>(fn: (db: unknown) => Promise<T>) => Promise<T>;
		};

		vi.spyOn(serviceState, 'loadDatabaseWithCurrentBaseline').mockResolvedValue(fakeDb);
		vi.spyOn(serviceState, 'syncRuntimeContractState').mockResolvedValue(undefined);

		const result = await serviceState.withReadOnlyDatabase(async (db) => db);

		expect(result).toBe(fakeDb);
		expect(serviceState.loadDatabaseWithCurrentBaseline).toHaveBeenCalledTimes(1);
	});

	it('uses the read-only database path directly for detached preview windows', async () => {
		const originalWindow = globalThis.window;
		vi.stubGlobal('window', {
			location: {
				pathname: '/preview/asset/project-1/asset-1'
			}
		} as Window);

		const { dbService } = await import('./db');
		const serviceState = dbService as unknown as {
			init: () => Promise<void>;
			withReadOnlyDatabase: <T>(fn: (db: unknown) => Promise<T>) => Promise<T>;
		};
		const initSpy = vi.spyOn(serviceState, 'init').mockResolvedValue(undefined);

		const result = await serviceState.withReadOnlyDatabase(async (db) => db);

		expect(result).toBeDefined();
		expect(initSpy).not.toHaveBeenCalled();

		if (originalWindow === undefined) {
			vi.unstubAllGlobals();
		} else {
			vi.stubGlobal('window', originalWindow);
		}
	});
});
