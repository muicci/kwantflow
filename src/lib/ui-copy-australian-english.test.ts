import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { globSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// User-visible copy uses Australian English. This scans text nodes and labelling attributes in
// every Svelte component plus the thrown/user-facing strings in services and state.
const files = [
	...globSync('src/**/*.svelte', { cwd: process.cwd() }),
	...globSync('src/lib/{services,state}/**/*.ts', { cwd: process.cwd() })
].filter((file) => !/\.(test|stories)\./.test(file) && !file.includes('/generated/'));

const bannedWords: RegExp[] = [
	/\blabor\b/i,
	/\bcatalog\b/i,
	/\bwork center\b/i,
	/\blicense\b/i,
	/\blicenses\b/i,
	/\banalyz(e|ing|ed)\b/i,
	/\binitializ(e|ing|ed)\b/i,
	/\borganiz(e|ing|ed|ation)\b/i,
	/\bcolor\b/,
	/\bcenter point\b/i,
	/\bfavorite\b/i
];

const visibleText = (source: string, isSvelte: boolean): string[] => {
	const nodes = isSvelte ? Array.from(source.matchAll(/>([^<>{}]+)</g), (match) => match[1]) : [];
	const attributes = Array.from(
		source.matchAll(/\b(?:label|title|placeholder|aria-label|description|alt)=["']([^"'{}]+)["']/g),
		(match) => match[1]
	);
	const strings = Array.from(
		source.matchAll(/(?:toast\.\w+|new Error|catchError|errorState\.\w+)\(\s*[`'"]([^`'"]+)[`'"]/g),
		(match) => match[1]
	);
	return [...nodes, ...attributes, ...strings].map((text) => text.trim()).filter(Boolean);
};

describe('Australian English UI copy', () => {
	it('scans a meaningful number of components', () => {
		expect(files.length).toBeGreaterThan(100);
	});

	it('does not leave US spellings on user-facing surfaces', () => {
		const offenders: string[] = [];
		for (const relativePath of files) {
			const source = readFileSync(join(process.cwd(), relativePath), 'utf8');
			for (const text of visibleText(source, relativePath.endsWith('.svelte'))) {
				for (const pattern of bannedWords) {
					if (pattern.test(text)) offenders.push(`${relativePath}: "${text}" (${pattern})`);
				}
			}
		}
		expect(offenders).toEqual([]);
	});
});
