import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	createReadStream,
	existsSync,
	realpathSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { sha256File } from './native-prepare.js';

type Resolution = { integrity?: string; tarball?: string; directory?: string; type?: string };
type Snapshot = {
	dependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
};
type Lock = {
	importers: Record<
		string,
		{
			dependencies?: Record<string, { version: string }>;
			optionalDependencies?: Record<string, { version: string }>;
		}
	>;
	packages: Record<string, { resolution?: Resolution; version?: string }>;
	snapshots: Record<string, Snapshot>;
};
export type NpmSourceInput = {
	identity: string;
	name: string;
	version: string;
	url: string;
	integrity: string;
};
type SourceArchive = { path: string; sha256: string; sizeBytes: number };
export type LocalSourceInput = {
	identity: string;
	name: string;
	version: string;
	directory: string;
};
export type LocalSourceReceipt = LocalSourceInput & {
	files: SourceArchive[];
};
export type DependencySourceReceipt = {
	schemaVersion: 1;
	pnpmLockSha256: string;
	cargoLockSha256: string;
	npm: (NpmSourceInput & SourceArchive)[];
	localPackages?: LocalSourceReceipt[];
	cargo: SourceArchive & { crates: { name: string; version: string; checksum: string }[] };
	preferredSourceReview: 'pending';
	scope: string;
};

function productionPackageIdentities(lock: Lock): string[] {
	const visited = new Set<string>();
	const identities = new Set<string>();
	const visit = (name: string, version: string) => {
		const key = `${name}@${version}`;
		if (visited.has(key)) return;
		visited.add(key);
		const snapshot = lock.snapshots[key];
		if (!snapshot) throw new Error(`Production snapshot missing: ${key}`);
		identities.add(key.split('(')[0]);
		for (const [dependency, resolved] of Object.entries({
			...snapshot.dependencies,
			...snapshot.optionalDependencies
		}))
			visit(dependency, resolved);
	};
	const importer = lock.importers['.'];
	if (!importer) throw new Error('Standalone app importer missing from pnpm lock.');
	for (const [name, value] of Object.entries({
		...importer.dependencies,
		...importer.optionalDependencies
	}))
		visit(name, value.version);
	return [...identities].sort();
}

export function productionNpmSourceInputs(lock: Lock): NpmSourceInput[] {
	return productionPackageIdentities(lock)
		.filter((identity) => !identity.includes('@file:'))
		.map((identity) => {
			const entry = lock.packages[identity];
			const index = identity.lastIndexOf('@');
			const name = identity.slice(0, index);
			const version = entry?.version ?? identity.slice(index + 1);
			const integrity = entry?.resolution?.integrity;
			if (!name || !version || !integrity)
				throw new Error(`Pinned registry integrity missing: ${identity}`);
			const url =
				entry.resolution?.tarball ??
				`https://registry.npmjs.org/${name}/-/${name.split('/').pop()}-${version}.tgz`;
			if (new URL(url).protocol !== 'https:')
				throw new Error(`Source URL must use HTTPS: ${identity}`);
			return { identity, name, version, url, integrity };
		});
}

export function productionLocalSourceInputs(
	lock: Lock,
	root: string = process.cwd()
): LocalSourceInput[] {
	return productionPackageIdentities(lock)
		.filter((identity) => identity.includes('@file:'))
		.map((identity) => {
			const entry = lock.packages[identity];
			if (
				identity !== 'libheif-js@file:packages/libheif-js' ||
				entry?.resolution?.type !== 'directory' ||
				entry.resolution.directory !== 'packages/libheif-js'
			)
				throw new Error(`Unreviewed local production package: ${identity}`);
			// pnpm 11 directory records omit the package version. The acquisition receipt
			// binds the local manifest and every payload byte, then verifies both on export.
			let version = entry.version;
			if (!version) {
				const manifest = JSON.parse(
					readFileSync(join(root, entry.resolution.directory, 'package.json'), 'utf8')
				) as { name?: unknown; version?: unknown };
				if (
					manifest.name !== 'libheif-js' ||
					typeof manifest.version !== 'string' ||
					!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)
				)
					throw new Error(`Invalid reviewed local package manifest: ${identity}`);
				version = manifest.version;
			}
			return {
				identity,
				name: 'libheif-js',
				version,
				directory: entry.resolution.directory
			};
		});
}

