import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	collectExistingMacosIconTouchPaths,
	normaliseRefreshMacosIconOptions,
	refreshMacosIconCache
} from '../../scripts/refresh-macos-icon-cache';

const tempRoots: string[] = [];
const LAUNCH_SERVICES_REGISTER =
	'/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';

const createAppFixture = (rootDir: string, relativePath: string) => {
	const appPath = join(rootDir, relativePath);
	mkdirSync(join(appPath, 'Contents/Resources'), { recursive: true });
	writeFileSync(join(appPath, 'Contents/Info.plist'), 'plist');
	writeFileSync(join(appPath, 'Contents/Resources/icon.icns'), 'icns');
	return appPath;
};

afterEach(() => {
	vi.restoreAllMocks();
	for (const rootDir of tempRoots.splice(0)) {
		rmSync(rootDir, { recursive: true, force: true });
	}
});

describe('macOS icon refresh helpers', () => {
	it('normalises explicit app paths relative to the repo root', () => {
		const rootDir = join(tmpdir(), 'kwantflow-icon-refresh-root');
		const options = normaliseRefreshMacosIconOptions(
			['--app', 'dist/Kwantflow.app', '--app', '/Applications/Kwantflow.app'],
			rootDir
		);

		expect(options.rootDir).toBe(rootDir);
		expect(options.appPaths).toEqual([
			resolve(rootDir, 'dist/Kwantflow.app'),
			'/Applications/Kwantflow.app'
		]);
	});

	it('collects only existing bundle, plist, and icon touch paths', () => {
		const rootDir = mkdtempSync(join(tmpdir(), 'kwantflow-icon-refresh-'));
		tempRoots.push(rootDir);
		const appPath = createAppFixture(rootDir, 'dist/Kwantflow.app');

		const targets = collectExistingMacosIconTouchPaths([appPath, join(rootDir, 'missing.app')]);

		expect(targets).toEqual([
			appPath,
			join(appPath, 'Contents/Info.plist'),
			join(appPath, 'Contents/Resources/icon.icns')
		]);
	});

	it('runs touch, Quick Look, IconServices, Finder, Dock, and Launch Services refresh commands on macOS', () => {
		const rootDir = mkdtempSync(join(tmpdir(), 'kwantflow-icon-refresh-run-'));
		tempRoots.push(rootDir);
		const appPath = createAppFixture(rootDir, 'dist/Kwantflow.app');
		const runner = vi.fn();

		refreshMacosIconCache(
			{
				rootDir,
				appPaths: [appPath]
			},
			{
				platform: 'darwin',
				runCommand: runner
			}
		);

		expect(runner.mock.calls).toEqual([
			['touch', ['-c', appPath], { allowFailure: false }],
			['touch', ['-c', join(appPath, 'Contents/Info.plist')], { allowFailure: false }],
			['touch', ['-c', join(appPath, 'Contents/Resources/icon.icns')], { allowFailure: false }],
			['qlmanage', ['-r', 'cache'], { allowFailure: false }],
			['qlmanage', ['-r'], { allowFailure: false }],
			['killall', ['iconservicesagent'], { allowFailure: true }],
			['killall', ['iconservicesd'], { allowFailure: true }],
			['killall', ['Finder'], { allowFailure: true }],
			['killall', ['Dock'], { allowFailure: true }],
			[
				LAUNCH_SERVICES_REGISTER,
				['-kill', '-r', '-domain', 'local', '-domain', 'system', '-domain', 'user'],
				{ allowFailure: true }
			]
		]);
	});

	it('refuses to run outside macOS', () => {
		expect(() =>
			refreshMacosIconCache(
				{
					rootDir: '/tmp/kwantflow',
					appPaths: []
				},
				{
					platform: 'linux',
					runCommand: vi.fn()
				}
			)
		).toThrow('macOS only');
	});
});
