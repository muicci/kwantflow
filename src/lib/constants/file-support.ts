// ============================================================
// Kwantflow File Support Contract
// Single source of truth for file format support across:
//   - project upload and attach
//   - preview and render
//   - thumbnail generation
//   - Estimate AI static policy
//   - Estimate AI runtime eligibility
// ============================================================

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

export type FileCategory =
	'pdf' | 'image' | 'text' | 'cad' | 'document' | 'archive' | 'email' | 'other';
export type GeneralFilePreviewKind =
	| 'pdf'
	| 'image'
	| 'text'
	| 'cad'
	| 'document'
	| 'spreadsheet'
	| 'dxf'
	| 'dwg'
	| 'tiff'
	| 'email'
	| 'none';
export type GeneralFileThumbnailKind =
	'pdf' | 'image' | 'text' | 'cad' | 'document' | 'spreadsheet' | 'dxf' | 'dwg' | 'none';

export type EstimateAiStaticPolicy =
	'native_file' | 'native_image' | 'text' | 'converted_image' | 'cad_renders' | 'unsupported';

export type EstimateAiPreparedArtifactKind = 'text' | 'pdf' | 'image' | 'cad';

interface FileSupportRecord {
	category: Exclude<FileCategory, 'other'>;
	uploadAllowed: boolean;
	attachAllowed: boolean;
	previewKind: GeneralFilePreviewKind;
	thumbnailKind: GeneralFileThumbnailKind;
	thumbnailPriority: number | null;
	mimeType: string | null;
	estimateAiStaticPolicy: EstimateAiStaticPolicy;
	estimateAiPreparedArtifactKind: EstimateAiPreparedArtifactKind | null;
	summaryGroupLabel: string;
	userFacingSupportLabel: string;
	agentNote?: string;
}

export interface GeneralFileCapability {
	id: string | null;
	category: FileCategory;
	uploadAllowed: boolean;
	attachAllowed: boolean;
	previewKind: GeneralFilePreviewKind;
	thumbnailKind: GeneralFileThumbnailKind;
	thumbnailPriority: number | null;
	mimeType: string | null;
	previewSupported: boolean;
	thumbnailEligible: boolean;
}

export interface FileSupportProfile extends GeneralFileCapability {
	estimateAiStaticPolicy: EstimateAiStaticPolicy;
	estimateAiPreparedArtifactKind: EstimateAiPreparedArtifactKind | null;
	summaryGroupLabel: string;
	userFacingSupportLabel: string;
	agentNote: string | null;
}

// ------------------------------------------------------------------
// Category-group factory — eliminates per-extension duplication
// ------------------------------------------------------------------

type ExtensionOverrides = Partial<
	Pick<
		FileSupportRecord,
		'mimeType' | 'estimateAiStaticPolicy' | 'userFacingSupportLabel' | 'agentNote'
	>
>;

/** Build a batch of records from shared defaults + per-extension overrides. */
function makeCategoryRecords(
	defaults: Omit<
		FileSupportRecord,
		'mimeType' | 'estimateAiStaticPolicy' | 'userFacingSupportLabel' | 'agentNote'
	> & {
		estimateAiStaticPolicy?: EstimateAiStaticPolicy;
	},
	overrides: Record<string, ExtensionOverrides>
): Record<string, FileSupportRecord> {
	const groupPolicy = defaults.estimateAiStaticPolicy;
	const { estimateAiStaticPolicy: _unused, ...cleanDefaults } = defaults;
	void _unused;
	const result: Record<string, FileSupportRecord> = {};
	for (const [ext, override] of Object.entries(overrides)) {
		result[ext] = {
			...cleanDefaults,
			mimeType: override.mimeType ?? null,
			estimateAiStaticPolicy: override.estimateAiStaticPolicy ?? groupPolicy ?? 'unsupported',
			userFacingSupportLabel: override.userFacingSupportLabel ?? `${ext.toUpperCase()} file`,
			...(override.agentNote ? { agentNote: override.agentNote } : {})
		} satisfies FileSupportRecord;
	}
	return result;
}

/** Build a single standalone record (for unique formats). */

// ------------------------------------------------------------------
// Records — organised by category group
// ------------------------------------------------------------------

