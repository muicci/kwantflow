import { relaunch } from '@tauri-apps/plugin-process';
import { open, save } from '@tauri-apps/plugin-dialog';
import { toast } from 'svelte-sonner';

import {
	backupService,
	resolveAutomaticBackupCadence,
	type BackupCadence,
	type BackupDeleteResult,
	type BackupInspection,
	type BackupStatus,
	type BackupSummary
} from '../services/backup';
import { dbService } from '../services/db';
import { storeService } from '../services/store';
import { createLogger } from '../services/logger.js';
import { errorState } from './errors.svelte';
import { workspaceState } from './workspace.svelte';

const log = createLogger('backupState');
const EMPTY_BACKUP_STATUS: BackupStatus = {
	lastBackup: null,
	lastAutomaticBackup: null,
	recentSnapshots: [],
	retainedRecoveryPaths: []
};

function parseIsoDate(value: string | null | undefined): number | null {
	if (!value) return null;
	const parsed = Date.parse(value);
	return Number.isNaN(parsed) ? null : parsed;
}

function cadenceWindowMs(): number {
	return 7 * 24 * 60 * 60 * 1000;
}

function normaliseBackupStatus(status: BackupStatus | null | undefined): BackupStatus {
	if (!status) return { ...EMPTY_BACKUP_STATUS };
	return {
		lastBackup: status.lastBackup ?? null,
		lastAutomaticBackup: status.lastAutomaticBackup ?? null,
		recentSnapshots: Array.isArray(status.recentSnapshots) ? status.recentSnapshots : [],
		retainedRecoveryPaths: Array.isArray(status.retainedRecoveryPaths)
			? status.retainedRecoveryPaths
			: []
	};
}

class BackupState {
	status: BackupStatus = $state({ ...EMPTY_BACKUP_STATUS });
	/**
	 * Heartbeat interval for checking whether an automatic backup is due.
	 *
	 * Daily check, weekly create.
	 * The heartbeat calls maybeRunAutomaticBackup() which respects the actual weekly
	 * cadence (7-day window) via cadenceWindowMs(). Without this timer, long-running
	 * sessions (no app restart) would never trigger a backup.
	 *
	 * Retention cap (max 7 snapshots) is enforced server-side in backup.rs via prune_snapshots().
	 */
	private static readonly CADENCE_HEARTBEAT_MS = 24 * 60 * 60 * 1000;
	#periodicCheckHandle: ReturnType<typeof setInterval> | null = null;

	isHydrated = $state(false);
	isCreatingManualBackup = $state(false);
	isRestoringBackup = $state(false);
	isDeletingBackup = $state(false);
	isExportingBackup = $state(false);
	isInspectingArchive = $state(false);
	isCreatingAutomaticBackup = $state(false);
	isRestoreRecoveryBlocked = $state(false);
	pendingRestoreArchivePath: string | null = $state(null);
	isBusy: boolean = $derived(
		this.isCreatingManualBackup ||
			this.isCreatingAutomaticBackup ||
			this.isExportingBackup ||
			this.isInspectingArchive ||
			this.isRestoringBackup ||
			this.isDeletingBackup ||
			this.isRestoreRecoveryBlocked
	);
	pendingRestoreInspection: BackupInspection | null = $state(null);
	pendingRestoreSnapshotId: string | null = $state(null);

	automaticCadence: BackupCadence = $derived(resolveAutomaticBackupCadence());

	automaticCadenceLabel: string = $derived('Weekly');

	lastBackupSummary: BackupSummary | null = $derived(this.status.lastBackup);
	lastAutomaticBackupSummary: BackupSummary | null = $derived(this.status.lastAutomaticBackup);

	async hydrate(): Promise<void> {
		await this.refreshStatus();
		this.isHydrated = true;
		this.startPeriodicCheck();
	}

