import { spawnSync } from 'node:child_process';
import fs, {
	chmodSync,
	copyFileSync,
	createReadStream,
	createWriteStream,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { createGzip } from 'node:zlib';
import { sha256File } from './native-prepare.js';
import { verifyDependencySources } from './dependency-source-prepare.js';
import { thirdPartySourceInputs } from './third-party-source-prepare.js';
import { verifyThirdParty } from './verify-third-party.js';

// Exact build/source inputs and required public documentation. Private operations,
// profile data, ignored binaries, credentials, and Git history are never exported.
export const PUBLIC_SOURCE_ROOTS = [
	'src',
	'src-tauri',
	'scripts',
	'static',
	'assets',
	'tokens',
	'content/local-assistant',
	'tests',
	'third-party',
	'packages/libheif-js',
	'docs/user',
	'docs/development/windows-installer.md',
	'.github/workflows/release.yml',
	'.github/workflows/ci.yml',
	'.github/windows-native-runtime-contract.json',
	'.storybook/main.ts',
	'.storybook/preview.ts',
	'.gitignore',
	'.node-version',
	'.pnpmrc',
	'.prettierignore',
	'.prettierrc',
	'AGENTS.md',
	'ARCHITECTURE.md',
	'CHANGELOG.md',
	'CODE_OF_CONDUCT.md',
	'CONTRIBUTING.md',
	'SECURITY.md',
	'TRADEMARKS.md',
	'LICENSE',
	'README.md',
	'THIRD_PARTY_NOTICES.md',
	'native-inputs.json',
	'eslint.config.js',
	'knip.json',
	'package.json',
	'pnpm-lock.yaml',
	'pnpm-workspace.yaml',
	'rust-toolchain.toml',
	'svelte.config.js',
	'tsconfig.json',
	'vite.config.js',
	'vitest.config.ts'
];

export function publicSourcePaths(paths: string[]): string[] {
	return paths
		.filter((path) =>
			PUBLIC_SOURCE_ROOTS.some((root) => path === root || path.startsWith(`${root}/`))
		)
		.map((path) => {
			if (
				path.startsWith('/') ||
				/[\\:]/.test(path) ||
				[...path].some(
					(character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
				) ||
				path.split('/').some((part) => !part || part === '..' || part === '.') ||
				/(?:^|\/)(?:\.git|\.cache|\.native-runtime-stage-[^/]*|\.env[^/]*|\.secrets[^/]*|runs|node_modules|target|gen)(?:\/|$)|\.(?:p8|p12|key|pem|db|db-wal|db-shm)$/i.test(
					path
				)
			)
				throw new Error(`Forbidden file in public source selection: ${path}`);
			return path;
		})
		.sort();
}

export function readDistributionVersion(root: string): string {
	const version = (
		JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: unknown }
	).version;
	if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version))
		throw new Error('Distribution requires a plain release version.');
	const tauriVersion = JSON.parse(
		readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8')
	).version;
	const cargoPackage = readFileSync(join(root, 'src-tauri/Cargo.toml'), 'utf8')
		.split(/^\[package\]\s*$/m)[1]
		?.split(/^\[/m)[0];
	const cargoVersion = /^version\s*=\s*"([^"]+)"\s*$/m.exec(cargoPackage ?? '')?.[1];
	if (tauriVersion !== version || cargoVersion !== version)
		throw new Error('Package, Tauri and Cargo release versions must match.');
	return version;
}

function assertRegularSourceFile(root: string, path: string): void {
	if (lstatSync(root).isSymbolicLink())
		throw new Error(`Public source export refuses a symlink root: ${root}`);
	let current = root;
	for (const part of path.split('/')) {
		current = join(current, part);
		if (lstatSync(current).isSymbolicLink())
			throw new Error(`Public source export refuses a symlink: ${path}`);
	}
	if (!lstatSync(current).isFile())
		throw new Error(`Public source export requires a regular file: ${path}`);
}

export function assertDistributionDirectory(root: string, directory: string): void {
	const path = relative(root, directory);
	if (!path || isAbsolute(path) || path.split(sep).includes('..'))
		throw new Error('Distribution output must stay inside the application root.');
	let current = root;
	for (const part of path.split(sep)) {
		current = join(current, part);
		try {
			const metadata = lstatSync(current);
			if (metadata.isSymbolicLink() || !metadata.isDirectory())
				throw new Error(`Distribution directory must not be a symlink or file: ${current}`);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
		}
	}
}

