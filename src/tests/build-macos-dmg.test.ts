import {
	mkdirSync,
	mkdtempSync,
	readlinkSync,
	rmSync,
	symlinkSync,
	utimesSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildMacosDmg } from '../../scripts/build-macos-dmg';

const tempRoots: string[] = [];

const createFixture = () => {
	const rootDir = mkdtempSync(join(tmpdir(), 'kwantflow-build-dmg-'));
	tempRoots.push(rootDir);
	writeFileSync(
		join(rootDir, 'package.json'),
		JSON.stringify({ name: 'kwantflow-app', version: '0.1.1' }, null, 2)
	);
	const appPath = join(rootDir, 'src-tauri/target/debug/bundle/macos/Kwantflow.app');
	mkdirSync(appPath, { recursive: true });
	writeFileSync(join(appPath, 'Contents.txt'), 'app bytes');
	return { rootDir, appPath };
};

afterEach(() => {
	for (const rootDir of tempRoots.splice(0)) {
		rmSync(rootDir, { recursive: true, force: true });
	}
	vi.restoreAllMocks();
});

// The helper creates the macOS Applications symlink and invokes hdiutil.
describe.skipIf(process.platform !== 'darwin')('build macOS dmg helper', () => {
	it('creates a repo-managed dmg command from the built app bundle', () => {
		const { rootDir } = createFixture();
		const spawnCommand = vi.fn<(command: string, args: string[]) => { status: number }>(() => ({
			status: 0
		}));

		const result = buildMacosDmg(
			{
				rootDir,
				profile: 'debug',
				archLabel: 'synthetic'
			},
			{ spawnCommand }
		);

		expect(result.outputPath).toBe(
			join(rootDir, 'src-tauri/target/debug/bundle/dmg/Kwantflow_0.1.1_synthetic.dmg')
		);
		expect(spawnCommand).toHaveBeenCalledTimes(1);
		const firstCall = spawnCommand.mock.calls[0];
		expect(firstCall).toBeDefined();
		if (!firstCall) {
			throw new Error('Expected hdiutil to be invoked once.');
		}
		const [command, args] = firstCall;
		expect(command).toBe('hdiutil');
		expect(args).toContain('create');
		expect(args).toContain('-srcfolder');
		expect(args[args.length - 1]).toBe(result.outputPath);
	});

	it('assesses the notarised app with spctl before building a release DMG', () => {
		const { rootDir, appPath } = createFixture();
		const releaseAppPath = appPath.replace('/debug/', '/release/');
		mkdirSync(releaseAppPath, { recursive: true });
		writeFileSync(join(releaseAppPath, 'Contents.txt'), 'release app bytes');
		const spawnCommand = vi.fn<(command: string, args: string[]) => { status: number }>(() => ({
			status: 0
		}));

		const result = buildMacosDmg(
			{
				rootDir,
				profile: 'release',
				notarize: true
			},
			{ spawnCommand }
		);
		expect(result.appPath).toBe(releaseAppPath);

		// hdiutil to create the DMG, then spctl to verify the notarised app before packaging.
		expect(spawnCommand.mock.calls.map(([command]) => command)).toEqual(['hdiutil', 'spctl']);
		expect(spawnCommand.mock.calls[1]?.[1]).toEqual([
			'-a',
			'-t',
			'execute',
			'-v',
			expect.stringContaining('/release/')
		]);
	});

	it('selects the requested target and never packages a newer unrelated architecture bundle', () => {
		const { rootDir, appPath: defaultApp } = createFixture();
		const appPath = join(
			rootDir,
			'src-tauri/target/universal-apple-darwin/debug/bundle/macos/Kwantflow.app'
		);
		mkdirSync(appPath, { recursive: true });
		writeFileSync(join(appPath, 'Contents.txt'), 'universal app fixture');
		const future = new Date(Date.now() + 60_000);
		utimesSync(defaultApp, future, future);
		const spawnCommand = vi.fn(() => ({ status: 0 }));
		const result = buildMacosDmg(
			{ rootDir, profile: 'debug', target: 'universal-apple-darwin' },
			{ spawnCommand }
		);
		expect(result.appPath).toBe(appPath);
		expect(result.appPath).not.toBe(defaultApp);
		expect(result.outputPath).toContain(
			'universal-apple-darwin/debug/bundle/dmg/Kwantflow_0.1.1_universal.dmg'
		);
		expect(() =>
			buildMacosDmg({ rootDir, profile: 'debug', target: 'x86_64-apple-darwin' }, { spawnCommand })
		).toThrow('Expected one built');
	});

	it('preserves relative application symlinks when staging signed bundle contents', () => {
		const { rootDir, appPath } = createFixture();
		symlinkSync('Contents.txt', join(appPath, 'relative-fixture'));
		const spawnCommand = vi.fn((command: string, args: string[]) => {
			if (command === 'hdiutil') {
				const staged = args[args.indexOf('-srcfolder') + 1];
				expect(readlinkSync(join(staged, 'Kwantflow.app/relative-fixture'))).toBe('Contents.txt');
			}
			return { status: 0 };
		});
		buildMacosDmg({ rootDir, profile: 'debug' }, { spawnCommand });
		expect(spawnCommand).toHaveBeenCalledOnce();
	});
});