	private startPeriodicCheck(): void {
		if (this.#periodicCheckHandle) return;
		this.#periodicCheckHandle = setInterval(() => {
			void this.maybeRunAutomaticBackup();
		}, BackupState.CADENCE_HEARTBEAT_MS);
	}

	private stopPeriodicCheck(): void {
		if (this.#periodicCheckHandle) {
			clearInterval(this.#periodicCheckHandle);
			this.#periodicCheckHandle = null;
		}
	}

	async refreshStatus(): Promise<void> {
		this.status = normaliseBackupStatus(await backupService.getStatus());
	}

	async maybeRunAutomaticBackup(): Promise<void> {
		if (this.isBusy) return;
		if (workspaceState.needsBootstrap) {
			log.info('Skipping automatic backup until workspace bootstrap completes.');
			return;
		}

		if (!this.isHydrated) {
			await this.hydrate();
		}

		const lastAutomaticBackupAt = parseIsoDate(this.status.lastAutomaticBackup?.createdAt);
		const cadenceMs = cadenceWindowMs();
		if (lastAutomaticBackupAt !== null && Date.now() - lastAutomaticBackupAt < cadenceMs) {
			return;
		}

		this.isCreatingAutomaticBackup = true;
		try {
			await backupService.createSnapshot('auto');
			await this.refreshStatus();
		} catch (error) {
			log.warn('Automatic backup failed.', error);
		} finally {
			this.isCreatingAutomaticBackup = false;
		}
	}

	async createManualBackup(): Promise<void> {
		if (this.isBusy) return;
		this.isCreatingManualBackup = true;
		try {
			await backupService.createSnapshot('manual');
			await this.refreshStatus();
			toast.success('Backup created');
		} catch (error) {
			await errorState.catchError(error, 'Create backup');
		} finally {
			this.isCreatingManualBackup = false;
		}
	}

	clearPendingRestore(): void {
		this.pendingRestoreSnapshotId = null;
		this.pendingRestoreArchivePath = null;
		this.pendingRestoreInspection = null;
	}

	async confirmPendingRestore(): Promise<void> {
		if (this.isBusy) return;
		if (this.pendingRestoreArchivePath) {
			await this.stageRestoreFromArchive(this.pendingRestoreArchivePath);
		} else if (this.pendingRestoreSnapshotId) {
			await this.stageRestoreFromSnapshot(this.pendingRestoreSnapshotId);
		}
	}

	async promptRestoreSnapshot(snapshotId: string): Promise<void> {
		if (this.isBusy) return;
		this.clearPendingRestore();
		this.isInspectingArchive = true;
		try {
			const inspection = await backupService.inspectSnapshot(snapshotId);
			this.pendingRestoreSnapshotId = snapshotId;
			this.pendingRestoreInspection = inspection;
		} catch (error) {
			this.clearPendingRestore();
			await errorState.catchError(error, 'Restore backup');
		} finally {
			this.isInspectingArchive = false;
		}
	}

	async stageRestoreFromSnapshot(snapshotId: string): Promise<void> {
		if (this.isBusy) return;
		this.isRestoringBackup = true;
		let staged = false;
		try {
			await backupService.stageRestoreFromSnapshot(snapshotId);
			staged = true;
			await storeService.flushForBackup();
			await dbService.close();
			this.clearPendingRestore();
			toast.success('Backup restore is ready. Restarting Kwantflow…');
			await relaunch();
		} catch (error) {
			const restoreError = staged ? await this.cancelFailedRelaunch(error) : error;
			await errorState.catchError(restoreError, 'Restore backup');
		} finally {
			this.isRestoringBackup = false;
		}
	}

	async exportPortableBackup(): Promise<void> {
		if (this.isBusy) return;
		this.isExportingBackup = true;
		try {
			const destinationPath = await save({
				defaultPath: `kwantflow-backup-${new Date().toISOString().slice(0, 10)}.zip`,
				filters: [{ name: 'Kwantflow backup', extensions: ['zip'] }]
			});
			if (!destinationPath) return;
			await backupService.exportArchive(destinationPath);
			await this.refreshStatus();
			toast.success('Portable backup exported');
		} catch (error) {
			await errorState.catchError(error, 'Export backup');
		} finally {
			this.isExportingBackup = false;
		}
	}

	async promptImportArchive(): Promise<void> {
		if (this.isBusy) return;
		this.clearPendingRestore();
		this.isInspectingArchive = true;
		try {
			const sourcePath = await open({
				multiple: false,
				directory: false,
				filters: [{ name: 'Kwantflow backup', extensions: ['zip'] }]
			});
			if (!sourcePath || Array.isArray(sourcePath)) return;
			const inspection = await backupService.inspectArchive(sourcePath);
			this.pendingRestoreArchivePath = sourcePath;
			this.pendingRestoreInspection = inspection;
		} catch (error) {
			this.clearPendingRestore();
			await errorState.catchError(error, 'Inspect backup');
		} finally {
			this.isInspectingArchive = false;
		}
	}

	async stageRestoreFromArchive(sourcePath: string): Promise<void> {
		if (this.isBusy) return;
		this.isRestoringBackup = true;
		let staged = false;
		try {
			await backupService.stageRestoreFromArchive(sourcePath);
			staged = true;
			await storeService.flushForBackup();
			await dbService.close();
			this.clearPendingRestore();
			toast.success('Backup restore is ready. Restarting Kwantflow…');
			await relaunch();
		} catch (error) {
			const restoreError = staged ? await this.cancelFailedRelaunch(error) : error;
			await errorState.catchError(restoreError, 'Restore backup');
		} finally {
			this.isRestoringBackup = false;
		}
	}

	async deleteSnapshot(snapshotId: string): Promise<BackupDeleteResult | null> {
		if (this.isBusy) return null;
		this.isDeletingBackup = true;
		try {
			const result = await backupService.deleteSnapshot(snapshotId);
			await this.refreshStatus();
			toast.success('Backup deleted');
			return result;
		} catch (error) {
			await errorState.catchError(error, 'Delete backup');
			return null;
		} finally {
			this.isDeletingBackup = false;
		}
	}

	private async cancelFailedRelaunch(error: unknown): Promise<unknown> {
		try {
			await backupService.cancelPendingRestore();
			await dbService.init();
			return error;
		} catch (recoveryError) {
			this.isRestoreRecoveryBlocked = true;
			return new Error(
				`Kwantflow could not recover after the failed restart. Restart the app before editing data. ${String(recoveryError)}`
			);
		}
	}
}

export const backupState = new BackupState();
