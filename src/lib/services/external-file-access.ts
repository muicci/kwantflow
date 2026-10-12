import { invoke } from '@tauri-apps/api/core';

import { isTauri } from '$lib/utils/env.js';

export async function allowExternalFileRead(path: string): Promise<string> {
	if (!isTauri()) return path;
	return invoke<string>('allow_external_file_read', { path });
}