const FILE_SUPPORT_RECORDS: Record<string, FileSupportRecord> = {
	// ── PDF ────────────────────────────────────────────────────────
	...{
		pdf: {
			category: 'pdf',
			uploadAllowed: true,
			attachAllowed: true,
			previewKind: 'pdf',
			thumbnailKind: 'pdf',
			thumbnailPriority: 400,
			mimeType: 'application/pdf',
			estimateAiStaticPolicy: 'native_file',
			estimateAiPreparedArtifactKind: 'pdf',
			summaryGroupLabel: 'PDF',
			userFacingSupportLabel: 'PDF'
		}
	},

	// ── Images —─────── native (direct AI support) ────────────────
	...makeCategoryRecords(
		{
			category: 'image',
			uploadAllowed: true,
			attachAllowed: true,
			previewKind: 'image',
			thumbnailKind: 'image',
			thumbnailPriority: 200,
			estimateAiPreparedArtifactKind: 'image',
			summaryGroupLabel: 'Images'
		},
		{
			png: {
				mimeType: 'image/png',
				estimateAiStaticPolicy: 'native_image',
				userFacingSupportLabel: 'PNG image'
			},
			jpg: {
				mimeType: 'image/jpeg',
				estimateAiStaticPolicy: 'native_image',
				userFacingSupportLabel: 'JPEG image'
			},
			jpeg: {
				mimeType: 'image/jpeg',
				estimateAiStaticPolicy: 'native_image',
				userFacingSupportLabel: 'JPEG image'
			},
			webp: {
				mimeType: 'image/webp',
				estimateAiStaticPolicy: 'native_image',
				userFacingSupportLabel: 'WebP image'
			}
		}
	),

	// ── Images —─────── converted (rasterised before AI use) ──────
	...makeCategoryRecords(
		{
			category: 'image',
			uploadAllowed: true,
			attachAllowed: true,
			previewKind: 'image',
			thumbnailKind: 'image',
			thumbnailPriority: 200,
			estimateAiPreparedArtifactKind: 'image',
			summaryGroupLabel: 'Images'
		},
		{
			svg: {
				mimeType: 'image/svg+xml',
				estimateAiStaticPolicy: 'converted_image',
				userFacingSupportLabel: 'SVG image',
				agentNote: 'AI-ready through the current file-processing workflow.'
			},
			gif: {
				mimeType: 'image/gif',
				estimateAiStaticPolicy: 'converted_image',
				userFacingSupportLabel: 'GIF image',
				agentNote: 'AI-ready through the current file-processing workflow.'
			},
			bmp: {
				mimeType: 'image/bmp',
				estimateAiStaticPolicy: 'converted_image',
				userFacingSupportLabel: 'BMP image',
				agentNote: 'AI-ready through the current file-processing workflow.'
			}
		}
	),

	// ── TIFF (multi-page scanned images) ──────────────────────────
	...makeCategoryRecords(
		{
			category: 'image',
			uploadAllowed: true,
			attachAllowed: true,
			previewKind: 'tiff',
			thumbnailKind: 'image',
			thumbnailPriority: 200,
			estimateAiPreparedArtifactKind: 'image',
			summaryGroupLabel: 'Images'
		},
		{
			tif: {
				mimeType: 'image/tiff',
				estimateAiStaticPolicy: 'converted_image',
				userFacingSupportLabel: 'TIFF image',
				agentNote: 'Multi-page TIFF via @image-js/tiff. Every page is accounted for by AI.'
			},
			tiff: {
				mimeType: 'image/tiff',
				estimateAiStaticPolicy: 'converted_image',
				userFacingSupportLabel: 'TIFF image',
				agentNote: 'Multi-page TIFF via @image-js/tiff. Every page is accounted for by AI.'
			}
		}
	),

	// ── Text files ────────────────────────────────────────────────
	...makeCategoryRecords(
		{
			category: 'text',
			uploadAllowed: true,
			attachAllowed: true,
			previewKind: 'text',
			thumbnailKind: 'text',
			thumbnailPriority: 100,
			estimateAiPreparedArtifactKind: 'text',
			summaryGroupLabel: 'Text and data',
			estimateAiStaticPolicy: 'text'
		},
		{
			txt: { mimeType: 'text/plain', userFacingSupportLabel: 'Plain text' },
			csv: {
				mimeType: 'text/csv',
				userFacingSupportLabel: 'CSV text table',
				agentNote: 'AI-ready through the current file-processing workflow.'
			},
			md: { mimeType: 'text/markdown', userFacingSupportLabel: 'Markdown text' },
			log: { mimeType: 'text/plain', userFacingSupportLabel: 'Log text' },
			json: { mimeType: 'application/json', userFacingSupportLabel: 'JSON text' },
			xml: { mimeType: 'application/xml', userFacingSupportLabel: 'XML text' }
		}
	),

	// ── CAD — 3D models (STEP, IGES, STL, OBJ, 3MF) ─────────
	...makeCategoryRecords(
		{
			category: 'cad',
			uploadAllowed: true,
			attachAllowed: true,
			previewKind: 'cad',
			thumbnailKind: 'cad',
			thumbnailPriority: 300,
			estimateAiStaticPolicy: 'cad_renders',
			estimateAiPreparedArtifactKind: 'cad',
			summaryGroupLabel: 'STEP/IGES/STL/OBJ/3MF'
		},
		{
			step: { mimeType: 'application/step', userFacingSupportLabel: 'STEP CAD' },
			stp: { mimeType: 'application/step', userFacingSupportLabel: 'STEP CAD' },
			iges: { mimeType: 'application/iges', userFacingSupportLabel: 'IGES CAD' },
			igs: { mimeType: 'application/iges', userFacingSupportLabel: 'IGES CAD' },
			stl: { mimeType: 'model/stl', userFacingSupportLabel: 'STL CAD' },
			obj: { mimeType: 'model/obj', userFacingSupportLabel: 'OBJ CAD' },
			'3mf': { mimeType: 'model/3mf', userFacingSupportLabel: '3MF CAD' }
		}
	),

	// ── DXF — 2D CAD drawings ─────────────────────────────────────
	dxf: {
		category: 'cad',
		uploadAllowed: true,
		attachAllowed: true,
		previewKind: 'dxf',
		thumbnailKind: 'dxf',
		thumbnailPriority: 300,
		mimeType: 'image/vnd.dxf',
		estimateAiStaticPolicy: 'cad_renders',
		estimateAiPreparedArtifactKind: 'cad',
		summaryGroupLabel: 'DXF',
		userFacingSupportLabel: 'DXF drawing',
		agentNote: 'AI-ready through the current file-processing workflow.'
	},

	// ── DWG — 2D CAD drawings ─────────────────────────────────────
	dwg: {
		category: 'cad',
		uploadAllowed: true,
		attachAllowed: true,
		previewKind: 'dwg',
		thumbnailKind: 'dwg',
		thumbnailPriority: 300,
		mimeType: 'application/acad',
		estimateAiStaticPolicy: 'cad_renders',
		estimateAiPreparedArtifactKind: 'cad',
		summaryGroupLabel: 'DWG',
		userFacingSupportLabel: 'DWG drawing',
		agentNote: 'Rendered via LibreDWG → SVG. Supports R2000–2018.'
	},

	// ── Documents — Office ────────────────────────────────────────
	doc: {
		category: 'document',
		uploadAllowed: false,
		attachAllowed: false,
		previewKind: 'none',
		thumbnailKind: 'none',
		thumbnailPriority: null,
		mimeType: 'application/msword',
		estimateAiStaticPolicy: 'unsupported',
		estimateAiPreparedArtifactKind: null,
		summaryGroupLabel: 'DOCX/XLSX',
		userFacingSupportLabel: 'Word document'
	},
	docx: {
		category: 'document',
		uploadAllowed: true,
		attachAllowed: true,
		previewKind: 'document',
		thumbnailKind: 'document',
		thumbnailPriority: 125,
		mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
		estimateAiStaticPolicy: 'text',
		estimateAiPreparedArtifactKind: 'text',
		summaryGroupLabel: 'DOCX/XLSX',
		userFacingSupportLabel: 'Word document',
		agentNote: 'AI-ready through the current file-processing workflow.'
	},
	xls: {
		category: 'document',
		uploadAllowed: false,
		attachAllowed: false,
		previewKind: 'none',
		thumbnailKind: 'none',
		thumbnailPriority: null,
		mimeType: 'application/vnd.ms-excel',
		estimateAiStaticPolicy: 'unsupported',
		estimateAiPreparedArtifactKind: null,
		summaryGroupLabel: 'DOCX/XLSX',
		userFacingSupportLabel: 'Excel spreadsheet'
	},
	xlsx: {
		category: 'document',
		uploadAllowed: true,
		attachAllowed: true,
		previewKind: 'spreadsheet',
		thumbnailKind: 'spreadsheet',
		thumbnailPriority: 125,
		mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
		estimateAiStaticPolicy: 'text',
		estimateAiPreparedArtifactKind: 'text',
		summaryGroupLabel: 'DOCX/XLSX',
		userFacingSupportLabel: 'Excel spreadsheet',
		agentNote: 'AI-ready through the current file-processing workflow.'
	},
	pptx: {
		category: 'document',
		uploadAllowed: false,
		attachAllowed: false,
		previewKind: 'none',
		thumbnailKind: 'none',
		thumbnailPriority: null,
		mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
		estimateAiStaticPolicy: 'unsupported',
		estimateAiPreparedArtifactKind: null,
		summaryGroupLabel: 'DOCX/XLSX',
		userFacingSupportLabel: 'PowerPoint presentation'
	},

	// ── Archives ──────────────────────────────────────────────────
	zip: {
		category: 'archive',
		uploadAllowed: true,
		attachAllowed: true,
		previewKind: 'none',
		thumbnailKind: 'none',
		thumbnailPriority: null,
		mimeType: 'application/zip',
		estimateAiStaticPolicy: 'unsupported',
		estimateAiPreparedArtifactKind: null,
		summaryGroupLabel: 'ZIP',
		userFacingSupportLabel: 'ZIP archive',
		agentNote: 'Auto-extracted at intake via JSZip. Contents processed individually.'
	},

	// ── Email files ───────────────────────────────────────────────
	msg: {
		category: 'email',
		uploadAllowed: true,
		attachAllowed: true,
		previewKind: 'email',
		thumbnailKind: 'none',
		thumbnailPriority: null,
		mimeType: 'application/vnd.ms-outlook',
		estimateAiStaticPolicy: 'text',
		estimateAiPreparedArtifactKind: 'text',
		summaryGroupLabel: 'Email files',
		userFacingSupportLabel: 'Outlook message',
		agentNote: 'Body text extracted for AI evidence. Attachments available for import.'
	},
	eml: {
		category: 'email',
		uploadAllowed: true,
		attachAllowed: true,
		previewKind: 'email',
		thumbnailKind: 'none',
		thumbnailPriority: null,
		mimeType: 'message/rfc822',
		estimateAiStaticPolicy: 'text',
		estimateAiPreparedArtifactKind: 'text',
		summaryGroupLabel: 'Email files',
		userFacingSupportLabel: 'Email message',
		agentNote: 'Body text extracted for AI evidence. Attachments available for import.'
	}
};

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

