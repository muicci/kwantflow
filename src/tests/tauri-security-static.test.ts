import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string) =>
	readFileSync(join(process.cwd(), relativePath), 'utf8');

describe('tauri desktop security posture', () => {
	it('keeps an explicit webview security config instead of a null CSP', () => {
		const tauriConfig = readSource('src-tauri/tauri.conf.json');

		expect(tauriConfig).not.toContain('"csp": null');
		expect(tauriConfig).toContain('"default-src"');
		expect(tauriConfig).toContain('"connect-src"');
		expect(tauriConfig).toContain('"img-src"');
	});

	it('permits only default-application web and contact URLs in both viewer windows', () => {
		for (const name of ['default', 'asset-preview']) {
			const capability = JSON.parse(readSource(`src-tauri/capabilities/${name}.json`));
			const opener = capability.permissions.filter((permission: string | { identifier: string }) =>
				(typeof permission === 'string' ? permission : permission.identifier).startsWith('opener:')
			);
			expect(opener).toEqual([
				{
					identifier: 'opener:allow-open-url',
					allow: [{ url: 'mailto:*' }, { url: 'tel:*' }, { url: 'http://*' }, { url: 'https://*' }]
				},
				'opener:deny-open-path',
				'opener:deny-reveal-item-in-dir'
			]);
			expect(capability.windows).toEqual([name === 'default' ? 'main' : 'asset-preview']);
			expect(capability).not.toHaveProperty('remote');
		}
	});

	it('serves asset protocol responses without wildcard CORS and with nosniff', () => {
		const tauriLib = readSource('src-tauri/src/lib.rs');

		expect(tauriLib).not.toContain('Access-Control-Allow-Origin", "*"');
		expect(tauriLib).toContain('X-Content-Type-Options');
		expect(tauriLib).toContain('Only image assets are allowed through kwant-asset.');
	});
});
