import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { dirname, join, posix, resolve, sep, win32 } from 'node:path';

import { buildMacosIconAssets, type BuildMacosIconAssetsResult } from './build-macos-icon-assets';
import { buildMacosDmg, type BuildMacosDmgOptions } from './build-macos-dmg';
import { spawnPnpmSync } from './package-manager';

export const isDirectExecution = (
	moduleUrl: string,
	entryPath: string | undefined,
	platform: NodeJS.Platform = process.platform
) => {
	if (!entryPath) return false;
	const windows = platform === 'win32';
	const pathApi = windows ? win32 : posix;
	const modulePath = pathApi.normalize(fileURLToPath(moduleUrl, { windows }));
	const executablePath = pathApi.normalize(entryPath);
	return windows
		? modulePath.toLowerCase() === executablePath.toLowerCase()
		: modulePath === executablePath;
};

const DEV_APP_IDENTIFIER = 'com.kwantflow.desktop.dev';
type SpawnResult = {
	status: number | null;
	error?: Error | null;
};

type SpawnOptions = {
	env?: NodeJS.ProcessEnv;
	cwd?: string;
};

type SpawnCommand = (command: string, args: string[], options?: SpawnOptions) => SpawnResult;
type LoadEnv = (
	mode: string,
	envDir: string,
	prefixes: string | string[]
) => Record<string, string>;
type BuildMacosIconAssets = (
	options: { rootDir: string },
	runtime?: undefined
) => BuildMacosIconAssetsResult;
type BuildDmg = (options: BuildMacosDmgOptions) => { outputPath: string };
type RunningProcess = {
	pid: number;
	command: string;
};
type ListProcesses = () => RunningProcess[];

type RunTauriCliRuntime = {
	platform?: NodeJS.Platform;
	rootDir?: string;
	env?: NodeJS.ProcessEnv;
	spawnCommand?: SpawnCommand;
	loadEnv?: LoadEnv;
	buildMacosIconAssets?: BuildMacosIconAssets;
	buildDmg?: BuildDmg;
	listProcesses?: ListProcesses;
	log?: (message: string) => void;
	warn?: (message: string) => void;
};

const defaultSpawnCommand: SpawnCommand = (command, args, options = {}) =>
	command === 'pnpm'
		? spawnPnpmSync(args, { stdio: 'inherit', env: options.env, cwd: options.cwd })
		: spawnSync(command, args, { stdio: 'inherit', env: options.env, cwd: options.cwd });

const parseRunningProcesses = (rawOutput: string): RunningProcess[] =>
	rawOutput
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.flatMap((line) => {
			const match = line.match(/^(\d+)\s+(.*)$/);
			if (!match) {
				return [];
			}
			return [
				{
					pid: Number(match[1]),
					command: match[2]
				}
			];
		});

const defaultListProcesses: ListProcesses = () => {
	const withPids = spawnSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
	if (withPids.error) {
		throw withPids.error;
	}
	if (withPids.status !== 0) {
		throw new Error(withPids.stderr?.trim() || 'Failed to inspect running process identifiers.');
	}
	return parseRunningProcesses(withPids.stdout);
};

const getOptionValues = (args: string[], names: string[]) => {
	for (let index = 0; index < args.length; index += 1) {
		if (names.includes(args[index])) {
			const values: string[] = [];
			for (let valueIndex = index + 1; valueIndex < args.length; valueIndex += 1) {
				const value = args[valueIndex];
				if (value.startsWith('-')) {
					break;
				}
				values.push(...value.split(',').filter(Boolean));
			}
			return values;
		}
	}
	return null;
};

const replaceBundleSelection = (args: string[], bundles: string[]) => {
	const nextArgs: string[] = [];
	for (let index = 0; index < args.length; index += 1) {
		const value = args[index];
		if (value === '-b' || value === '--bundles') {
			index += 1;
			while (index < args.length && !args[index].startsWith('-')) {
				index += 1;
			}
			index -= 1;
			continue;
		}
		nextArgs.push(value);
	}
	return [...nextArgs, '--bundles', bundles.join(',')];
};

const getTarget = (args: string[]) => {
	const values = getOptionValues(args, ['-t', '--target']);
	return values?.[0];
};

const usesDebugProfile = (args: string[]) => args.includes('-d') || args.includes('--debug');

const resolveBuildMode = (args: string[]) => {
	if (args[0] === 'dev') {
		return 'development';
	}

	return usesDebugProfile(args) ? 'development' : 'production';
};

const parseEnvFile = (filePath: string): Record<string, string> => {
	if (!existsSync(filePath)) {
		return {};
	}

	const env: Record<string, string> = {};
	for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
		const trimmedLine = line.trim();
		if (!trimmedLine || trimmedLine.startsWith('#')) {
			continue;
		}

		const separatorIndex = trimmedLine.indexOf('=');
		if (separatorIndex <= 0) {
			continue;
		}

		const key = trimmedLine
			.slice(0, separatorIndex)
			.trim()
			.replace(/^export\s+/, '');
		const rawValue = trimmedLine.slice(separatorIndex + 1).trim();
		const value =
			(rawValue.startsWith('"') && rawValue.endsWith('"')) ||
			(rawValue.startsWith("'") && rawValue.endsWith("'"))
				? rawValue.slice(1, -1)
				: rawValue;

		env[key] = value;
	}

	return env;
};

