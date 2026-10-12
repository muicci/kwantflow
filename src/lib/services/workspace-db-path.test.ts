import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/env', () => ({ isTauri: vi.fn(() => true) }));

describe('dbService active workspace projection', () => {
	beforeEach(() => {
		vi.resetModules();
	});

	it('starts without a workspace fallback and projects a Rust-activated workspace ID', async () => {
		const { dbService } = await import('./db');

		expect(dbService.getDatabasePath()).toBeNull();
		dbService.adoptActiveWorkspace('workspace-1');
		expect(dbService.getDatabasePath()).toBe('sqlite:workspaces/workspace-1/workspace.db');
	});

	it('rejects unsafe workspace IDs instead of accepting frontend database paths', async () => {
		const { dbService } = await import('./db');

		expect(() => dbService.adoptActiveWorkspace('../workspace')).toThrow(
			'Invalid active workspace ID'
		);
		expect(dbService.getDatabasePath()).toBeNull();
	});
});
