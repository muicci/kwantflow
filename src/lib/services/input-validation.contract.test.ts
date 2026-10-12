import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const rootDir = path.resolve(import.meta.dirname, '../../..');

function collectFiles(
	dir: string,
	matches: (filePath: string) => boolean,
	acc: string[] = []
): string[] {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.name.startsWith('.')) continue;
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			collectFiles(fullPath, matches, acc);
			continue;
		}
		if (matches(fullPath)) {
			acc.push(fullPath);
		}
	}
	return acc;
}

describe('input validation contract', () => {
	it('keeps direct zod email validators isolated to the shared validation module', () => {
		const files = collectFiles(
			path.join(rootDir, 'src'),
			(filePath) => filePath.endsWith('.ts') || filePath.endsWith('.svelte')
		);
		const offenders = files.filter((filePath) => {
			if (filePath.endsWith(path.join('services', 'input-validation.ts'))) return false;
			if (filePath.endsWith(path.join('services', 'input-validation.contract.test.ts')))
				return false;
			return fs.readFileSync(filePath, 'utf8').includes('.email(');
		});

		expect(offenders).toEqual([]);
	});

	it('keeps the generic phone pattern behind the shared validation contract', () => {
		const files = collectFiles(
			path.join(rootDir, 'src'),
			(filePath) => filePath.endsWith('.ts') || filePath.endsWith('.svelte')
		);
		const offenders = files.filter((filePath) => {
			if (filePath.endsWith(path.join('services', 'input-validation.ts'))) return false;
			if (filePath.endsWith(path.join('schemas', 'index.ts'))) return false;
			if (filePath.endsWith(path.join('services', 'input-validation.contract.test.ts')))
				return false;
			return fs.readFileSync(filePath, 'utf8').includes('GENERIC_PHONE_PATTERN');
		});

		expect(offenders).toEqual([]);
	});
});
