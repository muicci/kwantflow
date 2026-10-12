import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareThirdPartySources, thirdPartySourceInputs } from './third-party-source-prepare';

const temporary: string[] = [];
afterEach(() =>
	temporary.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }))
);
function fixture(input: Record<string, unknown>) {
	const root = mkdtempSync(join(tmpdir(), 'kwantflow-source-input-test-'));
	temporary.push(root);
	mkdirSync(join(root, 'third-party'), { recursive: true });
	writeFileSync(
		join(root, 'third-party/manifest.json'),
		JSON.stringify({ sourceArchives: [input] })
	);
	writeFileSync(
		join(root, 'third-party/native-source-manifest.json'),
		JSON.stringify({ sourceArchives: [] })
	);
	return root;
}
const input = {
	path: 'third-party/sources/upstream.tar.gz',
	url: 'https://example.com/source.tar.gz',
	sha256: createHash('sha256').update('tiny source fixture').digest('hex')
};

describe('pinned third-party source acquisition', () => {
	it('supports a relative application root and verifies existing bytes offline', async () => {
		const root = fixture(input);
		mkdirSync(join(root, 'third-party/sources'));
		writeFileSync(join(root, input.path), 'tiny source fixture');
		await expect(prepareThirdPartySources(relative(process.cwd(), root), true)).resolves.toBe(1);
		writeFileSync(join(root, input.path), 'modified');
		await expect(prepareThirdPartySources(root, true)).rejects.toThrow('not the pinned archive');
	});
	it('rejects nonportable and credential-bearing source inputs', () => {
		for (const path of [
			'third-party/sources/../escape',
			'third-party/sources/a\\..\\escape',
			'third-party/sources/a:stream',
			'third-party/sources/a\nfile',
			'third-party/sources//file',
			'third-party/sources/.git/config'
		]) {
			expect(() => thirdPartySourceInputs(fixture({ ...input, path }))).toThrow('Invalid pinned');
		}
		expect(() =>
			thirdPartySourceInputs(fixture({ ...input, url: 'https://secret@example.com/source.tar.gz' }))
		).toThrow('Invalid pinned');
	});
	it.skipIf(process.platform === 'win32')(
		'rejects symlinked archive parents before reading their bytes',
		async () => {
			const root = fixture(input);
			const elsewhere = mkdtempSync(join(tmpdir(), 'kwantflow-source-elsewhere-test-'));
			temporary.push(elsewhere);
			symlinkSync(elsewhere, join(root, 'third-party/sources'), 'dir');
			await expect(prepareThirdPartySources(root, true)).rejects.toThrow(
				'directory cannot be a symlink'
			);
		}
	);
});
