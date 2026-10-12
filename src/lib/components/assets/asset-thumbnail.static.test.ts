import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('asset thumbnail reactivity', () => {
	it('reloads preview thumbnails from a filePath-driven effect instead of a mount-only hook', () => {
		const source = readFileSync(
			join(process.cwd(), 'src/lib/components/assets/asset-thumbnail.svelte'),
			'utf8'
		);

		expect(source).toContain('$effect(() => {');
		expect(source).toContain('const path = filePath;');
		expect(source).toContain('thumbnailRequestId += 1;');
		expect(source).toContain('let thumbnailRequestId = 0;');
		expect(source).toContain('let activeDerivedPreview: DerivedPreview | null = null;');
		expect(source).not.toContain('const previousPreview = derivedPreview;');
		expect(source).not.toContain('let thumbnailRequestId = $state(0);');
		expect(source).not.toContain('onMount');
	});

	it('uses thumbnail-specific capability mapping and derived previews for non-raster files', () => {
		const source = readFileSync(
			join(process.cwd(), 'src/lib/components/assets/asset-thumbnail.svelte'),
			'utf8'
		);

		expect(source).toContain('getGeneralFileThumbnailKind');
		expect(source).toContain("kind === 'dxf'");
		expect(source).toContain("kind === 'document'");
		expect(source).toContain("kind === 'spreadsheet'");
		expect(source).toContain("kind === 'text'");
		expect(source).toContain('await getDerivedPreview(path)');
		expect(source).toContain('ui-derived-preview-card');
		expect(source).toContain('ui-derived-preview-header');
		expect(source).toContain('ui-thumbnail-image');
		expect(source).toContain('ui-thumb-grid-divider');
		expect(source).toContain('ui-file-badge');
		expect(source).not.toContain("{:else if previewKind === 'dxf'}");
	});
});
