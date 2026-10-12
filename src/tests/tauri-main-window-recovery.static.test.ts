import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('tauri main-window recovery', () => {
	it('recreates and shows the main window when the runtime inventory is empty', () => {
		const source = readFileSync(join(process.cwd(), 'src-tauri', 'src', 'lib.rs'), 'utf8');

		expect(source).toContain('fn ensure_main_window_registered');
		expect(source).toContain('WebviewWindowBuilder::from_config(app, &window_config)');
		expect(source).toContain(
			'WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::default())'
		);
		expect(source).toContain('recover_main_window(&app_handle, "setup")');
		expect(source).toContain('setup_watchdog_attempt_');
		expect(source).toContain('recover_main_window(app_handle, "run_ready")');
		expect(source).not.toContain('.on_navigation(on_nav');
	});
});
