import fs from 'node:fs';
import path from 'node:path';
import { globSync } from 'glob';
import { describe, expect, it } from 'vitest';

const PACKAGE_ALLOWLIST = new Set(['svelte', '@sveltejs/kit']);
const IMPORT_REGEXES = [
	/\bimport\s+(?:type\s+)?(?:[^'"]+?\s+from\s+)?['"]([^'"]+)['"]/g,
	/\bexport\s+(?:type\s+)?[^'"]+?\s+from\s+['"]([^'"]+)['"]/g,
	/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g
];

const getPackageName = (specifier: string) => {
	if (
		specifier.startsWith('.') ||
		specifier.startsWith('/') ||
		specifier.startsWith('$') ||
		specifier.startsWith('node:')
	) {
		return null;
	}

	if (specifier.startsWith('@')) {
		const [scope, name] = specifier.split('/');
		return scope && name ? `${scope}/${name}` : specifier;
	}

	return specifier.split('/')[0] ?? null;
};

describe('runtime dependency classification', () => {
	it('keeps shipped runtime packages out of devDependencies', () => {
		const packageJson = JSON.parse(
			fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')
		) as {
			dependencies?: Record<string, string>;
			devDependencies?: Record<string, string>;
		};

		const dependencies = new Set(Object.keys(packageJson.dependencies ?? {}));
		const devDependencies = new Set(Object.keys(packageJson.devDependencies ?? {}));
		const files = globSync('src/**/*.{ts,js,svelte}', {
			cwd: process.cwd(),
			nodir: true,
			posix: true,
			ignore: [
				'src/**/*.test.*',
				'src/**/*.stories.*',
				'src/tests/**',
				'src/**/test-*.{ts,js,svelte}',
				'src/app/**'
			]
		});

		const offenders = new Set<string>();

		for (const file of files) {
			const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
			for (const regex of IMPORT_REGEXES) {
				for (const match of source.matchAll(regex)) {
					const packageName = getPackageName(match[1] ?? '');
					if (!packageName || PACKAGE_ALLOWLIST.has(packageName)) {
						continue;
					}

					if (devDependencies.has(packageName) && !dependencies.has(packageName)) {
						offenders.add(packageName);
					}
				}
			}
		}

		expect([...offenders]).toEqual([]);
	});
});
