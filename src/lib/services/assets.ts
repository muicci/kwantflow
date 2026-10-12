import {
	BaseDirectory,
	copyFile,
	exists,
	mkdir,
	readDir,
	readFile,
	readTextFile,
	remove,
	stat,
	writeFile,
	writeTextFile
} from '@tauri-apps/plugin-fs';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { isTauri } from '../utils/env';
import {
	ACCOUNT_ROOT,
	accountAvatarPath,
	BRAND_LOGO_EXTENSIONS,
	VAULT_ROOT,
	workspaceVaultRelativePath,
	workspaceVaultRootPath
} from '../constants/index.js';
import { allowExternalFileRead } from './external-file-access.js';
import { resolveLocalDocumentPath } from './local-documents.js';
import { createLogger } from './logger.js';
import { storeService } from './store.js';

const PREVIEW_CACHE_DIR = 'generated-previews';
const PREPARED_EVIDENCE_CACHE_DIR = 'ai-evidence';
export const AI_EVIDENCE_PREPARATION_VERSION = 'prepared-v1';
const EVIDENCE_CACHE_BASE_DIRECTORY = BaseDirectory.AppCache;
const DEFAULT_EVIDENCE_CACHE_BUDGET_BYTES = 512 * 1024 * 1024;
let lastEvidenceCachePruneAt = 0;
/** Extensions supported by the kwant-asset:// protocol for in-app image display. */
const SAFE_LOCAL_IMAGE_EXTENSIONS = new Set<string>([
	'png',
	'jpg',
	'jpeg',
	'svg',
	'webp',
	'gif',
	'bmp'
]);
const SAFE_BRAND_LOGO_EXTENSIONS = new Set<string>(BRAND_LOGO_EXTENSIONS);
const log = createLogger('assetsService');

export function isAbsoluteLocalPath(path: string): boolean {
	return /^(?:[a-zA-Z]:[\\/]|\/|\\\\|file:\/\/)/.test(path);
}

