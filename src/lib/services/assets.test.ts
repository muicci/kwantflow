import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
	readFileMock,
	copyFileMock,
	mkdirMock,
	removeMock,
	existsMock,
	readDirMock,
	readTextFileMock,
	writeTextFileMock,
	statMock,
	convertFileSrcMock,
	invokeMock,
	joinMock,
	appLocalDataDirMock,
	createObjectURLMock,
	revokeObjectURLMock
} = vi.hoisted(() => ({
	readFileMock: vi.fn(),
	copyFileMock: vi.fn(),
	mkdirMock: vi.fn(),
	removeMock: vi.fn(),
	existsMock: vi.fn(),
	readDirMock: vi.fn(),
	readTextFileMock: vi.fn(),
	writeTextFileMock: vi.fn(),
	statMock: vi.fn(),
	convertFileSrcMock: vi.fn(),
	invokeMock: vi.fn(),
	joinMock: vi.fn(),
	appLocalDataDirMock: vi.fn(),
	createObjectURLMock: vi.fn(),
	revokeObjectURLMock: vi.fn()
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
	readFile: readFileMock,
	copyFile: copyFileMock,
	mkdir: mkdirMock,
	remove: removeMock,
	exists: existsMock,
	readDir: readDirMock,
	readTextFile: readTextFileMock,
	writeTextFile: writeTextFileMock,
	stat: statMock,
	BaseDirectory: {
		Document: 'Document',
		AppLocalData: 'AppLocalData',
		AppCache: 'AppCache'
	}
}));

vi.mock('@tauri-apps/api/core', () => ({
	convertFileSrc: convertFileSrcMock,
	invoke: invokeMock
}));

vi.mock('@tauri-apps/api/path', () => ({
	appLocalDataDir: appLocalDataDirMock,
	join: joinMock
}));

vi.mock('../utils/env', () => ({
	isTauri: () => true
}));

