import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { expect, it, vi } from 'vitest';
import {
	lockedCargoCrates,
	localPackageSourceReceipt,
	prepareDependencySources,
	productionLocalSourceInputs,
	productionNpmSourceInputs,
	verifyIntegrity
} from './dependency-source-prepare.js';

vi.mock('node:child_process', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:child_process')>();
	const spawnSync = vi.fn(actual.spawnSync);
	return { ...actual, spawnSync, default: { ...actual, spawnSync } };
});

it('retains production peers and all optional target sources without including unrelated dev tools', () => {
	const lock = {
		importers: { '.': { dependencies: { consumer: { version: '1.0.0(peer@2.0.0)' } } } },
		packages: {
			'consumer@1.0.0': { resolution: { integrity: 'sha512-pinned' } },
			'peer@2.0.0': { resolution: { integrity: 'sha512-peer' } },
			'optional-windows@3.0.0': { resolution: { integrity: 'sha512-windows' } },
			'dev-only@4.0.0': { resolution: { integrity: 'sha512-dev' } }
		},
		snapshots: {
			'consumer@1.0.0(peer@2.0.0)': {
				dependencies: { peer: '2.0.0' },
				optionalDependencies: { 'optional-windows': '3.0.0' }
			},
			'peer@2.0.0': {},
			'optional-windows@3.0.0': {},
			'dev-only@4.0.0': {}
		}
	};
	expect(productionNpmSourceInputs(lock).map((input) => input.identity)).toEqual([
		'consumer@1.0.0',
		'optional-windows@3.0.0',
		'peer@2.0.0'
	]);
	const missing = {
		...lock,
		snapshots: Object.fromEntries(
			Object.entries(lock.snapshots).filter(([name]) => name !== 'peer@2.0.0')
		)
	};
	expect(() => productionNpmSourceInputs(missing)).toThrow('snapshot missing');
});

it('keeps reviewed local HEIC package source separate from registry acquisition while walking dependencies', () => {
	const lock = {
		importers: { '.': { dependencies: { 'libheif-js': { version: 'file:packages/libheif-js' } } } },
		packages: {
			'libheif-js@file:packages/libheif-js': {
				resolution: { directory: 'packages/libheif-js', type: 'directory' },
				version: '1.23.6-kwantflow.1'
			},
			'linked-helper@2.0.0': { resolution: { integrity: 'sha512-helper' } }
		},
		snapshots: {
			'libheif-js@file:packages/libheif-js': { dependencies: { 'linked-helper': '2.0.0' } },
			'linked-helper@2.0.0': {}
		}
	};
	expect(productionNpmSourceInputs(lock).map((input) => input.identity)).toEqual([
		'linked-helper@2.0.0'
	]);
	expect(productionLocalSourceInputs(lock)).toEqual([
		{
			identity: 'libheif-js@file:packages/libheif-js',
			name: 'libheif-js',
			version: '1.23.6-kwantflow.1',
			directory: 'packages/libheif-js'
		}
	]);
	expect(() =>
		productionLocalSourceInputs({
			...lock,
			packages: {
				...lock.packages,
				'libheif-js@file:packages/libheif-js': {
					...lock.packages['libheif-js@file:packages/libheif-js'],
					resolution: { directory: '../private', type: 'directory' }
				}
			}
		})
	).toThrow('Unreviewed local');
});

