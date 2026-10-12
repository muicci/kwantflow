import { invoke } from '@tauri-apps/api/core';
import { storeService } from './store.js';

// 'pre_update' snapshots were created by the removed auto-updater (0.12.x) and are kept readable.
export type BackupReason = 'auto' | 'manual' | 'pre_update' | 'pre_restore';
export type BackupCadence = 'weekly';

export type BackupSummary = {
	id: string;
	reason: BackupReason;
	createdAt: string;
	appVersion: string;
	schemaVersion: number;
	fileCount: number;
	totalBytes: number;
};

export type BackupStatus = {
	lastBackup: BackupSummary | null;
	lastAutomaticBackup: BackupSummary | null;
	recentSnapshots: BackupSummary[];
	retainedRecoveryPaths: string[];
};

export type BackupInspection = {
	summary: BackupSummary;
	workspaceDisplayName: string | null;
	workspaceCount: number;
	externalReferences: string[];
};

export type BackupRestoreStageResult = {
	summary: BackupSummary;
	safetySnapshotCreated: boolean;
};

export type BackupDeleteResult = {
	summary: BackupSummary;
};

export function resolveAutomaticBackupCadence(): BackupCadence {
	return 'weekly';
}

export type BackupArchiveResult = { summary: BackupSummary; path: string };

class BackupService {
	async getStatus(): Promise<BackupStatus> {
		return invoke<BackupStatus>('get_backup_status');
	}

	async createSnapshot(reason: BackupReason): Promise<BackupSummary> {
		return storeService.withBackupSnapshot(() =>
			invoke<BackupSummary>('create_backup_snapshot', {
				reason
			})
		);
	}

	async inspectSnapshot(snapshotId: string): Promise<BackupInspection> {
		return invoke<BackupInspection>('inspect_backup_snapshot', {
			snapshotId
		});
	}

	async stageRestoreFromSnapshot(snapshotId: string): Promise<BackupRestoreStageResult> {
		return invoke<BackupRestoreStageResult>('stage_backup_restore_from_snapshot', {
			snapshotId
		});
	}

	async exportArchive(destinationPath: string): Promise<BackupArchiveResult> {
		return storeService.withBackupSnapshot(() =>
			invoke<BackupArchiveResult>('export_backup_archive', { destinationPath })
		);
	}

	async inspectArchive(sourcePath: string): Promise<BackupInspection> {
		return invoke<BackupInspection>('inspect_backup_archive', { sourcePath });
	}

	async stageRestoreFromArchive(sourcePath: string): Promise<BackupRestoreStageResult> {
		return invoke<BackupRestoreStageResult>('stage_backup_restore_from_archive', { sourcePath });
	}

	async cancelPendingRestore(): Promise<void> {
		await invoke('cancel_pending_backup_restore');
	}

	async deleteSnapshot(snapshotId: string): Promise<BackupDeleteResult> {
		return invoke<BackupDeleteResult>('delete_backup_snapshot', {
			snapshotId
		});
	}
}

export const backupService = new BackupService();
