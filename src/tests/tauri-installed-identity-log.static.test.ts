import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('installed-identity debug logging', () => {
	it('keeps plugin-log on the crash-safe webview-only target', () => {
		const source = readFileSync(join(process.cwd(), 'src-tauri', 'src', 'lib.rs'), 'utf8');

		expect(source).toContain('tauri_plugin_log::Builder::default()');
		expect(source).toContain('.clear_targets()');
		expect(source).toContain('tauri_plugin_log::TargetKind::Webview');
		expect(source).not.toContain('tauri_plugin_log::TargetKind::Stdout');
		expect(source).not.toContain('tauri_plugin_log::TargetKind::Stderr');
		expect(source).not.toContain('tauri_plugin_log::TargetKind::Folder');
	});
});
