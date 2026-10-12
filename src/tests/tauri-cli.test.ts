import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	detectRunningKwantflowViteDevProcesses,
	hasStagedWindowsNativeDlls,
	isDirectExecution,
	readQaIdentifier,
	runTauriCli
} from '../../scripts/tauri-cli';

const temporaryDirectories: string[] = [];
afterEach(() => {
	for (const directory of temporaryDirectories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});

const buildMacosIconAssetsResult = {
	outputPath: '/repo/src-tauri/gen/apple/Assets.car',
	icnsPath: '/repo/src-tauri/gen/apple/kwantflow.icns',
	tauriFallbackIcnsPath: '/repo/src-tauri/icons/icon.icns'
};

describe.sequential('tauri CLI wrapper', () => {
	it.skipIf(process.platform === 'win32')(
		'validates QA arguments through a directory alias before starting a build',
		() => {
			const directory = realpathSync(mkdtempSync(join(tmpdir(), 'kwantflow CLI alias ')));
			temporaryDirectories.push(directory);
			const alias = join(directory, 'scripts alias');
			symlinkSync(resolve('scripts'), alias, 'dir');
			const result = spawnSync(
				process.execPath,
				['--import', 'tsx', join(alias, 'tauri-cli.ts'), 'build'],
				{
					cwd: process.cwd(),
					env: {
						PATH: '',
						HOME: directory,
						USERPROFILE: directory,
						TMPDIR: directory,
						KWANTFLOW_TAURI_QA_IDENTIFIER: 'invalid'
					},
					encoding: 'utf8',
					timeout: 10_000
				}
			);
			expect(result.error).toBeUndefined();
			expect(result.status, result.stderr).toBe(1);
			expect(result.stderr).toContain('An isolated QA identifier is only valid for tauri dev');
		}
	);

	it('detects direct execution from Windows and POSIX entry paths', () => {
		expect(
			isDirectExecution(
				'file:///D:/a/kwantflow-app/kwantflow-app/scripts/tauri-cli.ts',
				'D:\\a\\kwantflow-app\\kwantflow-app\\scripts\\tauri-cli.ts',
				'win32'
			)
		).toBe(true);
		expect(
			isDirectExecution('file:///repo/scripts/tauri-cli.ts', '/repo/scripts/tauri-cli.ts')
		).toBe(true);
	});

	it('uses the Windows PATH delimiter when launching Tauri on Windows', () => {
		const spawnCommand = vi.fn(() => ({ status: 0 }));

		runTauriCli(['build', '--target', 'x86_64-pc-windows-msvc'], {
			platform: 'win32',
			env: {
				PATH: 'C:\\Windows\\System32'
			},
			loadEnv: vi.fn(() => ({})),
			spawnCommand,
			warn: vi.fn()
		});

		expect(spawnCommand).toHaveBeenCalledWith(
			'pnpm',
			['exec', 'tauri', 'build', '--target', 'x86_64-pc-windows-msvc'],
			expect.objectContaining({
				env: expect.objectContaining({ PATH: expect.stringMatching(/;C:\\Windows\\System32$/) })
			})
		);
	});

	it('returns a failed macOS build without running desktop cache maintenance or packaging', () => {
		const spawnCommand = vi.fn(() => ({ status: 1 }));
		const buildDmg = vi.fn(() => ({ outputPath: '/repo/dmg/Kwantflow.dmg' }));
		const status = runTauriCli(['build', '--debug'], {
			platform: 'darwin',
			rootDir: '/repo',
			env: {},
			loadEnv: vi.fn(() => ({})),
			buildMacosIconAssets: vi.fn(() => buildMacosIconAssetsResult),
			spawnCommand,
			buildDmg,
			log: vi.fn(),
			warn: vi.fn()
		});
		expect(status).toBe(1);
		expect(spawnCommand).toHaveBeenCalledTimes(1);
		expect(spawnCommand).toHaveBeenCalledWith(
			'pnpm',
			['exec', 'tauri', 'build', '--debug', '--bundles', 'app'],
			expect.objectContaining({ cwd: '/repo' })
		);
		expect(buildDmg).not.toHaveBeenCalled();
	});

	it('builds a repo-managed DMG after a successful darwin build', () => {
		const buildDmg = vi.fn(() => ({
			outputPath: '/repo/src-tauri/target/debug/bundle/dmg/Kwantflow_0.1.1_aarch64.dmg'
		}));
		const buildMacosIconAssets = vi.fn(() => buildMacosIconAssetsResult);
		const log = vi.fn();

		const status = runTauriCli(['build', '--debug'], {
			platform: 'darwin',
			rootDir: '/repo',
			loadEnv: vi.fn(() => ({})),
			env: {},
			buildMacosIconAssets,
			spawnCommand: vi.fn(() => ({ status: 0 })),
			buildDmg,
			log,
			warn: vi.fn()
		});

		expect(status).toBe(0);
		expect(buildDmg).toHaveBeenCalledWith(
			expect.objectContaining({
				rootDir: '/repo',
				profile: 'debug',
				target: undefined,
				notarize: false
			})
		);
		expect(log).toHaveBeenCalledWith(
			'Built repo-managed macOS DMG at /repo/src-tauri/target/debug/bundle/dmg/Kwantflow_0.1.1_aarch64.dmg.'
		);
	});

	it('does not load environment files for packaging', () => {
		const spawnCommand = vi.fn(() => ({ status: 0 }));
		const loadEnv = vi.fn(() => ({ APPLE_SIGNING_IDENTITY: 'ambient identity' }));
		runTauriCli(['build', '--debug'], {
			platform: 'darwin',
			rootDir: '/repo',
			env: {},
			loadEnv,
			spawnCommand,
			buildMacosIconAssets: vi.fn(() => buildMacosIconAssetsResult),
			buildDmg: vi.fn(() => ({ outputPath: '/repo/dmg/Kwantflow.dmg' })),
			log: vi.fn(),
			warn: vi.fn()
		});
		expect(loadEnv).not.toHaveBeenCalled();
		const call = spawnCommand.mock.calls[0] as unknown as [
			string,
			string[],
			{ env: Record<string, string> }
		];
		expect(call[2].env.APPLE_SIGNING_IDENTITY).toBeUndefined();
	});

	it('loads optional development configuration with explicit shell env taking precedence', () => {
		const spawnCommand = vi.fn(() => ({ status: 0 }));
		const loadEnv = vi.fn(() => ({ KWANTFLOW_DEV_OPTION: 'file', KWANTFLOW_DEV_OTHER: 'loaded' }));
		runTauriCli(['dev'], {
			platform: 'darwin',
			rootDir: '/repo',
			env: { KWANTFLOW_DEV_OPTION: 'shell' },
			loadEnv,
			spawnCommand,
			buildMacosIconAssets: vi.fn(() => buildMacosIconAssetsResult),
			buildDmg: vi.fn(() => ({ outputPath: '/repo/dmg/Kwantflow.dmg' })),
			log: vi.fn(),
			warn: vi.fn()
		});
		expect(loadEnv).toHaveBeenCalledWith('development', '/repo', '');
		expect(spawnCommand).toHaveBeenCalledWith(
			'pnpm',
			expect.any(Array),
			expect.objectContaining({
				env: expect.objectContaining({
					KWANTFLOW_DEV_OPTION: 'shell',
					KWANTFLOW_DEV_OTHER: 'loaded'
				})
			})
		);
	});

	it('does not compile macOS icons for non-build commands', () => {
		const buildMacosIconAssets = vi.fn(() => buildMacosIconAssetsResult);

		const status = runTauriCli(['dev'], {
			platform: 'darwin',
			buildMacosIconAssets,
			spawnCommand: vi.fn(() => ({ status: 0 })),
			buildDmg: vi.fn(() => ({ outputPath: '/repo/dmg/Kwantflow.dmg' })),
			log: vi.fn(),
			warn: vi.fn()
		});

		expect(status).toBe(0);
		expect(buildMacosIconAssets).not.toHaveBeenCalled();
	});

	it('bundles Windows native DLLs only after native inputs are staged', () => {
		const root = mkdtempSync(join(tmpdir(), 'kwantflow-tauri-cli-'));
		mkdirSync(join(root, 'src-tauri/native-runtime'), { recursive: true });
		writeFileSync(join(root, 'src-tauri/native-runtime/.gitkeep'), '');
		expect(hasStagedWindowsNativeDlls(root)).toBe(false);
		writeFileSync(join(root, 'src-tauri/native-runtime/litert_lm_c.dll'), '');
		expect(hasStagedWindowsNativeDlls(root)).toBe(true);
		rmSync(root, { recursive: true, force: true });
	});

	it('isolates tauri dev runs onto the dev-only bundle identifier', () => {
		const spawnCommand = vi.fn(() => ({ status: 0 }));

		runTauriCli(['dev'], {
			platform: 'darwin',
			spawnCommand,
			buildMacosIconAssets: vi.fn(() => buildMacosIconAssetsResult),
			buildDmg: vi.fn(() => ({ outputPath: '/repo/dmg/Kwantflow.dmg' })),
			log: vi.fn(),
			warn: vi.fn()
		});

		expect(spawnCommand).toHaveBeenCalledTimes(1);
		const firstCall = spawnCommand.mock.calls[0] as unknown as
			[string, string[], Record<string, unknown>?] | undefined;
		expect(firstCall).toBeDefined();
		const [command, args] = firstCall!;
		expect(command).toBe('pnpm');
		expect(args).toEqual(
			expect.arrayContaining([
				'exec',
				'tauri',
				'dev',
				'--config',
				JSON.stringify({
					identifier: 'com.kwantflow.desktop.dev'
				})
			])
		);
	});

	it('accepts only an explicit isolated QA identity for development', () => {
		expect(() =>
			readQaIdentifier({ KWANTFLOW_TAURI_QA_IDENTIFIER: 'com.kwantflow.desktop' })
		).toThrow('isolated');
		const spawnCommand = vi.fn(() => ({ status: 0 }));
		runTauriCli(['dev'], {
			platform: 'darwin',
			rootDir: '/repo',
			env: { KWANTFLOW_TAURI_QA_IDENTIFIER: 'com.kwantflow.desktop.qa-safe' },
			loadEnv: vi.fn(() => ({})),
			listProcesses: vi.fn(() => []),
			spawnCommand,
			warn: vi.fn(),
			log: vi.fn()
		});
		const call = spawnCommand.mock.calls[0] as unknown as [string, string[]];
		expect(call[1]).toContain(JSON.stringify({ identifier: 'com.kwantflow.desktop.qa-safe' }));
		expect(() =>
			runTauriCli(['build'], {
				env: { KWANTFLOW_TAURI_QA_IDENTIFIER: 'com.kwantflow.desktop.qa-safe' }
			})
		).toThrow('only valid for tauri dev');
	});

	it('detects kwantflow vite dev processes that can keep port 1420 busy', () => {
		expect(
			detectRunningKwantflowViteDevProcesses([
				{
					pid: 1,
					command: 'node /home/dev/Kwantflow/app/node_modules/vite/bin/vite.js dev'
				},
				{
					pid: 2,
					command:
						'node /home/dev/Kwantflow/app/.worktrees/local-ai/node_modules/vite/bin/vite.js dev'
				},
				{
					pid: 3,
					command: 'node /home/dev/OtherApp/node_modules/vite/bin/vite.js dev'
				}
			])
		).toEqual([
			{
				pid: 1,
				command: 'node /home/dev/Kwantflow/app/node_modules/vite/bin/vite.js dev'
			},
			{
				pid: 2,
				command:
					'node /home/dev/Kwantflow/app/.worktrees/local-ai/node_modules/vite/bin/vite.js dev'
			}
		]);
	});

	it('fails fast when another kwantflow vite dev server is already running', () => {
		expect(() =>
			runTauriCli(['dev'], {
				platform: 'darwin',
				env: {},
				listProcesses: vi.fn(() => [
					{
						pid: 42,
						command:
							'node /home/dev/Kwantflow/app/.worktrees/local-ai/node_modules/vite/bin/vite.js dev'
					}
				]),
				spawnCommand: vi.fn(() => ({ status: 0 })),
				buildMacosIconAssets: vi.fn(() => buildMacosIconAssetsResult),
				buildDmg: vi.fn(() => ({ outputPath: '/repo/dmg/Kwantflow.dmg' })),
				log: vi.fn(),
				warn: vi.fn()
			})
		).toThrow(
			'Existing Kwantflow Vite dev process(es) can keep port 1420 busy and block this launch'
		);
	});
});
