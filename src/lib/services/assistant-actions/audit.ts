import { createLogger } from '$lib/services/logger.js';
import { dbService } from '$lib/services/db.js';

const log = createLogger('assistant-action-audit');

export type AssistantActionAuditStatus =
	| 'proposed'
	| 'validated'
	| 'rejected'
	| 'approved'
	| 'executed'
	| 'failed'
	| 'persisted_unverified';

export type AssistantActionAuditEntry = {
	turnId: string;
	actionId: string;
	toolName: string;
	status: AssistantActionAuditStatus;
	itemCount?: number;
	issueCount?: number;
	errorCount?: number;
	errorMessage?: string;
	/** Optional JSON payload for verification details, provenance, or structured error data. */
	payloadJson?: string;
};

function toDurableAuditStatus(
	status: AssistantActionAuditStatus
): Exclude<AssistantActionAuditStatus, 'persisted_unverified'> {
	return status === 'persisted_unverified' ? 'executed' : status;
}

export function recordAssistantActionAudit(entry: AssistantActionAuditEntry): void {
	// Durable audit path: write to assistant_action_audit SQLite table via dbService.
	// Falls back to structured in-memory log when dbService is unavailable.
	try {
		if (typeof dbService.writeAssistantActionAudit === 'function') {
			dbService
				.writeAssistantActionAudit({
					...entry,
					status: toDurableAuditStatus(entry.status)
				})
				.catch((err) => {
					log.warn('Failed to write durable assistant action audit', { err, entry });
				});
			return;
		}
	} catch {
		// Fall through to in-memory path
	}
	log.info('Assistant action audit event (in-memory fallback)', entry);
}
