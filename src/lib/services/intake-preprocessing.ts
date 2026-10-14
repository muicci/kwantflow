import { readFile, writeFile, mkdir } from '@tauri-apps/plugin-fs';
import { appLocalDataDir, join } from '@tauri-apps/api/path';
import JSZip from 'jszip';
import { createLogger } from './logger.js';
import { isTauri } from '../utils/env.js';

const MAX_ZIP_FILES = 500;
const MAX_ZIP_TOTAL_BYTES = 500 * 1024 * 1024;
const ZIP_SAFE_EXTENSIONS = new Set(['zip']);
const INTAKE_TEMP_DIR = 'intake-temp';

const log = createLogger('intakePreprocessing');

export interface ExtractedZipEntry {
	name: string;
	bytes: Uint8Array;
	byteSize: number;
}

export interface ZipExtractionResult {
	entries: ExtractedZipEntry[];
	totalFiles: number;
	totalBytes: number;
	truncated: boolean;
	truncatedReason?: string;
}

// ── HEIC / HEIF conversion ──────────────────────────────────────────

type HeifRuntime = Awaited<
	ReturnType<(typeof import('libheif-js/libheif-wasm/libheif-bundle.mjs'))['default']>
>;
let heifRuntimePromise: Promise<HeifRuntime> | undefined;

export async function convertHeicToJpeg(heicBytes: Uint8Array): Promise<Uint8Array> {
	// The pinned libheif bundle includes its decoder WASM and never fetches code
	// or sends image bytes to a server. Defer the sizeable decoder until needed.
	heifRuntimePromise ??= import('libheif-js/libheif-wasm/libheif-bundle.mjs').then(
		({ default: createLibheif }) => createLibheif()
	);
	const libheif = await heifRuntimePromise;
	const decoder = new libheif.HeifDecoder();
	let images: ReturnType<typeof decoder.decode> = [];
	try {
		images = decoder.decode(heicBytes);
		const image = images[0];
		if (!image) throw new Error('HEIC file contains no decodable image.');
		const canvas = document.createElement('canvas');
		canvas.width = image.get_width();
		canvas.height = image.get_height();
		const context = canvas.getContext('2d');
		if (!context) throw new Error('HEIC conversion requires a canvas context.');
		const pixels = context.createImageData(canvas.width, canvas.height);
		await new Promise<void>((resolve, reject) => {
			image.display(pixels, (displayed) => {
				if (displayed) resolve();
				else reject(new Error('HEIC image decoding failed.'));
			});
		});
		context.putImageData(pixels, 0, 0);
		const jpeg = await new Promise<Blob>((resolve, reject) => {
			canvas.toBlob(
				(blob) => {
					if (blob) resolve(blob);
					else reject(new Error('HEIC image could not be encoded as JPEG.'));
				},
				'image/jpeg',
				0.92
			);
		});
		return new Uint8Array(await jpeg.arrayBuffer());
	} finally {
		for (const decoded of images) decoded.free();
		// libheif's JS adapter releases image handles, but its decoder retains the
		// context until decode is called again. Each import owns a fresh decoder.
		if (decoder.decoder) {
			libheif.heif_context_free(decoder.decoder);
			decoder.decoder = null;
		}
	}
}

export function isHeicFile(filePath: string): boolean {
	const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
	return ext === 'heic' || ext === 'heif';
}

// ── Temp file staging ──────────────────────────────────────────────

let tempDirReady = false;

async function ensureIntakeTempDir(): Promise<string> {
	const baseDir = await appLocalDataDir();
	const tempDir = await join(baseDir, INTAKE_TEMP_DIR);
	if (!tempDirReady) {
		try {
			await mkdir(tempDir, { recursive: true });
		} catch {
			// Directory may already exist
		}
		tempDirReady = true;
	}
	return tempDir;
}

export async function writeIntakeTempFile(fileName: string, bytes: Uint8Array): Promise<string> {
	const tempDir = await ensureIntakeTempDir();
	const safeName = fileName.replace(/[/\\:]/g, '_');
	const uniqueName = `${Date.now()}-${safeName}`;
	const filePath = await join(tempDir, uniqueName);
	await writeFile(filePath, bytes);
	return filePath;
}

