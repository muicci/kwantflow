import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();
const errorStateMock = {
	catchError: vi.fn()
};
const workspaceStateMock = {
	needsBootstrap: false
};
const dbServiceMock = {
	close: vi.fn(),
	init: vi.fn()
};
const toastMock = {
	success: vi.fn()
};
const relaunchMock = vi.fn();
const openDialogMock = vi.fn();
const saveDialogMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
	invoke: invokeMock
}));

vi.mock('./errors.svelte', () => ({
	errorState: errorStateMock
}));

vi.mock('./workspace.svelte', () => ({
	workspaceState: workspaceStateMock
}));

vi.mock('../services/db', () => ({
	dbService: dbServiceMock
}));

vi.mock('svelte-sonner', () => ({
	toast: toastMock
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: openDialogMock, save: saveDialogMock }));

vi.mock('@tauri-apps/plugin-process', () => ({
	relaunch: relaunchMock
}));

describe('backupState', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-04-11T10:00:00.000Z'));
		vi.resetModules();
		vi.clearAllMocks();
		workspaceStateMock.needsBootstrap = false;
		invokeMock.mockResolvedValue({
			lastBackup: null,
			lastAutomaticBackup: null,
			recentSnapshots: []
		});
		dbServiceMock.close.mockResolvedValue(undefined);
		dbServiceMock.init.mockResolvedValue(undefined);
		relaunchMock.mockResolvedValue(undefined);
		openDialogMock.mockResolvedValue(null);
		saveDialogMock.mockResolvedValue(null);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('uses weekly automatic backups for local workspaces', async () => {
		const { backupState } = await import('./backup.svelte');

		await backupState.hydrate();

		expect(backupState.automaticCadenceLabel).toBe('Weekly');
	});

	it('uses weekly automatic backups for all workspaces', async () => {
		const { backupState } = await import('./backup.svelte');

		await backupState.hydrate();

		expect(backupState.automaticCadenceLabel).toBe('Weekly');
	});

	it('skips automatic backups before a workspace has completed bootstrap', async () => {
		workspaceStateMock.needsBootstrap = true;

		const { backupState } = await import('./backup.svelte');

		await backupState.maybeRunAutomaticBackup();

		expect(invokeMock).not.toHaveBeenCalled();
	});

	it('creates an automatic backup only when the weekly cadence window has elapsed', async () => {
		invokeMock
			.mockResolvedValueOnce({
				lastBackup: null,
				lastAutomaticBackup: {
					id: 'backup-auto-1',
					reason: 'auto',
					createdAt: '2026-04-01T09:00:00.000Z'
				},
				recentSnapshots: []
			})
			.mockResolvedValueOnce({
				lastBackup: {
					id: 'backup-auto-2',
					reason: 'auto',
					createdAt: '2026-04-11T10:00:00.000Z'
				},
				lastAutomaticBackup: {
					id: 'backup-auto-2',
					reason: 'auto',
					createdAt: '2026-04-11T10:00:00.000Z'
				},
				recentSnapshots: []
			});

		const { backupState } = await import('./backup.svelte');

		await backupState.hydrate();
		await backupState.maybeRunAutomaticBackup();

		expect(invokeMock).toHaveBeenCalledWith('create_backup_snapshot', {
			reason: 'auto'
		});
	});

	it('stages a snapshot restore by closing the live database before relaunch', async () => {
		invokeMock
			.mockResolvedValueOnce({
				lastBackup: null,
				lastAutomaticBackup: null,
				recentSnapshots: []
			})
			.mockResolvedValueOnce({
				summary: {
					id: 'backup-import-1',
					reason: 'manual',
					createdAt: '2026-04-10T12:00:00.000Z'
				},
				safetySnapshotCreated: true
			});

		const { backupState } = await import('./backup.svelte');

		await backupState.hydrate();
		await backupState.stageRestoreFromSnapshot('backup-import-1');

		expect(dbServiceMock.close).toHaveBeenCalledTimes(1);
		expect(invokeMock).toHaveBeenCalledWith('stage_backup_restore_from_snapshot', {
			snapshotId: 'backup-import-1'
		});
		expect(toastMock.success).toHaveBeenCalledWith(
			'Backup restore is ready. Restarting Kwantflow…'
		);
		expect(relaunchMock).toHaveBeenCalledTimes(1);
	});

	it('inspects a selected backup snapshot before confirming restore', async () => {
		invokeMock
			.mockResolvedValueOnce({
				lastBackup: null,
				lastAutomaticBackup: null,
				recentSnapshots: []
			})
			.mockResolvedValueOnce({
				summary: {
					id: 'backup-import-1',
					reason: 'manual',
					createdAt: '2026-04-10T12:00:00.000Z',
					appVersion: '0.1.1',
					schemaVersion: 57,
					fileCount: 12,
					totalBytes: 2048
				},
				workspaceDisplayName: 'Acme Fabrication'
			});

		const { backupState } = await import('./backup.svelte');

		await backupState.hydrate();
		await backupState.promptRestoreSnapshot('backup-import-1');

		expect(invokeMock).toHaveBeenCalledWith('inspect_backup_snapshot', {
			snapshotId: 'backup-import-1'
		});
		expect(backupState.pendingRestoreInspection?.workspaceDisplayName).toBe('Acme Fabrication');
		expect(backupState.pendingRestoreSnapshotId).toBe('backup-import-1');
		expect(relaunchMock).not.toHaveBeenCalled();
	});

	it('keeps the inspected snapshot and staged selection together during competing clicks', async () => {
		let resolveInspection: (inspection: unknown) => void = () => {};
		invokeMock.mockReturnValueOnce(
			new Promise((resolve) => {
				resolveInspection = resolve;
			})
		);
		const { backupState } = await import('./backup.svelte');
		backupState.pendingRestoreSnapshotId = 'previous';
		backupState.pendingRestoreInspection = {
			summary: {
				id: 'previous',
				reason: 'manual',
				createdAt: '2026-04-10T12:00:00.000Z',
				appVersion: '0.12.2',
				schemaVersion: 2,
				fileCount: 1,
				totalBytes: 1024
			},
			workspaceDisplayName: 'Previous fixture',
			workspaceCount: 1,
			externalReferences: []
		};

		const inspection = backupState.promptRestoreSnapshot('backup-a');
		await backupState.promptRestoreSnapshot('backup-b');
		await backupState.confirmPendingRestore();

		expect(invokeMock).toHaveBeenCalledTimes(1);
		expect(backupState.pendingRestoreInspection).toBeNull();
		expect(backupState.pendingRestoreSnapshotId).toBeNull();
		expect(backupState.isBusy).toBe(true);
		resolveInspection({
			summary: { id: 'backup-a' },
			workspaceDisplayName: 'Fixture',
			workspaceCount: 1,
			externalReferences: []
		});
		await inspection;
		expect(backupState.pendingRestoreInspection?.summary.id).toBe('backup-a');
		expect(backupState.pendingRestoreSnapshotId).toBe('backup-a');
		expect(backupState.isBusy).toBe(false);

		await backupState.confirmPendingRestore();
		expect(invokeMock).toHaveBeenCalledWith('stage_backup_restore_from_snapshot', {
			snapshotId: 'backup-a'
		});
	});

	it('deletes a selected backup snapshot and refreshes status', async () => {
		invokeMock
			.mockResolvedValueOnce({
				lastBackup: null,
				lastAutomaticBackup: null,
				recentSnapshots: []
			})
			.mockResolvedValueOnce({
				summary: {
					id: 'backup-manual-1',
					reason: 'manual',
					createdAt: '2026-04-10T12:00:00.000Z',
					appVersion: '0.1.1',
					schemaVersion: 57,
					fileCount: 12,
					totalBytes: 2048
				}
			})
			.mockResolvedValueOnce({
				lastBackup: null,
				lastAutomaticBackup: null,
				recentSnapshots: []
			});

		const { backupState } = await import('./backup.svelte');

		await backupState.hydrate();
		await backupState.deleteSnapshot('backup-manual-1');

		expect(invokeMock).toHaveBeenCalledWith('delete_backup_snapshot', {
			snapshotId: 'backup-manual-1'
		});
		expect(toastMock.success).toHaveBeenCalledWith('Backup deleted');
	});
	it('validates an imported archive before enabling confirmation or closing live data', async () => {
		openDialogMock.mockResolvedValue('/tmp/portable.zip');
		invokeMock.mockResolvedValueOnce({
			summary: { id: 'portable' },
			workspaceDisplayName: 'Fixture',
			workspaceCount: 2,
			externalReferences: []
		});
		const { backupState } = await import('./backup.svelte');
		await backupState.promptImportArchive();
		expect(backupState.pendingRestoreArchivePath).toBe('/tmp/portable.zip');
		expect(backupState.pendingRestoreInspection?.workspaceCount).toBe(2);
		expect(dbServiceMock.close).not.toHaveBeenCalled();
		expect(relaunchMock).not.toHaveBeenCalled();
	});

	it('rejects an invalid archive without closing data or relaunching', async () => {
		openDialogMock.mockResolvedValue('/tmp/damaged.zip');
		invokeMock.mockRejectedValueOnce(new Error('Checksum mismatch'));
		const { backupState } = await import('./backup.svelte');
		await backupState.promptImportArchive();
		expect(backupState.pendingRestoreInspection).toBeNull();
		expect(backupState.pendingRestoreArchivePath).toBeNull();
		expect(dbServiceMock.close).not.toHaveBeenCalled();
		expect(relaunchMock).not.toHaveBeenCalled();
		expect(errorStateMock.catchError).toHaveBeenCalled();
	});

	it('does not snapshot or mutate data when the export dialog is cancelled', async () => {
		const { backupState } = await import('./backup.svelte');
		await backupState.exportPortableBackup();
		expect(invokeMock).not.toHaveBeenCalled();
		expect(backupState.isExportingBackup).toBe(false);
	});

	it('cancels an unapplied restore and reopens live data when relaunch fails', async () => {
		relaunchMock.mockRejectedValueOnce(new Error('Restart failed'));
		const { backupState } = await import('./backup.svelte');
		await backupState.stageRestoreFromArchive('/tmp/portable.zip');
		expect(invokeMock).toHaveBeenCalledWith('cancel_pending_backup_restore');
		expect(dbServiceMock.init).toHaveBeenCalledTimes(1);
		expect(backupState.isRestoreRecoveryBlocked).toBe(false);
		expect(errorStateMock.catchError).toHaveBeenCalled();
	});

	it('keeps background activity blocked if a queued restore cannot be cancelled', async () => {
		relaunchMock.mockRejectedValueOnce(new Error('Restart failed'));
		invokeMock.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('Journal exists'));
		const { backupState } = await import('./backup.svelte');
		await backupState.stageRestoreFromSnapshot('backup-fixture');
		expect(dbServiceMock.init).not.toHaveBeenCalled();
		expect(backupState.isRestoreRecoveryBlocked).toBe(true);
		expect(backupState.isBusy).toBe(true);
		expect(errorStateMock.catchError).toHaveBeenCalledWith(
			expect.objectContaining({
				message: expect.stringContaining('Restart the app before editing data')
			}),
			'Restore backup'
		);
	});
});
