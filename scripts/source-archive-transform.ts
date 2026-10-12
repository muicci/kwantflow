import { readFile, writeFile } from 'node:fs/promises';
import { crc32, gunzipSync } from 'node:zlib';

const tarString = (bytes: Buffer) => bytes.toString('utf8').replace(/\0.*$/s, '');

/** Retain source tar members verbatim, excluding explicitly named unused fixtures. */
export async function transformSourceArchive(
	inputPath: string,
	outputPath: string,
	omittedPaths: string[]
): Promise<void> {
	const archive = gunzipSync(await readFile(inputPath));
	const omissions = new Set(omittedPaths);
	const remaining = new Set(omissions);
	if (remaining.size !== omittedPaths.length || !remaining.size)
		throw new Error('Source omissions must be a nonempty set of exact paths.');
	for (const path of remaining)
		if (path.startsWith('/') || path.split('/').includes('..'))
			throw new Error(`Unsafe source omission: ${path}`);
	const members: Buffer[] = [];
	let metadata: Buffer[] = [];
	let extendedName: string | undefined;
	let terminated = false;
	for (let offset = 0; offset + 512 <= archive.length;) {
		const header = archive.subarray(offset, offset + 512);
		if (header.every((byte) => byte === 0)) {
			members.push(archive.subarray(offset));
			terminated = true;
			break;
		}
		const size = Number.parseInt(tarString(header.subarray(124, 136)).trim(), 8);
		if (!Number.isSafeInteger(size) || size < 0) throw new Error('Invalid source tar member size.');
		const end = offset + 512 + Math.ceil(size / 512) * 512;
		if (end > archive.length) throw new Error('Truncated source tar member.');
		const member = archive.subarray(offset, end);
		const body = archive.subarray(offset + 512, offset + 512 + size);
		const kind = String.fromCharCode(header[156]);
		if (kind === 'x' || kind === 'L' || kind === 'K') {
			metadata.push(member);
			if (kind === 'L') extendedName = tarString(body);
			if (kind === 'x') {
				for (let index = 0; index < body.length;) {
					const space = body.indexOf(32, index);
					const length = Number.parseInt(body.subarray(index, space).toString(), 10);
					if (
						space < index ||
						!Number.isSafeInteger(length) ||
						length <= 0 ||
						index + length > body.length
					)
						throw new Error('Invalid source PAX metadata.');
					const record = body.subarray(space + 1, index + length - 1).toString('utf8');
					if (record.startsWith('path=')) extendedName = record.slice(5);
					index += length;
				}
			}
		} else {
			const prefix = tarString(header.subarray(345, 500));
			const shortName = tarString(header.subarray(0, 100));
			const name = extendedName ?? (prefix ? `${prefix}/${shortName}` : shortName);
			const relativeName = name.replace(/^\.\//, '').split('/').slice(1).join('/');
			const resourceForkTarget = relativeName.replace(/(^|\/)\._([^/]+)$/, '$1$2');
			if (kind !== 'g' && (omissions.has(relativeName) || omissions.has(resourceForkTarget))) {
				if (omissions.has(relativeName)) remaining.delete(relativeName);
			} else members.push(...metadata, member);
			metadata = [];
			extendedName = undefined;
		}
		offset = end;
	}
	if (!terminated || metadata.length) throw new Error('Unterminated source tar archive.');
	if (remaining.size) throw new Error(`Source omission not found: ${[...remaining].join(', ')}`);
	const filtered = Buffer.concat(members);
	// Fixed gzip header and stored DEFLATE blocks avoid compressor/OS variation.
	const chunks = [Buffer.from([31, 139, 8, 0, 0, 0, 0, 0, 0, 255])];
	for (let offset = 0; offset < filtered.length; offset += 65535) {
		const bytes = filtered.subarray(offset, offset + 65535);
		const block = Buffer.alloc(5);
		block[0] = offset + bytes.length === filtered.length ? 1 : 0;
		block.writeUInt16LE(bytes.length, 1);
		block.writeUInt16LE(bytes.length ^ 65535, 3);
		chunks.push(block, bytes);
	}
	const trailer = Buffer.alloc(8);
	trailer.writeUInt32LE(crc32(filtered), 0);
	trailer.writeUInt32LE(filtered.length >>> 0, 4);
	chunks.push(trailer);
	await writeFile(outputPath, Buffer.concat(chunks));
}
