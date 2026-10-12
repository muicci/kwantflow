import { readFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

import { globSync } from 'glob';

export type BuildMacosDmgOptions = {
	rootDir: string;
	profile: 'debug' | 'release';
	target?: string;
	appPath?: string;
	outputPath?: string;
	volumeName?: string;
	version?: string;
	archLabel?: string;
	notarize?: boolean;
	env?: NodeJS.ProcessEnv;
};

type SpawnResult = {
	status: number | null;
	error?: Error | null;
	signal?: NodeJS.Signals | null;
};

type SpawnCommand = (
	command: string,
	args: string[],
	options?: { timeout?: number }
) => SpawnResult;

type BuildMacosDmgRuntime = {
	spawnCommand?: SpawnCommand;
};

const DEFAULT_DMG_COMMAND_TIMEOUT_MS = 20 * 60 * 1000;

const defaultSpawnCommand: SpawnCommand = (command, args, options = {}) =>
	spawnSync(command, args, { stdio: 'inherit', timeout: options.timeout });

const readPackageJson = (rootDir: string) =>
	JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf8')) as {
		name?: string;
		productName?: string;
		version?: string;
	};

const assertSpawnOk = (result: SpawnResult, label: string) => {
	if (result.error) {
		throw result.error;
	}
	if (result.signal) {
		throw new Error(`${label} was interrupted by signal ${result.signal}.`);
	}
	if (result.status !== 0) {
		throw new Error(`${label} failed with exit code ${String(result.status ?? 1)}.`);
	}
};

const detectArchLabel = (target: string | undefined) => {
	if (target?.includes('universal-apple-darwin')) {
		return 'universal';
	}
	if (target?.includes('aarch64')) {
		return 'aarch64';
	}
	if (target?.includes('x86_64')) {
		return 'x64';
	}
	if (process.arch === 'arm64') {
		return 'aarch64';
	}
	if (process.arch === 'x64') {
		return 'x64';
	}
	return process.arch;
};

const findBuiltMacosApp = (rootDir: string, profile: 'debug' | 'release', target?: string) => {
	if (target && (!/^[a-zA-Z0-9._-]+$/.test(target) || target === '.' || target === '..'))
		throw new Error('Invalid macOS build target.');
	const pattern = `src-tauri/target/${target ? `${target}/` : ''}${profile}/bundle/macos/*.app`;
	const candidates = globSync(pattern, {
		cwd: rootDir,
		absolute: true,
		nodir: false
	});
	if (candidates.length !== 1) {
		throw new Error(
			`Expected one built macOS app bundle under ${pattern}; found ${candidates.length}.`
		);
	}
	return candidates[0];
};

export const buildMacosDmg = (
	options: BuildMacosDmgOptions,
	runtime: BuildMacosDmgRuntime = {}
) => {
	const packageJson = readPackageJson(options.rootDir);
	const appPath =
		options.appPath ?? findBuiltMacosApp(options.rootDir, options.profile, options.target);
	const volumeName = options.volumeName ?? 'Kwantflow';
	const version = options.version ?? packageJson.version ?? '0.0.0';
	const archLabel = options.archLabel ?? detectArchLabel(options.target);
	const outputPath =
		options.outputPath ??
		resolve(
			dirname(dirname(appPath)),
			'dmg',
			`${basename(appPath, '.app')}_${version}_${archLabel}.dmg`
		);
	const stagingRoot = mkdtempSync(join(tmpdir(), 'kwantflow-dmg-'));
	const stagingDir = join(stagingRoot, 'payload');
	const stagedAppPath = join(stagingDir, basename(appPath));
	const spawnCommand = runtime.spawnCommand ?? defaultSpawnCommand;

	try {
		mkdirSync(stagingDir, { recursive: true });
		cpSync(appPath, stagedAppPath, { recursive: true, verbatimSymlinks: true });
		symlinkSync('/Applications', join(stagingDir, 'Applications'));
		rmSync(outputPath, { force: true });
		mkdirSync(dirname(outputPath), { recursive: true });

		assertSpawnOk(
			spawnCommand(
				'hdiutil',
				[
					'create',
					'-volname',
					volumeName,
					'-srcfolder',
					stagingDir,
					'-ov',
					'-format',
					'UDZO',
					outputPath
				],
				{ timeout: DEFAULT_DMG_COMMAND_TIMEOUT_MS }
			),
			'hdiutil create'
		);

		if (options.notarize) {
			// This compatibility option assesses an already notarized app.
			// Distribution signing/notarization of the final DMG bytes is owned
			// by distribution-build.ts; apps use Gatekeeper's execute assessment.
			assertSpawnOk(
				spawnCommand('spctl', ['-a', '-t', 'execute', '-v', appPath], {
					timeout: DEFAULT_DMG_COMMAND_TIMEOUT_MS
				}),
				'spctl assess app before DMG packaging'
			);
		}
	} finally {
		rmSync(stagingRoot, { recursive: true, force: true });
	}

	return {
		appPath,
		outputPath,
		volumeName,
		archLabel
	};
};
