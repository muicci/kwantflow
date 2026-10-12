// @vitest-environment node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyThirdParty } from './verify-third-party.js';

const require = createRequire(import.meta.url);
const rendererRequire = createRequire(require.resolve('@mlightcad/mtext-renderer'));
const opentype = rendererRequire('opentype.js');
const root = process.cwd();
const fontDir = join(root, 'static/cad-data/fonts');
const arrayBuffer = (path: string) => {
	const bytes = readFileSync(path);
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

describe('bundled open CAD assets', () => {
	it('keeps every font file covered by the pinned manifest and preserves legacy aliases', () => {
		const fonts = JSON.parse(readFileSync(join(fontDir, 'fonts.json'), 'utf8')) as {
			file: string;
			name: string[];
		}[];
		expect(readdirSync(fontDir).sort()).toEqual(
			['fonts.json', ...fonts.map((font) => font.file)].sort()
		);
		const aliases = new Set(fonts.flatMap((font) => font.name.map((name) => name.toLowerCase())));
		for (const name of [
			'arial',
			'verdana',
			'tahoma',
			'romans',
			'simplex',
			'amgdt',
			'simsun',
			'simhei',
			'msyh',
			'gbcbig',
			'bigfont'
		]) {
			expect(aliases.has(name), name).toBe(true);
		}
	});

	it('provides real Latin and multilingual CJK outlines from the bundled open fonts', () => {
		const latin = opentype.parse(arrayBuffer(join(fontDir, 'LiberationSans-Regular.ttf')));
		const cjk = opentype.parse(arrayBuffer(join(fontDir, 'NotoSansCJKsc-Regular.otf')));
		for (const character of 'Fabrication 123.45 ±°') {
			if (character !== ' ')
				expect(latin.charToGlyphIndex(character), character).toBeGreaterThan(0);
		}
		for (const character of '中文日本語한국어') {
			expect(cjk.charToGlyphIndex(character), character).toBeGreaterThan(0);
			expect(
				cjk.charToGlyph(character).getPath(0, 0, 100).commands.length,
				character
			).toBeGreaterThan(0);
		}
	});

	it('parses SHX Latin and AutoCAD dimension control slots into finite visible geometry', async () => {
		const modulePath = join(
			dirname(rendererRequire.resolve('@mlightcad/shx-parser')),
			'index.es.js'
		);
		const { ShxFont } = await import(/* @vite-ignore */ modulePath);
		const font = new ShxFont(arrayBuffer(join(fontDir, 'KwantflowOpenCad.shx')));
		for (const code of [65, 90, 97, 122, 48, 57, 126, 129, 176, 177, 8709]) {
			const shape = font.getCharShape(code, 12);
			expect(shape, String(code)).not.toBeNull();
			expect(shape.polylines.length, String(code)).toBeGreaterThan(0);
			for (const line of shape.polylines)
				for (const point of line) {
					expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
				}
		}
		expect(font.getCharShape(129, 12).polylines).toHaveLength(2);
		expect(font.getCharShape(177, 12).polylines).toHaveLength(3);
		font.release();
	});

	it('keeps documented GDT letter slots separate from ordinary Latin characters', async () => {
		const modulePath = join(
			dirname(rendererRequire.resolve('@mlightcad/shx-parser')),
			'index.es.js'
		);
		const { ShxFont } = await import(/* @vite-ignore */ modulePath);
		const font = new ShxFont(arrayBuffer(join(fontDir, 'KwantflowOpenGdt.shx')));
		for (const character of 'abcdefghijklmnprstu') {
			expect(
				font.getCharShape(character.charCodeAt(0), 12)?.polylines.length,
				character
			).toBeGreaterThan(0);
		}
		// Perpendicularity, position and concentricity have distinct original geometry.
		expect(font.getCharShape('b'.charCodeAt(0), 12).polylines).toHaveLength(2);
		expect(font.getCharShape('j'.charCodeAt(0), 12).polylines).toHaveLength(3);
		expect(font.getCharShape('r'.charCodeAt(0), 12).polylines).toHaveLength(2);
		for (const code of [0x22a5, 0x23e5, 0x232d, 0x2316, 0x23e4]) {
			expect(font.getCharShape(code, 12)?.polylines.length).toBeGreaterThan(0);
		}
		font.release();
	});

	it('verifies actual source, font, notice and coherent worker hashes', () => {
		const { errors } = verifyThirdParty(root);
		if (existsSync(join(root, 'third-party/sources'))) {
			expect(errors).toEqual([]);
			return;
		}
		// Without `pnpm third-party:sources:prepare` (about 1 GB of pinned upstream archives) only
		// those archives and the notices inside them are absent. Everything else must still verify;
		// `pnpm third-party:verify` after preparing sources is the full release gate.
		const unexpected = errors.filter(
			(error) => !error.startsWith('Missing compliance file: third-party/sources/')
		);
		expect(unexpected).toEqual([]);
	});
});
