import { spawnSync } from 'node:child_process';
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	realpathSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMacosDmg } from './build-macos-dmg.js';
import {
	assertMacosRuntimeOutputs,
	prepareNativeRuntime,
	sha256File,
	verifyMacosRuntime
} from './native-prepare.js';
import { spawnPnpmSync } from './package-manager.js';
import {
	assertDistributionDirectory,
	buildSourceDistribution,
	readDistributionVersion
} from './distribution-source.js';

export type DistributionManifest = {
	schemaVersion: 1;
	version: string;
	sourceCommit: string;
	sourceDirty: boolean;
	platform: 'darwin-universal' | 'windows-x86_64';
	trust: 'ad-hoc' | 'developer-id-notarized' | 'unsigned';
	installedQa: 'pending';
	artifacts: { name: string; sha256: string }[];
	runtimeReceipt?: { name: 'windows-runtime-receipt.json'; sha256: string };
};

export function parseDistributionBuildArgs(args: string[]) {
	if (args.some((arg) => !['--sign', '--offline-inputs'].includes(arg)))
		throw new Error('Usage: pnpm distribution:build [--sign] [--offline-inputs]');
	return { sign: args.includes('--sign'), offline: args.includes('--offline-inputs') };
}

export function verifyMacosApplication(app: string, version: string): void {
	const inspect = (command: string, args: string[]) => {
		const result = spawnSync(command, args, { encoding: 'utf8' });
		if (result.error || result.status !== 0)
			throw new Error(`Cannot inspect macOS app: ${result.error?.message ?? result.stderr.trim()}`);
		return result.stdout;
	};
	if (
		inspect('/usr/libexec/PlistBuddy', [
			'-c',
			'Print:CFBundleShortVersionString',
			join(app, 'Contents/Info.plist')
		]).trim() !== version
	)
		throw new Error('macOS application version does not match the release manifest.');
	const executable = inspect('/usr/libexec/PlistBuddy', [
		'-c',
		'Print:CFBundleExecutable',
		join(app, 'Contents/Info.plist')
	]).trim();
	if (!/^[a-zA-Z0-9._-]+$/.test(executable)) throw new Error('Invalid macOS bundle executable.');
	const binary = join(app, 'Contents/MacOS', executable);
	const libraries = ['liblitert_lm_c.dylib', 'libpdfium.dylib'];
	assertMacosRuntimeOutputs(
		executable,
		inspect('lipo', ['-archs', binary]),
		inspect('xcrun', ['vtool', '-show-build', binary]),
		inspect('otool', ['-L', binary]),
		libraries
	);
	const paths = inspect('otool', ['-l', binary])
		.split('Load command')
		.filter((block) => /\bcmd LC_RPATH\b/.test(block))
		.map((block) => /^\s*path (.+?) \(offset /m.exec(block)?.[1]);
	if (paths.filter((path) => path === '@executable_path/../Resources/local-ai/native').length !== 2)
		throw new Error('Both executable slices must search the bundled native resource directory.');
	for (const path of paths)
		if (
			!path ||
			!(
				[
					'@executable_path/../Resources/local-ai/native',
					'@executable_path/',
					'@executable_path/../Frameworks'
				].includes(path) ||
				path.startsWith('/System/Library/') ||
				path.startsWith('/usr/lib/')
			)
		)
			throw new Error(`Unreviewed macOS executable RPATH: ${path}`);
	verifyMacosRuntime(join(app, 'Contents/Resources/local-ai/native'));
}

export async function buildDistribution(rootDir: string, args: string[]): Promise<string> {
	rootDir = realpathSync(rootDir);
	const { sign, offline } = parseDistributionBuildArgs(args);
	if (!['darwin', 'win32'].includes(process.platform))
		throw new Error('Build on a native macOS or Windows x64 host.');
	if (process.platform === 'win32' && process.arch !== 'x64')
		throw new Error('Windows certification requires native x64 hardware.');
	if (sign && process.platform !== 'darwin')
		throw new Error(
			'Windows Authenticode signing is not configured. Do not describe an unsigned build as trusted.'
		);
	const version = readDistributionVersion(rootDir);
	const source = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: rootDir, encoding: 'utf8' });
	const gitRoot = spawnSync('git', ['rev-parse', '--show-toplevel'], {
		cwd: rootDir,
		encoding: 'utf8'
	});
	let sourceCommit: string;
	let sourceDirty: boolean;
	if (
		source.status === 0 &&
		gitRoot.status === 0 &&
		resolve(gitRoot.stdout.trim()) === resolve(rootDir)
	) {
		sourceCommit = source.stdout.trim();
		const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: rootDir, encoding: 'utf8' });
		if (dirty.status !== 0) throw new Error('Cannot determine source tree status.');
		sourceDirty = Boolean(dirty.stdout.trim());
	} else {
		const receiptPath = join(rootDir, 'SOURCE_PROVENANCE.json');
		if (!existsSync(receiptPath))
			throw new Error(
				'Build needs either a Git checkout or a verified source archive with SOURCE_PROVENANCE.json.'
			);
		const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as {
			schemaVersion: number;
			version: string;
			sourceCommit: string;
		};
		if (
			receipt.schemaVersion !== 1 ||
			receipt.version !== version ||
			!/^[a-f0-9]{40}$/.test(receipt.sourceCommit)
		)
			throw new Error('Invalid source archive provenance.');
		sourceCommit = receipt.sourceCommit;
		// Archive edits have no Git ledger. Record this local build as changed,
		// retaining the archived origin commit without claiming a clean checkout.
		sourceDirty = true;
	}
	if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error('Invalid application source commit.');
	if (sign && sourceDirty)
		throw new Error(
			'Signed distribution requires a clean source tree. Finish local verification before requesting a release.'
		);
	if (sign) await buildSourceDistribution(rootDir, { checkOnly: true });
	const env: NodeJS.ProcessEnv = { ...process.env, KWANTFLOW_REQUIRE_LITERT_LM_NATIVE: '1' };
	const run = (command: string, commandArgs: string[], commandEnv = env) => {
		const options = { stdio: 'inherit' as const, env: commandEnv, cwd: rootDir };
		const result =
			command === 'pnpm'
				? spawnPnpmSync(commandArgs, options)
				: spawnSync(command, commandArgs, options);
		if (result.error) throw result.error;
		if (result.status !== 0) throw new Error(`${command} failed (${result.status}).`);
	};
	// Signing secrets are intentionally read only for an explicit --sign build.
	if (sign) {
		for (const key of [
			'APPLE_SIGNING_IDENTITY',
			'APPLE_API_KEY_PATH',
			'APPLE_API_KEY',
			'APPLE_API_ISSUER'
		])
			if (!env[key]?.trim())
				throw new Error(
					`${key} is required for --sign. Supply maintainer-owned credentials in the process environment.`
				);
	} else {
		for (const key of [
			'APPLE_SIGNING_IDENTITY',
			'APPLE_CERTIFICATE',
			'APPLE_CERTIFICATE_PASSWORD',
			'APPLE_API_KEY_PATH',
			'APPLE_API_KEY',
			'APPLE_API_ISSUER',
			'APPLE_ID',
			'APPLE_PASSWORD',
			'APPLE_TEAM_ID'
		])
			delete env[key];
	}
	await prepareNativeRuntime(rootDir, offline);
	const platform = process.platform === 'darwin' ? 'darwin-universal' : 'windows-x86_64';
	const output = join(rootDir, 'dist/distribution', version, platform);
	assertDistributionDirectory(rootDir, output);
	mkdirSync(output, { recursive: true });
	let installer: string;
	let name: string;
	if (process.platform === 'darwin') {
		const app = join(
			rootDir,
			'src-tauri/target/universal-apple-darwin/release/bundle/macos/Kwantflow.app'
		);
		assertDistributionDirectory(rootDir, join(app, '..'));
		// Keep a successful earlier bundle from surviving as this run's result.
		rmSync(app, { recursive: true, force: true });
		const runtime = join(rootDir, 'src-tauri/native-runtime');
		for (const dll of readdirSync(runtime).filter((entry) => entry.endsWith('.dylib'))) {
			run(
				'codesign',
				[
					'--force',
					...(sign ? ['--options', 'runtime', '--timestamp'] : []),
					'--sign',
					sign ? env.APPLE_SIGNING_IDENTITY! : '-',
					join(runtime, dll)
				],
				env
			);
		}
		run(
			'pnpm',
			[
				'tauri',
				'build',
				'--target',
				'universal-apple-darwin',
				'--bundles',
				'app',
				'--config',
				JSON.stringify({
					bundle: { macOS: { signingIdentity: sign ? env.APPLE_SIGNING_IDENTITY : '-' } }
				})
			],
			env
		);
		verifyMacosApplication(app, version);
		if (sign) {
			run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], env);
			run('xcrun', ['stapler', 'validate', app], env);
			run('spctl', ['--assess', '--type', 'execute', '--verbose', app], env);
		}
		name = `Kwantflow_${version}_universal.dmg`;
		installer = join(output, name);
		buildMacosDmg({
			rootDir,
			appPath: app,
			outputPath: installer,
			profile: 'release',
			target: 'universal-apple-darwin',
			notarize: false
		});
		if (sign) {
			run(
				'codesign',
				['--force', '--timestamp', '--sign', env.APPLE_SIGNING_IDENTITY!, installer],
				env
			);
			run(
				'xcrun',
				[
					'notarytool',
					'submit',
					installer,
					'--key',
					env.APPLE_API_KEY_PATH!,
					'--key-id',
					env.APPLE_API_KEY!,
					'--issuer',
					env.APPLE_API_ISSUER!,
					'--wait'
				],
				env
			);
			run('xcrun', ['stapler', 'staple', installer], env);
			run('xcrun', ['stapler', 'validate', installer], env);
			run('codesign', ['--verify', '--strict', '--verbose=2', installer], env);
			run(
				'spctl',
				[
					'--assess',
					'--type',
					'open',
					'--context',
					'context:primary-signature',
					'--verbose',
					installer
				],
				env
			);
		}
	} else {
		run('pnpm', ['tauri', 'build', '--target', 'x86_64-pc-windows-msvc', '--no-bundle'], env);
		const releaseDir = join(rootDir, 'src-tauri/target/x86_64-pc-windows-msvc/release');
		assertDistributionDirectory(rootDir, releaseDir);
		name = `Kwantflow_${version}_x64-setup.exe`;
		const builtInstaller = join(releaseDir, 'bundle/nsis', name);
		// A previous build must not be mistaken for this run's bundle output.
		rmSync(builtInstaller, { force: true });
		// Check EXE imports before generating NSIS prerequisite decisions and bundling.
		run('pwsh', [
			'-NoProfile',
			'-File',
			join(rootDir, 'scripts/verify-windows-runtime.ps1'),
			'-RuntimeDirectory',
			join(rootDir, 'src-tauri/native-runtime'),
			'-AppExecutable',
			join(releaseDir, 'kwantflow-app.exe'),
			'-OutputDirectory',
			releaseDir,
			...(offline ? ['-Offline'] : [])
		]);
		run(
			'pnpm',
			['tauri', 'bundle', '--target', 'x86_64-pc-windows-msvc', '--bundles', 'nsis'],
			env
		);
		run(
			'pwsh',
			[
				'-NoProfile',
				'-File',
				join(rootDir, 'scripts/verify-windows-runtime.ps1'),
				'-RuntimeDirectory',
				join(rootDir, 'src-tauri/native-runtime'),
				'-AppExecutable',
				join(releaseDir, 'kwantflow-app.exe'),
				'-OutputDirectory',
				releaseDir,
				'-VerifyOnly'
			],
			env
		);
		if (!existsSync(builtInstaller))
			throw new Error('The current version Windows x64 NSIS installer was not produced.');
		installer = join(output, name);
		copyFileSync(builtInstaller, installer);
	}
	if (!existsSync(installer)) throw new Error('Installer was not produced.');
	const sha256 = await sha256File(installer);
	let runtimeReceipt: DistributionManifest['runtimeReceipt'];
	if (process.platform === 'win32') {
		const receiptName = 'windows-runtime-receipt.json';
		const receiptPath = join(output, receiptName);
		copyFileSync(join(rootDir, 'src-tauri/native-runtime', receiptName), receiptPath);
		runtimeReceipt = { name: receiptName, sha256: await sha256File(receiptPath) };
	}
	const manifest: DistributionManifest = {
		schemaVersion: 1,
		version,
		sourceCommit,
		sourceDirty,
		platform,
		trust:
			process.platform === 'darwin' ? (sign ? 'developer-id-notarized' : 'ad-hoc') : 'unsigned',
		installedQa: 'pending',
		artifacts: [{ name, sha256 }],
		...(runtimeReceipt ? { runtimeReceipt } : {})
	};
	writeFileSync(join(output, 'build-manifest.json'), `${JSON.stringify(manifest, null, '\t')}\n`);
	writeFileSync(join(output, 'SHA256SUMS'), `${sha256}  ${name}\n`);
	console.log(`Built ${installer}. Installed user-flow QA remains pending; nothing was published.`);
	return output;
}

if (
	process.argv[1] &&
	existsSync(process.argv[1]) &&
	realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
)
	await buildDistribution(process.cwd(), process.argv.slice(2));
