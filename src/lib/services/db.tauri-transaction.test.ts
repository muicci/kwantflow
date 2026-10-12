import { describe, expect, it, vi } from 'vitest';

import { TauriSqlDriver } from './db.js';

function createMockDatabase() {
	return {
		execute: vi.fn(async () => ({
			rowsAffected: 0,
			lastInsertId: 0
		})),
		select: vi.fn(async () => [])
	};
}

describe('request-scoped database IPC transactions', () => {
	it('rejects frontend transaction attempts over request-scoped IPC', async () => {
		const db = createMockDatabase();
		const driver = new TauriSqlDriver(db as never);
		const connection = await driver.acquireConnection();

		await expect(driver.beginTransaction(connection, {} as never)).rejects.toThrow(
			'Frontend transactions are unsupported over request-scoped database IPC'
		);
		await expect(driver.commitTransaction(connection)).rejects.toThrow(
			'Frontend transactions are unsupported over request-scoped database IPC'
		);
		await expect(driver.rollbackTransaction(connection)).rejects.toThrow(
			'Frontend transactions are unsupported over request-scoped database IPC'
		);
	});
});