export async function localPackageSourceReceipt(
	root: string,
	input: LocalSourceInput
): Promise<LocalSourceReceipt> {
	if (input.name !== 'libheif-js' || input.directory !== 'packages/libheif-js')
		throw new Error(`Unreviewed local package directory: ${input.directory}`);
	for (const parent of ['packages', input.directory])
		if (
			!lstatSync(join(root, parent)).isDirectory() ||
			lstatSync(join(root, parent)).isSymbolicLink()
		)
			throw new Error(`Local package directory cannot be a symlink: ${parent}`);
	const files: SourceArchive[] = [];
	const visit = async (directory: string, prefix: string) => {
		for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
			a.name.localeCompare(b.name)
		)) {
			const path = `${prefix}${entry.name}`;
			if (
				entry.isSymbolicLink() ||
				/(?:^|\/)(?:\.git|\.cache|\.env[^/]*|\.secrets[^/]*|node_modules|runs|target)(?:\/|$)|\.(?:p8|p12|key|pem|db|db-wal|db-shm)$/i.test(
					path
				)
			)
				throw new Error(`Unsafe local package source: ${path}`);
			const absolute = join(directory, entry.name);
			if (entry.isDirectory()) await visit(absolute, `${path}/`);
			else if (entry.isFile())
				files.push({
					path,
					sha256: await sha256File(absolute),
					sizeBytes: lstatSync(absolute).size
				});
			else throw new Error(`Local package source must be a regular file: ${path}`);
		}
	};
	await visit(join(root, input.directory), '');
	const manifest = JSON.parse(
		readFileSync(join(root, input.directory, 'package.json'), 'utf8')
	) as {
		name: string;
		version: string;
	};
	if (manifest.name !== input.name || manifest.version !== input.version)
		throw new Error('Local package name/version differs from the locked production graph.');
	return { ...input, files };
}

export async function verifyIntegrity(path: string, integrity: string): Promise<void> {
	const match = /^(sha512|sha256)-([A-Za-z0-9+/]+={0,2})$/.exec(integrity);
	if (!match) throw new Error(`Unsupported pinned integrity: ${integrity}`);
	const hash = createHash(match[1]);
	for await (const bytes of createReadStream(path)) hash.update(bytes);
	if (hash.digest('base64') !== match[2])
		throw new Error(`Package integrity mismatch: ${basename(path)}`);
}

export function lockedCargoCrates(
	text: string
): { name: string; version: string; checksum: string }[] {
	return text
		.split('[[package]]')
		.slice(1)
		.flatMap((block) => {
			const source = /^source = "([^"]+)"/m.exec(block)?.[1];
			if (!source) return [];
			if (source !== 'registry+https://github.com/rust-lang/crates.io-index')
				throw new Error(`Unreviewed Cargo source: ${source}`);
			const name = /^name = "([^"]+)"/m.exec(block)?.[1];
			const version = /^version = "([^"]+)"/m.exec(block)?.[1];
			const checksum = /^checksum = "([a-f0-9]{64})"/m.exec(block)?.[1];
			if (!name || !version || !checksum) throw new Error('Invalid locked Cargo registry package.');
			return [{ name, version, checksum }];
		});
}

async function verifyVendor(directory: string, crates: ReturnType<typeof lockedCargoCrates>) {
	for (const crate of crates) {
		const root = join(directory, `${crate.name}-${crate.version}`);
		const checksum = JSON.parse(readFileSync(join(root, '.cargo-checksum.json'), 'utf8')) as {
			package: string;
			files: Record<string, string>;
		};
		if (checksum.package !== crate.checksum)
			throw new Error(`Cargo package checksum mismatch: ${crate.name}-${crate.version}`);
		for (const [file, digest] of Object.entries(checksum.files)) {
			if (
				file.startsWith('/') ||
				file.split(/[\\/]/).includes('..') ||
				lstatSync(join(root, file)).isSymbolicLink()
			)
				throw new Error(`Unsafe Cargo source path: ${file}`);
			if ((await sha256File(join(root, file))) !== digest)
				throw new Error(`Cargo source bytes changed: ${crate.name}-${crate.version}/${file}`);
		}
		const visit = (directory: string, prefix: string) => {
			for (const entry of readdirSync(directory, { withFileTypes: true })) {
				const file = `${prefix}${entry.name}`;
				if (entry.isSymbolicLink())
					throw new Error(`Cargo vendor symlink is not permitted: ${file}`);
				if (entry.isDirectory()) visit(join(directory, entry.name), `${file}/`);
				else if (file !== '.cargo-checksum.json' && !checksum.files[file])
					throw new Error(`Unreviewed Cargo source file: ${file}`);
			}
		};
		visit(root, '');
	}
	const expected = new Set(crates.map((crate) => `${crate.name}-${crate.version}`));
	for (const entry of readdirSync(directory))
		if (!expected.has(entry)) throw new Error(`Unreviewed extra vendor directory: ${entry}`);
}

