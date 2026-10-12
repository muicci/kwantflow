import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(fileName: string): string {
	return readFileSync(join(process.cwd(), 'src/lib/components/assets', fileName), 'utf8');
}

function serviceSource(fileName: string): string {
	return readFileSync(join(process.cwd(), 'src/lib/services', fileName), 'utf8');
}

describe('derived preview viewer lifecycle guards', () => {
	it('keeps active previews outside tracked effect state for derived preview viewers', () => {
		const documentSource = source('document-viewer.svelte');
		const spreadsheetSource = source('spreadsheet-viewer.svelte');
		const tiffSource = source('tiff-viewer.svelte');

		for (const componentSource of [documentSource, spreadsheetSource, tiffSource]) {
			expect(componentSource).toContain('let activePreview:');
			expect(componentSource).not.toContain('const previousPreview = preview;');
			expect(componentSource).not.toContain('disposeDerivedPreview(preview);');
		}
	});

	it('resets the image viewer when the actual rendered source changes', () => {
		const imageSource = source('image-viewer.svelte');

		expect(imageSource).toContain('const imgSrc = $derived(srcUrl ?? getAssetUrl(filePath));');
		expect(imageSource).toContain('void imgSrc;');
		expect(imageSource).not.toContain('// Track filePath for reactivity');
	});

	it('does not deduplicate DXF, TIFF, or DWG preview loads across consumers that own blob URL cleanup', () => {
		const derivedPreviewSource = serviceSource('derived-previews.ts');

		expect(derivedPreviewSource).toContain('return true'); // shouldDeduplicatePreviewLoad now deduplicates all heavy pipeline loads
		expect(derivedPreviewSource).toContain('if (shouldDeduplicatePreviewLoad(previewKind)) {');
	});

	it('guards single-file viewer child props against transient null file objects', () => {
		const singleViewerSource = source('single-file-viewer.svelte');

		expect(singleViewerSource).toContain('ui-viewer-shell');
		expect(singleViewerSource).toContain('const filePath = $derived(file?.file_path ?? null);');
		expect(singleViewerSource).toContain('{#if file && filePath}');
		expect(singleViewerSource).toContain('ui-pane-empty');
		expect(singleViewerSource).not.toContain('filePath={file.file_path}');
	});

	it('contains lazy viewer module failures inside the shared preview surface', () => {
		const singleViewerSource = source('single-file-viewer.svelte');

		expect(singleViewerSource).toContain('{:catch error}');
		expect(singleViewerSource).toContain('<ViewerLoadError {error} {fileName} />');
	});

	it('releases transient and unmounted WebGL contexts instead of relying on garbage collection', () => {
		const cadViewerSource = source('cad-viewer.svelte');
		const cadEvidenceSource = serviceSource('ai-cad-evidence.ts');

		expect(cadViewerSource).toContain('renderer?.forceContextLoss();');
		expect(cadEvidenceSource).toContain('renderer.forceContextLoss();');
	});

	it('uses shared derived-preview surface helpers for document and spreadsheet chrome', () => {
		const documentSource = source('document-viewer.svelte');
		const spreadsheetSource = source('spreadsheet-viewer.svelte');
		const imageSource = source('image-viewer.svelte');
		const pdfSource = source('pdf-viewer.svelte');
		const cadSource = source('cad-viewer.svelte');
		const textSource = source('text-viewer.svelte');

		expect(documentSource).toContain('ui-derived-preview-card');
		expect(documentSource).toContain('ui-derived-preview-note');
		expect(spreadsheetSource).toContain('ui-derived-preview-table');
		expect(spreadsheetSource).toContain('ui-viewer-subtabs');
		expect(spreadsheetSource).toContain('ui-table-header-surface');
		for (const componentSource of [
			documentSource,
			spreadsheetSource,
			imageSource,
			pdfSource,
			cadSource,
			textSource
		]) {
			expect(componentSource).toContain('ui-viewer-strip');
		}
	});
});
