import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// Use the exact outline parser already required by mtext-renderer. The output is
// an OFL derivative of Liberation Sans, renamed to avoid its reserved name.
const require = createRequire(import.meta.url);
const rendererRequire = createRequire(require.resolve('@mlightcad/mtext-renderer'));
const opentype = rendererRequire('opentype.js');
const root = join(dirname(new URL(import.meta.url).pathname), '..');
const bytes = readFileSync(join(root, 'static/cad-data/fonts/LiberationSans-Regular.ttf'));
const font = opentype.parse(
	bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
);
type Point = { x: number; y: number };
type Command = Point & { type: string; x1: number; y1: number; x2: number; y2: number };

function encode(contours: Point[][], advance: number): number[] {
	const output: number[] = [];
	let cursor = { x: 0, y: 0 };
	const move = (point: Point) => {
		const target = { x: Math.round(point.x), y: Math.round(point.y) };
		while (cursor.x !== target.x || cursor.y !== target.y) {
			const dx = Math.max(-127, Math.min(127, target.x - cursor.x));
			const dy = Math.max(-127, Math.min(127, target.y - cursor.y));
			output.push(8, dx & 255, dy & 255);
			cursor = { x: cursor.x + dx, y: cursor.y + dy };
		}
	};
	for (const contour of contours) {
		if (contour.length < 2) continue;
		output.push(2);
		move(contour[0]);
		output.push(1);
		for (const point of contour.slice(1)) move(point);
	}
	output.push(2);
	move({ x: advance, y: 0 });
	output.push(0);
	return output;
}

function outline(code: number): number[] {
	const glyph = font.charToGlyph(String.fromCodePoint(code));
	const commands: Command[] = glyph.getPath(0, 0, 100).commands;
	const contours: Point[][] = [];
	let points: Point[] = [];
	let current = { x: 0, y: 0 };
	let start = current;
	for (const command of commands) {
		const end = { x: command.x, y: -command.y };
		if (command.type === 'M') {
			if (points.length) contours.push(points);
			points = [end];
			start = end;
		} else if (command.type === 'L') points.push(end);
		else if (command.type === 'Q' || command.type === 'C') {
			// Fixed eight-segment curves keep the generated SHX deterministic.
			for (let step = 1; step <= 8; step++) {
				const t = step / 8;
				const u = 1 - t;
				const control = { x: command.x1, y: -command.y1 };
				points.push(
					command.type === 'Q'
						? {
								x: u * u * current.x + 2 * u * t * control.x + t * t * end.x,
								y: u * u * current.y + 2 * u * t * control.y + t * t * end.y
							}
						: {
								x:
									u ** 3 * current.x +
									3 * u * u * t * control.x +
									3 * u * t * t * command.x2 +
									t ** 3 * end.x,
								y:
									u ** 3 * current.y +
									3 * u * u * t * control.y -
									3 * u * t * t * command.y2 +
									t ** 3 * end.y
							}
				);
			}
		} else if (command.type === 'Z') points.push(start);
		current = command.type === 'Z' ? start : end;
	}
	if (points.length) contours.push(points);
	return encode(contours, Math.round((glyph.advanceWidth * 100) / font.unitsPerEm));
}

const circle = (cx: number, cy: number, radius: number): Point[] =>
	Array.from({ length: 33 }, (_, index) => ({
		x: cx + radius * Math.cos((index * Math.PI) / 16),
		y: cy + radius * Math.sin((index * Math.PI) / 16)
	}));
const degree = encode([circle(20, 60, 12)], 42);
const diameter = encode(
	[
		circle(35, 35, 30),
		[
			{ x: 5, y: 0 },
			{ x: 65, y: 70 }
		]
	],
	75
);
const plusMinus = encode(
	[
		[
			{ x: 10, y: 45 },
			{ x: 60, y: 45 }
		],
		[
			{ x: 35, y: 20 },
			{ x: 35, y: 70 }
		],
		[
			{ x: 10, y: 5 },
			{ x: 60, y: 5 }
		]
	],
	75
);