function unpackedSourceInventory(root: string): string[] {
	const files: string[] = [];
	const walk = (path: string) => {
		if (path === 'src-tauri/native-runtime') {
			if (existsSync(join(root, path, '.gitkeep'))) files.push(`${path}/.gitkeep`);
			return;
		}
		if (
			path.startsWith('third-party/sources/') ||
			path === 'third-party/sources' ||
			path.startsWith('third-party/dependency-sources/') ||
			path === 'third-party/dependency-sources' ||
			path.startsWith('src-tauri/native-runtime/') ||
			path === 'src-tauri/native-runtime' ||
			/(?:^|\/)(?:node_modules|target|gen|\.git|\.cache|\.native-runtime-stage-[^/]*)(?:\/|$)/.test(
				path
			)
		)
			return;
		const absolute = join(root, path);
		if (!existsSync(absolute)) return;
		const metadata = lstatSync(absolute);
		if (metadata.isSymbolicLink())
			throw new Error(`Public source export refuses a symlink: ${path}`);
		if (metadata.isDirectory()) for (const name of readdirSync(absolute)) walk(`${path}/${name}`);
		else if (metadata.isFile()) files.push(path);
		else throw new Error(`Public source export requires a regular file: ${path}`);
	};
	for (const path of PUBLIC_SOURCE_ROOTS) walk(path);
	return files;
}

export function assertSourceReleaseReady(result: {
	errors: string[];
	releaseBlockers: string[];
}): void {
	const failures = [...result.errors, ...result.releaseBlockers];
	if (failures.length)
		throw new Error(
			`Source distribution is blocked:\n${failures.map((failure) => `- ${failure}`).join('\n')}`
		);
}