it('hashes exact local package bytes and rejects source links, credentials, and lock version drift', async () => {
	const root = mkdtempSync(join(tmpdir(), 'kwantflow-local-package-source-'));
	try {
		const directory = join(root, 'packages/libheif-js');
		mkdirSync(directory, { recursive: true });
		const input = {
			identity: 'libheif-js@file:packages/libheif-js',
			name: 'libheif-js',
			version: '1.23.6-kwantflow.1',
			directory: 'packages/libheif-js'
		};
		writeFileSync(join(directory, 'package.json'), JSON.stringify(input));
		writeFileSync(join(directory, 'libheif.js'), 'factory');
		const original = await localPackageSourceReceipt(root, input);
		expect(original.files.map((file) => file.path)).toEqual(['libheif.js', 'package.json']);
		writeFileSync(join(directory, 'libheif.js'), 'modified factory');
		expect((await localPackageSourceReceipt(root, input)).files[0].sha256).not.toEqual(
			original.files[0].sha256
		);
		await expect(localPackageSourceReceipt(root, { ...input, version: '1.23.5' })).rejects.toThrow(
			'locked production graph'
		);
		writeFileSync(join(directory, '.env'), 'synthetic test value');
		await expect(localPackageSourceReceipt(root, input)).rejects.toThrow('Unsafe local');
		rmSync(join(directory, '.env'));
		symlinkSync('libheif.js', join(directory, 'linked.js'));
		await expect(localPackageSourceReceipt(root, input)).rejects.toThrow('Unsafe local');
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

it('acquires the actual pnpm directory record without a synthetic lock version', async () => {
	const root = mkdtempSync(join(tmpdir(), 'kwantflow-pnpm-directory-source-'));
	try {
		const directory = join(root, 'packages/libheif-js');
		mkdirSync(directory, { recursive: true });
		const manifestPath = join(directory, 'package.json');
		writeFileSync(
			manifestPath,
			JSON.stringify({ name: 'libheif-js', version: '1.23.6-kwantflow.1' })
		);
		const lock = {
			importers: {
				'.': { dependencies: { 'libheif-js': { version: 'file:packages/libheif-js' } } }
			},
			packages: {
				'libheif-js@file:packages/libheif-js': {
					resolution: { directory: 'packages/libheif-js', type: 'directory' }
				}
			},
			snapshots: { 'libheif-js@file:packages/libheif-js': {} }
		};
		const [input] = productionLocalSourceInputs(lock, root);
		expect(input.version).toBe('1.23.6-kwantflow.1');
		const receipt = await localPackageSourceReceipt(root, input);
		writeFileSync(manifestPath, JSON.stringify({ name: 'libheif-js', version: '1.23.7-local.1' }));
		await expect(localPackageSourceReceipt(root, input)).rejects.toThrow('locked production graph');
		const [changed] = productionLocalSourceInputs(lock, root);
		expect(await localPackageSourceReceipt(root, changed)).not.toEqual(receipt);
		writeFileSync(manifestPath, JSON.stringify({ name: 'another-package', version: '1.23.6' }));
		expect(() => productionLocalSourceInputs(lock, root)).toThrow('Invalid reviewed local');
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

it('rejects changed registry tar bytes against locked integrity', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'kwantflow-source-integrity-'));
	try {
		const path = join(directory, 'package.tgz');
		writeFileSync(path, 'original');
		const integrity = `sha512-${createHash('sha512').update('original').digest('base64')}`;
		await expect(verifyIntegrity(path, integrity)).resolves.toBeUndefined();
		writeFileSync(path, 'changed');
		await expect(verifyIntegrity(path, integrity)).rejects.toThrow('integrity mismatch');
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

it('requires checksum-pinned Cargo registry inputs and rejects unreviewed Git sources', () => {
	const checksum = 'a'.repeat(64);
	expect(
		lockedCargoCrates(
			`[[package]]\nname = "local"\nversion = "1.0.0"\n[[package]]\nname = "locked"\nversion = "2.0.0"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\nchecksum = "${checksum}"`
		)
	).toEqual([{ name: 'locked', version: '2.0.0', checksum }]);
	expect(() => lockedCargoCrates('[[package]]\nsource = "git+https://example.com/source"')).toThrow(
		'Unreviewed Cargo source'
	);
});

it.skipIf(process.platform !== 'darwin')(
	'creates a Cargo archive without macOS metadata while preserving every crate file',
	async () => {
		const root = mkdtempSync(join(tmpdir(), 'kwantflow-cargo-archive-metadata-'));
		const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
		const checksum = 'a'.repeat(64);
		const files = {
			'Cargo.toml': '[package]\nname = "fixture"\nversion = "1.0.0"\n',
			'src/lib.rs': 'pub fn fixture() -> bool { true }\n'
		};
		const fileHashes = Object.fromEntries(
			Object.entries(files).map(([path, bytes]) => [
				path,
				createHash('sha256').update(bytes).digest('hex')
			])
		);
		const cargoChecksum = JSON.stringify({ package: checksum, files: fileHashes });
		let metadataSeeded = false;
		vi.stubEnv('COPYFILE_DISABLE', undefined);
		try {
			mkdirSync(join(root, 'src-tauri'));
			writeFileSync(
				join(root, 'pnpm-lock.yaml'),
				'importers:\n  ".": {}\npackages: {}\nsnapshots: {}\n'
			);
			writeFileSync(join(root, 'src-tauri/Cargo.toml'), '[package]\nname = "source-fixture"\n');
			writeFileSync(
				join(root, 'src-tauri/Cargo.lock'),
				`[[package]]\nname = "fixture"\nversion = "1.0.0"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\nchecksum = "${checksum}"\n`
			);
			vi.mocked(spawnSync).mockImplementation((command, args, options) => {
				if (command === 'rustup')
					return {
						status: 0,
						signal: null,
						pid: 0,
						output: [],
						stdout: 'kwantflow-fixture-cargo\n',
						stderr: ''
					};
				if (command === 'kwantflow-fixture-cargo') {
					const directory = join(String(args?.at(-1)), 'fixture-1.0.0');
					for (const [path, bytes] of Object.entries(files)) {
						mkdirSync(dirname(join(directory, path)), { recursive: true });
						writeFileSync(join(directory, path), bytes);
					}
					writeFileSync(join(directory, '.cargo-checksum.json'), cargoChecksum);
					const metadata = actual.spawnSync(
						'/usr/bin/xattr',
						[
							'-w',
							'com.kwantflow.synthetic-source-metadata',
							'synthetic-public-fixture',
							join(directory, 'src/lib.rs')
						],
						{ encoding: 'utf8' }
					);
					expect(metadata.status, metadata.stderr).toBe(0);
					metadataSeeded = true;
					return { status: 0, signal: null, pid: 0, output: [], stdout: '', stderr: '' };
				}
				return actual.spawnSync(command, args, options);
			});
			const directory = await prepareDependencySources(root, true);
			expect(metadataSeeded).toBe(true);
			const data = gunzipSync(readFileSync(join(directory, 'cargo-vendor.tar.gz')));
			const regularFiles: Record<string, string> = {};
			const extendedAttributeKeys: string[] = [];
			for (let offset = 0; offset + 512 <= data.length && data[offset] !== 0;) {
				const header = data.subarray(offset, offset + 512);
				const name = header.subarray(0, 100).toString('utf8').split('\0')[0];
				const prefix = header.subarray(345, 500).toString('utf8').split('\0')[0];
				const path = prefix ? `${prefix}/${name}` : name;
				const size = parseInt(header.subarray(124, 136).toString('ascii').replace(/\0/g, ''), 8);
				if (header[156] === 0 || header[156] === 48)
					regularFiles[path] = createHash('sha256')
						.update(data.subarray(offset + 512, offset + 512 + size))
						.digest('hex');
				if (header[156] === 120 || header[156] === 103)
					for (const match of data
						.subarray(offset + 512, offset + 512 + size)
						.toString('utf8')
						.matchAll(/(?:^|\n)\d+ ([^=\n]+)=/g))
						if (/^(?:LIBARCHIVE|SCHILY)\.xattr(?:\.|$)/.test(match[1]))
							extendedAttributeKeys.push(match[1]);
				offset += 512 + Math.ceil(size / 512) * 512;
			}
			expect(regularFiles).toEqual({
				...Object.fromEntries(
					Object.entries(fileHashes).map(([path, hash]) => [`vendor/fixture-1.0.0/${path}`, hash])
				),
				'vendor/fixture-1.0.0/.cargo-checksum.json': createHash('sha256')
					.update(cargoChecksum)
					.digest('hex')
			});
			expect(extendedAttributeKeys).toEqual([]);
		} finally {
			vi.mocked(spawnSync).mockRestore();
			vi.unstubAllEnvs();
			rmSync(root, { recursive: true, force: true });
		}
	}
);
