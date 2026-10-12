import { describe, expect, it } from 'vitest';

import { parseAliasesInput } from './aliases.js';

describe('parseAliasesInput', () => {
	it('normalises semicolon, comma, and newline separators into unique aliases', () => {
		expect(
			parseAliasesInput('site install; crane hire, structural steel\nsite install\n  coating ')
		).toEqual(['site install', 'crane hire', 'structural steel', 'coating']);
	});

	it('drops blank entries and collapses repeated whitespace', () => {
		expect(parseAliasesInput('  mild   steel  ; ; plate   10mm  ,\n')).toEqual([
			'mild steel',
			'plate 10mm'
		]);
	});
});
