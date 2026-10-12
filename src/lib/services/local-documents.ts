import { invoke } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';

import { VAULT_ROOT } from '../constants/index.js';
import { isTauri } from '../utils/env';

let documentsRoot: Promise<string> | null = null;

function getLocalDocumentsRoot(): Promise<string> {
	if (!isTauri()) {
		throw new Error('Local document files are only available in the desktop app.');
	}
	if (!documentsRoot) {
		documentsRoot = invoke<string>('get_local_documents_root')
			.then((root) => {
				if (typeof root !== 'string' || !/^(?:[a-zA-Z]:[\\/]|\/|\\\\)/.test(root)) {
					throw new Error('The desktop app returned an invalid local documents root.');
				}
				return root;
			})
			.catch((error: unknown) => {
				documentsRoot = null;
				throw error;
			});
	}
	return documentsRoot;
}

/** Resolve a stored document-relative path using the current native app identity. */
export async function resolveLocalDocumentPath(relativePath: string): Promise<string> {
	const root = await getLocalDocumentsRoot();
	const windowsPath =
		/^(?:[a-zA-Z]:[\\/]|\\\\|\/\/)/.test(root) ||
		relativePath.startsWith(`${VAULT_ROOT}/workspaces\\`) ||
		relativePath.startsWith(`${VAULT_ROOT}\\workspaces\\`);
	const normalizedPath = windowsPath ? relativePath.replace(/\\/g, '/') : relativePath;
	if (
		!normalizedPath ||
		normalizedPath.includes('\0') ||
		/^(?:[a-zA-Z]:|\/|\\|[a-zA-Z]+:\/\/)/.test(normalizedPath) ||
		(windowsPath && /(?:^|\/)[a-zA-Z]:/.test(normalizedPath)) ||
		normalizedPath.split('/').some((segment) => !segment || segment === '.' || segment === '..')
	) {
		throw new Error('Local document paths must be relative and cannot contain traversal.');
	}
	return join(root, normalizedPath);
}