const EXTENSION_MAP: Record<string, Exclude<FileCategory, 'other'>> = Object.fromEntries(
	Object.entries(FILE_SUPPORT_RECORDS).map(([extension, capability]) => [
		extension,
		capability.category
	])
) as Record<string, Exclude<FileCategory, 'other'>>;

function getFileExtension(filePathOrName: string): string | null {
	const extension = filePathOrName.split('.').pop()?.toLowerCase() || '';
	return extension || null;
}

function getSupportRecord(filePathOrName: string): FileSupportRecord | null {
	const extension = getFileExtension(filePathOrName);
	return extension ? (FILE_SUPPORT_RECORDS[extension] ?? null) : null;
}

function getCategoryExtensions(category: Exclude<FileCategory, 'other'>): string[] {
	return Object.entries(FILE_SUPPORT_RECORDS)
		.filter(([, capability]) => capability.category === category)
		.map(([extension]) => extension);
}

function formatSummaryList(groups: string[]): string {
	if (groups.length === 0) return '';
	if (groups.length === 1) return groups[0];
	if (groups.length === 2) return `${groups[0]} and ${groups[1]}`;
	return `${groups.slice(0, -1).join(', ')}, and ${groups.at(-1)}`;
}

function buildSummaryLabels(predicate: (record: FileSupportRecord) => boolean): string {
	const groups = [
		...new Set(
			Object.values(FILE_SUPPORT_RECORDS)
				.filter(predicate)
				.map((record) => record.summaryGroupLabel)
		)
	];
	return formatSummaryList(groups);
}

