import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolvePnpmInvocation } from '../../scripts/package-manager';

const temporary: string[] = [];
afterEach(() =>
	temporary.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }))
);
function fixture() {
	const root = mkdtempSync(join(tmpdir(), 'kwantflow-pnpm-test-'));
	temporary.push(root);
	return root;
}
function put(path: string, bytes: string | Buffer) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, bytes);
}
const prefix = ['--pm-on-fail=ignore'];

describe('portable package manager helpers', () => {
	it('uses the current pnpm JavaScript runtime without PATH lookup', () => {
		const path = join(fixture(), 'pnpm.cjs');
		put(path, '#!/usr/bin/env node\nrequire("./pnpm");\n');
		expect(resolvePnpmInvocation({ npm_execpath: path, PATH: '' })).toEqual({
			command: process.execPath,
			argsPrefix: [path, ...prefix]
		});
	});
	it('uses a standalone Windows pnpm executable without POSIX which or Corepack', () => {
		const root = fixture();
		const path = join(root, 'pnpm.exe');
		put(path, Buffer.from([77, 90, 0, 0]));
		expect(resolvePnpmInvocation({ npm_execpath: path, PATH: '' }, 'win32')).toEqual({
			command: path,
			argsPrefix: prefix
		});
		expect(resolvePnpmInvocation({ PATH: root }, 'win32')).toEqual({
			command: path,
			argsPrefix: prefix
		});
	});
	it('resolves Windows batch shims to the adjacent JavaScript package without using a shell', () => {
		const root = fixture();
		const shim = join(root, 'pnpm.cmd');
		const script = join(root, 'node_modules/pnpm/bin/pnpm.cjs');
		put(shim, '@echo off\r\n');
		put(script, '#!/usr/bin/env node\n');
		expect(resolvePnpmInvocation({ PATH: root }, 'win32')).toEqual({
			command: process.execPath,
			argsPrefix: [script, ...prefix]
		});
	});
	it('resolves a POSIX pnpm wrapper through the supplied PATH', () => {
		const root = fixture();
		const script = join(root, 'pnpm');
		put(script, '#!/usr/bin/env node\n');
		expect(resolvePnpmInvocation({ PATH: root }, 'darwin')).toEqual({
			command: process.execPath,
			argsPrefix: [script, ...prefix]
		});
	});
	it('fails clearly when the required package manager is missing', () => {
		expect(() => resolvePnpmInvocation({ PATH: '' })).toThrow('Install the pinned pnpm');
	});
});