describe('assets service', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		Object.defineProperty(URL, 'createObjectURL', {
			value: createObjectURLMock,
			configurable: true
		});
		Object.defineProperty(URL, 'revokeObjectURL', {
			value: revokeObjectURLMock,
			configurable: true
		});
		createObjectURLMock.mockReturnValue('blob:account-avatar');
		appLocalDataDirMock.mockResolvedValue('/app-local');
		joinMock.mockImplementation(async (root: string, path: string) => `${root}/${path}`);
		existsMock.mockResolvedValue(false);
		readDirMock.mockResolvedValue([]);
		readTextFileMock.mockResolvedValue('');
		writeTextFileMock.mockResolvedValue(undefined);
		invokeMock.mockImplementation(async (command: string, payload?: { path?: string }) =>
			command === 'get_local_documents_root' ? '/qa-documents' : payload?.path
		);
	});

	afterEach(() => {
		Reflect.deleteProperty(URL as object, 'createObjectURL');
		Reflect.deleteProperty(URL as object, 'revokeObjectURL');
	});

	it('reads stored account avatars from app-local storage and returns a blob URL', async () => {
		readFileMock.mockResolvedValueOnce(new Uint8Array([137, 80, 78, 71]));

		const { getAppLocalFileUrl } = await import('./assets');

		await expect(getAppLocalFileUrl('account/primary/avatar.png')).resolves.toBe(
			'blob:account-avatar'
		);

		expect(readFileMock).toHaveBeenCalledWith('account/primary/avatar.png', {
			baseDir: 'AppLocalData'
		});
		expect(createObjectURLMock).toHaveBeenCalledTimes(1);
		expect(convertFileSrcMock).not.toHaveBeenCalled();
	});

	it('reads absolute local paths into blob URLs for safe native previews', async () => {
		readFileMock.mockResolvedValueOnce(new Uint8Array([255, 216, 255, 224]));

		const { getAppLocalFileUrl } = await import('./assets');

		await expect(getAppLocalFileUrl('/tmp/avatar.jpg')).resolves.toBe('blob:account-avatar');

		expect(invokeMock).toHaveBeenCalledWith('allow_external_file_read', {
			path: '/tmp/avatar.jpg'
		});
		expect(readFileMock).toHaveBeenCalledWith('/tmp/avatar.jpg');
		expect(createObjectURLMock).toHaveBeenCalledTimes(1);
		expect(convertFileSrcMock).not.toHaveBeenCalled();
	});

	it('grants and copies absolute avatar files before storing them in app-local storage', async () => {
		const { storeAccountAvatar } = await import('./assets');

		await expect(storeAccountAvatar('primary', '/tmp/avatar.jpg')).resolves.toBe(
			'account/primary/avatar.jpg'
		);

		expect(invokeMock).toHaveBeenCalledWith('allow_external_file_read', {
			path: '/tmp/avatar.jpg'
		});
		expect(mkdirMock).toHaveBeenCalledWith('account/primary', {
			baseDir: 'AppLocalData',
			recursive: true
		});
		expect(copyFileMock).toHaveBeenCalledWith('/tmp/avatar.jpg', 'account/primary/avatar.jpg', {
			toPathBaseDir: 'AppLocalData'
		});
	});

	it('grants and copies absolute logo files before storing them in the workspace vault', async () => {
		const { storeCompanyLogo } = await import('./assets');

		await expect(storeCompanyLogo('workspace-1', 'company-1', '/tmp/logo.png')).resolves.toBe(
			'workspaces/workspace-1/vault/companies/company-1/logo.png'
		);

		expect(invokeMock).toHaveBeenCalledWith('allow_external_file_read', {
			path: '/tmp/logo.png'
		});
		expect(mkdirMock).toHaveBeenCalledWith(
			'/qa-documents/Kwantflow/workspaces/workspace-1/vault/companies/company-1',
			{
				recursive: true
			}
		);
		expect(copyFileMock).toHaveBeenCalledWith(
			'/tmp/logo.png',
			'/qa-documents/Kwantflow/workspaces/workspace-1/vault/companies/company-1/logo.png'
		);
	});

	it('stores workspace logos in the workspace-profile vault path', async () => {
		const { storeWorkspaceLogo } = await import('./assets');

		await expect(storeWorkspaceLogo('workspace-1', '/tmp/logo.svg')).resolves.toBe(
			'workspaces/workspace-1/vault/workspace-profile/logo.svg'
		);

		expect(invokeMock).toHaveBeenCalledWith('allow_external_file_read', {
			path: '/tmp/logo.svg'
		});
		expect(mkdirMock).toHaveBeenCalledWith(
			'/qa-documents/Kwantflow/workspaces/workspace-1/vault/workspace-profile',
			{
				recursive: true
			}
		);
		expect(copyFileMock).toHaveBeenCalledWith(
			'/tmp/logo.svg',
			'/qa-documents/Kwantflow/workspaces/workspace-1/vault/workspace-profile/logo.svg'
		);
	});

	it.each([
		'workspaces/workspace-1/vault/workspace/project-1/drawing.pdf',
		String.raw`workspaces\workspace-1\vault\workspace\project-1\drawing.pdf`
	])(
		'reads and removes stored vault path %j inside the native documents root',
		async (storedPath) => {
			readFileMock.mockResolvedValueOnce(new Uint8Array([1, 2, 3]));
			const { readVaultFile, removeVaultFile } = await import('./assets');
			const absolutePath =
				'/qa-documents/Kwantflow/workspaces/workspace-1/vault/workspace/project-1/drawing.pdf';

			await expect(readVaultFile(storedPath)).resolves.toEqual(new Uint8Array([1, 2, 3]));
			await removeVaultFile(storedPath);

			expect(readFileMock).toHaveBeenCalledWith(absolutePath);
			expect(removeMock).toHaveBeenCalledWith(absolutePath);
			expect(invokeMock).toHaveBeenCalledExactlyOnceWith('get_local_documents_root');
		}
	);

	it('preserves literal backslashes when reading and deleting Unix vault filenames', async () => {
		readFileMock.mockResolvedValueOnce(new Uint8Array([1, 2, 3]));
		const { readVaultFile, removeVaultFile } = await import('./assets');
		const storedPath = String.raw`workspaces/workspace-1/vault/workspace/project-1/part\A.step`;
		const absolutePath = `/qa-documents/Kwantflow/${storedPath}`;

		await readVaultFile(storedPath);
		await removeVaultFile(storedPath);

		expect(readFileMock).toHaveBeenCalledWith(absolutePath);
		expect(removeMock).toHaveBeenCalledWith(absolutePath);
	});

	it.each([
		String.raw`workspaces\workspace-1\..\private.pdf`,
		String.raw`C:\Users\User\Documents\private.pdf`,
		String.raw`\\server\share\private.pdf`
	])(
		'rejects unsafe Windows stored path %j before reading or removing files',
		async (storedPath) => {
			invokeMock.mockResolvedValue('C:/qa-documents');
			const { readVaultFile, removeVaultFile } = await import('./assets');

			await expect(readVaultFile(storedPath)).rejects.toThrow('cannot contain traversal');
			await expect(removeVaultFile(storedPath)).rejects.toThrow('cannot contain traversal');
			expect(readFileMock).not.toHaveBeenCalled();
			expect(removeMock).not.toHaveBeenCalled();
			expect(invokeMock).toHaveBeenCalledExactlyOnceWith('get_local_documents_root');
		}
	);

	it('does not read or delete files when the native documents root cannot be resolved', async () => {
		invokeMock.mockRejectedValue(new Error('native root unavailable'));
		const { readVaultFile, removeVaultFile } = await import('./assets');
		const storedPath = 'workspaces/workspace-1/vault/workspace/project-1/drawing.pdf';

		await expect(readVaultFile(storedPath)).rejects.toThrow('native root unavailable');
		await expect(removeVaultFile(storedPath)).rejects.toThrow('native root unavailable');

		expect(readFileMock).not.toHaveBeenCalled();
		expect(removeMock).not.toHaveBeenCalled();
	});

	it('preserves SVG previews from arbitrary local paths', async () => {
		readFileMock.mockResolvedValueOnce(new Uint8Array([60, 115, 118, 103]));

		const { getAppLocalFileUrl } = await import('./assets');

		await expect(getAppLocalFileUrl('/tmp/avatar.svg')).resolves.toBe('blob:account-avatar');

		expect(invokeMock).toHaveBeenCalledWith('allow_external_file_read', {
			path: '/tmp/avatar.svg'
		});
		expect(readFileMock).toHaveBeenCalledWith('/tmp/avatar.svg');
		expect(createObjectURLMock).toHaveBeenCalledTimes(1);
	});

	it('rejects unsupported image preview extensions', async () => {
		const { getAppLocalFileUrl } = await import('./assets');

		await expect(getAppLocalFileUrl('/tmp/avatar.heic')).rejects.toThrow(
			'Only PNG, JPEG, SVG, WEBP, GIF, or BMP local image previews are supported.'
		);

		expect(readFileMock).not.toHaveBeenCalled();
		expect(createObjectURLMock).not.toHaveBeenCalled();
	});

	it('writes and reads derived preview cache files in app-local storage', async () => {
		existsMock.mockImplementation(async (path: string) => path.includes('demo__hash'));
		readTextFileMock.mockResolvedValueOnce('{"kind":"document"}');

		const { readDerivedPreviewCacheText, writeDerivedPreviewCacheText } = await import('./assets');

		await writeDerivedPreviewCacheText(
			'generated-previews/demo__hash.docx.json',
			'{"kind":"document"}'
		);
		await expect(
			readDerivedPreviewCacheText('generated-previews/demo__hash.docx.json')
		).resolves.toBe('{"kind":"document"}');

		expect(mkdirMock).toHaveBeenCalledWith('generated-previews', {
			baseDir: 'AppCache',
			recursive: true
		});
		expect(writeTextFileMock).toHaveBeenCalledWith(
			'generated-previews/demo__hash.docx.json',
			'{"kind":"document"}',
			{
				baseDir: 'AppCache'
			}
		);
		expect(readTextFileMock).toHaveBeenCalledWith('generated-previews/demo__hash.docx.json', {
			baseDir: 'AppCache'
		});
	});

	it('keeps generated preview cache filenames short for nested workspace-vault paths', async () => {
		const { getPreparedEvidenceCachePath } = await import('./assets');
		const path = getPreparedEvidenceCachePath(
			'workspaces/ai-extraction-qa-1dc81acf/vault/00bec86c-8fcd-4867-abbd-f0ae711d10c2/qa-file-1-sample-quote-drawing.pdf',
			'file-1',
			'd4170b077a56610e81b71d6e17f7844d8864c10b72870d8f0a664746a4d1bb04',
			'pdf.json'
		);
		const fileName = path.split('/').pop() ?? '';

		expect(fileName.length).toBeLessThan(180);
		expect(path).toBe(
			'ai-evidence/ai-extraction-qa-1dc81acf/file-1/d4170b077a56610e81b71d6e17f7844d8864c10b72870d8f0a664746a4d1bb04/prepared-v1/pdf.json'
		);
	});

	it('removes every derived preview cache artifact for a source file', async () => {
		const { getDerivedPreviewCachePath, removeDerivedPreviewCacheForSource } =
			await import('./assets');
		const cachePath = getDerivedPreviewCachePath(
			'workspace/project/spec.docx',
			'content-hash',
			'docx.json'
		);
		const cachePrefix = cachePath.split('__content-hash.docx.json')[0];

		existsMock.mockResolvedValueOnce(true);
		readDirMock.mockResolvedValueOnce([
			{
				name: `${cachePrefix.split('/').pop()}__old-a.docx.json`,
				isDirectory: false,
				isFile: true,
				isSymlink: false
			},
			{
				name: `${cachePrefix.split('/').pop()}__old-b.docx.json`,
				isDirectory: false,
				isFile: true,
				isSymlink: false
			},
			{
				name: 'some-other-source__old-c.docx.json',
				isDirectory: false,
				isFile: true,
				isSymlink: false
			}
		]);

		await removeDerivedPreviewCacheForSource('workspace/project/spec.docx');

		expect(readDirMock).toHaveBeenCalledWith('generated-previews', {
			baseDir: 'AppCache'
		});
		expect(removeMock).toHaveBeenCalledTimes(2);
		expect(removeMock).toHaveBeenCalledWith(
			expect.stringContaining(`${cachePrefix.split('/').pop()}__old-a.docx.json`),
			{
				baseDir: 'AppCache'
			}
		);
		expect(removeMock).toHaveBeenCalledWith(
			expect.stringContaining(`${cachePrefix.split('/').pop()}__old-b.docx.json`),
			{
				baseDir: 'AppCache'
			}
		);
	});

	it('silently ignores derived preview cache cleanup if the preview cache directory does not exist', async () => {
		existsMock.mockResolvedValueOnce(false);
		const { removeDerivedPreviewCacheForSource } = await import('./assets');

		await removeDerivedPreviewCacheForSource('workspace/project/spec.docx');

		expect(existsMock).toHaveBeenCalledWith('generated-previews', {
			baseDir: 'AppCache'
		});
		expect(readDirMock).not.toHaveBeenCalled();
		expect(removeMock).not.toHaveBeenCalled();
	});

	it('silently ignores derived preview cache cleanup if the filePath is empty', async () => {
		const { removeDerivedPreviewCacheForSource } = await import('./assets');

		await removeDerivedPreviewCacheForSource('');

		expect(existsMock).not.toHaveBeenCalled();
		expect(readDirMock).not.toHaveBeenCalled();
		expect(removeMock).not.toHaveBeenCalled();
	});

	it('removes every prepared evidence cache artifact for a source file', async () => {
		const { removePreparedEvidenceCacheForSource } = await import('./assets');
		await removePreparedEvidenceCacheForSource(
			'workspaces/workspace-1/vault/project/spec.docx',
			'file-1'
		);

		expect(invokeMock).toHaveBeenCalledWith('remove_ai_evidence_cache_prefix', {
			relativePrefix: 'ai-evidence/workspace-1/file-1'
		});
		expect(removeMock).not.toHaveBeenCalled();
	});

	it('silently ignores prepared evidence cache cleanup if the evidence directory does not exist', async () => {
		existsMock.mockResolvedValueOnce(false);
		const { removePreparedEvidenceCacheForSource } = await import('./assets');

		await removePreparedEvidenceCacheForSource('workspace/project/spec.docx');

		expect(existsMock).toHaveBeenCalledWith('ai-evidence', {
			baseDir: 'AppCache'
		});
		expect(readDirMock).not.toHaveBeenCalled();
		expect(removeMock).not.toHaveBeenCalled();
	});

	it('silently ignores prepared evidence cache cleanup if the filePath is empty', async () => {
		const { removePreparedEvidenceCacheForSource } = await import('./assets');

		await removePreparedEvidenceCacheForSource('');

		expect(existsMock).not.toHaveBeenCalled();
		expect(readDirMock).not.toHaveBeenCalled();
		expect(removeMock).not.toHaveBeenCalled();
	});
});
