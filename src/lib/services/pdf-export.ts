import { invoke } from '@tauri-apps/api/core';
import { PDFDocument } from 'pdf-lib';

import { readVaultFile } from './assets';
import { createLogger } from './logger.js';
import { summariseQuotePackageWarnings } from './quote-pdf-export.js';
import {
	createQuotePdfPackageCacheKey,
	generateQuotePdfBytes,
	getCachedQuotePdfPackage,
	setCachedQuotePdfPackage,
	type QuotePdfPayload
} from './quote-pdf-document';
import type { QuotePackageAttachmentOutcome } from '$lib/types/index.js';

export type { PdfLineItem, QuotePdfPayload } from './quote-pdf-document';

export interface QuotePackageAttachmentSelection {
	file_id?: string | null;
	file_name: string;
	file_path: string;
}

export interface QuotePackagePreview {
	bytes: Uint8Array;
	attachmentOutcomes: QuotePackageAttachmentOutcome[];
	warnings: string[];
}

const log = createLogger('quotePdfService');

function clonePdfBytes(bytes: Uint8Array): Uint8Array {
	return new Uint8Array(bytes);
}

async function buildQuotePackagePreview(
	payload: QuotePdfPayload,
	attachments: QuotePackageAttachmentSelection[] = []
): Promise<QuotePackagePreview> {
	const drawingPaths = attachments.map((attachment) => attachment.file_path);
	const cached =
		drawingPaths.length === 0 ? getCachedQuotePdfPackage(payload, drawingPaths) : undefined;
	if (cached) {
		return {
			bytes: clonePdfBytes(cached),
			attachmentOutcomes: [],
			warnings: []
		};
	}

	const quoteBytes = await generateQuotePdfBytes(payload);
	if (attachments.length === 0) {
		setCachedQuotePdfPackage(payload, drawingPaths, quoteBytes);
		return {
			bytes: clonePdfBytes(quoteBytes),
			attachmentOutcomes: [],
			warnings: []
		};
	}

	const mergedPdf = await PDFDocument.load(clonePdfBytes(quoteBytes), { updateMetadata: false });
	const attachmentOutcomes: QuotePackageAttachmentOutcome[] = [];

	const loadedAttachments = await Promise.all(
		attachments.map(async (attachment) => {
			try {
				const drawingBytes = await readVaultFile(attachment.file_path);
				const drawingDoc = await PDFDocument.load(drawingBytes, { updateMetadata: false });
				return { attachment, drawingDoc, error: null };
			} catch (err) {
				return { attachment, drawingDoc: null, error: err };
			}
		})
	);

	for (const { attachment, drawingDoc, error } of loadedAttachments) {
		try {
			if (error || !drawingDoc) throw error;
			const copiedPages = await mergedPdf.copyPages(drawingDoc, drawingDoc.getPageIndices());
			copiedPages.forEach((page) => mergedPdf.addPage(page));
			attachmentOutcomes.push({
				file_id: attachment.file_id ?? null,
				file_name: attachment.file_name,
				status: 'appended',
				reason: null
			});
		} catch (err) {
			log.error('Failed to attach drawing', { path: attachment.file_path, error: err });
			attachmentOutcomes.push({
				file_id: attachment.file_id ?? null,
				file_name: attachment.file_name,
				status: 'omitted',
				reason: 'Could not read or append the selected PDF.'
			});
		}
	}

	const mergedBytes = await mergedPdf.save({ addDefaultPage: false, useObjectStreams: false });
	return {
		bytes: clonePdfBytes(mergedBytes),
		attachmentOutcomes,
		warnings: summariseQuotePackageWarnings(attachmentOutcomes)
	};
}

export async function getQuotePackagePreview(
	payload: QuotePdfPayload,
	attachments: QuotePackageAttachmentSelection[] = []
): Promise<QuotePackagePreview> {
	return await buildQuotePackagePreview(payload, attachments);
}

export async function saveQuotePackageBytes(
	rfqNumber: string,
	bytes: Uint8Array,
	openFile = true
): Promise<void> {
	const safeBytes = clonePdfBytes(bytes);

	await invoke('save_quote_pdf', {
		rfqNumber,
		bytes: Array.from(safeBytes),
		openFile
	});
}

export async function generateQuotePackage(
	payload: QuotePdfPayload,
	attachments: QuotePackageAttachmentSelection[] = []
): Promise<void> {
	const preview = await getQuotePackagePreview(payload, attachments);
	await saveQuotePackageBytes(payload.rfq_number, preview.bytes);
}

export async function generateQuotePdf(
	payload: QuotePdfPayload,
	attachments: QuotePackageAttachmentSelection[] = []
): Promise<void> {
	return await generateQuotePackage(payload, attachments);
}

export { createQuotePdfPackageCacheKey };