const shapes = new Map<number, number[]>([
	[0, [...Buffer.from('Kwantflow Open CAD Outline\0'), 80, 20, 0, 0]]
]);
for (const [first, last] of [
	[32, 125],
	[127, 0x52f],
	[0x2000, 0x23ff],
	[0x2500, 0x25ff]
]) {
	for (let code = first; code <= last; code++) {
		if (font.charToGlyphIndex(String.fromCodePoint(code))) shapes.set(code, [0, ...outline(code)]);
	}
}
// mtext-renderer 0.12.4 resolves %%c, %%d and %%p through these legacy SHX slots.
for (const code of [126, 176]) shapes.set(code, [0, ...degree]);
for (const code of [129, 8709]) shapes.set(code, [0, ...diameter]);
shapes.set(177, [0, ...plusMinus]);
function writeFont(file: string, glyphs: Map<number, number[]>) {
	const header = Buffer.from('AutoCAD-86 shapes 1.0\r\n\x1a', 'binary');
	const table = Buffer.alloc(6 + glyphs.size * 4);
	table.writeUInt16LE(Math.min(...glyphs.keys()), 0);
	table.writeUInt16LE(Math.max(...glyphs.keys()), 2);
	table.writeUInt16LE(glyphs.size, 4);
	let index = 6;
	const data: Buffer[] = [];
	for (const [code, shape] of glyphs) {
		if (shape.length > 65535) throw new Error(`SHX glyph ${code} exceeds format limit`);
		table.writeUInt16LE(code, index);
		table.writeUInt16LE(shape.length, index + 2);
		index += 4;
		data.push(Buffer.from(shape));
	}
	writeFileSync(join(root, 'static/cad-data/fonts', file), Buffer.concat([header, table, ...data]));
	console.log(`Built ${file} with ${glyphs.size - 1} glyphs.`);
}
writeFont('KwantflowOpenCad.shx', shapes);

// Original geometry implementing the documented GDT character slots, not
// extracted Autodesk outlines. Keep GDT separate from normal Latin letters.
// https://help.autodesk.com/cloudhelp/2018/ENU/OARXMAC-RefGuide/files/OREFMAC-AcDbFcf__setText_ACHAR__.html
const line = (...coordinates: number[]): Point[] =>
	Array.from({ length: coordinates.length / 2 }, (_, i) => ({
		x: coordinates[i * 2],
		y: coordinates[i * 2 + 1]
	}));
const arc = Array.from({ length: 17 }, (_, i) => ({
	x: 35 + 30 * Math.cos((i * Math.PI) / 16),
	y: 20 + 30 * Math.sin((i * Math.PI) / 16)
}));
const arrow = [line(15, 5, 55, 65), line(35, 60, 55, 65, 57, 44)];
const gdtGeometry: Record<string, Point[][]> = {
	a: [line(60, 5, 10, 5, 45, 65)],
	b: [line(5, 5, 65, 5), line(35, 5, 35, 65)],
	c: [line(5, 15, 55, 15, 70, 55, 20, 55, 5, 15)],
	d: [[...arc, { x: 65, y: 20 }]],
	e: [circle(35, 35, 30)],
	f: [line(10, 5, 35, 65), line(40, 5, 65, 65)],
	g: [circle(35, 35, 22), line(0, 5, 20, 65), line(50, 5, 70, 65)],
	h: arrow,
	i: [line(5, 15, 65, 15), line(5, 35, 65, 35), line(5, 55, 65, 55)],
	j: [circle(35, 35, 25), line(0, 35, 70, 35), line(35, 0, 35, 70)],
	k: [arc],
	l: [circle(35, 35, 32), line(25, 52, 25, 18, 50, 18)],
	m: [circle(35, 35, 32), line(20, 18, 20, 52, 35, 35, 50, 52, 50, 18)],
	p: [circle(35, 35, 32), line(25, 18, 25, 52, 45, 52, 50, 47, 50, 39, 45, 35, 25, 35)],
	r: [circle(35, 35, 30), circle(35, 35, 15)],
	s: [
		circle(35, 35, 32),
		line(50, 48, 45, 52, 25, 52, 20, 47, 20, 39, 45, 32, 50, 27, 50, 23, 45, 18, 25, 18, 20, 23)
	],
	t: [
		...arrow,
		...arrow.map((contour) => contour.map((point) => ({ x: point.x + 20, y: point.y })))
	],
	u: [line(5, 35, 65, 35)]
};
const gdt = new Map(shapes);
gdt.set(0, [...Buffer.from('Kwantflow Open GDT\0'), 80, 20, 0, 0]);
for (const [character, geometry] of Object.entries(gdtGeometry))
	gdt.set(character.charCodeAt(0), [0, ...encode(geometry, character === 't' ? 95 : 80)]);
gdt.set('n'.charCodeAt(0), [0, ...diameter]);
for (const [code, character] of [
	[0x2220, 'a'],
	[0x22a5, 'b'],
	[0x23e5, 'c'],
	[0x2313, 'd'],
	[0x25cb, 'e'],
	[0x2225, 'f'],
	[0x232d, 'g'],
	[0x2261, 'i'],
	[0x2316, 'j'],
	[0x2322, 'k'],
	[0x25ce, 'r'],
	[0x23e4, 'u']
] as const)
	gdt.set(code, gdt.get(character.charCodeAt(0))!);
writeFont('KwantflowOpenGdt.shx', gdt);
