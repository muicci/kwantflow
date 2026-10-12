import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	copyFileSync,
	chmodSync,
	cpSync,
	createReadStream,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type NativeInput = { url: string; filename: string; sha256: string };
type NativeInputs = { litertLm: { macos: NativeInput }; pdfium: { macos: NativeInput } };

export async function sha256File(path: string): Promise<string> {
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(path)) hash.update(chunk);
	return hash.digest('hex');
}

export async function verifyNativeInput(path: string, expectedSha256: string): Promise<void> {
	if (!/^[a-f0-9]{64}$/.test(expectedSha256))
		throw new Error('Invalid pinned native input SHA-256.');
	if ((await sha256File(path)) !== expectedSha256)
		throw new Error(`Native input checksum mismatch: ${path}`);
}

const run = (command: string, args: string[], cwd: string) => {
	const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`${command} failed (${result.status}).`);
};

export function assertMacosRuntimeOutputs(
	name: string,
	architectures: string,
	buildVersions: string,
	dependencies: string,
	stagedLibraries: string[] = [name],
	symbols = ''
): void {
	if (architectures.trim().split(/\s+/).sort().join(' ') !== 'arm64 x86_64')
		throw new Error(`${name} must contain exactly arm64 and x86_64.`);
	const minimums = [...buildVersions.matchAll(/^\s*minos\s+(\d+)\.(\d+)(?:\.\d+)?\s*$/gm)];
	if (
		minimums.length !== 2 ||
		[...buildVersions.matchAll(/^\s*platform\s+MACOS\s*$/gm)].length !== 2 ||
		minimums.some(
			(match) => Number(match[1]) > 12 || (Number(match[1]) === 12 && Number(match[2]) > 0)
		)
	)
		throw new Error(`${name} must support macOS 12.0 in both slices.`);
	for (const match of dependencies.matchAll(/^\s+(.+?)\s+\(compatibility version /gm)) {
		const dependency = match[1];
		if (
			!stagedLibraries.some(
				(library) =>
					dependency === `@rpath/${library}` || dependency === `@executable_path/${library}`
			) &&
			!dependency.startsWith('/System/Library/') &&
			!dependency.startsWith('/usr/lib/')
		)
			throw new Error(`${name} has an unstaged non-OS dependency: ${dependency}`);
	}
	const unresolvedBridge = symbols
		.split('\n')
		.find((line) => line.includes('(undefined)') && line.includes('cxxbridge'));
	if (unresolvedBridge)
		throw new Error(`${name} has an unresolved CXX bridge symbol: ${unresolvedBridge.trim()}`);
}

export function verifyMacosRuntime(directory: string, cwd?: string): void {
	const expected = ['liblitert_lm_c.dylib', 'libpdfium.dylib'];
	if (
		readdirSync(directory)
			.filter((name) => name.endsWith('.dylib'))
			.sort()
			.join(',') !== expected.join(',')
	)
		throw new Error(
			'macOS native runtime must contain exactly the pinned LiteRT-LM and PDFium dylibs; remove stale runtime shards deliberately.'
		);
	for (const name of expected) {
		const path = join(directory, name);
		const outputs = [
			['lipo', ['-archs', path]],
			['xcrun', ['vtool', '-show-build', path]],
			['otool', ['-L', path]],
			['nm', ['-u', '-m', path]]
		] as const;
		const results = outputs.map(([command, args]) => {
			const result = spawnSync(command, [...args], { cwd, encoding: 'utf8' });
			if (result.error) throw result.error;
			if (result.status !== 0)
				throw new Error(`${command} could not inspect ${name}: ${result.stderr.trim()}`);
			return result.stdout;
		});
		assertMacosRuntimeOutputs(name, results[0], results[1], results[2], [name], results[3]);
	}
}

async function acquire(
	input: NativeInput,
	cache: string,
	offline: boolean,
	cwd: string
): Promise<string> {
	const path = join(cache, input.filename);
	if (!existsSync(path)) {
		if (offline)
			throw new Error(`Missing cached native input: ${path}. Run native:prepare online once.`);
		const partial = `${path}.partial`;
		try {
			run(
				'curl',
				[
					'--fail',
					'--location',
					'--retry',
					'2',
					'--max-time',
					'300',
					'--output',
					partial,
					input.url
				],
				cwd
			);
			await verifyNativeInput(partial, input.sha256);
			renameSync(partial, path);
		} finally {
			rmSync(partial, { force: true });
		}
	}
	await verifyNativeInput(path, input.sha256);
	return path;
}

export async function prepareNativeRuntime(rootDir: string, offline = false): Promise<void> {
	rootDir = resolve(rootDir);
	if (process.platform === 'win32') {
		run(
			'pwsh',
			[
				'-NoProfile',
				'-File',
				join(rootDir, 'scripts/native-windows.ps1'),
				...(offline ? ['-Offline'] : [])
			],
			rootDir
		);
		return;
	}
	if (process.platform !== 'darwin')
		throw new Error('Supported build hosts are macOS and Windows x64.');
	const inputs = JSON.parse(
		readFileSync(join(rootDir, 'native-inputs.json'), 'utf8')
	) as NativeInputs;
	const cache = join(rootDir, '.cache/native-inputs');
	const output = join(rootDir, 'src-tauri/native-runtime');
	mkdirSync(cache, { recursive: true });
	mkdirSync(dirname(output), { recursive: true });
	const temporary = mkdtempSync(join(dirname(output), '.native-runtime-stage-'));
	const staged = join(temporary, 'candidate');
	const previous = join(temporary, 'previous');
	let preserveRecovery = false;
	try {
		if (existsSync(output)) cpSync(output, staged, { recursive: true });
		else mkdirSync(staged);
		const liteRt = await acquire(inputs.litertLm.macos, cache, offline, rootDir);
		const pdfium = await acquire(inputs.pdfium.macos, cache, offline, rootDir);
		run('unzip', ['-q', liteRt, '-d', join(temporary, 'litert')], rootDir);
		mkdirSync(join(temporary, 'pdfium'));
		run('tar', ['-xzf', pdfium, '-C', join(temporary, 'pdfium')], rootDir);
		for (const name of ['liblitert_lm_c.dylib', 'libpdfium.dylib']) {
			const destination = join(staged, name);
			if (existsSync(destination)) chmodSync(destination, 0o755);
		}
		copyFileSync(
			join(temporary, 'litert/CLiteRTLM_mac.xcframework/macos-arm64_x86_64/libCLiteRTLM_mac.dylib'),
			join(staged, 'liblitert_lm_c.dylib')
		);
		copyFileSync(join(temporary, 'pdfium/lib/libpdfium.dylib'), join(staged, 'libpdfium.dylib'));
		const notices = join(staged, 'licenses/pdfium');
		mkdirSync(notices, { recursive: true });
		cpSync(join(temporary, 'pdfium/licenses'), notices, { recursive: true });
		copyFileSync(join(temporary, 'pdfium/LICENSE'), join(notices, 'LICENSE'));
		for (const name of ['liblitert_lm_c.dylib', 'libpdfium.dylib']) {
			const path = join(staged, name);
			chmodSync(path, 0o755);
			run('install_name_tool', ['-id', `@rpath/${name}`, path], rootDir);
			// Changing an install name invalidates the upstream code signature.
			// Preparation is safe for development; explicit distribution signing
			// replaces this ad hoc signature with a maintainer's identity later.
			run('codesign', ['--force', '--sign', '-', path], rootDir);
		}
		verifyMacosRuntime(staged, rootDir);
		writeFileSync(
			join(staged, 'macos-input-receipt.json'),
			`${JSON.stringify({ platform: 'darwin-universal', liteRt: inputs.litertLm.macos, pdfium: inputs.pdfium.macos, minimumSystemVersion: '12.0', installedAppTested: false }, null, '\t')}\n`
		);
		if (existsSync(output)) renameSync(output, previous);
		try {
			renameSync(staged, output);
		} catch (error) {
			if (existsSync(previous)) {
				try {
					renameSync(previous, output);
				} catch (recoveryError) {
					preserveRecovery = true;
					throw new AggregateError(
						[error, recoveryError],
						`Native preparation could not restore the previous bundle. Recovery files remain at ${previous}.`,
						{ cause: recoveryError }
					);
				}
			}
			throw error;
		}
		console.log(
			'Prepared verified LiteRT-LM v0.16.0 and PDFium chromium/7920 universal native inputs.'
		);
	} finally {
		if (!preserveRecovery) rmSync(temporary, { recursive: true, force: true });
	}
}

if (
	process.argv[1] &&
	existsSync(resolve(process.argv[1])) &&
	realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))
) {
	const args = process.argv.slice(2);
	if (args.some((arg) => arg !== '--offline'))
		throw new Error('Usage: pnpm native:prepare [--offline]');
	await prepareNativeRuntime(process.cwd(), args.includes('--offline'));
}
