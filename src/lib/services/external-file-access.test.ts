import { describe, expect, it, vi } from 'vitest';
import { allowExternalFileRead } from './external-file-access.js';
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '$lib/utils/env.js';

vi.mock('@tauri-apps/api/core', () => ({
	invoke: vi.fn()
}));

vi.mock('$lib/utils/env.js', () => ({
	isTauri: vi.fn()
}));

describe('external file access service', () => {
	it('returns the path unaltered when not running in Tauri', async () => {
		vi.mocked(isTauri).mockReturnValue(false);

		const result = await allowExternalFileRead('/path/to/file.txt');
		expect(result).toBe('/path/to/file.txt');
		expect(invoke).not.toHaveBeenCalled();
	});

	it('invokes allow_external_file_read when running in Tauri', async () => {
		vi.mocked(isTauri).mockReturnValue(true);
		vi.mocked(invoke).mockResolvedValue('/resolved/path/to/file.txt');

		const result = await allowExternalFileRead('/path/to/file.txt');
		expect(invoke).toHaveBeenCalledWith('allow_external_file_read', { path: '/path/to/file.txt' });
		expect(result).toBe('/resolved/path/to/file.txt');
	});
});
