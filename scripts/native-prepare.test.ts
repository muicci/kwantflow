import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareNativeRuntime } from './native-prepare.js';

vi.mock('node:child_process', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:child_process')>();
	const spawnSync = vi.fn();
	return { ...actual, spawnSync, default: { ...actual, spawnSync } };
});
vi.mock('node:fs', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:fs')>();
	const renameSync = vi.fn(actual.renameSync);
	return { ...actual, renameSync, default: { ...actual, renameSync } };
});

const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');
const actualProcess =
	await vi.importActual<typeof import('node:child_process')>('node:child_process');
let root: string;
let output: string;
let failSigning = false;
let unresolvedCxx = false;
let largeSymbolTable = false;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'kwantflow-native-prepare-test-'));
	output = join(root, 'src-tauri/native-runtime');
	mkdirSync(join(root, '.cache/native-inputs'), { recursive: true });
	mkdirSync(join(output, 'licenses/litert'), { recursive: true });
	writeFileSync(join(output, 'liblitert_lm_c.dylib'), 'previous LiteRT');
	writeFileSync(join(output, 'libpdfium.dylib'), 'previous PDFium');
	writeFileSync(join(output, 'macos-input-receipt.json'), 'previous receipt');
	writeFileSync(join(output, 'licenses/litert/LICENSE'), 'existing LiteRT notice');
	const input = (filename: string) => {
		const bytes = Buffer.from(filename);
		writeFileSync(join(root, '.cache/native-inputs', filename), bytes);
		return {
			filename,
			url: `https://example.invalid/${filename}`,
			sha256: createHash('sha256').update(bytes).digest('hex')
		};
	};
	writeFileSync(
		join(root, 'native-inputs.json'),
		JSON.stringify({
			litertLm: { macos: input('litert.zip') },
			pdfium: { macos: input('pdfium.tgz') }
		})
	);
	failSigning = false;
	unresolvedCxx = false;
	largeSymbolTable = false;
	vi.mocked(renameSync).mockImplementation(actualFs.renameSync);
	vi.mocked(spawnSync).mockImplementation((command, args, options) => {
		expect(options?.cwd).toBe(root);
		const argumentsList = args as string[];
		let stdout = '';
		if (command === 'unzip') {
			const library = join(
				argumentsList[argumentsList.indexOf('-d') + 1],
				'CLiteRTLM_mac.xcframework/macos-arm64_x86_64/libCLiteRTLM_mac.dylib'
			);
			mkdirSync(dirname(library), { recursive: true });
			writeFileSync(library, 'candidate LiteRT');
		} else if (command === 'tar') {
			const directory = argumentsList[argumentsList.indexOf('-C') + 1];
			mkdirSync(join(directory, 'lib'));
			mkdirSync(join(directory, 'licenses'));
			writeFileSync(join(directory, 'lib/libpdfium.dylib'), 'candidate PDFium');
			writeFileSync(join(directory, 'LICENSE'), 'new PDFium notice');
		} else if (command === 'lipo') {
			stdout = 'arm64 x86_64';
		} else if (command === 'xcrun') {
			stdout = 'platform MACOS\nminos 12.0\nplatform MACOS\nminos 12.0\n';
		} else if (command === 'otool') {
			stdout = `${argumentsList[1]}:\n  @rpath/${basename(argumentsList[1])} (compatibility version 1.0.0)\n  /usr/lib/libSystem.B.dylib (compatibility version 1.0.0)`;
		} else if (command === 'nm') {
			if (largeSymbolTable && !argumentsList.includes('-u'))
				return {
					error: Object.assign(new Error('spawnSync nm ENOBUFS'), { code: 'ENOBUFS' }),
					status: null,
					signal: null,
					pid: 0,
					output: [],
					stdout: '',
					stderr: ''
				};
			if (unresolvedCxx)
				// Actual undefined symbol from the failed CXX 1.0.195 source candidate.
				stdout =
					'                 (undefined) external _litert$lm$cxxbridge1$0$new_minijinja_template (dynamically looked up)\n';
		} else if (command === 'codesign' && failSigning) {
			return { status: 1, signal: null, pid: 0, output: [], stdout: '', stderr: '' };
		}
		return { status: 0, signal: null, pid: 0, output: [], stdout, stderr: '' };
	});
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
	vi.clearAllMocks();
});

const expectPreviousBundle = () => {
	expect(readFileSync(join(output, 'liblitert_lm_c.dylib'), 'utf8')).toBe('previous LiteRT');
	expect(readFileSync(join(output, 'libpdfium.dylib'), 'utf8')).toBe('previous PDFium');
	expect(readFileSync(join(output, 'macos-input-receipt.json'), 'utf8')).toBe('previous receipt');
};