const loadBuildEnvFiles: LoadEnv = (mode, envDir) => {
	const fileNames = ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`];
	const env: Record<string, string> = {};

	for (const fileName of fileNames) {
		Object.assign(env, parseEnvFile(join(envDir, fileName)));
	}

	return env;
};

const resolveSharedRepoRoot = (rootDir: string) => {
	const gitPath = join(rootDir, '.git');
	if (!existsSync(gitPath)) {
		return rootDir;
	}

	try {
		if (lstatSync(gitPath).isDirectory()) {
			return rootDir;
		}
	} catch {
		return rootDir;
	}

	const gitPointer = readFileSync(gitPath, 'utf8').trim();
	const match = gitPointer.match(/^gitdir:\s*(.+)$/i);
	if (!match?.[1]) {
		return rootDir;
	}

	const resolvedGitDir = resolve(rootDir, match[1].trim());
	const worktreeMarker = `${sep}.git${sep}worktrees${sep}`;
	const markerIndex = resolvedGitDir.lastIndexOf(worktreeMarker);
	if (markerIndex === -1) {
		return rootDir;
	}

	const commonGitDir = resolvedGitDir.slice(0, markerIndex + `${sep}.git`.length);
	return dirname(commonGitDir);
};

const resolveRuntimeEnv = (
	args: string[],
	rootDir: string,
	env: NodeJS.ProcessEnv,
	loadEnv: LoadEnv
): NodeJS.ProcessEnv => {
	if (args[0] !== 'dev') {
		return env;
	}

	const mode = resolveBuildMode(args);
	const sharedRepoRoot = resolveSharedRepoRoot(rootDir);
	const sharedEnv = sharedRepoRoot !== rootDir ? loadEnv(mode, sharedRepoRoot, '') : {};
	const localEnv = loadEnv(mode, rootDir, '');

	return {
		...sharedEnv,
		...localEnv,
		...env
	};
};

const KWANTFLOW_VITE_DEV_PATTERNS = [
	/(^|\s)(?:node\s+)?(?:.+\/)?vite(?:\/bin\/vite\.js)?\s+dev(?:\s|$)/i,
	/\bpnpm\s+dev:tauri\b/i
] as const;

const KWANTFLOW_REPO_PROCESS_HINT = /(?:^|\/)Kwantflow\/app(?:\/|$)/i;

export const detectRunningKwantflowViteDevProcesses = (
	processList: RunningProcess[]
): RunningProcess[] =>
	processList.filter(
		(processInfo) =>
			KWANTFLOW_REPO_PROCESS_HINT.test(processInfo.command) &&
			KWANTFLOW_VITE_DEV_PATTERNS.some((pattern) => pattern.test(processInfo.command))
	);

const isProcessInspectionPermissionError = (error: unknown) => {
	if (!(error instanceof Error)) return false;
	const message = `${error.name} ${error.message}`.toLowerCase();
	return message.includes('eperm') || message.includes('permission denied');
};

const ensureKwantflowDevServerAvailability = (
	args: string[],
	listProcesses: ListProcesses,
	warn: (message: string) => void
) => {
	if (args[0] !== 'dev') {
		return;
	}

	let runningProcesses: RunningProcess[];
	try {
		runningProcesses = detectRunningKwantflowViteDevProcesses(listProcesses());
	} catch (error) {
		if (!isProcessInspectionPermissionError(error)) {
			throw error;
		}
		warn(
			`Kwantflow dev-server preflight is unavailable in this environment (${error instanceof Error ? error.message : String(error)}). Continuing without a port-1420 conflict check.`
		);
		return;
	}

	if (runningProcesses.length === 0) {
		return;
	}

	const processSummary = runningProcesses
		.map((processInfo) => `${processInfo.pid}: ${processInfo.command}`)
		.join('; ');

	throw new Error(
		`Existing Kwantflow Vite dev process(es) can keep port 1420 busy and block this launch: ${processSummary}. Stop the stale dev server, then rerun the Tauri launcher.`
	);
};

// Windows bundles the LiteRT-LM DLLs only after `pnpm native:prepare` staged them. A static
// resource glob in tauri.windows.conf.json would fail every fresh-clone build without them.
export const hasStagedWindowsNativeDlls = (rootDir: string) => {
	const directory = join(rootDir, 'src-tauri/native-runtime');
	return (
		existsSync(directory) &&
		readdirSync(directory).some((name) => name.toLowerCase().endsWith('.dll'))
	);
};

const applyConfigOverrides = (
	args: string[],
	env: NodeJS.ProcessEnv,
	includeWindowsNativeDlls: boolean
) => {
	const config: Record<string, unknown> = {};
	if (args[0] === 'dev') config.identifier = readQaIdentifier(env) ?? DEV_APP_IDENTIFIER;
	if (includeWindowsNativeDlls && ['dev', 'build', 'bundle'].includes(args[0] ?? ''))
		config.bundle = { resources: { 'native-runtime/*.dll': '' } };
	return Object.keys(config).length ? [...args, '--config', JSON.stringify(config)] : args;
};

export const TAURI_QA_IDENTIFIER_ENV = 'KWANTFLOW_TAURI_QA_IDENTIFIER';
export function readQaIdentifier(env: NodeJS.ProcessEnv): string | undefined {
	const identifier = env[TAURI_QA_IDENTIFIER_ENV];
	if (identifier === undefined) return;
	if (!/^com\.kwantflow\.desktop\.qa-[a-z0-9][a-z0-9-]{0,63}$/.test(identifier))
		throw new Error(
			`${TAURI_QA_IDENTIFIER_ENV} must use an isolated com.kwantflow.desktop.qa- identifier.`
		);
	return identifier;
}

const normaliseMacosBuildArgs = (args: string[]) => {
	if (args[0] !== 'build' || args.includes('--no-bundle')) {
		return { tauriArgs: args, shouldBuildDmg: false };
	}

	const requestedBundles = getOptionValues(args, ['-b', '--bundles']);
	const shouldBuildDmg = requestedBundles === null || requestedBundles.includes('dmg');
	const nextBundles = Array.from(
		new Set((requestedBundles ?? ['app', 'dmg']).filter((bundle) => bundle !== 'dmg').concat('app'))
	);

	return {
		tauriArgs: replaceBundleSelection(args, nextBundles),
		shouldBuildDmg
	};
};

export const runTauriCli = (args: string[], runtime: RunTauriCliRuntime = {}) => {
	const platform = runtime.platform ?? process.platform;
	const rootDir = runtime.rootDir ?? process.cwd();
	const env = runtime.env ?? process.env;
	const spawnCommand = runtime.spawnCommand ?? defaultSpawnCommand;
	const loadEnv = runtime.loadEnv ?? loadBuildEnvFiles;
	const buildMacosIconAssetsRunner = runtime.buildMacosIconAssets ?? buildMacosIconAssets;
	const buildDmg = runtime.buildDmg ?? buildMacosDmg;
	const listProcesses = runtime.listProcesses ?? defaultListProcesses;
	const log = runtime.log ?? console.log;
	const warn = runtime.warn ?? console.warn;
	const resolvedEnv = { ...resolveRuntimeEnv(args, rootDir, env, loadEnv) };
	// QA identity is accepted only from an explicit process/test environment,
	// never from repository environment files or an installed-profile override.
	delete resolvedEnv[TAURI_QA_IDENTIFIER_ENV];
	if (env[TAURI_QA_IDENTIFIER_ENV] !== undefined) {
		if (args[0] !== 'dev')
			throw new Error('An isolated QA identifier is only valid for tauri dev.');
		resolvedEnv[TAURI_QA_IDENTIFIER_ENV] = env[TAURI_QA_IDENTIFIER_ENV];
		readQaIdentifier(resolvedEnv);
	}

	ensureKwantflowDevServerAvailability(args, listProcesses, warn);

	const { tauriArgs: macosArgs, shouldBuildDmg } =
		platform === 'darwin'
			? normaliseMacosBuildArgs(args)
			: { tauriArgs: args, shouldBuildDmg: false };
	const tauriArgs = applyConfigOverrides(
		macosArgs,
		resolvedEnv,
		platform === 'win32' && hasStagedWindowsNativeDlls(rootDir)
	);
	const tauriEnv = resolvedEnv;
	// Use rustup's shim so rust-toolchain.toml is authoritative even when Homebrew's
	// cargo appears earlier in the interactive shell PATH.
	const rustupBin = join(homedir(), '.cargo/bin');
	const pathDelimiter = platform === 'win32' ? ';' : ':';
	tauriEnv.PATH = `${rustupBin}${pathDelimiter}${tauriEnv.PATH ?? process.env.PATH ?? ''}`;

	if (platform === 'darwin' && args[0] === 'build') {
		buildMacosIconAssetsRunner({ rootDir }, undefined);
	}

	const result = spawnCommand('pnpm', ['exec', 'tauri', ...tauriArgs], {
		env: tauriEnv,
		cwd: rootDir
	});
	let exitCode = result.status ?? 1;

	if (platform === 'darwin' && args[0] === 'build' && exitCode === 0 && shouldBuildDmg) {
		try {
			const dmgResult = buildDmg({
				rootDir,
				profile: usesDebugProfile(args) ? 'debug' : 'release',
				target: getTarget(args),
				notarize: false
			});
			log(`Built repo-managed macOS DMG at ${dmgResult.outputPath}.`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			warn('Failed to build repo-managed macOS DMG: ' + message);
			exitCode = 1;
		}
	}

	if (result.error) {
		throw result.error;
	}

	return exitCode;
};

if (
	process.argv[1] &&
	existsSync(process.argv[1]) &&
	isDirectExecution(import.meta.url, realpathSync(process.argv[1]))
) {
	process.exitCode = runTauriCli(process.argv.slice(2));
}
