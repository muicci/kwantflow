// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createContext, Script } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
type Property = { name: string; startBlock: number; sizeBlock: number };
type FixtureReader = {
	parse(): void;
	propertyStart: number;
	bigBlockSize: number;
	bigBlockTable: number[];
	propertyData: Property[];
	getNextBlock(index: number): number;
};
const Reader = (
	require('@kenjiuno/msgreader/lib/Reader.js') as {
		Reader: new (bytes: DataView) => FixtureReader;
	}
).Reader;
const MsgReader = (
	require('@kenjiuno/msgreader') as {
		default: new (bytes: DataView) => { getFileData(): { subject?: string } };
	}
).default;
type InputStream = {
	byteLength: number;
	position: number;
	readUint16Array(length: number): Uint16Array;
	readUint32Array(length: number): Uint32Array;
};
const DataStream = (
	require('@kenjiuno/msgreader/lib/DataStream.js') as { default: { prototype: InputStream } }
).default;

function fixture() {
	const bytes = Buffer.from(
		readFileSync('tests/fixtures/email/msgreader-test1.msg.base64', 'utf8').replace(/\s+/g, ''),
		'base64'
	);
	// Discover offsets from a known valid public fixture before any mutation.
	const reader = new Reader(new DataView(Uint8Array.from(bytes).buffer));
	reader.parse();
	const directorySectors: number[] = [];
	for (let sector = reader.propertyStart; sector !== -2; sector = reader.getNextBlock(sector)) {
		if (directorySectors.includes(sector)) throw new Error('Invalid public fixture chain.');
		directorySectors.push(sector);
	}
	const directoryOffset = (index: number) =>
		(directorySectors[Math.floor(index / 4)] + 1) * reader.bigBlockSize + (index % 4) * 128;
	const miniOffset = (property: Property) => {
		const relative = property.startBlock * 64;
		return (
			(reader.bigBlockTable[Math.floor(relative / reader.bigBlockSize)] + 1) * reader.bigBlockSize +
			(relative % reader.bigBlockSize)
		);
	};
	return { bytes, reader, directoryOffset, miniOffset };
}

function parseInChild(bytes: Buffer) {
	const moduleUrl = pathToFileURL(resolve('src/lib/services/email-content.ts')).href;
	// A timeout isolates regressions in the actual application parser without
	// allowing an unpatched dependency loop to hang the test runner.
	return spawnSync(
		process.execPath,
		[
			'--max-old-space-size=96',
			'--import',
			'tsx',
			'--input-type=module',
			'-e',
			`import {readFileSync} from 'node:fs';
			 const {parseEmailFileBytes}=await import(${JSON.stringify(moduleUrl)});
			 try { const parsed=await parseEmailFileBytes(Buffer.from(readFileSync(0,'utf8'),'base64'),'synthetic.msg');
			 console.log(JSON.stringify({subject:parsed.subject})); }
			 catch (error) {console.log(JSON.stringify({error:String(error)}));}`
		],
		{ input: bytes.toString('base64'), encoding: 'utf8', timeout: 2000 }
	);
}