export async function buildSourceDistribution(
	rootDir: string,
	options: { checkOnly?: boolean; candidate?: boolean } = {}
): Promise<string | undefined> {
	rootDir = realpathSync(rootDir);
	const version = readDistributionVersion(rootDir);
	const review = await verifyThirdParty(rootDir);
	let dependencySources:
		| { directory: string; files: string[]; localFiles: { path: string; sha256: string }[] }
		| undefined;
	try {
		const packaged = join(rootDir, 'third-party/dependency-sources');
		const directory = existsSync(join(packaged, 'receipt.json'))
			? packaged
			: join(rootDir, '.cache/dependency-sources');
		const receipt = await verifyDependencySources(rootDir, directory);
		dependencySources = {
			directory,
			files: [
				'receipt.json',
				'README.md',
				...receipt.npm.map((entry) => entry.path),
				receipt.cargo.path
			],
			localFiles: (receipt.localPackages ?? []).flatMap((local) =>
				local.files.map((file) => ({
					path: `${local.directory}/${file.path}`,
					sha256: file.sha256
				}))
			)
		};
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
		review.errors.push(
			'Exact npm production archives and Cargo vendor sources are missing. Run pnpm sources:prepare and pnpm sources:verify.'
		);
	}
	if (options.candidate) assertSourceReleaseReady({ errors: review.errors, releaseBlockers: [] });
	else assertSourceReleaseReady(review);
	const gitRoot = spawnSync('git', ['rev-parse', '--show-toplevel'], {
		cwd: rootDir,
		encoding: 'utf8'
	});
	const ownsGit = gitRoot.status === 0 && resolve(gitRoot.stdout.trim()) === rootDir;
	let sourceCommit: string;
	let dirty: boolean;
	let inventory: string[];
	if (ownsGit) {
		const status = spawnSync('git', ['status', '--porcelain'], { cwd: rootDir, encoding: 'utf8' });
		if (status.status !== 0) throw new Error('Cannot determine source tree status.');
		dirty = Boolean(status.stdout.trim());
		if (dirty && !options.candidate)
			throw new Error(
				'Corresponding-source release requires a clean Git tree. Use --candidate for unpublished local verification.'
			);
		const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: rootDir, encoding: 'utf8' });
		if (commit.status !== 0 || !/^[a-f0-9]{40}$/.test(commit.stdout.trim()))
			throw new Error('Cannot resolve source distribution commit.');
		sourceCommit = commit.stdout.trim();
		const paths = spawnSync(
			'git',
			['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
			{
				cwd: rootDir,
				encoding: 'utf8',
				maxBuffer: 16 * 1024 * 1024
			}
		);
		if (paths.status !== 0) throw new Error('Cannot determine public source inventory.');
		const removed = spawnSync('git', ['ls-files', '--deleted', '-z'], {
			cwd: rootDir,
			encoding: 'utf8',
			maxBuffer: 16 * 1024 * 1024
		});
		if (removed.status !== 0) throw new Error('Cannot determine removed application files.');
		const deleted = new Set(removed.stdout.split('\0').filter(Boolean));
		inventory = paths.stdout.split('\0').filter((path) => path && !deleted.has(path));
	} else {
		if (!options.candidate)
			throw new Error(
				'Release source export requires its own application Git checkout. An unpacked source bundle can create only an unpublished --candidate export.'
			);
		const provenance = JSON.parse(readFileSync(join(rootDir, 'SOURCE_PROVENANCE.json'), 'utf8'));
		if (
			provenance.schemaVersion !== 1 ||
			provenance.version !== version ||
			!/^[a-f0-9]{40}$/.test(provenance.sourceCommit)
		)
			throw new Error('Invalid unpacked source provenance.');
		sourceCommit = provenance.sourceCommit;
		dirty = true;
		inventory = unpackedSourceInventory(rootDir);
	}
	const nativeManifest = JSON.parse(
		readFileSync(join(rootDir, 'third-party/native-source-manifest.json'), 'utf8')
	) as { verificationReceipts?: { path: string; sha256: string }[] };
	for (const receipt of nativeManifest.verificationReceipts ?? []) {
		if (!/^[a-f0-9]{64}$/.test(receipt.sha256) || publicSourcePaths([receipt.path]).length !== 1)
			throw new Error('Invalid public native verification receipt.');
	}
	const sourceInputs = new Map(
		[
			...thirdPartySourceInputs(rootDir),
			...(nativeManifest.verificationReceipts ?? []),
			...(dependencySources?.localFiles ?? [])
		].map((input) => [input.path, input.sha256])
	);
	const files = publicSourcePaths([...new Set([...inventory, ...sourceInputs.keys()])]);
	for (const path of files) assertRegularSourceFile(rootDir, path);
	const output = join(
		rootDir,
		'dist/distribution',
		version,
		options.candidate ? 'candidate-source' : 'source'
	);
	assertDistributionDirectory(rootDir, output);
	if (options.checkOnly) return;
	mkdirSync(output, { recursive: true });
	const temporary = mkdtempSync(join(tmpdir(), 'kwantflow-source-'));
	const archiveOutput = mkdtempSync(join(output, '.source-'));
	const name = `Kwantflow_${version}_${options.candidate ? 'candidate-' : ''}source.tar.gz`;
	try {
		const tar = join(temporary, 'source.tar');
		const staging = join(temporary, `Kwantflow_${version}`);
		const fileDigests = new Map<string, string>();
		if (!options.candidate) {
			// Use exact committed bytes, then build a single archive of the audited
			// inventory plus verified acquired inputs. Git export-ignore cannot
			// silently omit a required source file.
			const committedTar = join(temporary, 'committed.tar');
			const archive = spawnSync(
				'git',
				[
					'archive',
					'--format=tar',
					`--prefix=Kwantflow_${version}/`,
					`--output=${committedTar}`,
					sourceCommit,
					'--',
					...PUBLIC_SOURCE_ROOTS.filter((root) =>
						files.some((path) => path === root || path.startsWith(`${root}/`))
					)
				],
				{ cwd: rootDir, encoding: 'utf8' }
			);
			if (archive.status !== 0) throw new Error(`Source archive failed: ${archive.stderr.trim()}`);
			const extract = spawnSync('tar', ['-xf', committedTar, '-C', temporary], {
				encoding: 'utf8'
			});
			if (extract.status !== 0)
				throw new Error(`Committed source staging failed: ${extract.stderr.trim()}`);
		}
		for (const path of files) {
			const source = join(rootDir, path);
			const destination = join(staging, path);
			if (options.candidate || (sourceInputs.has(path) && !existsSync(destination))) {
				mkdirSync(dirname(destination), { recursive: true });
				copyFileSync(source, destination);
				chmodSync(destination, lstatSync(source).mode & 0o777);
			}
			if (!existsSync(destination))
				throw new Error(`Committed source archive omitted a required public file: ${path}`);
			assertRegularSourceFile(staging, path);
			const sha256 = await sha256File(destination);
			if (sourceInputs.has(path) && sourceInputs.get(path) !== sha256)
				throw new Error(`Acquired source changed during export: ${path}`);
			fileDigests.set(path, sha256);
		}
		if (dependencySources)
			for (const path of dependencySources.files) {
				assertRegularSourceFile(
					rootDir,
					relative(rootDir, join(dependencySources.directory, path)).split(sep).join('/')
				);
				const destination = join(staging, 'third-party/dependency-sources', path);
				mkdirSync(dirname(destination), { recursive: true });
				copyFileSync(join(dependencySources.directory, path), destination);
				fileDigests.set(`third-party/dependency-sources/${path}`, await sha256File(destination));
			}
		const provenance = JSON.stringify({
			schemaVersion: 1,
			version,
			sourceCommit,
			sourceDirty: dirty,
			candidate: Boolean(options.candidate)
		});
		writeFileSync(join(staging, 'SOURCE_PROVENANCE.json'), `${provenance}\n`);
		fileDigests.set(
			'SOURCE_PROVENANCE.json',
			await sha256File(join(staging, 'SOURCE_PROVENANCE.json'))
		);
		const archive = spawnSync(
			'tar',
			[
				...(process.platform === 'darwin' ? ['--no-xattrs'] : []),
				'-cf',
				tar,
				'-C',
				temporary,
				`Kwantflow_${version}`
			],
			{
				encoding: 'utf8',
				// macOS otherwise adds AppleDouble members and PAX extended attributes.
				env: { ...process.env, COPYFILE_DISABLE: '1' }
			}
		);
		if (archive.status !== 0) throw new Error(`Source archive failed: ${archive.stderr.trim()}`);
		await pipeline(
			createReadStream(tar),
			createGzip({ level: 9 }),
			createWriteStream(join(archiveOutput, name), { flags: 'wx' })
		);
		// GitHub requires each uploaded release asset to be strictly under 2 GiB.
		if (fs.lstatSync(join(archiveOutput, name)).size >= 2 ** 31)
			throw new Error(
				"Compressed corresponding-source archive must be under GitHub's 2 GiB release asset limit. Nothing was finalized."
			);
		const sha256 = await sha256File(join(archiveOutput, name));
		renameSync(join(archiveOutput, name), join(output, name));
		writeFileSync(
			join(output, 'source-manifest.json'),
			`${JSON.stringify({ schemaVersion: 1, version, sourceCommit, sourceDirty: dirty, candidate: Boolean(options.candidate), correspondingSourceReview: review.releaseBlockers.length ? 'blocked' : 'ready', releaseBlockers: review.releaseBlockers, files: [...fileDigests].sort(([a], [b]) => a.localeCompare(b)).map(([path, sha256]) => ({ path, sha256 })), artifacts: [{ name, sha256 }] }, null, '\t')}\n`
		);
		writeFileSync(join(output, 'SHA256SUMS'), `${sha256}  ${name}\n`);
		return output;
	} finally {
		rmSync(archiveOutput, { recursive: true, force: true });
		rmSync(temporary, { recursive: true, force: true });
	}
}

if (
	process.argv[1] &&
	existsSync(process.argv[1]) &&
	realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	if (process.argv.slice(2).some((arg) => !['--check', '--candidate'].includes(arg)))
		throw new Error('Usage: pnpm distribution:source [--check] [--candidate]');
	const output = await buildSourceDistribution(process.cwd(), {
		checkOnly: process.argv.includes('--check'),
		candidate: process.argv.includes('--candidate')
	});
	console.log(
		output
			? `Created ${process.argv.includes('--candidate') ? 'unpublished local candidate' : 'reviewed release'} source at ${output}. Nothing was published.`
			: process.argv.includes('--candidate')
				? 'Candidate input hashes passed; final release eligibility requires completed source/license review.'
				: 'Source distribution hash/closure checks passed.'
	);
}
