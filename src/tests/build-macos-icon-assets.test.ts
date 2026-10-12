import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	DEFAULT_MACOS_ICON_ASSETS_OUTPUT_RELATIVE_PATH,
	buildMacosIconAssets
} from '../../scripts/build-macos-icon-assets';

const tempRoots: string[] = [];

const createFixture = () => {
	const rootDir = mkdtempSync(join(tmpdir(), 'kwantflow-macos-icon-assets-'));
	tempRoots.push(rootDir);
	const sourceIconPath = join(rootDir, 'assets/brand/macos/kwantflow.icon.xcassets/Contents.json');
	mkdirSync(dirname(sourceIconPath), { recursive: true });
	writeFileSync(
		sourceIconPath,
		'{\n  "info": {\n    "author": "xcode",\n    "version": 1\n  }\n}\n'
	);
	return { rootDir, sourceIconPath };
};

afterEach(() => {
	vi.restoreAllMocks();
	for (const rootDir of tempRoots.splice(0)) {
		rmSync(rootDir, { recursive: true, force: true });
	}
});

describe('build macOS icon assets', () => {
	it('compiles an asset catalog into Assets.car from the native macOS icon source', () => {
		const { rootDir } = createFixture();
		const spawnCommand = vi.fn((command: string, args: string[]) => {
			if (command === 'xcrun' && args[0] === 'actool') {
				const compileDir = args[args.indexOf('--compile') + 1];
				mkdirSync(compileDir, { recursive: true });
				writeFileSync(join(compileDir, 'Assets.car'), 'car bytes');
				writeFileSync(join(compileDir, 'kwantflow.icns'), 'icns bytes');
			}

			return { status: 0 };
		});

		const result = buildMacosIconAssets(
			{
				rootDir
			},
			{
				platform: 'darwin',
				spawnCommand
			}
		);

		expect(result.outputPath).toBe(join(rootDir, DEFAULT_MACOS_ICON_ASSETS_OUTPUT_RELATIVE_PATH));
		expect(result.icnsPath).toBe(join(rootDir, 'src-tauri/gen/apple/kwantflow.icns'));
		expect(result.tauriFallbackIcnsPath).toBe(join(rootDir, 'src-tauri/icons/icon.icns'));
		expect(existsSync(result.tauriFallbackIcnsPath)).toBe(true);
		expect(readFileSync(result.tauriFallbackIcnsPath, 'utf8')).toBe('icns bytes');
		expect(
			spawnCommand.mock.calls.some(
				([command, args]) =>
					command === 'xcrun' &&
					args.includes('actool') &&
					args.includes('--platform') &&
					args.includes('macosx') &&
					args.includes('--app-icon') &&
					args.includes('kwantflow') &&
					args.includes(join(rootDir, 'assets/brand/macos/kwantflow.icon.xcassets'))
			)
		).toBe(true);
		expect(spawnCommand.mock.calls.some(([command]) => command === 'magick')).toBe(false);
	});

	it('refuses to run outside macOS', () => {
		const { rootDir } = createFixture();

		expect(() =>
			buildMacosIconAssets(
				{
					rootDir
				},
				{
					platform: 'linux',
					spawnCommand: vi.fn(() => ({ status: 0 }))
				}
			)
		).toThrow('macOS only');
	});
});
