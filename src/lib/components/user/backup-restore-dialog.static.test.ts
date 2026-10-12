import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('shared backup restore confirmation', () => {
	const source = readFileSync(
		join(process.cwd(), 'src/lib/components/user/backup-restore-dialog.svelte'),
		'utf8'
	);

	it('opens from validated inspection and preserves confirmation during staging', () => {
		expect(source).toContain(
			'Boolean(backupState.pendingRestoreInspection) && !backupState.isRestoreRecoveryBlocked'
		);
		expect(source).toContain('if (!open && !backupState.isRestoringBackup)');
		expect(source).toContain('if (backupState.isRestoringBackup) event.preventDefault();');
		expect(source).toContain('disabled={backupState.isRestoringBackup}');
		expect(source).toContain('void backupState.confirmPendingRestore()');
		expect(source).toContain('backupState.clearPendingRestore()');
		expect(source).not.toContain('inspectArchive');
		expect(source).toMatch(
			/\{#if backupState\.pendingRestoreInspection && !backupState\.isRestoreRecoveryBlocked\}\s*<AlertDialog\.Root/
		);
	});

	it('shows installation-wide replacement and scrollable excluded external files', () => {
		expect(source).toContain('This replaces every local workspace and installation setting');
		expect(source).toContain('Original data is preserved before');
		expect(source).toContain('pendingRestoreInspection.workspaceCount');
		expect(source).toContain('class="h-32"');
		expect(source).toContain(
			"tabindex: 0, role: 'region', 'aria-label': 'Excluded external files'"
		);
		expect(source).toContain('as reference (reference)');
		expect(source).not.toContain('{@html');
	});
});