async function resolveReadableExternalPath(path: string): Promise<string> {
	const normalizedPath = path.replace(/^file:\/\//, '');
	return isAbsoluteLocalPath(path) ? allowExternalFileRead(normalizedPath) : normalizedPath;
}

function getPathExtension(path: string): string {
	return path.split('.').pop()?.toLowerCase() ?? '';
}

function assertSafeLocalImagePath(path: string): string {
	const extension = getPathExtension(path);
	if (!SAFE_LOCAL_IMAGE_EXTENSIONS.has(extension)) {
		throw new Error('Only PNG, JPEG, SVG, WEBP, GIF, or BMP local image previews are supported.');
	}

	return extension;
}

function assertSafeBrandLogoPath(path: string): string {
	const extension = getPathExtension(path);
	if (!SAFE_BRAND_LOGO_EXTENSIONS.has(extension)) {
		throw new Error('Workspace and company logos must be PNG, JPEG, or SVG files.');
	}

	return extension;
}

function encodeCacheSegment(value: string): string {
	return Array.from(new TextEncoder().encode(value), (byte) =>
		byte.toString(16).padStart(2, '0')
	).join('');
}

function shortStablePathHash(value: string): string {
	let hash = 0x811c9dc5;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(16).padStart(8, '0');
}

export function getGeneratedPreviewSourceKey(filePath: string): string {
	const encoded = encodeCacheSegment(filePath);
	if (encoded.length <= 96) return encoded;
	const extension = getPathExtension(filePath);
	const extensionSuffix = extension ? `-${extension}` : '';
	return `${shortStablePathHash(filePath)}-${encoded.slice(-48)}${extensionSuffix}`;
}

async function ensurePreviewCacheDir(): Promise<void> {
	if (!isTauri()) return;
	await mkdir(PREVIEW_CACHE_DIR, { baseDir: EVIDENCE_CACHE_BASE_DIRECTORY, recursive: true });
}

async function ensurePreparedEvidenceCacheDir(): Promise<void> {
	if (!isTauri()) return;
	await mkdir(PREPARED_EVIDENCE_CACHE_DIR, {
		baseDir: EVIDENCE_CACHE_BASE_DIRECTORY,
		recursive: true
	});
}

async function pruneEvidenceDiskCache(): Promise<void> {
	if (!isTauri() || Date.now() - lastEvidenceCachePruneAt < 60_000) return;
	lastEvidenceCachePruneAt = Date.now();
	let budget = DEFAULT_EVIDENCE_CACHE_BUDGET_BYTES;
	try {
		const nativeBudget = await invoke<number>('get_ai_evidence_cache_budget');
		if (Number.isFinite(nativeBudget) && nativeBudget >= 0) budget = nativeBudget;
	} catch (error) {
		log.warn('AI evidence cache disk budget inspection failed; using hard limit', error);
	}

	const files: Array<{ path: string; size: number; accessedAt: number }> = [];
	for (const directory of [PREVIEW_CACHE_DIR, PREPARED_EVIDENCE_CACHE_DIR]) {
		if (!(await exists(directory, { baseDir: EVIDENCE_CACHE_BASE_DIRECTORY }))) continue;
		for (const entry of await readDir(directory, { baseDir: EVIDENCE_CACHE_BASE_DIRECTORY })) {
			if (!entry.isFile) continue;
			const path = `${directory}/${entry.name}`;
			const info = await stat(path, { baseDir: EVIDENCE_CACHE_BASE_DIRECTORY });
			files.push({
				path,
				size: info.size,
				accessedAt: info.atime?.getTime() ?? info.mtime?.getTime() ?? 0
			});
		}
	}

	let total = files.reduce((sum, file) => sum + file.size, 0);
	for (const file of files.sort((a, b) => a.accessedAt - b.accessedAt)) {
		if (total <= budget) break;
		await remove(file.path, { baseDir: EVIDENCE_CACHE_BASE_DIRECTORY });
		total -= file.size;
	}
}

export async function hashFileBytes(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', bytes.slice());
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function getDerivedPreviewCachePath(
	filePath: string,
	sourceFingerprint: string,
	suffix: string
): string {
	return `${PREVIEW_CACHE_DIR}/${getGeneratedPreviewSourceKey(filePath)}__${sourceFingerprint}.${suffix}`;
}

export function getPreparedEvidenceCachePath(
	filePath: string,
	fileId: string,
	sourceFingerprint: string,
	suffix: string
): string {
	const workspaceId = filePath.match(/(?:^|\/)workspaces\/([^/]+)/)?.[1] ?? 'unknown-workspace';
	const safeSegment = (value: string) =>
		/^[a-zA-Z0-9_-]+$/.test(value) ? value : encodeCacheSegment(value);
	if (!/^[a-zA-Z0-9._-]+$/.test(suffix)) {
		throw new Error('Invalid prepared evidence cache suffix.');
	}
	return `${PREPARED_EVIDENCE_CACHE_DIR}/${safeSegment(workspaceId)}/${safeSegment(fileId)}/${safeSegment(sourceFingerprint)}/${AI_EVIDENCE_PREPARATION_VERSION}/${suffix}`;
}

export async function readDerivedPreviewCacheText(path: string): Promise<string | null> {
	if (!isTauri()) return null;
	if (!(await exists(path, { baseDir: EVIDENCE_CACHE_BASE_DIRECTORY }))) return null;
	return readTextFile(path, { baseDir: EVIDENCE_CACHE_BASE_DIRECTORY });
}

export async function readAppLocalFile(path: string): Promise<Uint8Array> {
	return readFile(path, { baseDir: BaseDirectory.AppLocalData });
}

export async function appLocalPathExists(path: string): Promise<boolean> {
	if (!isTauri()) return false;
	return exists(path, { baseDir: BaseDirectory.AppLocalData });
}

export async function writeDerivedPreviewCacheText(path: string, value: string): Promise<void> {
	if (!isTauri()) return;
	await ensurePreviewCacheDir();
	await pruneEvidenceDiskCache();
	await writeTextFile(path, value, { baseDir: EVIDENCE_CACHE_BASE_DIRECTORY });
}

export async function readPreparedEvidenceCacheText(path: string): Promise<string | null> {
	if (!isTauri()) return null;
	if (!(typeof process !== 'undefined' && process.env?.VITEST)) {
		await invoke('set_ai_evidence_cache_pin', { relativePath: path, pinned: true });
		try {
			return await invoke<string | null>('read_ai_evidence_cache_text', { relativePath: path });
		} finally {
			await invoke('set_ai_evidence_cache_pin', { relativePath: path, pinned: false });
		}
	}
	if (!(await exists(path, { baseDir: EVIDENCE_CACHE_BASE_DIRECTORY }))) return null;
	return readTextFile(path, { baseDir: EVIDENCE_CACHE_BASE_DIRECTORY });
}

export async function writePreparedEvidenceCacheText(path: string, value: string): Promise<void> {
	if (!isTauri()) return;
	if (!(typeof process !== 'undefined' && process.env?.VITEST)) {
		const retained = await invoke<boolean>('write_ai_evidence_cache_text', {
			relativePath: path,
			value
		});
		if (!retained) {
			log.info('Prepared AI evidence exceeded the active disk-cache budget and was not retained', {
				path
			});
		}
		return;
	}
	await ensurePreparedEvidenceCacheDir();
	await pruneEvidenceDiskCache();
	await writeTextFile(path, value, { baseDir: EVIDENCE_CACHE_BASE_DIRECTORY });
}

export async function readPreparedEvidenceCacheFile(path: string): Promise<Uint8Array | null> {
	if (!isTauri()) return null;
	if (!(typeof process !== 'undefined' && process.env?.VITEST)) {
		await invoke('set_ai_evidence_cache_pin', { relativePath: path, pinned: true });
		try {
			const value = await invoke<number[] | Uint8Array | null>('read_ai_evidence_cache_bytes', {
				relativePath: path
			});
			return value == null ? null : Uint8Array.from(value);
		} finally {
			await invoke('set_ai_evidence_cache_pin', { relativePath: path, pinned: false });
		}
	}
	if (!(await exists(path, { baseDir: EVIDENCE_CACHE_BASE_DIRECTORY }))) return null;
	return readFile(path, { baseDir: EVIDENCE_CACHE_BASE_DIRECTORY });
}

export async function writePreparedEvidenceCacheFile(
	path: string,
	bytes: Uint8Array
): Promise<void> {
	if (!isTauri()) return;
	if (!(typeof process !== 'undefined' && process.env?.VITEST)) {
		const retained = await invoke<boolean>('write_ai_evidence_cache_bytes', {
			relativePath: path,
			value: Array.from(bytes)
		});
		if (!retained) {
			log.info('Prepared AI evidence exceeded the active disk-cache budget and was not retained', {
				path
			});
		}
		return;
	}
	await ensurePreparedEvidenceCacheDir();
	await pruneEvidenceDiskCache();
	await writeFile(path, bytes, { baseDir: EVIDENCE_CACHE_BASE_DIRECTORY });
}

export async function removeDerivedPreviewCacheForSource(filePath: string): Promise<void> {
	if (!isTauri() || !filePath) return;
	if (!(await exists(PREVIEW_CACHE_DIR, { baseDir: EVIDENCE_CACHE_BASE_DIRECTORY }))) return;

	const sourcePrefix = `${getGeneratedPreviewSourceKey(filePath)}__`;
	const entries = await readDir(PREVIEW_CACHE_DIR, { baseDir: EVIDENCE_CACHE_BASE_DIRECTORY });

	await Promise.all(
		entries
			.filter((entry) => entry.isFile && entry.name.startsWith(sourcePrefix))
			.map((entry) =>
				remove(`${PREVIEW_CACHE_DIR}/${entry.name}`, { baseDir: EVIDENCE_CACHE_BASE_DIRECTORY })
			)
	);
}

export async function removePreparedEvidenceCacheForSource(
	filePath: string,
	fileId?: string
): Promise<void> {
	if (!isTauri() || !filePath) return;
	if (fileId) {
		const workspaceId = filePath.match(/(?:^|\/)workspaces\/([^/]+)/)?.[1] ?? 'unknown-workspace';
		const safeSegment = (value: string) =>
			/^[a-zA-Z0-9_-]+$/.test(value) ? value : encodeCacheSegment(value);
		await invoke('remove_ai_evidence_cache_prefix', {
			relativePrefix: `${PREPARED_EVIDENCE_CACHE_DIR}/${safeSegment(workspaceId)}/${safeSegment(fileId)}`
		});
		return;
	}
	if (!(await exists(PREPARED_EVIDENCE_CACHE_DIR, { baseDir: EVIDENCE_CACHE_BASE_DIRECTORY })))
		return;

	const sourcePrefix = `${getGeneratedPreviewSourceKey(filePath)}__`;
	const entries = await readDir(PREPARED_EVIDENCE_CACHE_DIR, {
		baseDir: EVIDENCE_CACHE_BASE_DIRECTORY
	});

	await Promise.all(
		entries
			.filter((entry) => entry.isFile && entry.name.startsWith(sourcePrefix))
			.map((entry) =>
				remove(`${PREPARED_EVIDENCE_CACHE_DIR}/${entry.name}`, {
					baseDir: EVIDENCE_CACHE_BASE_DIRECTORY
				})
			)
	);
}

export async function removeAppLocalPreviewArtifact(
	path: string | null | undefined
): Promise<void> {
	if (!isTauri() || !path) return;
	await storeService.withManagedFileMutation(async () => {
		if (!(await exists(path, { baseDir: BaseDirectory.AppLocalData }))) return;
		await remove(path, { baseDir: BaseDirectory.AppLocalData });
	});
}

/**
 * Asset Service — The single authority for reading vault files.
 *
 * Prefer `readVaultFile` for all binary reads (PDF rendering, hashing, etc.).
 * Use `getAssetUrl` only when you need a URL for HTML resource tags (<img>, <video>).
 */

/**
 * Read a vault file as raw bytes via Tauri's fs plugin.
 * This is the primary way to access vault files — it bypasses the custom
 * protocol entirely and works reliably in both main thread and workers.
 *
 * @param dbFilePath — the workspace-vault-relative file_path value from SQLite.
 */
export async function readVaultFile(dbFilePath: string): Promise<Uint8Array> {
	return readFile(await resolveLocalDocumentPath(`${VAULT_ROOT}/${dbFilePath}`));
}

/**
 * Convert a vault-relative path to a kwant-asset:// URL.
 * Use for HTML resource tags that need a src URL (<img>, <video>, <source>).
 *
 * @param dbFilePath — e.g. "workspaces/workspace-id/vault/workspace/project-id/asset.step"
 */
export function getAssetUrl(dbFilePath: string): string {
	if (!isTauri()) {
		return `/mock-assets/${dbFilePath}`;
	}
	return convertFileSrc(dbFilePath, 'kwant-asset');
}

export async function getVaultImagePreviewUrl(dbFilePath: string): Promise<string> {
	if (!isTauri()) {
		return `/mock-assets/${dbFilePath}`;
	}
	const normalizedPath = dbFilePath.replace(/^file:\/\//, '');
	const bytes = await readVaultFile(normalizedPath);
	const mimeType = getImageMimeType(normalizedPath);
	return URL.createObjectURL(new Blob([bytes.slice().buffer], { type: mimeType }));
}

/**
 * Copy a user-selected account avatar into app-local storage and return the stored relative path.
 */
export async function storeAccountAvatar(accountId: string, sourcePath: string): Promise<string> {
	if (!isTauri()) {
		return sourcePath;
	}

	log.info('Storing account avatar asset', {
		accountId,
		sourcePathType: isAbsoluteLocalPath(sourcePath) ? 'absolute' : 'relative'
	});
	const extension = `.${assertSafeLocalImagePath(sourcePath)}`;
	const targetPath = accountAvatarPath(accountId, extension);
	const readablePath = await resolveReadableExternalPath(sourcePath);

	await storeService.withManagedFileMutation(async () => {
		await mkdir(`${ACCOUNT_ROOT}/${accountId}`, {
			baseDir: BaseDirectory.AppLocalData,
			recursive: true
		});
		await copyFile(readablePath, targetPath, { toPathBaseDir: BaseDirectory.AppLocalData });
	});

	log.info('Stored account avatar asset', { accountId, targetPath });
	return targetPath;
}

export async function storeCompanyLogo(
	workspaceId: string,
	companyId: string,
	sourcePath: string
): Promise<string> {
	if (!isTauri()) {
		return sourcePath;
	}

	log.info('Storing company logo asset', {
		companyId,
		sourcePathType: isAbsoluteLocalPath(sourcePath) ? 'absolute' : 'relative'
	});
	const extension = `.${assertSafeBrandLogoPath(sourcePath)}`;
	const targetPath = `${workspaceVaultRelativePath(workspaceId)}/companies/${companyId}/logo${extension}`;
	const readablePath = await resolveReadableExternalPath(sourcePath);

	await storeService.withManagedFileMutation(async () => {
		await mkdir(
			await resolveLocalDocumentPath(
				`${workspaceVaultRootPath(workspaceId)}/companies/${companyId}`
			),
			{ recursive: true }
		);
		await copyFile(readablePath, await resolveLocalDocumentPath(`${VAULT_ROOT}/${targetPath}`));
	});

	log.info('Stored company logo asset', { companyId, targetPath });
	return targetPath;
}

export async function storeWorkspaceLogo(workspaceId: string, sourcePath: string): Promise<string> {
	if (!isTauri()) {
		return sourcePath;
	}

	log.info('Storing workspace logo asset', {
		workspaceId,
		sourcePathType: isAbsoluteLocalPath(sourcePath) ? 'absolute' : 'relative'
	});
	const extension = `.${assertSafeBrandLogoPath(sourcePath)}`;
	const targetPath = `${workspaceVaultRelativePath(workspaceId)}/workspace-profile/logo${extension}`;
	const readablePath = await resolveReadableExternalPath(sourcePath);

	await storeService.withManagedFileMutation(async () => {
		await mkdir(
			await resolveLocalDocumentPath(`${workspaceVaultRootPath(workspaceId)}/workspace-profile`),
			{ recursive: true }
		);
		await copyFile(readablePath, await resolveLocalDocumentPath(`${VAULT_ROOT}/${targetPath}`));
	});

	log.info('Stored workspace logo asset', { workspaceId, targetPath });
	return targetPath;
}

function getImageMimeType(filePath: string): string {
	const extension = assertSafeLocalImagePath(filePath);
	return extension === 'jpg' || extension === 'jpeg'
		? 'image/jpeg'
		: extension === 'webp'
			? 'image/webp'
			: extension === 'gif'
				? 'image/gif'
				: extension === 'svg'
					? 'image/svg+xml'
					: extension === 'bmp'
						? 'image/bmp'
						: 'image/png';
}

/**
 * Resolve an app-local file path into a browser-usable URL.
 */
export async function getAppLocalFileUrl(relativePath: string): Promise<string> {
	if (!isTauri()) {
		return relativePath;
	}
	const normalizedPath = relativePath.replace(/^file:\/\//, '');
	assertSafeLocalImagePath(normalizedPath);
	const readablePath = await resolveReadableExternalPath(relativePath);
	const bytes = isAbsoluteLocalPath(relativePath)
		? await readFile(readablePath)
		: await readFile(relativePath, { baseDir: BaseDirectory.AppLocalData });
	const mimeType = getImageMimeType(normalizedPath);
	return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
}

/**
 * Delete a vault-relative file path.
 */
export async function removeVaultFile(dbFilePath: string): Promise<void> {
	if (!isTauri() || !dbFilePath) return;
	await storeService.withManagedFileMutation(async () =>
		remove(await resolveLocalDocumentPath(`${VAULT_ROOT}/${dbFilePath}`))
	);
}
