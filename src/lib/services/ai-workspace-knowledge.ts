import { BaseDirectory, copyFile, mkdir, remove, stat, writeTextFile } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import { JsonStringSchema } from '$lib/schemas/index.js';
import {
	ACCOUNT_ROOT,
	GENERAL_PROJECT_FILE_UPLOAD_EXTENSIONS,
	getFileSupportProfile,
	inferGeneralFileMimeType
} from '$lib/constants/index.js';
import { readAppLocalFile, removeDerivedPreviewCacheForSource } from '$lib/services/assets.js';
import { getDerivedPreview } from '$lib/services/derived-previews.js';
import { allowExternalFileRead } from '$lib/services/external-file-access.js';
import { createLogger } from '$lib/services/logger.js';
import { isTauri } from '$lib/utils/env.js';
import { storeService } from '$lib/services/store.js';
import type {
	AiOverrideEvent,
	AiWorkspaceKnowledgeContext,
	WorkspaceAiFeedbackEntry,
	WorkspaceAiKnowledgeFile
} from '$lib/types/index.js';

const WORKSPACE_AI_KNOWLEDGE_ROOT = `${ACCOUNT_ROOT}/workspace-ai-knowledge`;
export const WORKSPACE_AI_KNOWLEDGE_MAX_FILES = 5;
export const WORKSPACE_AI_PLAYBOOK_MAX_CHARS = 1_200;
export const WORKSPACE_AI_FEEDBACK_MAX_CHARS = 400;
export const WORKSPACE_AI_KNOWLEDGE_MAX_FILE_BYTES = 10 * 1024 * 1024;
const WORKSPACE_AI_SKILL_MAX_CHARS = 4_000;
const WORKSPACE_AI_SKILL_FILE_NAME = 'workspace-ai-skill.md';
const MAX_FILE_TEXT_CHARS = 2_400;
const MAX_TOTAL_TEXT_CHARS = 8_000;
const MAX_INCLUDED_FEEDBACK_ENTRIES = 6;
const MAX_LEARNED_CORRECTIONS = 8;

const WORKSPACE_AI_KNOWLEDGE_ALLOWED_CATEGORIES = new Set(['pdf', 'text', 'document']);
const log = createLogger('workspaceAiKnowledge');

export function isWorkspaceAiKnowledgeFileAllowed(filePathOrName: string): boolean {
	const profile = getFileSupportProfile(filePathOrName);
	return (
		profile.uploadAllowed &&
		WORKSPACE_AI_KNOWLEDGE_ALLOWED_CATEGORIES.has(profile.category) &&
		(profile.previewKind === 'pdf' ||
			profile.previewKind === 'text' ||
			profile.previewKind === 'document' ||
			profile.previewKind === 'spreadsheet')
	);
}

export function getWorkspaceAiKnowledgeUploadExtensions(): string[] {
	return GENERAL_PROJECT_FILE_UPLOAD_EXTENSIONS.filter((extension) =>
		isWorkspaceAiKnowledgeFileAllowed(`file.${extension}`)
	);
}

const WORKSPACE_AI_KNOWLEDGE_EXTENSION_LABELS: Record<string, string> = {
	pdf: 'PDF',
	docx: 'DOCX',
	xlsx: 'XLSX',
	txt: 'TXT',
	csv: 'CSV',
	md: 'Markdown',
	log: 'LOG',
	json: 'JSON',
	xml: 'XML'
};

function joinHumanList(items: string[]): string {
	if (items.length <= 1) return items.join('');
	return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
}

export function getWorkspaceAiKnowledgeUploadSummary(): string {
	const labels = getWorkspaceAiKnowledgeUploadExtensions().map(
		(extension) => WORKSPACE_AI_KNOWLEDGE_EXTENSION_LABELS[extension] ?? extension.toUpperCase()
	);
	return joinHumanList(labels);
}

type StoredWorkspaceKnowledgeFile = {
	filePath: string;
	byteSize: number;
	mimeType: string | null;
};

type NativePdfTextExtractionResult = {
	text: string;
	pageCount: number;
};