// ------------------------------------------------------------------
// Public API — Inference functions
// ------------------------------------------------------------------

export function getFileCategory(filePathOrName: string): FileCategory {
	const extension = getFileExtension(filePathOrName);
	return (extension ? EXTENSION_MAP[extension] : null) ?? 'other';
}

export function getFileSupportProfile(filePathOrName: string): FileSupportProfile {
	const extension = getFileExtension(filePathOrName);
	const record = getSupportRecord(filePathOrName);
	const previewKind = record?.previewKind ?? 'none';
	const thumbnailKind = record?.thumbnailKind ?? 'none';

	return {
		id: extension,
		category: record?.category ?? getFileCategory(filePathOrName),
		uploadAllowed: record?.uploadAllowed ?? false,
		attachAllowed: record?.attachAllowed ?? false,
		previewKind,
		thumbnailKind,
		previewSupported: previewKind !== 'none',
		thumbnailEligible: thumbnailKind !== 'none' && record?.thumbnailPriority != null,
		thumbnailPriority: record?.thumbnailPriority ?? null,
		mimeType: record?.mimeType ?? null,
		estimateAiStaticPolicy: record?.estimateAiStaticPolicy ?? 'unsupported',
		estimateAiPreparedArtifactKind: record?.estimateAiPreparedArtifactKind ?? null,
		summaryGroupLabel: record?.summaryGroupLabel ?? 'Other',
		userFacingSupportLabel: record?.userFacingSupportLabel ?? 'Other file',
		agentNote: record?.agentNote ?? null
	};
}

