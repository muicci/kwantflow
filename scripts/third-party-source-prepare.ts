import { spawnSync } from 'node:child_process';
import {
	existsSync,
	realpathSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256File } from './native-prepare.js';
import { transformSourceArchive } from './source-archive-transform.js';

export type ThirdPartySourceInput = {
	path: string;
	url: string;
	sha256: string;
	upstreamSha256?: string;
	omittedPaths?: string[];
};
export function thirdPartySourceInputs(root: string): ThirdPartySourceInput[] {
	const inputs: ThirdPartySourceInput[] = ['manifest.json', 'native-source-manifest.json'].flatMap(
		(manifest) =>
			(
				JSON.parse(readFileSync(join(root, 'third-party', manifest), 'utf8')) as {
					sourceArchives: ThirdPartySourceInput[];
				}
			).sourceArchives
	);
	const seen = new Map<string, ThirdPartySourceInput>();
	for (const input of inputs) {
		const url = new URL(input.url);
		if (
			!input.path.startsWith('third-party/sources/') ||
			/[\\:]/.test(input.path) ||
			[...input.path].some(
				(character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
			) ||
			input.path.split('/').some((part) => !part || ['..', '.', '.git', '.cache'].includes(part)) ||
			!/^[a-f0-9]{64}$/.test(input.sha256) ||
			url.protocol !== 'https:' ||
			url.username ||
			url.password
		)
			throw new Error(`Invalid pinned source input: ${input.path}`);
		const previous = seen.get(input.path);
		if (previous && previous.sha256 !== input.sha256)
			throw new Error(`Conflicting source input hashes: ${input.path}`);
		seen.set(input.path, input);
	}
	return [...seen.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export async function prepareThirdPartySources(root: string, offline: boolean): Promise<number> {
	root = resolve(root);
	if (lstatSync(root).isSymbolicLink()) throw new Error('Source input root cannot be a symlink.');
	const inputs = thirdPartySourceInputs(root);
	for (const input of inputs) {
		const path = join(root, input.path);
		let parent = dirname(path);
		while (parent !== resolve(root)) {
			if (existsSync(parent) && lstatSync(parent).isSymbolicLink())
				throw new Error(`Source input directory cannot be a symlink: ${input.path}`);
			parent = dirname(parent);
		}
		if (existsSync(path)) {
			if (!lstatSync(path).isFile() || (await sha256File(path)) !== input.sha256)
				throw new Error(
					`Existing source input is not the pinned archive: ${input.path}. Preserve it separately before retrying.`
				);
			continue;
		}
		if (offline) throw new Error(`Offline source input missing: ${input.path}`);
		mkdirSync(dirname(path), { recursive: true });
		const temporary = mkdtempSync(join(dirname(path), '.source-input-'));
		const partial = join(temporary, 'verified.partial');
		const upstream = input.omittedPaths?.length ? join(temporary, 'upstream.partial') : partial;
		try {
			const result = spawnSync(
				'curl',
				[
					'--fail',
					'--silent',
					'--show-error',
					'--location',
					'--max-time',
					'900',
					'--retry',
					'2',
					'--output',
					upstream,
					input.url
				],
				{ encoding: 'utf8' }
			);
			if (result.error || result.status !== 0)
				throw new Error(
					`Source archive download failed: ${input.path}: ${result.error?.message ?? result.stderr.slice(-1000)}`
				);
			if (input.omittedPaths?.length) {
				if (!input.upstreamSha256 || (await sha256File(upstream)) !== input.upstreamSha256)
					throw new Error(`Raw source archive checksum mismatch: ${input.path}`);
				await transformSourceArchive(upstream, partial, input.omittedPaths);
			}
			if ((await sha256File(partial)) !== input.sha256)
				throw new Error(`Source archive checksum mismatch: ${input.path}`);
			renameSync(partial, path);
		} finally {
			rmSync(temporary, { recursive: true, force: true });
		}
		console.log(`Acquired verified source: ${input.path}`);
	}
	return inputs.length;
}

if (
	process.argv[1] &&
	existsSync(process.argv[1]) &&
	realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))
) {
	if (process.argv.slice(2).some((arg) => arg !== '--offline'))
		throw new Error('Usage: pnpm third-party:sources:prepare [--offline]');
	console.log(
		`Verified ${await prepareThirdPartySources(process.cwd(), process.argv.includes('--offline'))} pinned upstream source archives. Distribution review remains separate.`
	);
}
