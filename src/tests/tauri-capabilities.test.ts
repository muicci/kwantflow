import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readJson(path: string): {
	permissions?: (string | { identifier: string; [key: string]: unknown })[];
	windows?: string[];
} {
	return JSON.parse(readFileSync(path, 'utf8')) as {
		permissions?: (string | { identifier: string; [key: string]: unknown })[];
		windows?: string[];
	};
}

describe('Tauri capability hardening', () => {
	it('keeps app command permissions on the main window only', () => {
		const defaultCapability = readJson('src-tauri/capabilities/default.json');
		const previewCapability = readJson('src-tauri/capabilities/asset-preview.json');

		expect(defaultCapability.permissions).toContain('default');
		expect(defaultCapability.permissions).toContain('core:window:allow-show');
		expect(defaultCapability.permissions).toContain('core:window:allow-unminimize');
		expect(previewCapability.permissions).not.toContain('default');
	});

	type ScopedPermission = { identifier: string; allow?: { path?: string; url?: string }[] };
	const scoped = (capability: ReturnType<typeof readJson>): ScopedPermission[] =>
		(capability.permissions ?? []).filter(
			(p): p is ScopedPermission => typeof p === 'object' && p !== null
		) as ScopedPermission[];
	const identifiers = (capability: ReturnType<typeof readJson>): string[] =>
		(capability.permissions ?? []).map((p) => (typeof p === 'string' ? p : p.identifier));

	it('keeps detached preview read-only for SQL and workspace vault access', () => {
		const workspaceCapability = readJson('src-tauri/capabilities/workspace.json');
		const previewCapability = readJson('src-tauri/capabilities/asset-preview.json');

		expect(workspaceCapability.windows).toEqual(['main']);
		expect(previewCapability.permissions).toContain('allow-query-workspace-database');
		expect(previewCapability.permissions).not.toContain('allow-execute-workspace-database');
		expect(previewCapability.permissions).toContain('core:window:allow-destroy');
		for (const permission of scoped(previewCapability)) {
			if (!/^fs:allow-(write|remove|rename|mkdir|copy|truncate)/.test(permission.identifier))
				continue;
			for (const scope of permission.allow ?? []) {
				expect(scope.path).toMatch(/^\$APPCACHE\//);
			}
		}
	});

	it('never grants blanket file-system sets to any window', () => {
		for (const file of ['default.json', 'asset-preview.json', 'workspace.json']) {
			const capability = readJson(`src-tauri/capabilities/${file}`);
			for (const identifier of identifiers(capability)) {
				expect(identifier).not.toMatch(/^fs:allow-[a-z]+-(read|write|meta)-recursive$/);
				expect(identifier).not.toMatch(
					/^fs:(allow-read|allow-write|read-all|write-all|scope-home|scope-app)$/
				);
			}
			for (const permission of scoped(capability)) {
				if (!permission.identifier.startsWith('fs:')) continue;
				for (const scope of permission.allow ?? []) {
					expect(scope.path).toMatch(
						/^\$(DOCUMENT\/Kwantflow|APPLOCALDATA\/[a-zA-Z/-]+|APPCACHE\/[a-z-]+)(\/\*\*)?$/
					);
				}
			}
		}
	});

	it('registers app command ACL generation in build.rs', () => {
		const buildScript = readFileSync('src-tauri/build.rs', 'utf8');

		expect(buildScript).toContain('AppManifest::new().commands(APP_COMMANDS)');
		expect(buildScript).not.toContain('tauri_build::build()');
		expect(buildScript).toContain('"allow_external_file_read"');
		expect(buildScript).toContain('"create_workspace_command"');
		expect(buildScript).toContain('"activate_workspace_command"');
		expect(buildScript).toContain('"delete_workspace_command"');
		expect(buildScript).toContain('"reset_active_workspace_command"');
		expect(buildScript).not.toContain('"prepare_workspace_database_command"');
		expect(buildScript).not.toContain('"set_active_workspace_db_path_command"');
		expect(buildScript).not.toContain('"reset_workspace_foundation"');
	});

	it('keeps build-time ACL command generation aligned with registered Tauri handlers', () => {
		const buildScript = readFileSync('src-tauri/build.rs', 'utf8');
		const libSource = readFileSync('src-tauri/src/lib.rs', 'utf8');
		const appCommandsBlock = buildScript
			.split('const APP_COMMANDS: &[&str] = &[', 2)[1]
			?.split('];', 1)[0];
		const handlerBlock = libSource.split('tauri::generate_handler![', 2)[1]?.split(']', 1)[0];
		expect(appCommandsBlock).toBeTruthy();
		expect(handlerBlock).toBeTruthy();
		const appCommands = [...appCommandsBlock!.matchAll(/"([a-zA-Z0-9_]+)"/g)].map(
			(match) => match[1]
		);
		const handlerCommands = [...handlerBlock!.matchAll(/\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g)]
			.map((match) => match[1])
			.filter((name) => name !== 'tauri' && name !== 'generate_handler');

		expect(appCommands.toSorted()).toEqual(handlerCommands.toSorted());
	});

	it('keeps release native LiteRT builds fail-closed when native inputs are required', () => {
		const buildScript = readFileSync('src-tauri/build.rs', 'utf8');
		const tauriConfig = readFileSync('src-tauri/tauri.conf.json', 'utf8');
		const bridgeHeader = readFileSync('src-tauri/native/litert_lm_bridge.h', 'utf8');

		expect(buildScript).toContain('KWANTFLOW_REQUIRE_LITERT_LM_NATIVE');
		expect(buildScript).toContain('let include_dir = "native"');
		expect(buildScript).toContain('let lib_dir = "native-runtime"');
		expect(buildScript).not.toContain('KWANTFLOW_LITERT_LM_C_INCLUDE_DIR');
		expect(buildScript).not.toContain('KWANTFLOW_LITERT_LM_LIB_DIR');
		expect(buildScript).toContain('@executable_path/../Resources/local-ai/native');
		expect(buildScript).toContain('panic!');
		expect(buildScript).toContain('native/litert_lm_bridge_stub.cc');
		expect(buildScript).toContain('native/litert_lm_bridge_litert.cc');
		expect(tauriConfig).toContain('"native-runtime/": "local-ai/native/"');
		expect(bridgeHeader).toContain('const char* native_lib_dir');
		expect(readFileSync('.gitignore', 'utf8')).toContain('src-tauri/native-runtime/*');
	});

	it('includes Rust-owned workspace lifecycle commands in the default permission set', () => {
		const defaultPermissions = readFileSync('src-tauri/permissions/default.toml', 'utf8');
		const defaultCapability = readJson('src-tauri/capabilities/default.json');

		expect(defaultCapability.permissions).toContain('allow-query-control-database');
		expect(defaultCapability.permissions).toContain('allow-execute-control-database');
		expect(defaultCapability.permissions).toContain('allow-query-workspace-database');
		expect(defaultCapability.permissions).toContain('allow-execute-workspace-database');
		expect(defaultPermissions).toContain('"allow-get-email-provider-settings"');
		expect(defaultPermissions).toContain('"allow-set-email-provider-settings"');
		expect(defaultPermissions).toContain('"allow-create-workspace-command"');
		expect(defaultPermissions).toContain('"allow-activate-workspace-command"');
		expect(defaultPermissions).toContain('"allow-delete-workspace-command"');
		expect(defaultPermissions).toContain('"allow-reset-active-workspace-command"');
		expect(defaultPermissions).not.toContain('"allow-prepare-workspace-database-command"');
		expect(defaultPermissions).not.toContain('"allow-set-active-workspace-db-path-command"');
		expect(defaultPermissions).not.toContain('"allow-reset-workspace-foundation"');
	});
});
