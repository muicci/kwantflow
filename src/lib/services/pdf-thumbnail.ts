import { readVaultFile } from './assets';
import { createLogger } from './logger.js';
import { workerClient } from './worker-client';

/** Module-level cache: filePath → object URL of rendered thumbnail. */
const cache = new Map<string, string>();

/** In-flight renders: deduplicates concurrent requests for the same file. */
const inflight = new Map<string, Promise<string | null>>();
const recentFailures = new Map<string, number>();
const log = createLogger('pdfThumbnailService');
const FAILURE_RETRY_COOLDOWN_MS = 30_000;

/**
 * Get a thumbnail blob URL for a PDF file.
 * Returns cached result instantly if available.
 * Returns null on render failure.
 * NOW OFF-MAIN-THREAD.
 */
export async function getPdfThumbnail(filePath: string): Promise<string | null> {
	const cached = cache.get(filePath);
	if (cached) return cached;

	const lastFailureAt = recentFailures.get(filePath);
	if (lastFailureAt && Date.now() - lastFailureAt < FAILURE_RETRY_COOLDOWN_MS) {
		return null;
	}

	const pending = inflight.get(filePath);
	if (pending) return pending;

	const promise = renderThumbnail(filePath);
	inflight.set(filePath, promise);

	try {
		return await promise;
	} finally {
		inflight.delete(filePath);
	}
}

async function renderThumbnail(filePath: string): Promise<string | null> {
	try {
		const pdfBytes = await readVaultFile(filePath);

		// Call the background worker via Comlink
		const api = workerClient.getAPI();
		const blob = await api.renderPdfThumbnail(pdfBytes);

		const url = URL.createObjectURL(blob);
		recentFailures.delete(filePath);
		cache.set(filePath, url);
		return url;
	} catch (e) {
		recentFailures.set(filePath, Date.now());
		log.error('Background render failed', {
			filePath,
			retryAfterMs: FAILURE_RETRY_COOLDOWN_MS,
			error: e
		});
		return null;
	}
}
