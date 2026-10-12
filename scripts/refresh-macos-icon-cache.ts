import { realpathSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type RefreshMacosIconOptions = {
	rootDir: string;
	appPaths: string[];
};

type RunCommandOptions = {
	allowFailure: boolean;
};

type RunCommand = (command: string, args: string[], options: RunCommandOptions) => void;

type RefreshMacosIconRuntime = {
	platform?: NodeJS.Platform;
	runCommand?: RunCommand;
};

const DEFAULT_APP_PATHS = [
	'dist/Kwantflow.app',
	'src-tauri/target/debug/bundle/macos/Kwantflow.app',
	'src-tauri/target/release/bundle/macos/Kwantflow.app'
];

const LAUNCH_SERVICES_REGISTER =
	'/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';

const dedupe = (paths: string[]) => Array.from(new Set(paths));

const resolveAppPath = (rootDir: string, filePath: string) =>
	isAbsolute(filePath) ? filePath : resolve(rootDir, filePath);

export const normaliseRefreshMacosIconOptions = (
	args: string[],
	rootDir = process.cwd()
): RefreshMacosIconOptions => {
	const explicitAppPaths: string[] = [];

	for (let index = 0; index < args.length; index += 1) {
		const value = args[index];
		if (value === '--app') {
			const providedPath = args[index + 1];
			if (providedPath === undefined) {
				throw new Error('Missing value for --app.');
			}
			explicitAppPaths.push(resolveAppPath(rootDir, providedPath));
			index += 1;
			continue;
		}

		throw new Error('Unknown argument: ' + value + '.');
	}

	const appPaths =
		explicitAppPaths.length > 0
			? explicitAppPaths
			: DEFAULT_APP_PATHS.map((appPath) => resolveAppPath(rootDir, appPath));

	return {
		rootDir,
		appPaths: dedupe(appPaths)
	};
};

export const collectExistingMacosIconTouchPaths = (appPaths: string[]) => {
	const touchPaths: string[] = [];

	for (const appPath of dedupe(appPaths)) {
		for (const candidatePath of [
			appPath,
			join(appPath, 'Contents/Info.plist'),
			join(appPath, 'Contents/Resources/icon.icns')
		]) {
			if (existsSync(candidatePath)) {
				touchPaths.push(candidatePath);
			}
		}
	}

	return dedupe(touchPaths);
};

const defaultRunCommand: RunCommand = (command, args, options) => {
	const result = spawnSync(command, args, { stdio: 'inherit' });
	if (result.error) {
		throw result.error;
	}
	if (options.allowFailure === false) {
		if (result.status === 0) {
			return;
		}
		throw new Error(
			command + ' ' + args.join(' ') + ' failed with exit code ' + String(result.status ?? 1) + '.'
		);
	}
};

export const refreshMacosIconCache = (
	options: RefreshMacosIconOptions,
	runtime: RefreshMacosIconRuntime = {}
) => {
	const platform = runtime.platform ?? process.platform;
	if (platform !== 'darwin') {
		throw new Error('macOS only.');
	}

	const runCommand = runtime.runCommand ?? defaultRunCommand;
	const touchPaths = collectExistingMacosIconTouchPaths(options.appPaths);

	for (const touchPath of touchPaths) {
		runCommand('touch', ['-c', touchPath], { allowFailure: false });
	}

	runCommand('qlmanage', ['-r', 'cache'], { allowFailure: false });
	runCommand('qlmanage', ['-r'], { allowFailure: false });
	runCommand('killall', ['iconservicesagent'], { allowFailure: true });
	runCommand('killall', ['iconservicesd'], { allowFailure: true });
	runCommand('killall', ['Finder'], { allowFailure: true });
	runCommand('killall', ['Dock'], { allowFailure: true });
	if (existsSync(LAUNCH_SERVICES_REGISTER)) {
		runCommand(
			LAUNCH_SERVICES_REGISTER,
			['-kill', '-r', '-domain', 'local', '-domain', 'system', '-domain', 'user'],
			{ allowFailure: true }
		);
	}

	return { touchPaths };
};

const runCli = (args: string[]) => {
	const options = normaliseRefreshMacosIconOptions(args);
	const result = refreshMacosIconCache(options);

	if (result.touchPaths.length === 0) {
		console.log(
			'No existing Kwantflow app bundles were found. Refreshed Quick Look, IconServices, Finder, Dock, and Launch Services caches only.'
		);
		return;
	}

	console.log('Refreshed macOS icon cache for:');
	for (const touchPath of result.touchPaths) {
		console.log('- ' + touchPath);
	}
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
