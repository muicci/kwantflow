import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssetFile, Project } from '$lib/types/index.js';
import { ProjectStatus } from '$lib/constants/index.js';

const getPreviewFile = vi.fn();

vi.mock('$lib/state/explorer.svelte.js', () => ({
	explorerState: {
		getPreviewFile
	}
}));

const makeProject = (overrides: Partial<Project> = {}): Project => ({
	id: overrides.id ?? 'project-1',
	workspace_id: overrides.workspace_id ?? 'workspace-1',
	sort_order: overrides.sort_order ?? 1,
	is_favourite: overrides.is_favourite ?? false,
	rfq_number: overrides.rfq_number ?? 'RFQ-1001',
	created_at: overrides.created_at ?? '2026-03-25T00:00:00.000Z',
	updated_at: overrides.updated_at ?? '2026-03-25T00:00:00.000Z',
	status: overrides.status ?? ProjectStatus.Draft,
	project_name: overrides.project_name ?? 'Factory mezzanine',
	contact_name: overrides.contact_name ?? 'Acme Steel',
	...overrides
});

const makeFile = (overrides: Partial<AssetFile> = {}): AssetFile => ({
	id: overrides.id ?? 'file-1',
	project_id: overrides.project_id ?? 'project-1',
	asset_id: overrides.asset_id ?? null,
	file_path: overrides.file_path ?? 'workspace/project-1/spec-sheet.pdf',
	original_name: overrides.original_name ?? 'spec-sheet.pdf',
	mime_type: overrides.mime_type ?? 'application/pdf',
	created_at: overrides.created_at ?? '2026-03-25T00:00:00.000Z',
	...overrides
});

describe('preview file route load', () => {
	beforeEach(() => {
		getPreviewFile.mockReset();
	});

	it('loads the requested preview file through explorerState', async () => {
		getPreviewFile.mockResolvedValue({
			file: makeFile({ id: 'file-7', original_name: 'shop-drawing.pdf' }),
			project: makeProject({ id: 'project-7', rfq_number: 'RFQ-7007' })
		});

		const mod = await import('./+page');
		const result = await mod.load({
			params: { fileId: 'file-7' }
		} as unknown as Parameters<typeof mod.load>[0]);

		expect(getPreviewFile).toHaveBeenCalledWith('file-7');
		expect(result).toMatchObject({
			previewFile: {
				file: { id: 'file-7', original_name: 'shop-drawing.pdf' },
				project: { id: 'project-7', rfq_number: 'RFQ-7007' }
			}
		});
	});
});
