// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { transformSourceArchive } from './source-archive-transform.js';

let scratch: string;
let input: string;
const fonts = ['data/ISO.shx', 'data/SIMPLEX8.shx', 'examples/fonts/gdt.shx'];

beforeEach(async () => {
	scratch = await mkdtemp(join(tmpdir(), 'kwantflow-source-transform-'));
	input = join(scratch, 'upstream.tar.gz');
	for (const path of ['src/parser.ts', 'LICENSE', ...fonts]) {
		const target = join(scratch, 'source', path);
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, path === 'src/parser.ts' ? 'export const parser = 1;\n' : path);
	}
	execFileSync('tar', ['-czf', input, '-C', scratch, 'source']);
});
afterEach(async () => rm(scratch, { recursive: true, force: true }));

describe('preferred source archive transformation', () => {
	it('retains valid source and notices while removing only the named fixture files', async () => {
		const output = join(scratch, 'source.tar.gz');
		await transformSourceArchive(input, output, fonts);
		const members = execFileSync('tar', ['-tzf', output], { encoding: 'utf8' });
		expect(members).toContain('source/src/parser.ts');
		expect(members).toContain('source/LICENSE');
		for (const font of fonts) expect(members).not.toContain(`source/${font}`);
		expect(
			execFileSync('tar', ['-xOzf', output, 'source/src/parser.ts'], { encoding: 'utf8' })
		).toBe('export const parser = 1;\n');
		const repeated = join(scratch, 'repeated.tar.gz');
		await transformSourceArchive(input, repeated, fonts);
		expect(await readFile(repeated)).toEqual(await readFile(output));
	});

	it('rejects missing omissions rather than silently retaining an unknown asset', async () => {
		await expect(
			transformSourceArchive(input, join(scratch, 'out'), ['missing.shx'])
		).rejects.toThrow('Source omission not found');
	});

	it('rejects traversal paths and empty omission declarations', async () => {
		await expect(
			transformSourceArchive(input, join(scratch, 'out'), ['../gdt.shx'])
		).rejects.toThrow('Unsafe source omission');
		await expect(transformSourceArchive(input, join(scratch, 'out'), [])).rejects.toThrow(
			'nonempty set'
		);
	});
});
