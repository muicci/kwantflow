import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string) =>
	readFileSync(join(process.cwd(), relativePath), 'utf8');

const extractHexColours = (source: string) =>
	Array.from(source.matchAll(/#([0-9A-Fa-f]{6})/g), ([, hex]) => hex.toUpperCase());

const toChannels = (hex: string) => {
	const pairs = hex.match(/.{2}/g) ?? [];
	return pairs.map((pair) => Number.parseInt(pair, 16));
};

describe('desktop branding assets', () => {
	it('keeps desktop-facing branding aligned to Kwantflow', () => {
		const cargoToml = readSource('src-tauri/Cargo.toml');
		const tauriConfig = readSource('src-tauri/tauri.conf.json');
		const packageJson = readSource('package.json');
		const brandReadme = readSource('assets/brand/README.md');
		const appIconSource = readSource('assets/brand/kwantflow-app-icon.svg');
		const macosTintedLayerSource = readSource(
			'assets/brand/macos/kwantflow.icon.xcassets/kwantflow.iconstack/Group.iconstackgroup/L3921 2.iconstacklayer/Contents.json'
		);
		const macosTintedLayer = JSON.parse(macosTintedLayerSource) as {
			properties?: {
				image?: Array<{
					'icon-studio-appearance'?: string;
					'icon-studio-idiom'?: string;
					value?: { name?: string };
				}>;
				'is-glass'?: Array<{
					'icon-studio-appearance'?: string;
					'icon-studio-idiom'?: string;
					value?: boolean;
				}>;
			};
		};
		const sidebarSource = readSource('src/lib/components/app-sidebar.svelte');
		const layoutSource = readSource('src/routes/+layout.svelte');

		expect(existsSync(join(process.cwd(), 'assets/brand/kwantflow-app-icon.png'))).toBe(true);
		expect(
			existsSync(join(process.cwd(), 'assets/brand/macos/kwantflow.icon.xcassets/Contents.json'))
		).toBe(true);
		expect(
			existsSync(
				join(
					process.cwd(),
					'assets/brand/macos/kwantflow.icon.xcassets/kwantflow_Assets/mono.imageset/image.svg'
				)
			)
		).toBe(true);
		expect(existsSync(join(process.cwd(), 'static/images/kwantflow-app-icon.png'))).toBe(true);
		expect(existsSync(join(process.cwd(), 'assets/brand/kwantflow-source.svg'))).toBe(true);
		expect(existsSync(join(process.cwd(), 'assets/brand/kwantflow-logo-app-source.svg'))).toBe(
			true
		);
		expect(
			existsSync(join(process.cwd(), 'src/lib/assets/branding/kwantflow-sidebar-mark.svg'))
		).toBe(true);
		expect(existsSync(join(process.cwd(), 'src/lib/assets/branding/kwantflow-logo-app.svg'))).toBe(
			true
		);
		expect(existsSync(join(process.cwd(), 'static/images/nano_banana_logo.png'))).toBe(false);
		expect(existsSync(join(process.cwd(), 'icon.svg'))).toBe(false);
		expect(existsSync(join(process.cwd(), 'kwantflow-icon.svg'))).toBe(false);
		expect(existsSync(join(process.cwd(), 'kwantflow-logo-app.svg'))).toBe(false);
		expect(existsSync(join(process.cwd(), 'static/splashscreen.html'))).toBe(false);
		expect(cargoToml).not.toContain('description = "A Tauri App"');
		expect(cargoToml).not.toContain('authors = ["you"]');
		expect(cargoToml).toContain('description = "');
		expect(cargoToml).toContain('authors = [');
		expect(tauriConfig).toContain('"publisher"');
		expect(tauriConfig).toContain('"shortDescription"');
		expect(tauriConfig).toContain('"longDescription"');
		expect(packageJson).toContain('"branding:regen"');
		expect(packageJson).toContain('"branding:build:macos-icon-assets"');
		expect(packageJson).toContain('"branding:refresh:macos"');
		expect(brandReadme).toContain('canonical source-of-truth for Kwantflow desktop branding');
		expect(brandReadme).toContain('pnpm branding:regen');
		expect(brandReadme).toContain('pnpm branding:build:macos-icon-assets');
		expect(brandReadme).toContain('pnpm branding:refresh:macos');
		expect(brandReadme).toContain('Assets.car');
		expect(brandReadme).toContain('CFBundleIconName');
		expect(brandReadme).toContain('src-tauri/icons/icon.icns');
		expect(brandReadme).toContain('Finder or Dock still shows a stale icon');
		expect(brandReadme).toContain('assets/brand/kwantflow-app-icon.svg');
		expect(brandReadme).toContain('assets/brand/macos/kwantflow.icon.xcassets');
		expect(brandReadme).toContain('kwantflow-logo-app-source.svg');
		expect(brandReadme).toContain('src/lib/assets/branding/kwantflow-logo-app.svg');
		expect(brandReadme).toContain('src/lib/assets/branding/kwantflow-sidebar-mark.svg');
		expect(brandReadme).toContain('src-tauri/icons');
		expect(sidebarSource).toContain(
			"import sidebarLogoUrl from '$lib/assets/branding/kwantflow-logo-app.svg';"
		);
		expect(layoutSource).toContain('ui-boot-logo-shimmer');
		expect(layoutSource).toContain('Opening Kwantflow');
		expect(layoutSource).toContain('Loading your local workspace…');
		expect(appIconSource).toContain('viewBox="0 0 1024 1024"');
		expect(appIconSource).not.toContain('linearGradient');
		expect(appIconSource).not.toContain('<filter');
		const iconColours = extractHexColours(appIconSource);
		expect(iconColours.length).toBeGreaterThan(0);
		expect(new Set(iconColours).size).toBe(1);
		expect(iconColours).not.toContain('FFFFFF');
		expect(
			iconColours.some((hex) => {
				const [red, green, blue] = toChannels(hex);
				return red <= 16 && green <= 16 && blue <= 16;
			})
		).toBe(true);
		expect(appIconSource).not.toContain('<rect');
		expect(appIconSource).not.toContain('stroke=');
		expect(
			macosTintedLayer.properties?.image?.find(
				(entry) =>
					entry['icon-studio-appearance'] === 'tinted' && entry['icon-studio-idiom'] === 'macOS'
			)?.value?.name
		).toBe('kwantflow_Assets/mono');
		expect(
			macosTintedLayer.properties?.['is-glass']?.find(
				(entry) =>
					entry['icon-studio-appearance'] === 'tinted' && entry['icon-studio-idiom'] === 'macOS'
			)?.value
		).toBe(false);
	});
});
