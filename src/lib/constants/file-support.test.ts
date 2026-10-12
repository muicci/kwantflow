import { describe, expect, it } from 'vitest';
import {
	GENERAL_PROJECT_FILE_SUMMARY,
	GENERAL_PROJECT_FILE_UPLOAD_EXTENSIONS,
	getEstimateAiPreparedArtifactKind,
	getEstimateAiStaticPolicy,
	getFileSupportProfile,
	getGeneralFilePreviewKind,
	getGeneralProjectFileSummary,
	getSetupImportExtensions,
	getSpreadsheetExtensions,
	getArchiveExtensions,
	getEmailExtensions,
	getDerivedPreviewExtensions,
	FILE_EXTENSIONS,
	BRAND_LOGO_EXTENSIONS
} from './file-support.js';

describe('file support contract', () => {
	it('keeps general upload support and preview routing in one registry', () => {
		expect(getFileSupportProfile('workspace/rfq/spec.pdf')).toMatchObject({
			category: 'pdf',
			uploadAllowed: true,
			previewKind: 'pdf',
			estimateAiStaticPolicy: 'native_file',
			estimateAiPreparedArtifactKind: 'pdf'
		});
		expect(getFileSupportProfile('workspace/rfq/model.dxf')).toMatchObject({
			category: 'cad',
			uploadAllowed: true,
			previewKind: 'dxf',
			estimateAiStaticPolicy: 'cad_renders',
			estimateAiPreparedArtifactKind: 'cad'
		});
		expect(getGeneralFilePreviewKind('workspace/rfq/schedule.xlsx')).toBe('spreadsheet');
	});

	it('covers newly added formats with correct properties', () => {
		// HEIC/HEIF — unsupported (conversion unreliable)
		expect(getFileSupportProfile('photo.heic')).toMatchObject({
			category: 'other',
			uploadAllowed: false,
			previewKind: 'none'
		});
		expect(getFileSupportProfile('photo.heif')).toMatchObject({
			category: 'other',
			uploadAllowed: false
		});

		// TIFF — multi-page scanned images
		expect(getFileSupportProfile('scan.tiff')).toMatchObject({
			category: 'image',
			uploadAllowed: true,
			previewKind: 'tiff',
			estimateAiStaticPolicy: 'converted_image',
			estimateAiPreparedArtifactKind: 'image'
		});
		expect(getFileSupportProfile('scan.tif')).toMatchObject({
			category: 'image',
			uploadAllowed: true,
			previewKind: 'tiff'
		});

		// ZIP — archive, not previewable
		expect(getFileSupportProfile('package.zip')).toMatchObject({
			category: 'archive',
			uploadAllowed: true,
			previewKind: 'none',
			estimateAiStaticPolicy: 'unsupported',
			estimateAiPreparedArtifactKind: null
		});

		// DWG — 2D CAD drawings
		expect(getFileSupportProfile('drawing.dwg')).toMatchObject({
			category: 'cad',
			uploadAllowed: true,
			previewKind: 'dwg',
			estimateAiStaticPolicy: 'cad_renders',
			estimateAiPreparedArtifactKind: 'cad'
		});

		// IFC — not advertised until a maintained loader is compatible with the CAD viewer stack.
		expect(getFileSupportProfile('model.ifc')).toMatchObject({
			category: 'other',
			uploadAllowed: false,
			estimateAiStaticPolicy: 'unsupported',
			estimateAiPreparedArtifactKind: null
		});

		// DWF — explicitly unsupported until a verified parser and fixture exist.
		expect(getFileSupportProfile('drawing.dwf')).toMatchObject({
			category: 'other',
			uploadAllowed: false,
			estimateAiStaticPolicy: 'unsupported',
			estimateAiPreparedArtifactKind: null
		});

		// MSG/EML — email files, body text used for AI evidence
		expect(getFileSupportProfile('email.msg')).toMatchObject({
			category: 'email',
			uploadAllowed: true,
			previewKind: 'email',
			estimateAiStaticPolicy: 'text'
		});
		expect(getFileSupportProfile('email.eml')).toMatchObject({
			category: 'email',
			uploadAllowed: true,
			previewKind: 'email',
			estimateAiStaticPolicy: 'text'
		});
	});

	it('keeps Estimate AI static policy aligned with current shipped truth', () => {
		expect(getEstimateAiStaticPolicy('workspace/rfq/image.png')).toBe('native_image');
		expect(getEstimateAiStaticPolicy('workspace/rfq/image.webp')).toBe('native_image');
		expect(getEstimateAiStaticPolicy('workspace/rfq/table.csv')).toBe('text');
		expect(getEstimateAiStaticPolicy('workspace/rfq/notes.md')).toBe('text');
		expect(getEstimateAiStaticPolicy('workspace/rfq/data.json')).toBe('text');
		expect(getEstimateAiStaticPolicy('workspace/rfq/spec.xml')).toBe('text');
		expect(getEstimateAiStaticPolicy('workspace/rfq/photo.svg')).toBe('converted_image');
		expect(getEstimateAiStaticPolicy('workspace/rfq/markup.gif')).toBe('converted_image');
		expect(getEstimateAiStaticPolicy('workspace/rfq/screenshot.bmp')).toBe('converted_image');
		expect(getEstimateAiStaticPolicy('workspace/rfq/part.step')).toBe('cad_renders');
		expect(getEstimateAiStaticPolicy('workspace/rfq/drawing.dxf')).toBe('cad_renders');
		expect(getEstimateAiStaticPolicy('workspace/rfq/spec.docx')).toBe('text');
		expect(getEstimateAiStaticPolicy('workspace/rfq/schedule.xlsx')).toBe('text');
		// New formats
		expect(getEstimateAiStaticPolicy('photo.heic')).toBe('unsupported');
		expect(getEstimateAiStaticPolicy('scan.tiff')).toBe('converted_image');
		expect(getEstimateAiStaticPolicy('drawing.dwg')).toBe('cad_renders');
		expect(getEstimateAiStaticPolicy('model.ifc')).toBe('unsupported');
		expect(getEstimateAiStaticPolicy('package.zip')).toBe('unsupported');
		expect(getEstimateAiStaticPolicy('email.msg')).toBe('text');
		expect(getEstimateAiStaticPolicy('email.eml')).toBe('text');
	});

	it('maps AI artifact kinds from the same support contract', () => {
		expect(getEstimateAiPreparedArtifactKind('workspace/rfq/spec.pdf')).toBe('pdf');
		expect(getEstimateAiPreparedArtifactKind('workspace/rfq/photo.jpg')).toBe('image');
		expect(getEstimateAiPreparedArtifactKind('workspace/rfq/photo.svg')).toBe('image');
		expect(getEstimateAiPreparedArtifactKind('workspace/rfq/table.csv')).toBe('text');
		expect(getEstimateAiPreparedArtifactKind('workspace/rfq/spec.docx')).toBe('text');
		expect(getEstimateAiPreparedArtifactKind('workspace/rfq/schedule.xlsx')).toBe('text');
		expect(getEstimateAiPreparedArtifactKind('workspace/rfq/part.stl')).toBe('cad');
		expect(getEstimateAiPreparedArtifactKind('workspace/rfq/drawing.dxf')).toBe('cad');
		// New formats
		expect(getEstimateAiPreparedArtifactKind('photo.heic')).toBe(null);
		expect(getEstimateAiPreparedArtifactKind('scan.tiff')).toBe('image');
		expect(getEstimateAiPreparedArtifactKind('drawing.dwg')).toBe('cad');
		expect(getEstimateAiPreparedArtifactKind('model.ifc')).toBe(null);
	});

	it('derives the public upload summary from the registry rather than hand-authored copy', () => {
		expect(GENERAL_PROJECT_FILE_UPLOAD_EXTENSIONS).toContain('pdf');
		expect(GENERAL_PROJECT_FILE_UPLOAD_EXTENSIONS).toContain('dxf');
		expect(GENERAL_PROJECT_FILE_UPLOAD_EXTENSIONS).toContain('gif');
		expect(GENERAL_PROJECT_FILE_UPLOAD_EXTENSIONS).toContain('json');
		expect(GENERAL_PROJECT_FILE_UPLOAD_EXTENSIONS).toContain('webp');
		expect(GENERAL_PROJECT_FILE_UPLOAD_EXTENSIONS).not.toContain('doc');
		// New uploadable formats
		expect(GENERAL_PROJECT_FILE_UPLOAD_EXTENSIONS).not.toContain('heic');
		expect(GENERAL_PROJECT_FILE_UPLOAD_EXTENSIONS).toContain('tiff');
		expect(GENERAL_PROJECT_FILE_UPLOAD_EXTENSIONS).toContain('zip');
		expect(GENERAL_PROJECT_FILE_UPLOAD_EXTENSIONS).toContain('dwg');
		expect(GENERAL_PROJECT_FILE_UPLOAD_EXTENSIONS).not.toContain('ifc');
		expect(GENERAL_PROJECT_FILE_UPLOAD_EXTENSIONS).toContain('msg');
		expect(GENERAL_PROJECT_FILE_UPLOAD_EXTENSIONS).toContain('eml');

		expect(GENERAL_PROJECT_FILE_SUMMARY).toBe(getGeneralProjectFileSummary());
		expect(GENERAL_PROJECT_FILE_SUMMARY).toContain('PDF');
		expect(GENERAL_PROJECT_FILE_SUMMARY).toContain('Images');
		expect(GENERAL_PROJECT_FILE_SUMMARY).toContain('Text and data');
		expect(GENERAL_PROJECT_FILE_SUMMARY).toContain('STEP/IGES/STL/OBJ/3MF');
		expect(GENERAL_PROJECT_FILE_SUMMARY).toContain('DXF');
		expect(GENERAL_PROJECT_FILE_SUMMARY).toContain('DOCX/XLSX');
	});

	it('provides correct derived extension lists', () => {
		// Setup-import extensions (CSV + XLSX — both treated as spreadsheet sources)
		expect(getSetupImportExtensions()).toEqual(['csv', 'xlsx']);

		// Spreadsheet extensions (strict — only native spreadsheet formats)
		expect(getSpreadsheetExtensions()).toEqual(['xlsx']);

		// Archive extensions
		expect(getArchiveExtensions()).toEqual(['zip']);

		// Email file extensions
		expect(getEmailExtensions()).toEqual(['msg', 'eml']);

		// FILE_EXTENSIONS groups
		expect(FILE_EXTENSIONS.image).toContain('png');
		expect(FILE_EXTENSIONS.image).not.toContain('heic');
		expect(FILE_EXTENSIONS.image).toContain('tiff');
		expect(FILE_EXTENSIONS.cad).toContain('dwg');
		expect(FILE_EXTENSIONS.cad).not.toContain('ifc');
		expect(FILE_EXTENSIONS.archive).toEqual(['zip']);
		expect(FILE_EXTENSIONS.email).toEqual(['msg', 'eml']);
	});

	it('provides export-specific extension lists', () => {
		// Brand logo uploads
		expect(BRAND_LOGO_EXTENSIONS).toEqual(['png', 'jpg', 'jpeg', 'svg']);
		expect(BRAND_LOGO_EXTENSIONS).not.toContain('webp');
	});

	it('derives preview extensions requiring dedicated derived previews', () => {
		const derivedExts = getDerivedPreviewExtensions();
		expect(derivedExts).toContain('docx');
		expect(derivedExts).toContain('xlsx');
		expect(derivedExts).toContain('dxf');
		expect(derivedExts).toContain('dwg');
		expect(derivedExts).toContain('tiff');
		expect(derivedExts).toContain('tif');
	});
});
