import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string) =>
	readFileSync(join(process.cwd(), relativePath), 'utf8');

describe('tauri dev wiring', () => {
	it('boots Tauri directly without local-AI sidecar/runtime install hooks', () => {
		const packageJson = readSource('package.json');
		const tauriConfig = readSource('src-tauri/tauri.conf.json');
		const defaultCapability = readSource('src-tauri/capabilities/default.json');

		expect(packageJson).toContain('"dev:tauri": "vite dev"');
		expect(packageJson).toContain('"tauri": "node --import tsx ./scripts/tauri-cli.ts"');
		expect(packageJson).not.toContain('local-ai:runtime:ensure');
		expect(packageJson).not.toContain('runtime:package:build');
		expect(tauriConfig).toContain('"beforeDevCommand": "corepack pnpm dev:tauri"');
		expect(tauriConfig).toContain('"beforeBuildCommand": "corepack pnpm build"');
		expect(tauriConfig).not.toContain('"externalBin"');
		expect(tauriConfig).not.toContain('"binaries/litert-lm-server"');
		expect(tauriConfig).not.toContain('local-ai-runtime');
		expect(defaultCapability).not.toContain('shell:allow-execute');
		expect(defaultCapability).not.toContain('shell:allow-spawn');
	});

	it('requires real native libraries in every release build', () => {
		const build = readSource('src-tauri/build.rs');
		expect(build).toContain('if is_release_profile');
		expect(build).toContain('Release builds cannot disable the native LiteRT-LM engine.');
		expect(build).toContain('native-runtime must contain a linkable LiteRT-LM C API library');
	});
});
