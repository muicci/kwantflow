import { toast } from 'svelte-sonner';
import { createLogger } from '$lib/services/logger.js';

const log = createLogger('errorsState');

/**
 * ErrorState — Global error handling and health monitoring.
 * Logs errors through the shared app logger, displays Sonner toasts, and tracks system health.
 */
class ErrorState {
	lastError: string | null = $state(null);
	healthStatus: 'Healthy' | 'Error' = $state('Healthy');

	/**
	 * Catch, log, and display an error.
	 * @param error - The error to handle
	 * @param context - Human-readable context (e.g. "Boot Sequence", "DB Query")
	 * @param retry - Optional retry callback for the toast action button
	 * @param options - Optional safe user-facing overrides and configurations
	 */
	async catchError(
		error: unknown,
		context?: string,
		retry?: () => void,
		options?: { description?: string; silent?: boolean }
	) {
		log.error(`${context || 'Unknown context'}:`, error);

		this.healthStatus = 'Error';

		const errorMessage = error instanceof Error ? error.message : String(error);
		// Default to a non-technical, friendly user message to avoid exposing raw system logs
		const userDescription = options?.description ?? 'Something went wrong. Please try again.';
		this.lastError = errorMessage;

		if (!options?.silent) {
			toast.error(context || 'An error occurred', {
				description: userDescription,
				action: retry ? { label: 'Retry', onClick: retry } : { label: 'Dismiss', onClick: () => {} }
			});
		}
	}

	resetHealth() {
		this.healthStatus = 'Healthy';
		this.lastError = null;
	}

	captureLayoutWarning(message: string, extra?: Record<string, unknown>) {
		log.warn(`[LayoutWarning] ${message}`, extra);
	}
}

export const errorState = new ErrorState();