// ── Intake preprocessing ───────────────────────────────────────────

/**
 * Preprocess a staged intake file before vault ingestion.
 * Returns an array of { path, fileName } entries to replace the original staged file.
 */
export async function preprocessIntakeFiles(
	files: Array<{ path: string; name?: string | null }>
): Promise<Array<{ path: string; name: string | null }>> {
	if (!isTauri() || files.length === 0) {
		return files.map((f) => ({ path: f.path, name: f.name ?? null }));
	}

	const results: Array<{ path: string; name: string | null }> = [];

	for (const file of files) {
		const fileName = file.path.split(/[/\\]/).pop() ?? file.path;
		const ext = fileName.split('.').pop()?.toLowerCase() ?? '';

		if (ext === 'heic' || ext === 'heif') {
			try {
				const bytes = await readFile(file.path);
				const jpegBytes = await convertHeicToJpeg(bytes);
				const jpegName = fileName.replace(/\.(heic|heif)$/i, '.jpg');
				const jpegPath = await writeIntakeTempFile(jpegName, jpegBytes);
				log.info(`HEIC → JPEG: ${fileName} (${bytes.byteLength} → ${jpegBytes.byteLength}B)`);
				results.push({ path: jpegPath, name: jpegName });
				continue;
			} catch (error) {
				log.error(`HEIC conversion failed: ${fileName}`, error);
				results.push({ path: file.path, name: file.name ?? null });
				continue;
			}
		}

		if (ext === 'zip') {
			try {
				const bytes = await readFile(file.path);
				const result = await extractZip(bytes, fileName);
				if (result.truncated) {
					log.warn(`ZIP truncated: ${fileName} — ${result.truncatedReason}`);
				}
				const entryPromises = result.entries.map(async (entry) => {
					return { path: await writeIntakeTempFile(entry.name, entry.bytes), name: entry.name };
				});
				results.push(...(await Promise.all(entryPromises)));
				log.info(`ZIP extracted: ${fileName} → ${result.entries.length} files`);
				continue;
			} catch (error) {
				log.error(`ZIP extraction failed: ${fileName}`, error);
				results.push({ path: file.path, name: file.name ?? null });
				continue;
			}
		}

		results.push({ path: file.path, name: file.name ?? null });
	}

	return results;
}

// ── ZIP extraction ──────────────────────────────────────────────────

export async function extractZip(
	zipBytes: Uint8Array,
	_archiveName: string
): Promise<ZipExtractionResult> {
	const zip = await JSZip.loadAsync(zipBytes);
	const entries: ExtractedZipEntry[] = [];
	let totalBytes = 0;
	let truncated = false;
	let truncatedReason: string | undefined;

	const fileEntries = Object.values(zip.files).filter((entry) => !entry.dir);

	if (fileEntries.length > MAX_ZIP_FILES) {
		truncated = true;
		truncatedReason = `Archive contains ${fileEntries.length} files (limit: ${MAX_ZIP_FILES})`;
	}

	for (const entry of fileEntries) {
		if (entries.length >= MAX_ZIP_FILES) break;

		// Skip nested archives (no recursion)
		const entryExt = entry.name.split('.').pop()?.toLowerCase() ?? '';
		if (ZIP_SAFE_EXTENSIONS.has(entryExt)) {
			log.info(`Skipping nested archive (.${entryExt}) inside an imported ZIP`);
			continue;
		}

		// Skip macOS metadata
		if (entry.name.startsWith('__MACOSX/') || entry.name.includes('/.DS_Store')) {
			continue;
		}

		try {
			const data = await entry.async('uint8array');
			totalBytes += data.byteLength;

			if (totalBytes > MAX_ZIP_TOTAL_BYTES) {
				truncated = true;
				truncatedReason = `Extracted size exceeds ${MAX_ZIP_TOTAL_BYTES / (1024 * 1024)}MB limit`;
				break;
			}

			entries.push({
				name: entry.name.split('/').pop() ?? entry.name,
				bytes: data,
				byteSize: data.byteLength
			});
		} catch (error) {
			log.warn('Failed to extract a ZIP entry', error);
		}
	}

	return { entries, totalFiles: fileEntries.length, totalBytes, truncated, truncatedReason };
}
