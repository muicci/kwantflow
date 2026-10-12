import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs, {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	assertDistributionDirectory,
	buildSourceDistribution,
	publicSourcePaths,
	readDistributionVersion
} from './distribution-source';
import { sha256File } from './native-prepare';
import { verifyDependencySources } from './dependency-source-prepare';

vi.mock('./verify-third-party.js', () => ({
	verifyThirdParty: vi.fn(async () => ({ errors: [], releaseBlockers: [] }))
}));
vi.mock('node:fs', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:fs')>();
	const copyFileSync = vi.fn(actual.copyFileSync);
	return { ...actual, copyFileSync, default: { ...actual, copyFileSync } };
});
vi.mock('./dependency-source-prepare.js', () => ({
	verifyDependencySources: vi.fn(async (_root: string, directory: string) =>
		JSON.parse(readFileSync(join(directory, 'receipt.json'), 'utf8'))
	)
}));
const temporary: string[] = [];
afterEach(() => {
	temporary.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }));
	vi.clearAllMocks();
	vi.unstubAllEnvs();
});
function put(root: string, path: string, text: string) {
	mkdirSync(dirname(join(root, path)), { recursive: true });
	writeFileSync(join(root, path), text);
}
function fixture() {
	const root = realpathSync(mkdtempSync(join(tmpdir(), 'kwantflow-source-export-test-')));
	temporary.push(root);
	put(root, 'package.json', JSON.stringify({ version: '0.13.0' }));
	put(root, 'src-tauri/Cargo.toml', '[package]\nname = "fixture"\nversion = "0.13.0"\n');
	put(root, 'src-tauri/tauri.conf.json', JSON.stringify({ version: '0.13.0' }));
	put(root, 'src/lib/example.ts', 'export const fixture = true;\n');
	put(root, 'docs/user/README.md', 'Tiny public documentation fixture.\n');
	put(root, '.storybook/main.ts', 'export default { stories: [] };\n');
	put(root, '.storybook/preview.ts', 'export default {};\n');
	put(root, 'tokens/components.json', '{"button":{}}\n');
	put(root, 'content/local-assistant/workflows/onboarding.md', 'Synthetic bundled help.\n');
	put(root, 'ARCHITECTURE.md', 'Public architecture overview.\n');
	put(root, 'docs/private-founder-notes.md', 'must stay outside the archive');
	put(root, 'third-party/sources/upstream.tar.gz', 'tiny pinned source fixture');
	put(
		root,
		'third-party/manifest.json',
		JSON.stringify({
			sourceArchives: [
				{
					path: 'third-party/sources/upstream.tar.gz',
					url: 'https://example.com/source.tar.gz',
					sha256: createHash('sha256').update('tiny pinned source fixture').digest('hex')
				}
			]
		})
	);
	put(root, 'third-party/recipes/native/check.log', 'Synthetic native verification receipt.\n');
	put(
		root,
		'third-party/native-source-manifest.json',
		JSON.stringify({
			sourceArchives: [],
			verificationReceipts: [
				{
					path: 'third-party/recipes/native/check.log',
					sha256: createHash('sha256')
						.update('Synthetic native verification receipt.\n')
						.digest('hex')
				}
			]
		})
	);
	put(root, 'third-party/dependency-sources/npm/fixture.tar.gz', 'tiny npm fixture');
	put(root, 'third-party/dependency-sources/cargo/vendor.tar.gz', 'tiny cargo fixture');
	put(root, 'third-party/dependency-sources/README.md', 'Tiny dependency fixture');
	put(
		root,
		'third-party/dependency-sources/receipt.json',
		JSON.stringify({
			npm: [{ path: 'npm/fixture.tar.gz' }],
			cargo: { path: 'cargo/vendor.tar.gz' },
			localPackages: []
		})
	);
	put(
		root,
		'SOURCE_PROVENANCE.json',
		JSON.stringify({ schemaVersion: 1, version: '0.13.0', sourceCommit: 'a'.repeat(40) })
	);
	return root;
}

