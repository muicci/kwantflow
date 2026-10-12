import {
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseDistributionBuildArgs } from './distribution-build.js';
import { verifyDistribution } from './distribution-verify.js';
import { assertSourceReleaseReady, publicSourcePaths } from './distribution-source.js';
import { assertMacosRuntimeOutputs, sha256File, verifyNativeInput } from './native-prepare.js';

const temporary: string[] = [];
afterEach(() =>
	temporary.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }))
);

describe('local distribution integrity and publication boundary', () => {
	it.skipIf(process.platform === 'win32').each([
		{
			script: 'distribution-source.ts',
			args: ['--invalid'],
			expected: 'Usage: pnpm distribution:source'
		},
		{
			script: 'distribution-build.ts',
			args: ['--invalid'],
			expected: 'Usage: pnpm distribution:build'
		},
		{
			script: 'distribution-verify.ts',
			args: [],
			expected: 'Usage: pnpm distribution:verify'
		}
	])('runs $script validation through a directory alias', ({ script, args, expected }) => {
		const directory = realpathSync(mkdtempSync(join(tmpdir(), 'kwantflow distribution alias ')));
		temporary.push(directory);
		const alias = join(directory, 'scripts alias');
		symlinkSync(resolve('scripts'), alias, 'dir');
		const result = spawnSync(process.execPath, ['--import', 'tsx', join(alias, script), ...args], {
			cwd: process.cwd(),
			env: { PATH: '', HOME: directory, USERPROFILE: directory, TMPDIR: directory },
			encoding: 'utf8',
			timeout: 10_000
		});
		expect(result.error).toBeUndefined();
		expect(result.status, result.stderr).toBe(1);
		expect(result.stderr).toContain(expected);
	});

	it('exports audited build inputs while excluding private docs, credentials, and history', () => {
		expect(
			publicSourcePaths([
				'src/lib/example.ts',
				'third-party/sources/upstream.tar.gz',
				'docs/user/README.md',
				'docs/development/windows-installer.md',
				'docs/development/private-founder-notes.md',
				'packages/libheif-js/package.json',
				'packages/unreviewed/package.json',
				'ARCHITECTURE.md',
				'.env',
				'progress.md',
				'.git/config'
			])
		).toEqual([
			'ARCHITECTURE.md',
			'docs/development/windows-installer.md',
			'docs/user/README.md',
			'packages/libheif-js/package.json',
			'src/lib/example.ts',
			'third-party/sources/upstream.tar.gz'
		]);
		expect(() => publicSourcePaths(['src-tauri/private-signing.p12'])).toThrow('Forbidden');
		expect(() => publicSourcePaths(['scripts/.env.local'])).toThrow('Forbidden');
		expect(() =>
			assertSourceReleaseReady({ errors: [], releaseBlockers: ['unresolved native notices'] })
		).toThrow('unresolved native notices');
	});

	it('rejects missing slices, raised deployment targets, and non-OS dylib dependencies', () => {
		const versions = ' platform MACOS\n minos 12.0\n platform MACOS\n minos 12.0\n';
		const dependencies =
			'\t@rpath/libpdfium.dylib (compatibility version 0.0.0)\n\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0)\n';
		expect(() =>
			assertMacosRuntimeOutputs('libpdfium.dylib', 'arm64 x86_64', versions, dependencies)
		).not.toThrow();
		expect(() =>
			assertMacosRuntimeOutputs('libpdfium.dylib', 'arm64', versions, dependencies)
		).toThrow('arm64 and x86_64');
		expect(() =>
			assertMacosRuntimeOutputs(
				'libpdfium.dylib',
				'arm64 x86_64',
				versions.replace('minos 12.0', 'minos 13.0'),
				dependencies
			)
		).toThrow('macOS 12.0');
		expect(() =>
			assertMacosRuntimeOutputs(
				'libpdfium.dylib',
				'arm64 x86_64',
				versions,
				`${dependencies}\t/opt/homebrew/lib/libextra.dylib (compatibility version 1.0.0)\n`
			)
		).toThrow('unstaged non-OS');
		expect(() =>
			assertMacosRuntimeOutputs(
				'Kwantflow',
				'arm64 x86_64',
				versions,
				dependencies.replace('@rpath/libpdfium.dylib', '@executable_path/libpdfium.dylib'),
				['libpdfium.dylib']
			)
		).not.toThrow();
	});
	it('rejects corrupted native inputs even when their names match pinned archives', async () => {
		const directory = mkdtempSync(join(tmpdir(), 'kwantflow-native-input-test-'));
		temporary.push(directory);
		const path = join(directory, 'runtime.zip');
		writeFileSync(path, 'correct');
		const digest = await sha256File(path);
		await expect(verifyNativeInput(path, digest)).resolves.toBeUndefined();
		writeFileSync(path, 'corrupt');
		await expect(verifyNativeInput(path, digest)).rejects.toThrow('checksum mismatch');
	});

	it('checks installer bytes and rejects artifact traversal', async () => {
		const directory = mkdtempSync(join(tmpdir(), 'kwantflow-distribution-test-'));
		temporary.push(directory);
		writeFileSync(join(directory, 'Kwantflow_0.13.0_universal.dmg'), 'installer');
		const artifact = {
			name: 'Kwantflow_0.13.0_universal.dmg',
			sha256: await sha256File(join(directory, 'Kwantflow_0.13.0_universal.dmg'))
		};
		const manifest = {
			schemaVersion: 1,
			version: '0.13.0',
			sourceCommit: 'a'.repeat(40),
			sourceDirty: true,
			platform: 'darwin-universal',
			trust: 'ad-hoc',
			installedQa: 'pending',
			artifacts: [artifact]
		};
		const save = () =>
			writeFileSync(join(directory, 'build-manifest.json'), JSON.stringify(manifest));
		save();
		writeFileSync(join(directory, 'SHA256SUMS'), `${artifact.sha256}  ${artifact.name}\n`);
		await expect(verifyDistribution(directory)).resolves.toMatchObject({ installedQa: 'pending' });
		writeFileSync(join(directory, 'SHA256SUMS'), `${'b'.repeat(64)}  ${artifact.name}\n`);
		await expect(verifyDistribution(directory)).rejects.toThrow('SHA256SUMS');
		writeFileSync(join(directory, 'SHA256SUMS'), `${artifact.sha256}  ${artifact.name}\n`);
		writeFileSync(join(directory, artifact.name), 'modified');
		await expect(verifyDistribution(directory)).rejects.toThrow('checksum mismatch');
		artifact.name = '../escape.dmg';
		save();
		await expect(verifyDistribution(directory)).rejects.toThrow('artifact name');
	});

	it('binds a Windows installer to its certified prerequisite receipt and rejects stale receipt bytes', async () => {
		const directory = mkdtempSync(join(tmpdir(), 'kwantflow-windows-distribution-test-'));
		temporary.push(directory);
		const name = 'Kwantflow_0.13.0_x64-setup.exe';
		const receiptName = 'windows-runtime-receipt.json';
		writeFileSync(join(directory, name), 'synthetic installer fixture');
		writeFileSync(
			join(directory, receiptName),
			JSON.stringify({
				platform: 'windows-x86_64',
				installedAppTested: false,
				webView2: {
					signatureStatus: 'Valid',
					installerVersion: '1.3.275.13',
					minimumRuntimeVersion: '125.0.0.0',
					sha256: 'a'.repeat(64)
				}
			})
		);
		const manifest = {
			schemaVersion: 1,
			version: '0.13.0',
			sourceCommit: 'a'.repeat(40),
			sourceDirty: true,
			platform: 'windows-x86_64',
			trust: 'unsigned',
			installedQa: 'pending',
			artifacts: [{ name, sha256: await sha256File(join(directory, name)) }],
			runtimeReceipt: { name: receiptName, sha256: await sha256File(join(directory, receiptName)) }
		};
		writeFileSync(join(directory, 'build-manifest.json'), JSON.stringify(manifest));
		writeFileSync(join(directory, 'SHA256SUMS'), `${manifest.artifacts[0].sha256}  ${name}\n`);
		await expect(verifyDistribution(directory)).resolves.toMatchObject({ installedQa: 'pending' });
		writeFileSync(join(directory, receiptName), 'changed');
		await expect(verifyDistribution(directory)).rejects.toThrow('receipt checksum mismatch');
		Reflect.deleteProperty(manifest, 'runtimeReceipt');
		writeFileSync(join(directory, 'build-manifest.json'), JSON.stringify(manifest));
		await expect(verifyDistribution(directory)).rejects.toThrow('prerequisite receipt');
	});

	it('requires signing to be requested explicitly and has no updater/company hosts', () => {
		expect(parseDistributionBuildArgs([])).toEqual({ sign: false, offline: false });
		expect(() => parseDistributionBuildArgs(['--publish'])).toThrow('Usage');
		const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
		expect(config.bundle.createUpdaterArtifacts).toBeUndefined();
		expect(config.plugins?.updater).toBeUndefined();
		expect(JSON.stringify(config)).not.toMatch(/kwantflow\.com|supabase|sentry/i);
		const windows = JSON.parse(readFileSync('src-tauri/tauri.windows.conf.json', 'utf8'));
		expect(windows.bundle.windows.webviewInstallMode.type).toBe('skip');
		expect(windows.bundle.windows.minimumWebview2Version).toBeUndefined();
		expect(windows.bundle.windows.nsis.installerHooks).toBe(
			'../scripts/windows-installer-hooks.nsh'
		);
		const contract = JSON.parse(
			readFileSync('.github/windows-native-runtime-contract.json', 'utf8')
		);
		expect(contract.webView2.minimumVersion).toBe('125.0.0.0');
		expect(contract.webView2.tauriCli.version).toBe(
			JSON.parse(readFileSync('node_modules/@tauri-apps/cli/package.json', 'utf8')).version
		);
		const hook = readFileSync('scripts/windows-installer-hooks.nsh', 'utf8');
		expect(hook).toContain('!macro NSIS_HOOK_PREINSTALL');
		expect(hook).toContain('${KWANTFLOW_HOOK_DIRECTORY}');
		expect(hook).not.toContain('NSISdl::download');
		expect(hook).not.toContain('MB_ABORTRETRYIGNORE');
		// Staged DLLs are added by scripts/tauri-cli.ts so fresh clones build without them.
		expect(windows.bundle.resources).toBeUndefined();
	});
});
