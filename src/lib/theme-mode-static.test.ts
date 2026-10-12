import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string) =>
	readFileSync(join(process.cwd(), relativePath), 'utf8');

describe('dark mode integration', () => {
	it('mounts ModeWatcher from the root layout without delegating persistence to browser storage', () => {
		const source = readSource('src/routes/+layout.svelte');

		expect(source).toContain("import { ModeWatcher } from 'mode-watcher';");
		expect(source).toContain('<ModeWatcher track={false} />');
	});

	it('wires the Sonner wrapper to the active mode-watcher theme', () => {
		const source = readSource('src/lib/components/ui/sonner/sonner.svelte');

		expect(source).toContain("import { mode } from 'mode-watcher';");
		expect(source).toContain('theme={mode.current');
	});

	it('keeps theme controls in the sidebar shell and removes duplicate Settings controls', () => {
		const ownerDialogSource = readSource('src/lib/components/user/settings-dialog.svelte');
		const navUserSource = readSource('src/lib/components/nav-user.svelte');

		expect(ownerDialogSource).not.toContain('themePreference');
		expect(ownerDialogSource).not.toContain('Appearance');
		expect(ownerDialogSource).not.toContain('THEME_PREFERENCE_OPTIONS');
		expect(navUserSource).toContain('<DropdownMenu.Sub>');
		expect(navUserSource).toContain('<DropdownMenu.SubTrigger>');
		expect(navUserSource).toContain('Theme');
		expect(navUserSource).toContain('Light');
		expect(navUserSource).toContain('Dark');
		expect(navUserSource).toContain('System');
		expect(navUserSource).toContain('<DropdownMenu.RadioGroup value={appState.themePreference}>');
	});

	it('uses theme-safe branding instead of dark:invert for the sidebar logo', () => {
		const source = readSource('src/lib/components/app-sidebar.svelte');

		expect(source).not.toContain('dark:invert');
	});
});