type LearnedCorrection = {
	fieldPath: string;
	originalValue: string;
	finalValue: string;
	occurrenceCount: number;
	reinforcedByFeedback: boolean;
};

function normaliseText(value: string | null | undefined): string {
	return (value ?? '')
		.split('\0')
		.join('')
		.replace(/\r\n/g, '\n')
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function clampText(value: string, maxLength: number): { text: string; truncated: boolean } {
	if (value.length <= maxLength) {
		return { text: value, truncated: false };
	}

	return {
		text: `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`,
		truncated: true
	};
}

function fileNameFromPath(path: string): string {
	return path.split(/[/\\]/).pop() ?? 'knowledge-file';
}

function slugifyFileName(name: string): string {
	const parts = fileNameFromPath(name).split('.');
	const extension = parts.length > 1 ? (parts.pop() ?? '') : '';
	const stem = parts.join('.') || 'knowledge-file';
	const safeStem = stem
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48);
	const safeExtension = extension
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '')
		.slice(0, 12);
	return safeExtension
		? `${safeStem || 'knowledge-file'}.${safeExtension}`
		: safeStem || 'knowledge-file';
}

function htmlToPlainText(html: string): string {
	const parser = new DOMParser();
	const document = parser.parseFromString(`<body>${html}</body>`, 'text/html');
	const blocks = Array.from(
		document.body.querySelectorAll('p,li,tr,h1,h2,h3,h4,h5,h6,blockquote,pre,div,caption,td,th')
	)
		.map((element) => element.textContent?.trim() ?? '')
		.filter(Boolean);

	return normaliseText(blocks.length > 0 ? blocks.join('\n') : (document.body.textContent ?? ''));
}

function spreadsheetPreviewToText(
	preview: Extract<Awaited<ReturnType<typeof getDerivedPreview>>, { kind: 'spreadsheet' }>
): string {
	return normaliseText(
		preview.sheets
			.map((sheet) => {
				const lines: string[] = [`Sheet: ${sheet.name}`];
				if (sheet.headers.length > 0) {
					lines.push(`Headers: ${sheet.headers.join(' | ')}`);
				}
				for (const row of sheet.rows.slice(0, 120)) {
					const visibleCells = row.filter((cell) => cell.trim().length > 0);
					if (visibleCells.length > 0) {
						lines.push(visibleCells.join(' | '));
					}
				}
				return lines.join('\n');
			})
			.join('\n\n')
	);
}

async function readPdfTextFromAppLocal(filePath: string): Promise<string> {
	if (isTauri()) {
		try {
			const result = await invoke<NativePdfTextExtractionResult>('extract_pdf_text', {
				filePath
			});
			return normaliseText(result.text);
		} catch (error) {
			log.warn('Native PDF text extraction failed for workspace knowledge', {
				filePath,
				error
			});
			throw new Error(
				error instanceof Error && error.message
					? error.message
					: 'Failed to read the PDF knowledge file in the desktop runtime.',
				{ cause: error }
			);
		}
	}

	const bytes = await readAppLocalFile(filePath);
	const pdfjs =
		(await import('pdfjs-dist/legacy/build/pdf.mjs')) as typeof import('pdfjs-dist/legacy/build/pdf.mjs');
	const loadingParams = {
		data: new Uint8Array(bytes),
		useWasm: false,
		disableWorker: true
	};
	const loadingTask = pdfjs.getDocument(loadingParams as Parameters<typeof pdfjs.getDocument>[0]);
	const pdfDocument = (await loadingTask.promise) as {
		numPages: number;
		getPage: (pageNumber: number) => Promise<{
			getTextContent: () => Promise<{ items: Array<{ str?: string }> }>;
		}>;
	};

	const pagePromises = Array.from({ length: pdfDocument.numPages }, async (_, index) => {
		const pageNumber = index + 1;
		const page = await pdfDocument.getPage(pageNumber);
		const textContent = await page.getTextContent();
		const pageText = textContent.items
			.map((item) => item.str ?? '')
			.join(' ')
			.replace(/\s+/g, ' ')
			.trim();
		if (pageText) {
			return `Page ${pageNumber}: ${pageText}`;
		}
		return null;
	});

	const pageResults = await Promise.all(pagePromises);
	const pageTexts = pageResults.filter((text): text is string => text !== null);

	return normaliseText(pageTexts.join('\n\n'));
}

