import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
import { backupService, resolveAutomaticBackupCadence } from './backup.js';

describe('local backup service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		invokeMock.mockResolvedValue({});
	});

	it('uses the local weekly cadence and creates without account parameters', async () => {
		expect(resolveAutomaticBackupCadence()).toBe('weekly');
		await backupService.createSnapshot('manual');
		expect(invokeMock).toHaveBeenCalledWith('create_backup_snapshot', { reason: 'manual' });
	});

	it('keeps archive inspection separate from staging replacement', async () => {
		await backupService.inspectArchive('/tmp/backup.zip');
		expect(invokeMock).toHaveBeenCalledWith('inspect_backup_archive', {
			sourcePath: '/tmp/backup.zip'
		});
		expect(invokeMock).toHaveBeenCalledTimes(1);
		await backupService.stageRestoreFromArchive('/tmp/backup.zip');
		expect(invokeMock).toHaveBeenLastCalledWith('stage_backup_restore_from_archive', {
			sourcePath: '/tmp/backup.zip'
		});
	});
});