describe('audited standalone source export', () => {
	it('enforces the same package, native and installer version before packaging', () => {
		const root = fixture();
		expect(readDistributionVersion(root)).toBe('0.13.0');
		put(root, 'src-tauri/Cargo.toml', '[package]\nversion = "0.12.9"\n');
		expect(() => readDistributionVersion(root)).toThrow('versions must match');
		put(root, 'package.json', JSON.stringify({ version: '../escape' }));
		expect(() => readDistributionVersion(root)).toThrow('plain release version');
	});
	it('rejects path traversal, platform separators, control characters and managed staging files', () => {
		for (const path of [
			'scripts/../escape',
			'scripts/..\\escape',
			'scripts/a:stream',
			'scripts/a\nfile',
			'scripts/.git/config',
			'src-tauri/.native-runtime-stage-old/candidate/file'
		])
			expect(() => publicSourcePaths([path])).toThrow('Forbidden');
		const root = fixture();
		expect(() => assertDistributionDirectory(root, join(root, '..', 'escape'))).toThrow(
			'inside the application root'
		);
	});

	it('checks the actual public inventory without creating an archive or output directory', async () => {
		const root = fixture();
		await expect(buildSourceDistribution(root, { candidate: true, checkOnly: true })).resolves.toBe(
			undefined
		);
		expect(existsSync(join(root, 'dist'))).toBe(false);
		put(root, 'src/.env.local', 'synthetic forbidden input');
		await expect(
			buildSourceDistribution(root, { candidate: true, checkOnly: true })
		).rejects.toThrow('Forbidden file');
	});
	it('exports explicitly selected public audit receipts and verifies their staged digests', async () => {
		const root = fixture();
		const nativeManifest = JSON.parse(
			readFileSync(join(root, 'third-party/native-source-manifest.json'), 'utf8')
		);
		const receipts = [];
		for (const path of [
			'third-party/audit/cargo-audit-main.json',
			'third-party/audit/cargo-audit-cxxbridge.json',
			'third-party/audit/cargo-audit-lockfiles.json'
		]) {
			put(root, path, JSON.stringify({ syntheticPublicAudit: path }));
			receipts.push({ path, sha256: await sha256File(join(root, path)) });
		}
		put(
			root,
			'third-party/native-source-manifest.json',
			JSON.stringify({
				...nativeManifest,
				verificationReceipts: [...nativeManifest.verificationReceipts, ...receipts]
			})
		);
		const output = await buildSourceDistribution(root, { candidate: true });
		const manifest = JSON.parse(readFileSync(join(output!, 'source-manifest.json'), 'utf8'));
		for (const receipt of receipts) expect(manifest.files).toContainEqual(receipt);
		put(root, receipts[0].path, '{"changedAfterVerification":true}');
		await expect(buildSourceDistribution(root, { candidate: true })).rejects.toThrow(
			'Acquired source changed during export'
		);
	});
	it.each([
		{ path: 'docs/private-founder-notes.md', error: 'Invalid public native verification receipt' },
		{ path: 'third-party/../docs/private-founder-notes.md', error: 'Forbidden file' }
	])('rejects a native receipt for $path', async ({ path, error }) => {
		const root = fixture();
		put(
			root,
			'third-party/native-source-manifest.json',
			JSON.stringify({
				sourceArchives: [],
				verificationReceipts: [
					{ path, sha256: await sha256File(join(root, 'docs/private-founder-notes.md')) }
				]
			})
		);
		await expect(
			buildSourceDistribution(root, { candidate: true, checkOnly: true })
		).rejects.toThrow(error);
		expect(existsSync(join(root, 'dist'))).toBe(false);
	});
	it('re-exports verified packaged dependencies without .git or a parent workspace and hashes every raw archive member', async () => {
		const root = fixture();
		const { copyFileSync: actualCopyFileSync } =
			await vi.importActual<typeof import('node:fs')>('node:fs');
		let metadataSeeded = false;
		const copy =
			process.platform === 'darwin'
				? vi.mocked(copyFileSync).mockImplementation((...args) => {
						actualCopyFileSync(...args);
						if (!String(args[1]).endsWith('/src/lib/example.ts')) return;
						const metadata = spawnSync(
							'/usr/bin/xattr',
							[
								'-w',
								'com.kwantflow.synthetic-source-metadata',
								'synthetic-public-fixture',
								String(args[1])
							],
							{ encoding: 'utf8' }
						);
						expect(metadata.status, metadata.stderr).toBe(0);
						metadataSeeded = true;
					})
				: undefined;
		let output: string | undefined;
		try {
			output = await buildSourceDistribution(root, { candidate: true });
		} finally {
			copy?.mockRestore();
		}
		if (process.platform === 'darwin') expect(metadataSeeded).toBe(true);
		expect(verifyDependencySources).toHaveBeenCalledWith(
			root,
			join(root, 'third-party/dependency-sources')
		);
		const manifest = JSON.parse(readFileSync(join(output!, 'source-manifest.json'), 'utf8'));
		expect(manifest).toMatchObject({
			sourceCommit: 'a'.repeat(40),
			sourceDirty: true,
			candidate: true
		});
		// BSD tar consumes AppleDouble members during extraction and listing. Read
		// the tiny fixture's actual regular-file headers and bytes instead.
		const data = gunzipSync(readFileSync(join(output!, manifest.artifacts[0].name)));
		const regularFiles = [];
		const extendedAttributeKeys = [];
		for (let offset = 0; offset + 512 <= data.length;) {
			const header = data.subarray(offset, offset + 512);
			if (header.every((byte) => byte === 0)) break;
			const name = header.subarray(0, 100).toString('utf8').split('\0')[0];
			const prefix = header.subarray(345, 500).toString('utf8').split('\0')[0];
			const size = parseInt(
				header.subarray(124, 136).toString('ascii').replace(/\0/g, '').trim(),
				8
			);
			if (header[156] === 0 || header[156] === 48) {
				const path = (prefix ? `${prefix}/${name}` : name).replace(/^Kwantflow_0\.13\.0\//, '');
				regularFiles.push({
					path,
					sha256: createHash('sha256')
						.update(data.subarray(offset + 512, offset + 512 + size))
						.digest('hex')
				});
			}
			if (header[156] === 120 || header[156] === 103) {
				const pax = data.subarray(offset + 512, offset + 512 + size).toString('utf8');
				for (const match of pax.matchAll(/(?:^|\n)\d+ ([^=\n]+)=/g))
					if (/^(?:LIBARCHIVE|SCHILY)\.xattr(?:\.|$)/.test(match[1]))
						extendedAttributeKeys.push(match[1]);
			}
			offset += 512 + Math.ceil(size / 512) * 512;
		}
		expect(regularFiles.sort((a, b) => a.path.localeCompare(b.path))).toEqual(manifest.files);
		expect(extendedAttributeKeys).toEqual([]);
		const unpacked = join(root, 'unpacked');
		mkdirSync(unpacked);
		const extract = spawnSync(
			'tar',
			['-xzf', join(output!, manifest.artifacts[0].name), '-C', unpacked],
			{ encoding: 'utf8' }
		);
		expect(extract.status, extract.stderr).toBe(0);
		const app = join(unpacked, 'Kwantflow_0.13.0');
		const files: string[] = [];
		const walk = (path: string) => {
			for (const entry of readdirSync(join(app, path), { withFileTypes: true })) {
				const child = path ? `${path}/${entry.name}` : entry.name;
				if (entry.isDirectory()) walk(child);
				else files.push(child);
			}
		};
		walk('');
		expect(manifest.files.map((file: { path: string }) => file.path).sort()).toEqual(files.sort());
		for (const file of manifest.files)
			expect(await sha256File(join(app, file.path))).toBe(file.sha256);
		expect(await sha256File(join(output!, manifest.artifacts[0].name))).toBe(
			manifest.artifacts[0].sha256
		);
		expect(existsSync(join(app, 'docs/private-founder-notes.md'))).toBe(false);
		expect(existsSync(join(app, '.storybook/main.ts'))).toBe(true);
		expect(existsSync(join(app, '.storybook/preview.ts'))).toBe(true);
		expect(existsSync(join(app, 'tokens/components.json'))).toBe(true);
		expect(existsSync(join(app, 'content/local-assistant/workflows/onboarding.md'))).toBe(true);
		expect(existsSync(join(app, 'ARCHITECTURE.md'))).toBe(true);
		await expect(buildSourceDistribution(root)).rejects.toThrow('own application Git checkout');
	});
	it.each([
		{ size: 2 ** 31 - 1, allowed: true },
		{ size: 2 ** 31, allowed: false },
		{ size: 2 ** 31 + 1, allowed: false }
	])(
		'enforces the GitHub asset limit for a final archive of $size bytes',
		async ({ size, allowed }) => {
			const root = fixture();
			// Only the reported final size changes; the actual gzip fixture stays tiny.
			const actualLstatSync = fs.lstatSync;
			const stat = vi.spyOn(fs, 'lstatSync').mockImplementation((...args) => {
				const metadata = actualLstatSync(...args);
				if (
					metadata &&
					typeof args[0] === 'string' &&
					args[0].endsWith('Kwantflow_0.13.0_candidate-source.tar.gz')
				)
					Object.assign(metadata, { size });
				return metadata;
			});
			try {
				if (allowed) {
					const output = await buildSourceDistribution(root, { candidate: true });
					expect(existsSync(join(output!, 'source-manifest.json'))).toBe(true);
				} else {
					await expect(buildSourceDistribution(root, { candidate: true })).rejects.toThrow(
						"under GitHub's 2 GiB release asset limit"
					);
					expect(readdirSync(join(root, 'dist/distribution/0.13.0/candidate-source'))).toEqual([]);
				}
			} finally {
				stat.mockRestore();
			}
		}
	);
	it.skipIf(process.platform === 'win32')(
		'hashes committed application files and fails if Git archive omits a required source file',
		async () => {
			const root = fixture();
			// Use a disposable fake Git executable to simulate export-ignore. No
			// commit is created and the actual repository's Git history is untouched.
			const paths = [
				'package.json',
				'src-tauri/Cargo.toml',
				'src-tauri/tauri.conf.json',
				'src/lib/example.ts',
				'docs/user/README.md',
				'third-party/manifest.json',
				'third-party/native-source-manifest.json'
			];
			const contract = join(root, '.git-fixture.json');
			writeFileSync(contract, JSON.stringify({ paths }));
			const bin = join(root, '.fixture-bin');
			mkdirSync(bin);
			const git = join(bin, 'git');
			writeFileSync(
				git,
				`#!/usr/bin/env node
import fs from 'node:fs'; import path from 'node:path'; import { spawnSync } from 'node:child_process';
const fixture = JSON.parse(fs.readFileSync(process.env.KWANTFLOW_GIT_FIXTURE, 'utf8'));
const args = process.argv.slice(2); const root = process.cwd();
if (args[0] === 'rev-parse') process.stdout.write(args[1] === '--show-toplevel' ? root : 'a'.repeat(40));
else if (args[0] === 'ls-files') process.stdout.write((args.includes('--deleted') ? fixture.deletedPaths ?? [] : fixture.paths).join('\\0'));
else if (args[0] === 'archive') {
  const stage = path.join(root, '.fixture-archive'); const prefix = 'Kwantflow_0.13.0';
  fs.rmSync(stage, { recursive: true, force: true });
  for (const file of fixture.paths.filter(file => file !== fixture.omittedPath)) {
    const destination = path.join(stage, prefix, file); fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.copyFileSync(path.join(root, file), destination);
  }
  const output = args.find(arg => arg.startsWith('--output=')).slice('--output='.length);
  const result = spawnSync('tar', ['-cf', output, '-C', stage, prefix], { stdio: 'inherit' }); process.exit(result.status ?? 1);
}
`
			);
			chmodSync(git, 0o755);
			vi.stubEnv('PATH', `${bin}:${process.env.PATH}`);
			vi.stubEnv('KWANTFLOW_GIT_FIXTURE', contract);
			const output = await buildSourceDistribution(root);
			const manifest = JSON.parse(readFileSync(join(output!, 'source-manifest.json'), 'utf8'));
			expect(manifest).toMatchObject({
				sourceDirty: false,
				candidate: false,
				correspondingSourceReview: 'ready'
			});
			expect(manifest.files).toContainEqual({
				path: 'src/lib/example.ts',
				sha256: await sha256File(join(root, 'src/lib/example.ts'))
			});
			expect(manifest.files).toContainEqual({
				path: 'third-party/recipes/native/check.log',
				sha256: await sha256File(join(root, 'third-party/recipes/native/check.log'))
			});
			writeFileSync(
				contract,
				JSON.stringify({
					paths: [...paths, 'src/removed-commercial-system.ts'],
					deletedPaths: ['src/removed-commercial-system.ts']
				})
			);
			const candidateOutput = await buildSourceDistribution(root, { candidate: true });
			const candidateManifest = JSON.parse(
				readFileSync(join(candidateOutput!, 'source-manifest.json'), 'utf8')
			);
			expect(candidateManifest.files).not.toContainEqual(
				expect.objectContaining({ path: 'src/removed-commercial-system.ts' })
			);
			writeFileSync(contract, JSON.stringify({ paths, omittedPath: 'src/lib/example.ts' }));
			await expect(buildSourceDistribution(root)).rejects.toThrow('omitted a required public file');
		}
	);
	it.skipIf(process.platform === 'win32')('rejects source and output symlinks', async () => {
		const root = fixture();
		symlinkSync(join(root, 'package.json'), join(root, 'src/linked.json'));
		await expect(
			buildSourceDistribution(root, { candidate: true, checkOnly: true })
		).rejects.toThrow('refuses a symlink');
		await expect(buildSourceDistribution(root, { candidate: true })).rejects.toThrow(
			'refuses a symlink'
		);
		rmSync(join(root, 'src/linked.json'));
		symlinkSync(join(root, 'docs'), join(root, 'dist'), 'dir');
		await expect(
			buildSourceDistribution(root, { candidate: true, checkOnly: true })
		).rejects.toThrow('must not be a symlink');
		expect(() => assertDistributionDirectory(root, join(root, 'dist/distribution'))).toThrow(
			'must not be a symlink'
		);
	});

	it('requires physical dependency source receipts even for an unpublished candidate', async () => {
		const root = fixture();
		rmSync(join(root, 'third-party/dependency-sources/receipt.json'));
		await expect(
			buildSourceDistribution(root, { candidate: true, checkOnly: true })
		).rejects.toThrow('Exact npm production archives and Cargo vendor sources are missing');
		await expect(buildSourceDistribution(root, { candidate: true })).rejects.toThrow(
			'Exact npm production archives and Cargo vendor sources are missing'
		);
		expect(existsSync(join(root, 'dist'))).toBe(false);
	});
});
