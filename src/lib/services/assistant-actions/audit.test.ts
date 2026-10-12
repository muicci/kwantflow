import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockWarn, mockInfo, mockWriteAssistantActionAudit } = vi.hoisted(() => {
	return {
		mockWarn: vi.fn(),
		mockInfo: vi.fn(),
		mockWriteAssistantActionAudit: vi.fn()
	};
});

vi.mock('$lib/services/logger.js', () => ({
	createLogger: vi.fn(() => ({
		warn: mockWarn,
		info: mockInfo
	}))
}));

vi.mock('$lib/services/db.js', () => ({
	dbService: {
		writeAssistantActionAudit: mockWriteAssistantActionAudit
	}
}));

import { recordAssistantActionAudit, type AssistantActionAuditEntry } from './audit.js';
import { dbService } from '$lib/services/db.js';

describe('recordAssistantActionAudit', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockWriteAssistantActionAudit.mockResolvedValue(undefined);
		// Restore the function if it was deleted in a previous test
		dbService.writeAssistantActionAudit = mockWriteAssistantActionAudit;
	});

	it('writes to dbService and translates persisted_unverified status', () => {
		const entry: AssistantActionAuditEntry = {
			turnId: '1',
			actionId: '2',
			toolName: 'test',
			status: 'persisted_unverified'
		};
		recordAssistantActionAudit(entry);
		expect(mockWriteAssistantActionAudit).toHaveBeenCalledWith({
			...entry,
			status: 'executed'
		});
		expect(mockInfo).not.toHaveBeenCalled();
	});

	it('writes to dbService with other statuses untranslated', () => {
		const entry: AssistantActionAuditEntry = {
			turnId: '1',
			actionId: '2',
			toolName: 'test',
			status: 'proposed'
		};
		recordAssistantActionAudit(entry);
		expect(mockWriteAssistantActionAudit).toHaveBeenCalledWith(entry);
		expect(mockInfo).not.toHaveBeenCalled();
	});

	it('logs warning when dbService write fails', async () => {
		const entry: AssistantActionAuditEntry = {
			turnId: '1',
			actionId: '2',
			toolName: 'test',
			status: 'proposed'
		};
		const error = new Error('db error');
		mockWriteAssistantActionAudit.mockRejectedValue(error);

		recordAssistantActionAudit(entry);

		// Allow the promise chain to settle
		await Promise.resolve();
		await Promise.resolve();

		expect(mockWarn).toHaveBeenCalledWith('Failed to write durable assistant action audit', {
			err: error,
			entry
		});
	});

	it('falls back to logger when dbService.writeAssistantActionAudit is not a function', () => {
		const entry: AssistantActionAuditEntry = {
			turnId: '1',
			actionId: '2',
			toolName: 'test',
			status: 'proposed'
		};

		// Remove the function to trigger fallback
		// @ts-expect-error test
		delete dbService.writeAssistantActionAudit;

		recordAssistantActionAudit(entry);

		expect(mockInfo).toHaveBeenCalledWith(
			'Assistant action audit event (in-memory fallback)',
			entry
		);
	});
});