it('runs the real native CLI from a spaced entry path and rejects unknown arguments', () => {
	const script = join(root, 'native preparation entry.ts');
	copyFileSync(resolve('scripts/native-prepare.ts'), script);
	const result = actualProcess.spawnSync(process.execPath, [script, '--unknown'], {
		cwd: root,
		encoding: 'utf8'
	});
	expect(result.error).toBeUndefined();
	expect(result.status).toBe(1);
	expect(result.stderr).toContain('Usage: pnpm native:prepare [--offline]');
	expectPreviousBundle();
});

describe.skipIf(process.platform !== 'darwin')('native preparation stages validation', () => {
	it('preserves the previous files and receipt when signing fails', async () => {
		failSigning = true;
		await expect(prepareNativeRuntime(root, true)).rejects.toThrow('codesign failed');
		expectPreviousBundle();
		expect(readdirSync(join(root, 'src-tauri'))).toEqual(['native-runtime']);
	});

	it('preserves the previous bundle when a cached archive is corrupt', async () => {
		writeFileSync(join(root, '.cache/native-inputs/pdfium.tgz'), 'corrupt');
		await expect(prepareNativeRuntime(root, true)).rejects.toThrow('checksum mismatch');
		expectPreviousBundle();
		expect(spawnSync).not.toHaveBeenCalled();
	});

	it('retains the deliberate rejection of stale runtime shards', async () => {
		writeFileSync(join(output, 'stale.dylib'), 'old shard');
		await expect(prepareNativeRuntime(root, true)).rejects.toThrow(
			'remove stale runtime shards deliberately'
		);
		expectPreviousBundle();
		expect(readFileSync(join(output, 'stale.dylib'), 'utf8')).toBe('old shard');
	});

	it('rejects unresolved CXX symbol versions before replacing the previous bundle', async () => {
		largeSymbolTable = true;
		unresolvedCxx = true;
		await expect(prepareNativeRuntime(root, true)).rejects.toThrow('unresolved CXX bridge symbol');
		expectPreviousBundle();
		expect(readdirSync(join(root, 'src-tauri'))).toEqual(['native-runtime']);
	});

	it('stages large native libraries using only their undefined symbols', async () => {
		largeSymbolTable = true;
		await prepareNativeRuntime(root, true);
		expect(vi.mocked(spawnSync).mock.calls.filter(([command]) => command === 'nm')).toHaveLength(2);
		expect(readFileSync(join(output, 'liblitert_lm_c.dylib'), 'utf8')).toBe('candidate LiteRT');
		expect(readFileSync(join(output, 'libpdfium.dylib'), 'utf8')).toBe('candidate PDFium');
		expect(readdirSync(join(root, 'src-tauri'))).toEqual(['native-runtime']);
	});

	it('publishes the complete validated bundle and preserves existing notices', async () => {
		await prepareNativeRuntime(root, true);
		expect(readFileSync(join(output, 'liblitert_lm_c.dylib'), 'utf8')).toBe('candidate LiteRT');
		expect(readFileSync(join(output, 'libpdfium.dylib'), 'utf8')).toBe('candidate PDFium');
		expect(
			JSON.parse(readFileSync(join(output, 'macos-input-receipt.json'), 'utf8')).installedAppTested
		).toBe(false);
		expect(readFileSync(join(output, 'licenses/litert/LICENSE'), 'utf8')).toBe(
			'existing LiteRT notice'
		);
		expect(readFileSync(join(output, 'licenses/pdfium/LICENSE'), 'utf8')).toBe('new PDFium notice');
		expect(readdirSync(join(root, 'src-tauri'))).toEqual(['native-runtime']);
	});

	it('restores the previous directory when promotion fails', async () => {
		vi.mocked(renameSync).mockImplementation((from, to) => {
			if (basename(from.toString()) === 'candidate') throw new Error('promotion failed');
			actualFs.renameSync(from, to);
		});
		await expect(prepareNativeRuntime(root, true)).rejects.toThrow('promotion failed');
		expectPreviousBundle();
		expect(readdirSync(join(root, 'src-tauri'))).toEqual(['native-runtime']);
	});

	it('retains recovery files if promotion and rollback both fail', async () => {
		vi.mocked(renameSync).mockImplementation((from, to) => {
			if (basename(from.toString()) !== 'native-runtime') throw new Error('directory is locked');
			actualFs.renameSync(from, to);
		});
		const failure = await prepareNativeRuntime(root, true).catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(AggregateError);
		if (!(failure instanceof AggregateError))
			throw new Error('Expected both preparation failures.');
		expect(failure.message).toContain('Recovery files remain');
		expect(failure.errors.map((error: Error) => error.message)).toEqual([
			'directory is locked',
			'directory is locked'
		]);
		expect(failure.cause).toBe(failure.errors[1]);
		const directory = readdirSync(join(root, 'src-tauri')).find((name) =>
			name.startsWith('.native-runtime-stage-')
		);
		expect(directory).toBeDefined();
		expect(
			readFileSync(join(root, 'src-tauri', directory!, 'previous/libpdfium.dylib'), 'utf8')
		).toBe('previous PDFium');
	});
});