describe('offline MSG malformed input', () => {
	it.each([
		[
			'directory sector self-cycle',
			(f: ReturnType<typeof fixture>) => f.bytes.writeInt32LE(1, 516)
		],
		[
			'directory sector pair-cycle',
			(f: ReturnType<typeof fixture>) => f.bytes.writeInt32LE(1, 528)
		],
		['root mini-stream cycle', (f: ReturnType<typeof fixture>) => f.bytes.writeInt32LE(3, 524)],
		['mini-FAT cycle', (f: ReturnType<typeof fixture>) => f.bytes.writeInt32LE(2, 520)],
		['mini-stream cycle', (f: ReturnType<typeof fixture>) => f.bytes.writeInt32LE(15, 1596)],
		[
			'storage hierarchy cycle',
			(f: ReturnType<typeof fixture>) => f.bytes.writeInt32LE(1, f.directoryOffset(1) + 76)
		],
		[
			'sibling hierarchy cycle',
			(f: ReturnType<typeof fixture>) => f.bytes.writeInt32LE(21, f.directoryOffset(21) + 72)
		],
		[
			'large stream sector cycle',
			(f: ReturnType<typeof fixture>) => {
				f.bytes.writeInt32LE(4608, f.directoryOffset(16) + 120);
				f.bytes.writeInt32LE(15, 572);
			}
		]
	])('rejects %s through the application parser without hanging', (_name, mutate) => {
		const input = fixture();
		mutate(input);
		const result = parseInChild(input.bytes);
		expect(result.error).toBeUndefined();
		expect(result.status).toBe(0);
		expect(JSON.parse(result.stdout.trim())).toEqual({ error: expect.stringMatching(/cyclic/i) });
	});

	it('rejects a DIFAT cycle even when its finite declared count could hide the cycle', () => {
		const input = fixture();
		const bytes = Buffer.alloc(112 * 512);
		input.bytes.copy(bytes);
		bytes.writeInt32LE(110, 44);
		bytes.fill(0, 76, 512);
		bytes.writeInt32LE(110, 68);
		bytes.writeInt32LE(2, 72);
		bytes.fill(255, 111 * 512, 112 * 512);
		bytes.writeInt32LE(0, 111 * 512);
		bytes.writeInt32LE(110, 112 * 512 - 4);
		const result = parseInChild(bytes);
		expect(result.error).toBeUndefined();
		expect(result.status).toBe(0);
		expect(JSON.parse(result.stdout.trim())).toEqual({
			error: expect.stringMatching(/cyclic.*DIFAT/i)
		});
	});

	it.each([
		[
			'oversized stream',
			(f: ReturnType<typeof fixture>) =>
				f.bytes.writeUInt32LE(0x7fffffff, f.directoryOffset(16) + 120)
		],
		[
			'negative stream',
			(f: ReturnType<typeof fixture>) => f.bytes.writeInt32LE(-1, f.directoryOffset(16) + 120)
		],
		['out-of-file sector', (f: ReturnType<typeof fixture>) => f.bytes.writeInt32LE(5000, 48)],
		['invalid sector size', (f: ReturnType<typeof fixture>) => f.bytes.writeUInt16LE(0, 30)],
		[
			'oversized allocation table',
			(f: ReturnType<typeof fixture>) => f.bytes.writeInt32LE(0x7fffffff, 44)
		],
		[
			'oversized directory name',
			(f: ReturnType<typeof fixture>) => f.bytes.writeUInt16LE(65534, f.directoryOffset(16) + 64)
		]
	])('rejects %s before unbounded work or allocation', (_name, mutate) => {
		const input = fixture();
		mutate(input);
		const result = parseInChild(input.bytes);
		expect(result.error).toBeUndefined();
		expect(result.status).toBe(0);
		expect(JSON.parse(result.stdout.trim())).toEqual({
			error: expect.stringMatching(/Invalid MSG/)
		});
	});

	it('checks a named-property string length before requesting an oversized typed array', () => {
		const input = fixture();
		const table = input.reader.propertyData.find((p) => p.name === '__substg1.0_00040102')!;
		input.bytes.writeUInt32LE(0xfffffff0, input.miniOffset(table));
		const original = DataStream.prototype.readUint16Array;
		const attempts: number[] = [];
		const spy = vi.spyOn(DataStream.prototype, 'readUint16Array').mockImplementation(function (
			this: InputStream,
			length: number
		) {
			if (length * 2 > this.byteLength - this.position) {
				attempts.push(length * 2);
				throw new Error('Synthetic oversized allocation intercepted.');
			}
			return original.call(this, length);
		});
		try {
			expect(() =>
				new MsgReader(new DataView(Uint8Array.from(input.bytes).buffer)).getFileData()
			).toThrow(/Invalid MSG named property string size/);
			expect(attempts).toEqual([]);
		} finally {
			spy.mockRestore();
		}
	});

	it.each(['deleted', 'modified'] as const)(
		'checks the %s recurrence count before requesting an oversized array',
		(kind) => {
			const input = fixture();
			const guid = input.reader.propertyData.find((p) => p.name === '__substg1.0_00020102')!;
			const entry = input.reader.propertyData.find((p) => p.name === '__substg1.0_00030102')!;
			const fieldIndex = input.reader.propertyData.findIndex(
				(p) => p.name === '__substg1.0_8000001F'
			);
			const field = input.reader.propertyData[fieldIndex];
			const offset = input.miniOffset(field);
			input.bytes.writeUInt32LE(0x00062002, input.miniOffset(guid));
			input.bytes.writeUInt32LE(0x00008216, input.miniOffset(entry));
			input.bytes.write('__substg1.0_80000102\0', input.directoryOffset(fieldIndex), 'utf16le');
			input.bytes.fill(0, offset, offset + field.sizeBlock);
			input.bytes.writeUInt16LE(0x3004, offset);
			input.bytes.writeUInt16LE(0x3004, offset + 2);
			input.bytes.writeUInt32LE(0x40000000, offset + (kind === 'deleted' ? 34 : 38));
			const original = DataStream.prototype.readUint32Array;
			const attempts: number[] = [];
			const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
			const spy = vi.spyOn(DataStream.prototype, 'readUint32Array').mockImplementation(function (
				this: InputStream,
				length: number
			) {
				if (length * 4 > this.byteLength - this.position) {
					attempts.push(length * 4);
					throw new Error('Synthetic oversized allocation intercepted.');
				}
				return original.call(this, length);
			});
			try {
				const parsed = new MsgReader(
					new DataView(Uint8Array.from(input.bytes).buffer)
				).getFileData();
				expect(parsed.subject).toBe('title');
				expect(attempts).toEqual([]);
			} finally {
				spy.mockRestore();
				debug.mockRestore();
			}
		}
	);

	it.each([0, 7, 512])('rejects a truncated %i-byte MSG without hanging', (size) => {
		const result = parseInChild(fixture().bytes.subarray(0, size));
		expect(result.error).toBeUndefined();
		expect(result.status).toBe(0);
		expect(JSON.parse(result.stdout.trim())).toEqual({ error: expect.any(String) });
	});
});

describe('offline EML without dynamic code execution', () => {
	it('runs the actual GBK helper and parser while string code generation is disabled', () => {
		const packagePath = require.resolve('eml-parse-js');
		const module = { exports: {} };
		const context = createContext(
			{
				module,
				exports: module.exports,
				require: createRequire(packagePath),
				TextEncoder,
				TextDecoder
			},
			{ codeGeneration: { strings: false, wasm: false } }
		);
		new Script(readFileSync(packagePath, 'utf8'), { filename: packagePath }).runInContext(context);
		const parser = module.exports as {
			GBKUTF8: { GB2312ToUTF8(value: string): string };
			readEml(value: string): { text: string };
		};
		expect(parser.GBKUTF8.GB2312ToUTF8('材料')).toBe('%E6%9D%90%E6%96%99');
		expect(parser.readEml('Content-Type: text/plain\r\n\r\nPlease quote.').text).toBe(
			'Please quote.'
		);
	});
});