export async function extractWorkspaceAiKnowledgeText(filePath: string): Promise<string> {
	const previewKind = inferGeneralFileMimeType(filePath) === 'application/pdf' ? 'pdf' : null;

	if (previewKind === 'pdf') {
		return readPdfTextFromAppLocal(filePath);
	}

	const generalPreview = await getDerivedPreview(filePath, { fileSource: 'appLocal' }).catch(
		() => null
	);
	if (generalPreview?.kind === 'document') {
		return htmlToPlainText(generalPreview.html);
	}
	if (generalPreview?.kind === 'spreadsheet') {
		return spreadsheetPreviewToText(generalPreview);
	}
	if (generalPreview?.kind === 'text') {
		return normaliseText(generalPreview.lines.join('\n'));
	}

	const bytes = await readAppLocalFile(filePath);
	return normaliseText(new TextDecoder('utf-8').decode(bytes));
}

export async function storeWorkspaceAiKnowledgeFile(params: {
	workspaceId: string;
	fileId: string;
	sourcePath: string;
}): Promise<StoredWorkspaceKnowledgeFile> {
	if (!isTauri()) {
		throw new Error('Workspace AI knowledge files require the desktop runtime.');
	}

	const readablePath = await allowExternalFileRead(params.sourcePath.replace(/^file:\/\//, ''));
	const info = await stat(readablePath);
	if (info.isDirectory) {
		throw new Error('Knowledge attachments must be files, not folders.');
	}
	if (Number(info.size ?? 0) > WORKSPACE_AI_KNOWLEDGE_MAX_FILE_BYTES) {
		throw new Error('Knowledge attachments must stay under 10 MB each.');
	}

	const safeName = slugifyFileName(readablePath);
	const targetDir = `${WORKSPACE_AI_KNOWLEDGE_ROOT}/${params.workspaceId}`;
	const targetPath = `${targetDir}/${params.fileId}-${safeName}`;
	await storeService.withManagedFileMutation(async () => {
		await mkdir(targetDir, { baseDir: BaseDirectory.AppLocalData, recursive: true });
		await copyFile(readablePath, targetPath, { toPathBaseDir: BaseDirectory.AppLocalData });
	});

	return {
		filePath: targetPath,
		byteSize: Number(info.size ?? 0),
		mimeType: inferGeneralFileMimeType(readablePath)
	};
}

export async function removeWorkspaceAiKnowledgeFile(path: string): Promise<void> {
	if (!isTauri() || !path) return;
	await storeService.withManagedFileMutation(() =>
		remove(path, { baseDir: BaseDirectory.AppLocalData })
	);
	await removeDerivedPreviewCacheForSource(path);
}

export function getWorkspaceAiSkillFilePath(workspaceId: string): string {
	return `${WORKSPACE_AI_KNOWLEDGE_ROOT}/${workspaceId}/${WORKSPACE_AI_SKILL_FILE_NAME}`;
}

export async function persistWorkspaceAiSkillFile(params: {
	workspaceId: string;
	skillMarkdown: string | null;
}): Promise<string | null> {
	if (!isTauri()) return null;
	const targetDir = `${WORKSPACE_AI_KNOWLEDGE_ROOT}/${params.workspaceId}`;
	const targetPath = getWorkspaceAiSkillFilePath(params.workspaceId);
	return storeService.withManagedFileMutation(async () => {
		if (!params.skillMarkdown?.trim()) {
			await remove(targetPath, { baseDir: BaseDirectory.AppLocalData }).catch(() => undefined);
			return null;
		}

		await mkdir(targetDir, {
			baseDir: BaseDirectory.AppLocalData,
			recursive: true
		});
		await writeTextFile(targetPath, params.skillMarkdown, {
			baseDir: BaseDirectory.AppLocalData
		});
		return targetPath;
	});
}

function formatValuePreview(value: string): string {
	const clean = normaliseText(value);
	if (!clean) return 'blank';
	return clampText(clean.replace(/\s+/g, ' '), 72).text;
}

function normaliseLearningValue(value: string): string {
	return formatValuePreview(value).toLowerCase();
}

function serialiseOverrideValue(value: string): string {
	try {
		const parsed = JsonStringSchema.parse(value);
		if (parsed == null) return 'blank';
		if (typeof parsed === 'string') return parsed;
		if (typeof parsed === 'number' || typeof parsed === 'boolean') return String(parsed);
		return JSON.stringify(parsed);
	} catch {
		return value;
	}
}

function normaliseFieldPath(path: string): string {
	return path.replace(/\[\d+\]/g, '[*]');
}

function formatFieldPathLabel(path: string): string {
	const normalized = normaliseFieldPath(path);
	if (normalized.includes('unit_rate')) return 'Rates';
	if (normalized.includes('quantity')) return 'Quantities';
	if (normalized.includes('source_id')) return 'Source links';
	if (normalized.includes('cost_code_id')) return 'Cost codes';
	if (normalized.includes('classification_system_id')) return 'Classifications';
	if (normalized.includes('wbs_root_node_id') || normalized.includes('wbs_node_id'))
		return 'Structure';
	if (normalized.includes('applied_template_id')) return 'Templates';
	if (normalized.includes('applied_preset_id')) return 'Presets';
	return normalized
		.replace(/^current\./, '')
		.replace(/^estimate\./, '')
		.replace(/\[\*\]/g, '')
		.replace(/[_./]+/g, ' ')
		.trim();
}

function buildLearnedCorrections(params: {
	overrideEvents: AiOverrideEvent[];
	feedbackEntries: WorkspaceAiFeedbackEntry[];
}): LearnedCorrection[] {
	const feedbackRunIds = new Set(params.feedbackEntries.map((entry) => entry.runId));
	const grouped = new Map<
		string,
		{
			fieldPath: string;
			originalValue: string;
			finalValue: string;
			occurrenceCount: number;
			reinforcedByFeedback: boolean;
		}
	>();

	for (const event of params.overrideEvents) {
		const fieldPath = normaliseFieldPath(event.field_path);
		const originalValue = serialiseOverrideValue(event.original_value_json);
		const finalValue = serialiseOverrideValue(event.final_value_json);
		const normalizedOriginal = normaliseLearningValue(originalValue);
		const normalizedFinal = normaliseLearningValue(finalValue);
		if (!normalizedOriginal && !normalizedFinal) continue;
		if (normalizedOriginal === normalizedFinal) continue;
		const key = [fieldPath, normalizedOriginal, normalizedFinal].join('|');
		const existing = grouped.get(key);
		if (existing) {
			existing.occurrenceCount += 1;
			existing.reinforcedByFeedback ||= feedbackRunIds.has(event.run_id);
			continue;
		}
		grouped.set(key, {
			fieldPath,
			originalValue,
			finalValue,
			occurrenceCount: 1,
			reinforcedByFeedback: feedbackRunIds.has(event.run_id)
		});
	}

	return [...grouped.values()]
		.filter((entry) => entry.occurrenceCount >= 2 || entry.reinforcedByFeedback)
		.sort((left, right) => {
			if (left.reinforcedByFeedback !== right.reinforcedByFeedback) {
				return left.reinforcedByFeedback ? -1 : 1;
			}
			return right.occurrenceCount - left.occurrenceCount;
		})
		.slice(0, MAX_LEARNED_CORRECTIONS);
}

function buildFeedbackSection(entries: WorkspaceAiFeedbackEntry[]): {
	markdown: string | null;
	includedCount: number;
} {
	const lines = entries
		.map((entry) => normaliseText(entry.feedbackText))
		.filter(Boolean)
		.slice(0, MAX_INCLUDED_FEEDBACK_ENTRIES)
		.map((feedback) => `- ${clampText(feedback, WORKSPACE_AI_FEEDBACK_MAX_CHARS).text}`);
	return {
		markdown: lines.length > 0 ? `## Recent estimator feedback\n\n${lines.join('\n')}` : null,
		includedCount: lines.length
	};
}

function buildCorrectionsSection(corrections: LearnedCorrection[]): string | null {
	if (corrections.length === 0) return null;
	return [
		'## Repeated corrections',
		'',
		...corrections.map((correction) => {
			const fieldLabel = formatFieldPathLabel(correction.fieldPath);
			const originalValue = formatValuePreview(correction.originalValue);
			const finalValue = formatValuePreview(correction.finalValue);
			const note = correction.reinforcedByFeedback ? 'feedback-backed' : 'repeat edit';
			return `- ${fieldLabel}: prefer ${finalValue} over ${originalValue} (${correction.occurrenceCount} confirmed edits, ${note})`;
		})
	].join('\n');
}

function buildSkillMarkdown(params: {
	playbookText: string;
	fileSections: string[];
	feedbackSection: string | null;
	correctionsSection: string | null;
	sourceSummary: {
		fileCount: number;
		includedFileCount: number;
		feedbackEntryCount: number;
		includedFeedbackCount: number;
		learnedCorrectionCount: number;
	};
}): { markdown: string | null; truncated: boolean } {
	const sections = [
		'# Workspace Estimating Skill',
		'',
		'## Role',
		'Use this workspace guidance to preserve the customer’s estimating conventions without overriding direct project evidence or validated workspace records.',
		params.playbookText ? `\n## Business playbook\n\n${params.playbookText}` : null,
		params.fileSections.length > 0
			? `\n## Reference knowledge\n\n${params.fileSections.join('\n\n')}`
			: null,
		params.feedbackSection ? `\n${params.feedbackSection}` : null,
		params.correctionsSection ? `\n${params.correctionsSection}` : null,
		[
			'',
			'## Guardrails',
			'',
			'- Evidence overrides workspace habits when they conflict.',
			'- Real workspace records override vague preferences.',
			'- Weak matches stay unresolved instead of guessed.',
			'- Local quote math remains the source of truth.',
			'',
			'## Source summary',
			'',
			`- Included files: ${params.sourceSummary.includedFileCount} of ${params.sourceSummary.fileCount}`,
			`- Included feedback notes: ${params.sourceSummary.includedFeedbackCount} of ${params.sourceSummary.feedbackEntryCount}`,
			`- Learned correction patterns: ${params.sourceSummary.learnedCorrectionCount}`
		].join('\n')
	]
		.filter(Boolean)
		.join('\n');

	const clamped = clampText(normaliseText(sections), WORKSPACE_AI_SKILL_MAX_CHARS);
	return {
		markdown: clamped.text || null,
		truncated: clamped.truncated
	};
}

function simpleTextHash(value: string): string {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function compilePlaybookSection(playbookText: string, remainingChars: number) {
	if (!playbookText) return { markdown: null, consumedChars: 0, truncated: false };
	const next = clampText(playbookText, Math.min(remainingChars, MAX_FILE_TEXT_CHARS));
	if (!next.text) return { markdown: null, consumedChars: 0, truncated: next.truncated };
	return {
		markdown: `# Workspace estimating playbook\n\n${next.text}`,
		consumedChars: next.text.length,
		truncated: next.truncated
	};
}

function compileFilesSection(files: WorkspaceAiKnowledgeFile[], remainingChars: number) {
	const compiledSections: string[] = [];
	const fileSections: string[] = [];
	let includedFileCount = 0;
	let currentRemainingChars = remainingChars;
	let truncated = false;

	const processedFiles = files.map((file) => {
		const cleanText = normaliseText(file.extractedText);
		const next = cleanText
			? clampText(cleanText, Math.min(currentRemainingChars, MAX_FILE_TEXT_CHARS))
			: { text: '', truncated: false };
		if (next.text && currentRemainingChars > 0) {
			compiledSections.push(`## ${file.originalName}\n\n${next.text}`);
			fileSections.push(`### ${file.originalName}\n\n${next.text}`);
			currentRemainingChars = Math.max(0, currentRemainingChars - next.text.length);
			includedFileCount += 1;
		}
		truncated ||= next.truncated || (Boolean(cleanText) && !next.text);

		return {
			id: file.id,
			originalName: file.originalName,
			mimeType: file.mimeType,
			byteSize: file.byteSize,
			characterCount: cleanText.length,
			excerpt: cleanText ? clampText(cleanText, 180).text : null
		};
	});

	return {
		compiledSections,
		fileSections,
		processedFiles,
		includedFileCount,
		consumedChars: remainingChars - currentRemainingChars,
		truncated
	};
}

function compileAppendixSection(markdown: string | null, remainingChars: number) {
	if (!markdown || remainingChars <= 0)
		return { markdown: null, consumedChars: 0, truncated: false };
	const next = clampText(markdown, remainingChars);
	if (!next.text) return { markdown: null, consumedChars: 0, truncated: next.truncated };
	return {
		markdown: next.text,
		consumedChars: next.text.length,
		truncated: next.truncated
	};
}

export function buildWorkspaceAiKnowledgeContext(params: {
	playbookText: string;
	files: WorkspaceAiKnowledgeFile[];
	feedbackEntries?: WorkspaceAiFeedbackEntry[];
	overrideEvents?: AiOverrideEvent[];
	skillFilePath?: string | null;
}): AiWorkspaceKnowledgeContext {
	const playbookText = normaliseText(params.playbookText);
	const compiledSections: string[] = [];
	let remainingChars = MAX_TOTAL_TEXT_CHARS;
	let truncated = false;

	const feedbackEntries = params.feedbackEntries ?? [];
	const learnedCorrections = buildLearnedCorrections({
		overrideEvents: params.overrideEvents ?? [],
		feedbackEntries
	});

	const playbookResult = compilePlaybookSection(playbookText, remainingChars);
	if (playbookResult.markdown) {
		compiledSections.push(playbookResult.markdown);
		remainingChars -= playbookResult.consumedChars;
		truncated ||= playbookResult.truncated;
	}

	const filesResult = compileFilesSection(params.files, remainingChars);
	compiledSections.push(...filesResult.compiledSections);
	remainingChars -= filesResult.consumedChars;
	truncated ||= filesResult.truncated;

	const feedbackSection = buildFeedbackSection(feedbackEntries);
	const feedbackResult = compileAppendixSection(feedbackSection.markdown, remainingChars);
	if (feedbackResult.markdown) {
		compiledSections.push(feedbackResult.markdown);
		remainingChars -= feedbackResult.consumedChars;
		truncated ||= feedbackResult.truncated;
	}

	const correctionsSection = buildCorrectionsSection(learnedCorrections);
	const correctionsResult = compileAppendixSection(correctionsSection, remainingChars);
	if (correctionsResult.markdown) {
		compiledSections.push(correctionsResult.markdown);

		truncated ||= correctionsResult.truncated;
	}

	const compiledMarkdown = compiledSections.join('\n\n').trim();
	const skill = buildSkillMarkdown({
		playbookText,
		fileSections: filesResult.fileSections,
		feedbackSection: feedbackSection.markdown,
		correctionsSection,
		sourceSummary: {
			fileCount: params.files.length,
			includedFileCount: filesResult.includedFileCount,
			feedbackEntryCount: feedbackEntries.length,
			includedFeedbackCount: feedbackSection.includedCount,
			learnedCorrectionCount: learnedCorrections.length
		}
	});
	truncated ||= skill.truncated;

	return {
		playbookText: playbookText || null,
		compiledMarkdown: compiledMarkdown || null,
		skillMarkdown: skill.markdown,
		skillHash: skill.markdown ? simpleTextHash(skill.markdown) : null,
		skillFilePath: params.skillFilePath ?? null,
		sourceSummary: {
			hasPlaybook: playbookText.length > 0,
			fileCount: params.files.length,
			includedFileCount: filesResult.includedFileCount,
			feedbackEntryCount: feedbackEntries.length,
			includedFeedbackCount: feedbackSection.includedCount,
			learnedCorrectionCount: learnedCorrections.length,
			hasLearningAppendix: feedbackSection.includedCount > 0 || learnedCorrections.length > 0,
			truncated,
			totalCharacterCount: compiledMarkdown.length
		},
		files: filesResult.processedFiles
	};
}
