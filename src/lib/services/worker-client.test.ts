/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Comlink from 'comlink';

vi.mock('comlink', () => ({
	wrap: vi.fn().mockReturnValue({ mockApi: true })
}));

describe('worker-client', () => {
	let OriginalWorker: typeof Worker;
	let workerMock: any;

	beforeEach(() => {
		OriginalWorker = globalThis.Worker;

		workerMock = vi.fn(function () {
			return {
				postMessage: vi.fn(),
				terminate: vi.fn(),
				addEventListener: vi.fn(),
				removeEventListener: vi.fn(),
				dispatchEvent: vi.fn(),
				onerror: null,
				onmessage: null,
				onmessageerror: null
			};
		});

		globalThis.Worker = workerMock as unknown as typeof Worker;

		vi.resetModules();
	});

	afterEach(() => {
		globalThis.Worker = OriginalWorker;
		vi.clearAllMocks();
	});

	it('should lazily instantiate the worker and wrap it with Comlink only once', async () => {
		const { workerClient } = await import('./worker-client.js');

		expect(globalThis.Worker).not.toHaveBeenCalled();
		expect(Comlink.wrap).not.toHaveBeenCalled();

		const api1 = workerClient.getAPI();

		expect(globalThis.Worker).toHaveBeenCalledTimes(1);
		expect(globalThis.Worker).toHaveBeenCalledWith(expect.any(URL), { type: 'module' });
		expect(Comlink.wrap).toHaveBeenCalledTimes(1);
		expect(api1).toEqual({ mockApi: true });

		const api2 = workerClient.getAPI();

		expect(globalThis.Worker).toHaveBeenCalledTimes(1);
		expect(Comlink.wrap).toHaveBeenCalledTimes(1);
		expect(api2).toBe(api1);
	});
});
