import {
	execFileSync,
	spawnSync,
	type ExecFileSyncOptions,
	type SpawnSyncOptions
} from 'node:child_process';
import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

type PnpmInvocation = { command: string; argsPrefix: string[] };
const PNPM_OFFLINE_VERSION_SWITCH_BYPASS = ['--pm-on-fail=ignore'];

function pnpmInvocationAt(filePath: string): PnpmInvocation | undefined {
	const filename = filePath.split(/[\\/]/).pop() ?? '';
	if (!/^pnpm(?:\.(?:cjs|mjs|js|exe|cmd|bat))?$/i.test(filename)) return;
	try {
		if (!statSync(filePath).isFile()) return;
	} catch {
		return;
	}
	if (/\.(?:cmd|bat)$/i.test(filename)) {
		// Execute the adjacent package's JavaScript directly. Windows batch files
		// require a shell, which would interpret arguments intended for pnpm.
		for (const script of [
			join(dirname(filePath), 'node_modules/pnpm/bin/pnpm.cjs'),
			join(dirname(filePath), 'node_modules/corepack/dist/pnpm.js')
		]) {
			const invocation = pnpmInvocationAt(script);
			if (invocation) return invocation;
		}
		return;
	}
	if (/\.exe$/i.test(filename))
		return { command: filePath, argsPrefix: PNPM_OFFLINE_VERSION_SWITCH_BYPASS };
	const descriptor = openSync(filePath, 'r');
	let header: string;
	try {
		const bytes = Buffer.alloc(256);
		const count = readSync(descriptor, bytes, 0, bytes.length, 0);
		header = bytes.subarray(0, count).toString('utf8');
	} finally {
		closeSync(descriptor);
	}
	const javascript = /\.(?:cjs|mjs|js)$/i.test(filename) || /^#![^\n]*\bnode\b/.test(header);
	return javascript
		? { command: process.execPath, argsPrefix: [filePath, ...PNPM_OFFLINE_VERSION_SWITCH_BYPASS] }
		: { command: filePath, argsPrefix: PNPM_OFFLINE_VERSION_SWITCH_BYPASS };
}

export const resolvePnpmInvocation = (
	env: NodeJS.ProcessEnv = process.env,
	platform: NodeJS.Platform = process.platform
): PnpmInvocation => {
	const npmExecPath = env.npm_execpath?.trim();
	if (npmExecPath) {
		const current = pnpmInvocationAt(npmExecPath);
		if (current) return current;
	}
	const windows = platform === 'win32';
	const path = env.PATH ?? env.Path ?? process.env.PATH ?? '';
	for (const directory of path.split(windows ? ';' : ':').filter(Boolean)) {
		for (const name of windows ? ['pnpm.exe', 'pnpm.cmd', 'pnpm'] : ['pnpm']) {
			const invocation = pnpmInvocationAt(join(directory.replace(/^"(.*)"$/, '$1'), name));
			if (invocation) return invocation;
		}
	}
	throw new Error(
		'pnpm is not available. Install the pinned pnpm version from package.json before running developer commands.'
	);
};

export const execPnpmSync = (args: string[], options: ExecFileSyncOptions = {}) => {
	const invocation = resolvePnpmInvocation(options.env as NodeJS.ProcessEnv | undefined);
	return execFileSync(invocation.command, [...invocation.argsPrefix, ...args], options);
};

export const spawnPnpmSync = (args: string[], options: SpawnSyncOptions = {}) => {
	const invocation = resolvePnpmInvocation(options.env as NodeJS.ProcessEnv | undefined);
	return spawnSync(invocation.command, [...invocation.argsPrefix, ...args], options);
};
