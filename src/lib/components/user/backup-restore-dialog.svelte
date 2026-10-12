<script lang="ts">
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import * as ScrollArea from '$lib/components/ui/scroll-area/index.js';
	import { Meta } from '$lib/components/primitives/index.js';
	import { backupState } from '$lib/state/backup.svelte.js';

	function formatBackupDateTime(value: string): string {
		const parsed = new Date(value);
		if (Number.isNaN(parsed.getTime())) return value;
		return new Intl.DateTimeFormat(undefined, {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(parsed);
	}
</script>

{#if backupState.pendingRestoreInspection && !backupState.isRestoreRecoveryBlocked}
	<AlertDialog.Root
		open={Boolean(backupState.pendingRestoreInspection) && !backupState.isRestoreRecoveryBlocked}
		onOpenChange={(open) => {
			if (!open && !backupState.isRestoringBackup) backupState.clearPendingRestore();
		}}
	>
		<AlertDialog.Content
			onEscapeKeydown={(event) => {
				if (backupState.isRestoringBackup) event.preventDefault();
			}}
		>
			<AlertDialog.Header>
				<AlertDialog.Title>Restore this backup?</AlertDialog.Title>
				<AlertDialog.Description>
					This replaces every local workspace and installation setting on this device and restarts
					the app. Changes made after the backup will be lost. Original data is preserved before
					replacement. Email credentials are excluded; mailboxes may require reconnecting.
				</AlertDialog.Description>
			</AlertDialog.Header>
			{#if backupState.pendingRestoreInspection}
				<div class="grid gap-1 pb-2 sm:grid-cols-2">
					<Meta>
						Created {formatBackupDateTime(backupState.pendingRestoreInspection.summary.createdAt)}
					</Meta>
					<Meta>App v{backupState.pendingRestoreInspection.summary.appVersion}</Meta>
					<Meta>
						{backupState.pendingRestoreInspection.workspaceCount} workspace(s) in this backup
					</Meta>
				</div>
				{#if backupState.pendingRestoreInspection.externalReferences.length > 0}
					<Meta
						>Files referenced outside the document vault are not included. Reconnect these paths
						after restoring:</Meta
					>
					<ScrollArea.Root
						class="h-32"
						orientation="vertical"
						viewportProps={{ tabindex: 0, role: 'region', 'aria-label': 'Excluded external files' }}
					>
						<ul class="space-y-1 pe-3 break-words">
							{#each backupState.pendingRestoreInspection.externalReferences as reference (reference)}
								<li><Meta>{reference}</Meta></li>
							{/each}
						</ul>
					</ScrollArea.Root>
				{/if}
			{/if}
			<AlertDialog.Footer>
				<AlertDialog.Cancel
					onclick={() => backupState.clearPendingRestore()}
					disabled={backupState.isRestoringBackup}
				>
					Cancel
				</AlertDialog.Cancel>
				<AlertDialog.Action
					onclick={() => void backupState.confirmPendingRestore()}
					disabled={backupState.isRestoringBackup}
				>
					{backupState.isRestoringBackup ? 'Restoring...' : 'Restore and Restart'}
				</AlertDialog.Action>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	</AlertDialog.Root>
{/if}
