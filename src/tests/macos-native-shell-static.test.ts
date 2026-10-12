import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string) =>
	readFileSync(join(process.cwd(), relativePath), 'utf8');

describe('macOS browser-style shell integration', () => {
	it('keeps native traffic lights but moves browser-style controls into the custom strip', () => {
		const cargoToml = readSource('src-tauri/Cargo.toml');
		const tauriLib = readSource('src-tauri/src/lib.rs');
		const layoutSource = readSource('src/routes/+layout.svelte');
		const tabStripSource = readSource('src/lib/components/app-shell-tab-strip.svelte');
		const navUserSource = readSource('src/lib/components/nav-user.svelte');
		const tauriConfig = readSource('src-tauri/tauri.conf.json');

		expect(cargoToml).not.toContain('"devtools"');
		expect(layoutSource).not.toContain('DevInspector');
		expect(cargoToml).not.toContain('objc2');
		expect(tauriConfig).toContain('"titleBarStyle": "Overlay"');
		expect(tauriConfig).toContain('"hiddenTitle": true');
		expect(tauriConfig).toContain('"acceptFirstMouse": true');
		expect(tauriConfig).toContain('"trafficLightPosition"');
		expect(tauriLib).toContain(
			'const NATIVE_APP_MENU_ACTION_EVENT: &str = "native-app-menu-action";'
		);
		expect(tauriLib).not.toContain(
			'const NATIVE_OPENED_FILES_EVENT: &str = "native-opened-files";'
		);
		expect(tauriLib).not.toContain('configure_main_window_surface');
		expect(tauriLib).not.toContain('NSTitlebarAccessoryViewController');
		expect(tauriLib).not.toContain('open_workspace_tab');
		expect(tauriLib).not.toContain('tabbing_identifier');
		expect(layoutSource).toContain(
			"import AppShellTabStrip from '$lib/components/app-shell-tab-strip.svelte';"
		);
		expect(layoutSource).toContain("import { appState } from '$lib/state/app.svelte.js';");
		expect(layoutSource).toContain('import {');
		expect(layoutSource).toContain('appTabsState,');
		expect(layoutSource).toContain('buildTabDestination,');
		expect(layoutSource).toContain("} from '$lib/state/app-tabs.svelte.js';");
		expect(layoutSource).toContain(
			'<AppShellTabStrip project={headerProject} user={shellUser} {pathname} />'
		);
		expect(layoutSource).toContain('bind:open={appState.isSidebarOpen}');
		expect(layoutSource).toContain('void appState.persistSidebarOpen(open);');
		expect(layoutSource).not.toContain('NativeShellSidebarToggleBridge');
		expect(layoutSource).not.toContain('nativeTrigger');
		expect(layoutSource).not.toContain('__KWANTFLOW_INITIAL_ROUTE__');
		expect(tabStripSource).toContain(
			"import AppShellSidebarToggle from '$lib/components/app-shell-sidebar-toggle.svelte';"
		);
		expect(tabStripSource).toContain('APP_SHELL_PAGE_DESTINATIONS');
		expect(tabStripSource).toContain('bind:offsetWidth={tabRailWidth}');
		expect(tabStripSource).toContain('chrome-tab-scroll');
		expect(tabStripSource).toContain('startNativeWindowDrag');
		expect(tabStripSource).toContain('<NavUser {user} variant="toolbar" />');
		expect(tabStripSource).toContain('Open tab');
		expect(tabStripSource).toContain('Open tabs');
		expect(tabStripSource).toContain('data-tab-rail');
		expect(tabStripSource).toContain('data-tab-rail-actions');
		expect(tabStripSource).toContain('group-hover:opacity-100');
		expect(tabStripSource).toContain('aria-label={`Close ${tab.title} tab`}');
		expect(navUserSource).not.toContain('nativeTrigger');
	});
});
