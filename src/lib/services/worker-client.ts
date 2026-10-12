import * as Comlink from 'comlink';
import type { IndustrialWorkerAPI } from '../workers/industrial.worker';

/**
 * Singleton client for the background Industrial Worker.
 */
class WorkerClient {
	private worker: Worker | null = null;
	private api: Comlink.Remote<IndustrialWorkerAPI> | null = null;

	getAPI(): Comlink.Remote<IndustrialWorkerAPI> {
		if (!this.api) {
			// Vite-native worker instantiation
			this.worker = new Worker(new URL('../workers/industrial.worker.ts', import.meta.url), {
				type: 'module'
			});
			this.api = Comlink.wrap<IndustrialWorkerAPI>(this.worker);
		}
		return this.api;
	}
}

export const workerClient = new WorkerClient();