export function getGeneralFileCapability(filePathOrName: string): GeneralFileCapability {
	const profile = getFileSupportProfile(filePathOrName);
	return {
		id: profile.id,
		category: profile.category,
		uploadAllowed: profile.uploadAllowed,
		attachAllowed: profile.attachAllowed,
		previewKind: profile.previewKind,
		thumbnailKind: profile.thumbnailKind,
		thumbnailPriority: profile.thumbnailPriority,
		mimeType: profile.mimeType,
		previewSupported: profile.previewSupported,
		thumbnailEligible: profile.thumbnailEligible
	};
}

export function getGeneralFilePreviewKind(filePathOrName: string): GeneralFilePreviewKind {
	return getGeneralFileCapability(filePathOrName).previewKind;
}

export function getGeneralFileThumbnailKind(filePathOrName: string): GeneralFileThumbnailKind {
	return getGeneralFileCapability(filePathOrName).thumbnailKind;
}

export function isGeneralProjectFileUploadAllowed(filePathOrName: string): boolean {
	return getGeneralFileCapability(filePathOrName).uploadAllowed;
}

export function getGeneralProjectFileUploadExtensions(): string[] {
	return Object.keys(FILE_SUPPORT_RECORDS).filter((extension) =>
		isGeneralProjectFileUploadAllowed(`file.${extension}`)
	);
}

export function getGeneralProjectFileSummary(): string {
	return buildSummaryLabels((record) => record.uploadAllowed);
}

export const GENERAL_PROJECT_FILE_UPLOAD_EXTENSIONS = getGeneralProjectFileUploadExtensions();
export const GENERAL_PROJECT_FILE_SUMMARY = getGeneralProjectFileSummary();

export function getGeneralFileThumbnailPriority(filePathOrName: string): number | null {
	return getGeneralFileCapability(filePathOrName).thumbnailPriority;
}

export function inferGeneralFileMimeType(filePathOrName: string): string | null {
	return getGeneralFileCapability(filePathOrName).mimeType;
}

// ------------------------------------------------------------------
// Derived extension lists
// ------------------------------------------------------------------

export const FILE_EXTENSIONS = {
	pdf: getCategoryExtensions('pdf'),
	image: getCategoryExtensions('image'),
	text: getCategoryExtensions('text'),
	cad: getCategoryExtensions('cad'),
	document: getCategoryExtensions('document'),
	archive: getCategoryExtensions('archive'),
	email: getCategoryExtensions('email')
} as const;

/** Extensions accepted for brand/company logo uploads. Supports common web image formats. */
export const BRAND_LOGO_EXTENSIONS = ['png', 'jpg', 'jpeg', 'svg'] as const;
export const BRAND_LOGO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml'] as const;

/** Dot-prefixed extension list for HTML file-open accept attributes. */
export const ALL_ACCEPTED_EXTENSIONS: string[] = Object.values(FILE_EXTENSIONS)
	.flat()
	.filter((ext) => isGeneralProjectFileUploadAllowed(`file.${ext}`))
	.map((ext) => `.${ext}`);

