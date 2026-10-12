import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { execPnpmSync } from './package-manager';

const repoRoot = process.cwd();
const brandDir = join(repoRoot, 'assets/brand');
const sourceSvg = join(brandDir, 'kwantflow-source.svg');
const appIconSvg = join(brandDir, 'kwantflow-app-icon.svg');
const appIconPng = join(brandDir, 'kwantflow-app-icon.png');
const splashIconPng = join(repoRoot, 'static/images/kwantflow-app-icon.png');
const faviconPng = join(repoRoot, 'static/favicon.png');
const tauriIconsDir = join(repoRoot, 'src-tauri/icons');

const requireFile = (filePath: string) => {
	if (!existsSync(filePath)) {
		throw new Error(`Missing required branding source: ${filePath}`);
	}
};

const run = (command: string, args: string[]) => {
	execFileSync(command, args, { stdio: 'inherit' });
};

const ensureParent = (filePath: string) => {
	mkdirSync(dirname(filePath), { recursive: true });
};

requireFile(sourceSvg);
requireFile(appIconSvg);

ensureParent(appIconPng);
ensureParent(splashIconPng);
ensureParent(faviconPng);

run('magick', [
	'-background',
	'none',
	'-density',
	'384',
	appIconSvg,
	'-resize',
	'1024x1024',
	`PNG32:${appIconPng}`
]);

copyFileSync(appIconPng, splashIconPng);

run('magick', [appIconPng, '-resize', '256x256', faviconPng]);
execPnpmSync(['tauri', 'icon', appIconPng, '-o', tauriIconsDir], { stdio: 'inherit' });

if (process.platform === 'darwin') {
	console.log(
		'If Finder or Dock still shows a stale icon after regeneration, run pnpm branding:refresh:macos.'
	);
}
