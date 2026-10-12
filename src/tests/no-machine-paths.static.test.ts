import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Licence evidence, logs and fixtures are committed to a public repository. They must not
// embed paths from a maintainer's machine. Record repo-relative paths (or `<app>`, `<home>`).
const BINARY_EXTENSIONS =
	/\.(wasm|png|jpe?g|webp|gif|ico|icns|shx|ttf|otf|woff2?|dwg|dxf|pdf|heic|tif{1,2}|tgz|zip|gz|xlsx|docx|msg|eml|step|stp|iges|igs|stl|obj|3mf|car|bin|dylib|dll|so|a|lib)$/i;
const SKIP_PREFIXES = [
	'third-party/sources/',
	'packages/libheif-js/libheif-wasm/',
	'node_modules/'
];
// Generic placeholder usernames used by synthetic fixtures are allowed.
const MACHINE_PATH =
	/(^|[^A-Za-z0-9])\/Users\/(?!(?:user|example|alice|bob|jane|john|tester?)\/)[A-Za-z0-9._-]+\/|[A-Za-z]:\\Users\\(?!(?:user|example|alice|bob|jane|john|tester?)\\)[A-Za-z0-9._-]+\\/i;
const SELF = 'src/tests/no-machine-paths.static.test.ts';

describe('committed files contain no machine-specific home paths', () => {
	it('scans every tracked and untracked (non-ignored) text file', () => {
		const list = (...args: string[]) =>
			execFileSync('git', ['ls-files', ...args], { cwd: process.cwd(), encoding: 'utf8' })
				.split('\n')
				.filter(Boolean);
		const files = Array.from(new Set([...list(), ...list('--others', '--exclude-standard')]))
			.filter((file) => !SKIP_PREFIXES.some((prefix) => file.startsWith(prefix)))
			.filter((file) => !BINARY_EXTENSIONS.test(file))
			.filter((file) => file !== SELF);
		expect(files.length).toBeGreaterThan(100);

		const offenders: string[] = [];
		for (const file of files) {
			let text: string;
			try {
				text = readFileSync(file, 'utf8');
			} catch {
				continue;
			}
			if (text.includes('\u0000')) continue;
			const match = text.match(MACHINE_PATH);
			if (match) offenders.push(`${file}: ${match[0].trim()}`);
		}
		expect(offenders).toEqual([]);
	});
});
