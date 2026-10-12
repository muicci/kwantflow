import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const PROJECT_ROOT = process.cwd();
const DESKTOP_SURFACE_ROOTS = [
	path.join(PROJECT_ROOT, 'src/lib/components'),
	path.join(PROJECT_ROOT, 'src/lib/state'),
	path.join(PROJECT_ROOT, 'src/lib/services'),
	path.join(PROJECT_ROOT, 'src/routes')
];
const ALLOWED_PROVIDER_LITERAL_FILES = new Set([
	path.join(PROJECT_ROOT, 'src/lib/schemas/index.ts')
]);
const PROVIDER_LITERALS = ['gemini', '@google/genai', 'GoogleGenAI', 'gemini-'];

function walkFiles(root: string): string[] {
	const entries = readdirSync(root, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const nextPath = path.join(root, entry.name);
		if (entry.isDirectory()) {
			files.push(...walkFiles(nextPath));
			continue;
		}
		if (!entry.isFile()) continue;
		if (entry.name.endsWith('.test.ts')) continue;
		files.push(nextPath);
	}
	return files;
}

describe('desktop provider surface guard', () => {
	it('keeps provider-specific literals out of desktop-facing code paths', () => {
		const violations: string[] = [];

		for (const root of DESKTOP_SURFACE_ROOTS) {
			for (const filePath of walkFiles(root)) {
				if (ALLOWED_PROVIDER_LITERAL_FILES.has(filePath)) continue;
				const source = readFileSync(filePath, 'utf8');
				for (const literal of PROVIDER_LITERALS) {
					if (!source.includes(literal)) continue;
					violations.push(`${path.relative(PROJECT_ROOT, filePath)} contains "${literal}"`);
				}
			}
		}

		expect(violations).toEqual([]);
	});
});