// ------------------------------------------------------------------
// Estimate AI static policy
// ------------------------------------------------------------------

function getEstimateAiStaticPolicyFromMimeType(
	mimeType: string | null | undefined
): EstimateAiStaticPolicy | null {
	const normalised = mimeType?.trim().toLowerCase() ?? '';
	if (!normalised) return null;
	if (normalised === 'application/pdf') return 'native_file';
	if (normalised === 'image/png' || normalised === 'image/jpeg' || normalised === 'image/webp') {
		return 'native_image';
	}
	if (
		normalised === 'image/gif' ||
		normalised === 'image/bmp' ||
		normalised === 'image/svg+xml' ||
		normalised === 'image/tiff'
	) {
		return 'converted_image';
	}
	if (
		normalised === 'text/plain' ||
		normalised === 'text/csv' ||
		normalised === 'application/json' ||
		normalised === 'application/xml' ||
		normalised === 'text/xml' ||
		normalised === 'message/rfc822' ||
		normalised === 'application/vnd.ms-outlook'
	) {
		return 'text';
	}
	if (
		normalised === 'application/step' ||
		normalised === 'application/iges' ||
		normalised === 'model/stl' ||
		normalised === 'model/obj' ||
		normalised === 'model/3mf' ||
		normalised === 'image/vnd.dxf' ||
		normalised === 'application/acad'
	) {
		return 'cad_renders';
	}
	if (
		normalised === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
		normalised === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
	) {
		return 'text';
	}
	return null;
}

export function getEstimateAiStaticPolicy(
	filePathOrName: string,
	mimeType?: string | null
): EstimateAiStaticPolicy {
	return (
		getEstimateAiStaticPolicyFromMimeType(mimeType) ??
		getFileSupportProfile(filePathOrName).estimateAiStaticPolicy
	);
}

export function getEstimateAiPreparedArtifactKind(
	filePathOrName: string,
	mimeType?: string | null
): EstimateAiPreparedArtifactKind | null {
	const staticPolicy = getEstimateAiStaticPolicy(filePathOrName, mimeType);
	if (staticPolicy === 'native_file') return 'pdf';
	if (staticPolicy === 'native_image') return 'image';
	if (staticPolicy === 'converted_image') return 'image';
	if (staticPolicy === 'text') return 'text';
	if (staticPolicy === 'cad_renders') return 'cad';
	return null;
}

export function getEstimateAiSummary(): string {
	return buildSummaryLabels((record) => record.estimateAiStaticPolicy !== 'unsupported');
}

/** Return all extensions whose preview requires a dedicated derived preview (not raw viewer). */
export function getDerivedPreviewExtensions(): string[] {
	return Object.entries(FILE_SUPPORT_RECORDS)
		.filter(
			([, record]) =>
				record.previewKind === 'document' ||
				record.previewKind === 'spreadsheet' ||
				record.previewKind === 'dxf' ||
				record.previewKind === 'dwg' ||
				record.previewKind === 'tiff'
		)
		.map(([ext]) => ext);
}

/** Return all extensions that should show as spreadsheet-type in the setup-import wizard. */
export function getSetupImportExtensions(): string[] {
	return Object.entries(FILE_SUPPORT_RECORDS)
		.filter(
			([ext, record]) =>
				record.previewKind === 'spreadsheet' ||
				(record.category === 'text' && (ext === 'csv' || ext === 'tsv'))
		)
		.map(([ext]) => ext);
}

/** Return all extensions that should show as spreadsheet-type (for generic spreadsheet pickers). */
export function getSpreadsheetExtensions(): string[] {
	return Object.entries(FILE_SUPPORT_RECORDS)
		.filter(([, record]) => record.previewKind === 'spreadsheet')
		.map(([ext]) => ext);
}

/** Return all extensions that are archives. */
export function getArchiveExtensions(): string[] {
	return Object.entries(FILE_SUPPORT_RECORDS)
		.filter(([, record]) => record.category === 'archive')
		.map(([ext]) => ext);
}

/** Return all extensions that are email files. */
export function getEmailExtensions(): string[] {
	return Object.entries(FILE_SUPPORT_RECORDS)
		.filter(([, record]) => record.category === 'email')
		.map(([ext]) => ext);
}
