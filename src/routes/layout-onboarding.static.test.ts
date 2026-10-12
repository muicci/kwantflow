import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const layoutPath = join(process.cwd(), 'src/routes/+layout.svelte');

describe('root layout onboarding gate', () => {
	it('renders the onboarding workspace before the normal app shell', () => {
		expect(existsSync(layoutPath)).toBe(true);

		const source = readFileSync(layoutPath, 'utf8');

		expect(source).toContain('$lib/components/onboarding/onboarding-workspace.svelte');
		expect(source).toContain('installBenignBrowserWarningFilter');
		expect(source).toContain('const detachedPreviewRouteId =');
		expect(source).toContain('const detachedPreviewPathnamePattern =');
		expect(source).toContain('const isDetachedPreviewRoute = $derived');
		expect(source).toContain('const isDetachedPreviewPath = $derived');
		expect(source).toContain('const isDetachedPreviewSurface = $derived');
		expect(source).toContain('{:else if isDetachedPreviewSurface && !appState.bootFailureMessage}');
		expect(source).toContain('{#if backupState.isRestoreRecoveryBlocked}');
		expect(source).toContain('Restart Kwantflow before editing data.');
		expect(source.indexOf('{#if backupState.isRestoreRecoveryBlocked}')).toBeLessThan(
			source.indexOf('{:else if isDetachedPreviewSurface && !appState.bootFailureMessage}')
		);
		expect(source).toContain('appState.isBooting');
		expect(source).toContain('{:else if appState.isBooting || appState.bootFailureMessage}');
		expect(source).toContain('onboardingState.shouldGateApp');
		expect(source).toContain('{:else if onboardingState.shouldGateApp}');
		expect(source).not.toContain('AppUpdateDialog');
		expect(source).not.toContain('SupportReportDialog');
		expect(source).not.toContain('DevInspector');
		expect(source).not.toContain('attachDevConsoleMirroring');
		expect(source).toContain('<BackupRestoreDialog />');
		expect(source.indexOf('<BackupRestoreDialog />')).toBeGreaterThan(
			source.indexOf('</Sidebar.Provider>\n{/if}')
		);
		expect(source).toContain('onclick={() => void backupState.promptImportArchive()}');
		expect(source).toContain('Import backup');
		expect(source).toContain(
			'shouldRedirectProtectedRoute(pathname, onboardingState.isAccessReady)'
		);
		expect(source).toContain("goto(resolve('/'), { replaceState: true })");
		expect(source).toContain('class="ui-boot-logo-shimmer block size-16"');
		expect(source).toContain('Opening Kwantflow');
		expect(source).toContain('Loading your local workspace…');
	});

	it('loads Tauri shell listeners inside onMount instead of static route imports', () => {
		expect(existsSync(layoutPath)).toBe(true);

		const source = readFileSync(layoutPath, 'utf8');

		expect(source).not.toContain("import { listen } from '@tauri-apps/api/event'");
		expect(source).not.toContain("import { getCurrentWindow } from '@tauri-apps/api/window'");
		expect(source).not.toContain(
			"import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link'"
		);
		expect(source).toContain("import('@tauri-apps/api/event')");
		expect(source).toContain("import('@tauri-apps/api/window')");
		expect(source).not.toContain("import('@tauri-apps/plugin-deep-link')");
		expect(source).toContain('currentWindowLabel = windowApi.getCurrentWindow().label');
		expect(source).toContain(
			'void appState.ensureBooted().then(() => recoverStaleProjectRouteIfNeeded());'
		);
		expect(source).toContain('Project route no longer exists in the active workspace');
		expect(source).toContain("await goto(resolve('/'), {");
	});

	it('reads bundled help and legal documents in an escaped, scrollable dialog outside shell gates', () => {
		const source = readFileSync(layoutPath, 'utf8');
		const documentationDialog = source.slice(
			source.indexOf('<Dialog.Root bind:open={appState.isLocalDocumentationOpen}>'),
			source.indexOf('</Dialog.Root>') + '</Dialog.Root>'.length
		);

		expect(documentationDialog).toContain('title={appState.localDocumentationTitle}');
		expect(documentationDialog).toContain('<ScrollArea.Root');
		expect(documentationDialog).toContain('whitespace-pre-wrap');
		expect(documentationDialog).toContain('{appState.localDocumentationText}</pre>');
		expect(documentationDialog).not.toContain('{@html');
		expect(documentationDialog).not.toContain('openUrl');
		expect(documentationDialog).not.toContain('openPath');
		expect(documentationDialog).toContain('trapFocus={true}');
		expect(documentationDialog).toMatch(
			/viewportProps=\{\{\s*tabindex: 0,\s*role: 'region',\s*'aria-label': appState\.localDocumentationTitle\s*\}\}/
		);
		const scrollAreaSource = readFileSync(
			join(process.cwd(), 'src/lib/components/ui/scroll-area/scroll-area.svelte'),
			'utf8'
		);
		expect(scrollAreaSource).toMatch(/<ScrollAreaPrimitive\.Viewport\s+\{\.\.\.viewportProps\}/);
		expect(documentationDialog).toContain('Close');
		expect(
			source.indexOf('<Dialog.Root bind:open={appState.isLocalDocumentationOpen}>')
		).toBeGreaterThan(source.indexOf('</Sidebar.Provider>\n{/if}'));
		expect(source).toContain("case 'open-help':");
		expect(source).toContain("void appState.openLocalDocumentation('help');");
		expect(source).toMatch(/\{#if appState\.isLocalDocumentationOpen\}\s*<Dialog\.Root/);
		expect(source).toMatch(
			/case 'open-settings':\s*if\s*\(\s*isLocalShellBlocked\s*\|\|\s*appState\.isLocalDocumentationOpen\s*\|\|\s*backupState\.pendingRestoreInspection\s*\)\s*break;/
		);
	});

	it('keeps a completed but failed boot in recovery and blocks normal shell side effects', () => {
		const source = readFileSync(layoutPath, 'utf8');
		const recoveryGate = '{:else if appState.isBooting || appState.bootFailureMessage}';
		const recoveryBody = source.slice(
			source.indexOf(recoveryGate),
			source.indexOf('{:else if onboardingState.shouldGateApp}')
		);
		expect(recoveryBody).toContain('Startup paused');
		expect(recoveryBody).toContain('backupState.promptImportArchive()');
		expect(recoveryBody).toContain('appState.retryBoot()');
		expect(source).toMatch(
			/appState\.isBooting\s*\|\|\s*Boolean\(appState\.bootFailureMessage\)\s*\|\|\s*backupState\.isRestoreRecoveryBlocked/
		);
		expect(source).toMatch(/function requestQuickCreate[^]*?if \(isLocalShellBlocked\) return;/);
		expect(source).toMatch(
			/function recoverStaleProjectRouteIfNeeded[^]*?if \(isLocalShellBlocked\) return;/
		);
		expect(source).toMatch(/case 'open-settings':\s*if\s*\(\s*isLocalShellBlocked\s*\|\|/);
		expect(source).toMatch(
			/if \(isDetachedPreviewSurface \|\| isLocalShellBlocked\) return;\s*const requestedActionId/
		);
		expect(source).not.toContain('if (isDetachedPreviewSurface || appState.isBooting) return;');
		expect(source).toMatch(
			/if\s*\(\s*isLocalShellBlocked\s*\|\|\s*onboardingState\.shouldGateApp\s*\|\|\s*!useNativeMacShell\s*\|\|\s*restoringTabs\s*\)/
		);
	});
});