const execute = (command: string, args: string[], cwd: string, environment?: NodeJS.ProcessEnv) => {
	const result = spawnSync(command, args, {
		cwd,
		encoding: 'utf8',
		maxBuffer: 8 * 1024 * 1024,
		...(environment ? { env: environment } : {})
	});
	if (result.error || result.status !== 0)
		throw new Error(`${command} failed: ${result.error?.message ?? result.stderr.slice(-4000)}`);
	return result.stdout;
};

export async function verifyDependencySources(
	root: string,
	directory = join(root, '.cache/dependency-sources')
): Promise<DependencySourceReceipt> {
	const receipt = JSON.parse(
		readFileSync(join(directory, 'receipt.json'), 'utf8')
	) as DependencySourceReceipt;
	if (
		receipt.schemaVersion !== 1 ||
		receipt.pnpmLockSha256 !== (await sha256File(join(root, 'pnpm-lock.yaml'))) ||
		receipt.cargoLockSha256 !== (await sha256File(join(root, 'src-tauri/Cargo.lock')))
	)
		throw new Error(
			'Dependency sources do not match current lockfiles. Run dependency-source-prepare again.'
		);
	const lock = parse(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')) as Lock;
	const expected = productionNpmSourceInputs(lock);
	const expectedLocal = await Promise.all(
		productionLocalSourceInputs(lock, root).map((input) => localPackageSourceReceipt(root, input))
	);
	if (JSON.stringify(receipt.localPackages ?? []) !== JSON.stringify(expectedLocal))
		throw new Error('Local package source files differ from the locked acquisition receipt.');
	if (
		receipt.npm.length !== expected.length ||
		JSON.stringify(
			receipt.npm.map(({ identity, name, version, url, integrity }) => ({
				identity,
				name,
				version,
				url,
				integrity
			}))
		) !== JSON.stringify(expected)
	)
		throw new Error('Npm source receipt differs from the locked production graph.');
	const crates = lockedCargoCrates(readFileSync(join(root, 'src-tauri/Cargo.lock'), 'utf8'));
	if (JSON.stringify(receipt.cargo.crates) !== JSON.stringify(crates))
		throw new Error('Cargo source receipt differs from locked crates.');
	for (const archive of [...receipt.npm, receipt.cargo]) {
		if (!/^npm\/[a-f0-9]{64}\.tgz$|^cargo-vendor\.tar\.gz$/.test(archive.path))
			throw new Error('Unsafe source receipt archive path.');
		const path = join(directory, archive.path);
		if (
			!lstatSync(path).isFile() ||
			lstatSync(path).size !== archive.sizeBytes ||
			(await sha256File(path)) !== archive.sha256
		)
			throw new Error(`Dependency source archive checksum mismatch: ${archive.path}`);
	}
	for (const archive of receipt.npm)
		await verifyIntegrity(join(directory, archive.path), archive.integrity);
	const temporary = mkdtempSync(join(tmpdir(), 'kwantflow-source-verify-'));
	try {
		const archive = join(directory, receipt.cargo.path);
		for (const path of execute('tar', ['-tzf', archive], root).split('\n').filter(Boolean))
			if (!path.startsWith('vendor/') || path.split(/[\\/]/).includes('..') || path.startsWith('/'))
				throw new Error(`Unsafe Cargo archive entry: ${path}`);
		for (const entry of execute('tar', ['-tvzf', archive], root).split('\n').filter(Boolean))
			if (!['-', 'd'].includes(entry[0]))
				throw new Error('Cargo vendor archive contains a link or special file.');
		execute('tar', ['-xzf', archive, '-C', temporary], root);
		await verifyVendor(join(temporary, 'vendor'), crates);
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
	return receipt;
}

export async function prepareDependencySources(root: string, offline: boolean): Promise<string> {
	const directory = join(root, '.cache/dependency-sources');
	mkdirSync(join(directory, 'npm'), { recursive: true });
	const pnpmLockSha256 = await sha256File(join(root, 'pnpm-lock.yaml'));
	const cargoLockSha256 = await sha256File(join(root, 'src-tauri/Cargo.lock'));
	const lock = parse(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')) as Lock;
	const inputs = productionNpmSourceInputs(lock);
	const localPackages = await Promise.all(
		productionLocalSourceInputs(lock, root).map((input) => localPackageSourceReceipt(root, input))
	);
	const npm: DependencySourceReceipt['npm'] = [];
	for (const input of inputs) {
		const name = `${createHash('sha256').update(input.identity).digest('hex')}.tgz`;
		const path = join(directory, 'npm', name);
		if (!existsSync(path)) {
			if (offline) throw new Error(`Offline source archive missing: ${input.identity}`);
			const partial = `${path}.partial`;
			execute(
				'curl',
				[
					'--fail',
					'--silent',
					'--show-error',
					'--location',
					'--max-time',
					'180',
					'--retry',
					'2',
					'--output',
					partial,
					input.url
				],
				root
			);
			try {
				await verifyIntegrity(partial, input.integrity);
				renameSync(partial, path);
			} finally {
				if (existsSync(partial)) rmSync(partial);
			}
		}
		await verifyIntegrity(path, input.integrity);
		npm.push({
			...input,
			path: `npm/${name}`,
			sha256: await sha256File(path),
			sizeBytes: lstatSync(path).size
		});
		if (npm.length % 25 === 0)
			console.log(`Verified ${npm.length}/${inputs.length} exact npm production archives.`);
	}
	const crates = lockedCargoCrates(readFileSync(join(root, 'src-tauri/Cargo.lock'), 'utf8'));
	const temporary = mkdtempSync(join(tmpdir(), 'kwantflow-cargo-sources-'));
	try {
		const rustup = execute('rustup', ['which', 'cargo'], root).trim();
		execute(
			rustup,
			[
				'vendor',
				'--locked',
				...(offline ? ['--offline'] : []),
				'--versioned-dirs',
				'--manifest-path',
				join(root, 'src-tauri/Cargo.toml'),
				join(temporary, 'vendor')
			],
			root
		);
		await verifyVendor(join(temporary, 'vendor'), crates);
		const path = join(directory, 'cargo-vendor.tar.gz');
		execute(
			'tar',
			[
				...(process.platform === 'darwin' ? ['--no-xattrs'] : []),
				'-czf',
				`${path}.partial`,
				'-C',
				temporary,
				'vendor'
			],
			root,
			process.platform === 'darwin' ? { ...process.env, COPYFILE_DISABLE: '1' } : undefined
		);
		renameSync(`${path}.partial`, path);
		const receipt: DependencySourceReceipt = {
			schemaVersion: 1,
			pnpmLockSha256,
			cargoLockSha256,
			npm,
			localPackages,
			cargo: {
				path: 'cargo-vendor.tar.gz',
				sha256: await sha256File(path),
				sizeBytes: lstatSync(path).size,
				crates
			},
			preferredSourceReview: 'pending',
			scope:
				'Exact locked npm production package payloads including optional targets, audited local package files and hashes, plus full locked Cargo vendor sources/checksums. Compiled distributions still require matching preferred upstream source and build instructions before corresponding-source review can pass.'
		};
		if (
			pnpmLockSha256 !== (await sha256File(join(root, 'pnpm-lock.yaml'))) ||
			cargoLockSha256 !== (await sha256File(join(root, 'src-tauri/Cargo.lock')))
		)
			throw new Error('Lockfiles changed during acquisition. Rerun against the final locked tree.');
		writeFileSync(join(directory, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
		writeFileSync(
			join(directory, 'README.md'),
			'# Exact dependency sources\n\nVerify receipt.json against the app lockfiles with scripts/dependency-source-prepare.ts --check. npm/*.tgz are unchanged package payloads verified against pnpm integrity. localPackages records the exact reviewed file-package name, version and files under the application packages directory; these bytes are included directly in the source distribution. Extract cargo-vendor.tar.gz in this directory, then pass these Cargo configuration options from the application root:\n\n```sh\ncargo build --locked --offline --manifest-path src-tauri/Cargo.toml --config \'source.crates-io.replace-with="vendored-sources"\' --config \'source.vendored-sources.directory="third-party/dependency-sources/vendor"\'\n```\n\nThis acquisition receipt does not certify preferred upstream source for compiled npm payloads, local packages or native libraries. Preserve third-party source archives, notices and their build instructions. Developer toolchains and npm development tools are fetched separately by the pinned build instructions.\n'
		);
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
	await verifyDependencySources(root, directory);
	return directory;
}

if (
	process.argv[1] &&
	existsSync(process.argv[1]) &&
	realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))
) {
	if (process.argv.slice(2).some((arg) => !['--offline', '--check'].includes(arg)))
		throw new Error(
			'Usage: pnpm exec tsx scripts/dependency-source-prepare.ts [--offline] [--check]'
		);
	const root = process.cwd();
	if (process.argv.includes('--check')) {
		await verifyDependencySources(
			root,
			existsSync(join(root, 'third-party/dependency-sources/receipt.json'))
				? join(root, 'third-party/dependency-sources')
				: undefined
		);
		console.log(
			'Exact registry dependency source hashes and lock graph verified; preferred-source review is separate.'
		);
	} else
		console.log(
			`Prepared verified registry sources at ${await prepareDependencySources(root, process.argv.includes('--offline'))}. Nothing was published.`
		);
}
