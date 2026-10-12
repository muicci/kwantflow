import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock, joinMock, isTauriMock } = vi.hoisted(() => ({
	invokeMock: vi.fn(),
	joinMock: vi.fn(),
	isTauriMock: vi.fn()
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/path', () => ({ join: joinMock }));
vi.mock('../utils/env', () => ({ isTauri: isTauriMock }));

describe('local document path resolution', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		isTauriMock.mockReturnValue(true);
		invokeMock.mockResolvedValue('/app-local/com.kwantflow.desktop.qa-a/qa-documents');
		joinMock.mockImplementation(async (root: string, path: string) => `${root}/${path}`);
	});

	it('keeps production and two QA identity vaults disjoint without changing stored relative paths', async () => {
		const relativePath = 'Kwantflow/workspaces/workspace-1/vault/workspace/project-1/drawing.pdf';
		const roots = [
			'/user/Documents',
			'/app-local/com.kwantflow.desktop.qa-a/qa-documents',
			'/app-local/com.kwantflow.desktop.qa-b/qa-documents'
		];
		const resolvedPaths: string[] = [];
		for (const root of roots) {
			vi.resetModules();
			invokeMock.mockResolvedValue(root);
			const { resolveLocalDocumentPath } = await import('./local-documents');
			resolvedPaths.push(await resolveLocalDocumentPath(relativePath));
		}

		expect(new Set(resolvedPaths).size).toBe(3);
		expect(resolvedPaths).toEqual(roots.map((root) => `${root}/${relativePath}`));
		expect(invokeMock).toHaveBeenCalledTimes(3);
	});

	it('resolves an old Windows workspace hierarchy on a Unix host to the same file as slash paths', async () => {
		const { resolveLocalDocumentPath } = await import('./local-documents');
		const slashPath = 'Kwantflow/workspaces/workspace-1/vault/workspace/project-1/drawing.pdf';
		const windowsPath = String.raw`Kwantflow\workspaces\workspace-1\vault\workspace\project-1\drawing.pdf`;

		const slashResult = await resolveLocalDocumentPath(slashPath);
		await expect(resolveLocalDocumentPath(windowsPath)).resolves.toBe(slashResult);
		expect(joinMock).toHaveBeenNthCalledWith(
			2,
			'/app-local/com.kwantflow.desktop.qa-a/qa-documents',
			slashPath
		);
		expect(invokeMock).toHaveBeenCalledExactlyOnceWith('get_local_documents_root');
	});

	it('preserves literal backslashes in canonical Unix vault filenames', async () => {
		const { resolveLocalDocumentPath } = await import('./local-documents');
		const relativePath = String.raw`Kwantflow/workspaces/workspace-1/vault/workspace/project-1/part\A.step`;

		await expect(resolveLocalDocumentPath(relativePath)).resolves.toBe(
			`/app-local/com.kwantflow.desktop.qa-a/qa-documents/${relativePath}`
		);
		expect(joinMock).toHaveBeenCalledWith(
			'/app-local/com.kwantflow.desktop.qa-a/qa-documents',
			relativePath
		);
	});

	it.each([
		String.raw`Kwantflow/workspaces\workspace-1\..\private.pdf`,
		String.raw`Kwantflow\workspaces\workspace-1\..\private.pdf`,
		String.raw`Kwantflow/workspaces\C:\Users\User\private.pdf`
	])('rejects unsafe legacy Windows hierarchy %j on a Unix host', async (relativePath) => {
		const { resolveLocalDocumentPath } = await import('./local-documents');

		await expect(resolveLocalDocumentPath(relativePath)).rejects.toThrow(
			'cannot contain traversal'
		);
		expect(joinMock).not.toHaveBeenCalled();
	});

	it('normalizes mixed Windows separators when the native root is a Windows path', async () => {
		invokeMock.mockResolvedValue('C:/app-local/com.kwantflow.desktop.qa-a/qa-documents');
		const { resolveLocalDocumentPath } = await import('./local-documents');

		await expect(
			resolveLocalDocumentPath(
				String.raw`Kwantflow/workspaces/workspace-1/vault/workspace/project-1/parts\A.step`
			)
		).resolves.toBe(
			'C:/app-local/com.kwantflow.desktop.qa-a/qa-documents/Kwantflow/workspaces/workspace-1/vault/workspace/project-1/parts/A.step'
		);
	});

	it('shares one native root lookup between concurrent resolutions', async () => {
		const { resolveLocalDocumentPath } = await import('./local-documents');
		await Promise.all([
			resolveLocalDocumentPath('Kwantflow/workspaces/workspace-a/vault'),
			resolveLocalDocumentPath('Kwantflow/workspaces/workspace-b/vault')
		]);

		expect(invokeMock).toHaveBeenCalledExactlyOnceWith('get_local_documents_root');
		expect(joinMock).toHaveBeenCalledTimes(2);
	});

	it.each([
		'',
		'/user/Documents/private.pdf',
		'C:/Users/User/Documents/private.pdf',
		String.raw`C:\Users\User\Documents\private.pdf`,
		'C:private.pdf',
		String.raw`\\server\share\private.pdf`,
		String.raw`\Users\User\Documents\private.pdf`,
		'file:///user/Documents/private.pdf',
		'Kwantflow/../private.pdf',
		'Kwantflow/./vault',
		'Kwantflow//vault',
		'Kwantflow\\..\\private.pdf',
		String.raw`Kwantflow\workspaces\workspace-1\..\private.pdf`,
		String.raw`Kwantflow\workspaces\workspace-1\.\private.pdf`,
		String.raw`Kwantflow\C:\Users\User\Documents\private.pdf`,
		'Kwantflow/vault\0.pdf'
	])(
		'rejects unsafe Windows document path %j before joining it under the native root',
		async (path) => {
			invokeMock.mockResolvedValue('C:/app-local/com.kwantflow.desktop.qa-a/qa-documents');
			const { resolveLocalDocumentPath } = await import('./local-documents');
			await expect(resolveLocalDocumentPath(path)).rejects.toThrow(
				'Local document paths must be relative and cannot contain traversal.'
			);
			expect(invokeMock).toHaveBeenCalledExactlyOnceWith('get_local_documents_root');
			expect(joinMock).not.toHaveBeenCalled();
		}
	);

	it('fails closed on IPC errors and retries the native root on the next operation', async () => {
		invokeMock.mockRejectedValueOnce(new Error('native root unavailable'));
		const { resolveLocalDocumentPath } = await import('./local-documents');
		await expect(
			resolveLocalDocumentPath('Kwantflow/workspaces/workspace-a/vault')
		).rejects.toThrow('native root unavailable');
		expect(joinMock).not.toHaveBeenCalled();
		await expect(resolveLocalDocumentPath('Kwantflow/workspaces/workspace-a/vault')).resolves.toBe(
			'/app-local/com.kwantflow.desktop.qa-a/qa-documents/Kwantflow/workspaces/workspace-a/vault'
		);
		expect(invokeMock).toHaveBeenCalledTimes(2);
	});

	it('rejects a non-absolute native root and clears it for the next operation', async () => {
		invokeMock.mockResolvedValueOnce('qa-documents');
		const { resolveLocalDocumentPath } = await import('./local-documents');
		await expect(
			resolveLocalDocumentPath('Kwantflow/workspaces/workspace-a/vault')
		).rejects.toThrow('invalid local documents root');
		expect(joinMock).not.toHaveBeenCalled();
		await expect(
			resolveLocalDocumentPath('Kwantflow/workspaces/workspace-a/vault')
		).resolves.toContain('/app-local/com.kwantflow.desktop.qa-a/qa-documents/');
		expect(invokeMock).toHaveBeenCalledTimes(2);
	});

	it('does not attempt native file resolution in browser mode', async () => {
		isTauriMock.mockReturnValue(false);
		const { resolveLocalDocumentPath } = await import('./local-documents');
		await expect(
			resolveLocalDocumentPath('Kwantflow/workspaces/workspace-a/vault')
		).rejects.toThrow('only available in the desktop app');
		expect(invokeMock).not.toHaveBeenCalled();
	});
});
