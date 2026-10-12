import {
	copyFileSync,
	existsSync,
	realpathSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	renameSync,
	rmSync,
	statSync
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_MACOS_ICON_SOURCE_RELATIVE_PATH = 'assets/brand/macos/kwantflow.icon.xcassets';
export const DEFAULT_MACOS_ICON_ASSETS_OUTPUT_RELATIVE_PATH = 'src-tauri/gen/apple/Assets.car';
export const DEFAULT_MACOS_ICON_ICNS_OUTPUT_RELATIVE_PATH = 'src-tauri/gen/apple/kwantflow.icns';
export const DEFAULT_TAURI_ICNS_FALLBACK_RELATIVE_PATH = 'src-tauri/icons/icon.icns';

const DEFAULT_MINIMUM_DEPLOYMENT_TARGET = '12.0';

type SpawnResult = {
	status: number | null;
	stdout?: string;
	stderr?: string;
	error?: Error | null;
};

type SpawnCommand = (command: string, args: string[]) => SpawnResult;

export type BuildMacosIconAssetsOptions = {
	rootDir: string;
	sourceIconPath?: string;
	outputPath?: string;
	minimumDeploymentTarget?: string;
};

type BuildMacosIconAssetsRuntime = {
	platform?: NodeJS.Platform;
	spawnCommand?: SpawnCommand;
};

export type BuildMacosIconAssetsResult = {
	outputPath: string;
	icnsPath: string;
	tauriFallbackIcnsPath: string;
};

const defaultSpawnCommand: SpawnCommand = (command, args) =>
	spawnSync(command, args, { stdio: 'inherit', encoding: 'utf8' });

const runCommand = (
	spawnCommand: SpawnCommand,
	command: string,
	args: string[],
	failure: string
) => {
	const result = spawnCommand(command, args);
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		throw new Error(failure);
	}
};

const getMacosAppIconName = (sourceIconPath: string) => {
	const sourceName = basename(sourceIconPath);
	if (sourceName.endsWith('.icon.xcassets')) {
		return sourceName.slice(0, -'.icon.xcassets'.length);
	}
	if (sourceName.endsWith('.xcassets')) {
		return sourceName.slice(0, -'.xcassets'.length);
	}
	return sourceName;
};

const newestMtimeMs = (path: string): number => {
	const stats = statSync(path);
	if (!stats.isDirectory()) return stats.mtimeMs;
	return Math.max(
		stats.mtimeMs,
		...readdirSync(path).map((entry) => newestMtimeMs(join(path, entry)))
	);
};

const canReuseGeneratedAssets = (sourceIconPath: string, outputPaths: string[]) => {
	if (!outputPaths.every((outputPath) => existsSync(outputPath))) return false;
	const sourceMtime = newestMtimeMs(sourceIconPath);
	const oldestOutputMtime = Math.min(
		...outputPaths.map((outputPath) => statSync(outputPath).mtimeMs)
	);
	return oldestOutputMtime >= sourceMtime;
};

export const buildMacosIconAssets = (
	options: BuildMacosIconAssetsOptions,
	runtime: BuildMacosIconAssetsRuntime = {}
): BuildMacosIconAssetsResult => {
	const platform = runtime.platform ?? process.platform;
	if (platform !== 'darwin') {
		throw new Error('macOS only');
	}

	const spawnCommand = runtime.spawnCommand ?? defaultSpawnCommand;
	const sourceIconPath = resolve(
		options.rootDir,
		options.sourceIconPath ?? DEFAULT_MACOS_ICON_SOURCE_RELATIVE_PATH
	);
	if (!existsSync(sourceIconPath)) {
		throw new Error(
			`Missing canonical native macOS icon source at ${sourceIconPath}. Restore assets/brand/macos before packaging a macOS bundle.`
		);
	}

	const desiredOutputPath = resolve(
		options.rootDir,
		options.outputPath ?? DEFAULT_MACOS_ICON_ASSETS_OUTPUT_RELATIVE_PATH
	);
	const appIconName = getMacosAppIconName(sourceIconPath);
	const outputDir = dirname(desiredOutputPath);
	const desiredIcnsPath = resolve(options.rootDir, DEFAULT_MACOS_ICON_ICNS_OUTPUT_RELATIVE_PATH);
	const tauriFallbackIcnsPath = resolve(options.rootDir, DEFAULT_TAURI_ICNS_FALLBACK_RELATIVE_PATH);
	const temporaryRoot = mkdtempSync(join(tmpdir(), 'kwantflow-macos-icon-assets-'));
	const partialInfoPlistPath = join(temporaryRoot, 'partial-info.plist');
	const compiledOutputPath = join(outputDir, 'Assets.car');
	const compiledIcnsPath = join(outputDir, `${appIconName}.icns`);

	try {
		mkdirSync(outputDir, { recursive: true });
		try {
			runCommand(
				spawnCommand,
				'xcrun',
				[
					'actool',
					'--compile',
					outputDir,
					'--platform',
					'macosx',
					'--minimum-deployment-target',
					options.minimumDeploymentTarget ?? DEFAULT_MINIMUM_DEPLOYMENT_TARGET,
					'--app-icon',
					appIconName,
					'--output-partial-info-plist',
					partialInfoPlistPath,
					sourceIconPath
				],
				'Failed to compile the native macOS icon asset catalog. Ensure Xcode is installed and run xcodebuild -runFirstLaunch on the release Mac.'
			);
		} catch (error) {
			if (
				canReuseGeneratedAssets(sourceIconPath, [
					desiredOutputPath,
					desiredIcnsPath,
					tauriFallbackIcnsPath
				])
			) {
				console.warn(
					'[warn] actool is unavailable, reusing existing generated macOS icon assets. ' +
						'Install full Xcode before changing assets/brand/macos.'
				);
				return {
					outputPath: desiredOutputPath,
					icnsPath: desiredIcnsPath,
					tauriFallbackIcnsPath
				};
			}
			throw error;
		}

		if (!existsSync(compiledOutputPath)) {
			throw new Error(`actool did not produce Assets.car at ${compiledOutputPath}.`);
		}

		if (compiledOutputPath !== desiredOutputPath) {
			mkdirSync(dirname(desiredOutputPath), { recursive: true });
			renameSync(compiledOutputPath, desiredOutputPath);
		}
		if (existsSync(compiledIcnsPath)) {
			if (compiledIcnsPath !== desiredIcnsPath) {
				mkdirSync(dirname(desiredIcnsPath), { recursive: true });
				renameSync(compiledIcnsPath, desiredIcnsPath);
			}
		} else {
			console.warn(
				`[warn] actool did not produce ${appIconName}.icns — ` +
					'falling back to existing src-tauri/icons/icon.icns. ' +
					'This is expected on Xcode 16+.'
			);
			if (existsSync(tauriFallbackIcnsPath)) {
				mkdirSync(dirname(desiredIcnsPath), { recursive: true });
				copyFileSync(tauriFallbackIcnsPath, desiredIcnsPath);
			}
		}
		mkdirSync(dirname(tauriFallbackIcnsPath), { recursive: true });
		if (existsSync(desiredIcnsPath)) {
			copyFileSync(desiredIcnsPath, tauriFallbackIcnsPath);
		}

		return {
			outputPath: desiredOutputPath,
			icnsPath: desiredIcnsPath,
			tauriFallbackIcnsPath
		};
	} finally {
		rmSync(temporaryRoot, { recursive: true, force: true });
	}
};

const runCli = (args: string[]) => {
	if (args.length > 0) {
		throw new Error('Usage:\n  pnpm branding:build:macos-icon-assets');
	}

	const result = buildMacosIconAssets({
		rootDir: process.cwd()
	});
	console.log(`Built macOS icon asset catalog at ${result.outputPath}.`);
	console.log(`Updated native macOS fallback icon at ${result.tauriFallbackIcnsPath}.`);
};

if (
	process.argv[1] &&
	existsSync(process.argv[1]) &&
	realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))
) {
	try {
		runCli(process.argv.slice(2));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(message);
		process.exitCode = 1;
	}
}
