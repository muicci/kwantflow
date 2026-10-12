import {
	PDFDocument,
	StandardFonts,
	rgb,
	type PDFFont,
	type PDFImage,
	type PDFPage
} from 'pdf-lib';
import {
	formatLocalisedCurrency,
	formatLocalisedDate,
	formatLocalisedPercent,
	getQuoteMessage,
	parseDocumentDate as parseDocumentDateImpl,
	resolveLocalisationContext
} from './localisation.js';
import {
	DEFAULT_QUOTE_PDF_PAYMENT_TERMS,
	DEFAULT_QUOTE_PDF_TERMS_FALLBACK
} from './quote-pdf-export.js';

export interface PdfLineItem {
	file_name: string;
	description: string;
	quantity: number;
	lead_time: string;
	unit_price: number;
	line_total: number;
}

export interface QuotePdfPayload {
	rfq_number: string;
	contact_name: string | null;
	contact: {
		countryCode: string | null;
		businessIdLabel: string | null;
		businessIdValue: string | null;
		taxIdLabel: string | null;
		taxIdValue: string | null;
	} | null;
	project_name: string | null;
	business: {
		name: string;
		countryCode?: string | null;
		logoFilePath?: string | null;
		logoMimeType?: 'image/png' | 'image/jpeg' | null;
		logoBytes?: Uint8Array | null;
		businessIdLabel: string | null;
		businessIdValue: string | null;
		taxIdLabel: string | null;
		taxIdValue: string | null;
		taxDisplayLabel: string | null;
		taxRatePercentage: number | null;
		address: string | null;
		contactName: string | null;
		contactEmail: string | null;
		contactPhone: string | null;
		currencyCode: string | null;
		dateFormat: string | null;
		languageLocale?: string | null;
		numberLocale?: string | null;
	};
	option_label: string;
	lead_time: string;
	notes: string | null;
	line_items: PdfLineItem[];
	subtotal: number;
	gst: number;
	total: number;
	issued_date: string;
	valid_until_date: string;
	payment_terms?: string | null;
	terms_fallback?: string | null;
	footerBranding?: {
		logoMimeType?: 'image/png' | 'image/jpeg' | null;
		logoBytes?: Uint8Array | null;
	} | null;
}

export type QuotePdfTemplateId = 'default';

export interface QuotePdfRenderConfig {
	templateId?: QuotePdfTemplateId;
}

type QuotePdfSectionKey = 'projectSite' | 'commercialSummary' | 'terms';
type QuotePdfTableAlign = 'left' | 'center' | 'right';

export interface QuotePdfDescriptionLine {
	text: string;
	emphasised: boolean;
}

export interface QuotePdfRowPlan {
	index: number;
	descriptionLines: QuotePdfDescriptionLine[];
	priceText: string;
	quantityText: string;
	amountText: string;
	rowHeight: number;
}

export interface QuotePdfSectionPlan {
	key: QuotePdfSectionKey;
	label: string;
	lines: string[];
	continued: boolean;
	placement: 'beforeTable' | 'afterTable' | 'postSummary';
	topGap: number;
	height: number;
}

export interface QuotePdfDetailRowPlan {
	label: string;
	valueLines: string[];
	height: number;
}

export interface QuotePdfDetailTablePlan {
	rows: QuotePdfDetailRowPlan[];
	width: number;
	labelWidth: number;
	height: number;
}

export interface QuotePdfTextBlockLinePlan {
	text: string;
	tone: 'primary' | 'muted';
}

export interface QuotePdfTextBlockPlan {
	lines: QuotePdfTextBlockLinePlan[];
	width: number;
	height: number;
}

export interface QuotePdfHeaderPlan {
	title: string;
	businessName: string;
	businessNameLines: string[];
	customerNameLines: string[];
	customerDetails: QuotePdfTextBlockPlan;
	businessDetails: QuotePdfTextBlockPlan;
	customerTop: number;
	businessNameTop: number;
	businessDetailsTop: number;
	bottomY: number;
}

export interface QuotePdfTableColumnPlan {
	key: 'description' | 'price' | 'quantity' | 'amount';
	label: string;
	x: number;
	width: number;
	align: QuotePdfTableAlign;
}

export interface QuotePdfPagePlan {
	pageNumber: number;
	showsPrimaryHeader: boolean;
	header?: QuotePdfHeaderPlan;
	sections: QuotePdfSectionPlan[];
	pricingTable: {
		columns: QuotePdfTableColumnPlan[];
		showsHeader: boolean;
	};
	lineItems: QuotePdfRowPlan[];
	summary?: {
		subtotalText: string;
		gstText: string;
		totalText: string;
	};
	paymentTerms?: string;
}

export interface QuotePdfDocumentPlan {
	templateId: QuotePdfTemplateId;
	pages: QuotePdfPagePlan[];
}

interface QuotePdfFontContext {
	regularFont: PDFFont;
	boldFont: PDFFont;
}

interface QuotePdfRenderAssets {
	logoImage: PDFImage | null;
	footerLogoImage: PDFImage | null;
}

interface QuotePdfTemplateSectionDefinition {
	key: QuotePdfSectionKey;
	labelKey: 'quote.projectSite' | 'quote.commercialSummary' | 'quote.terms';
	placement: 'beforeTable' | 'afterTable' | 'postSummary';
	buildText: (payload: QuotePdfPayload) => string;
}

interface QuotePdfTemplateDefinition {
	id: QuotePdfTemplateId;
	sections: QuotePdfTemplateSectionDefinition[];
}

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN_X = 40;
const MARGIN_TOP = 42;
const MARGIN_BOTTOM = 34;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;
const PAGE_BODY_BOTTOM = PAGE_HEIGHT - MARGIN_BOTTOM - 22;

const QUOTE_PDF_RENDERER_VERSION = '2026-04-20-masthead-refresh-4';
const TITLE_FONT_SIZE = 17;
const BODY_FONT_SIZE = 8.75;
const BODY_LINE_HEIGHT = 12;
const SMALL_FONT_SIZE = 7.5;
const BUSINESS_NAME_FONT_SIZE = 11.2;
const BUSINESS_NAME_LINE_HEIGHT = 13;
const HEADER_TEXT_LINE_HEIGHT = 11.5;
const HEADER_TEXT_FONT_SIZE = 8.75;
const HEADER_TITLE_ROW_GAP = 12;
const CUSTOMER_NAME_FONT_SIZE = 11.2;
const CUSTOMER_NAME_LINE_HEIGHT = 13;
const FOOTER_FONT_SIZE = 7.25;
const FOOTER_PREPARED_FONT_SIZE = 7.1;
const FOOTER_LOGO_SIZE = 7.2;
const FOOTER_LOGO_GAP = 3;
const HEADER_LOGO_MAX_WIDTH = 16;
const HEADER_LOGO_MAX_HEIGHT = 16;

const DETAIL_TABLE_GAP = 28;
const CONTACT_TABLE_WIDTH = 236;
const BUSINESS_TABLE_WIDTH = CONTENT_WIDTH - CONTACT_TABLE_WIDTH - DETAIL_TABLE_GAP;
const HEADER_TO_BODY_GAP = 10;
const HEADER_META_GAP = 7;

const SECTION_LABEL_FONT_SIZE = 7.6;
const SECTION_LABEL_LINE_HEIGHT = 10;
const SECTION_HEADER_GAP = 4;
const SECTION_TOP_PADDING = 6;
const SECTION_BOTTOM_PADDING = 6;
const SECTION_OUTER_GAP = 8;
const AFTER_TABLE_SECTION_TOP_GAP = 10;

const TABLE_HEADER_HEIGHT = 22;
const TABLE_ROW_TOP_PADDING = 6;
const TABLE_ROW_BOTTOM_PADDING = 6;
const TABLE_COLUMNS: ReadonlyArray<Omit<QuotePdfTableColumnPlan, 'x'>> = [
	{ key: 'description', label: 'Description', width: 315, align: 'left' },
	{ key: 'price', label: 'Price', width: 80, align: 'right' },
	{ key: 'quantity', label: 'Quantity', width: 48, align: 'center' },
	{ key: 'amount', label: 'Amount', width: 72, align: 'right' }
];

const SUMMARY_GAP = 12;
const SUMMARY_WIDTH = 186;
const SUMMARY_HEIGHT = 62;
const PAYMENT_TERMS_HEIGHT = 16;
const CONTINUATION_HEADER_HEIGHT = 22;
const CONTINUATION_BODY_START = MARGIN_TOP + CONTINUATION_HEADER_HEIGHT;
const TEXT_PRIMARY = rgb(0.18, 0.18, 0.18);
const TEXT_SECONDARY = rgb(0.34, 0.34, 0.34);
const TEXT_MUTED = rgb(0.46, 0.46, 0.46);
const LINE_STRONG = rgb(0.58, 0.58, 0.58);
const LINE_DEFAULT = rgb(0.74, 0.74, 0.74);
const LINE_SOFT = rgb(0.86, 0.86, 0.86);
const SURFACE_SUBTLE = rgb(0.965, 0.965, 0.965);

const pdfPackageCache = new Map<string, Uint8Array>();
const DEFAULT_QUOTE_PDF_RENDER_CONFIG: Required<QuotePdfRenderConfig> = {
	templateId: 'default'
};

const DEFAULT_QUOTE_PDF_TEMPLATE: QuotePdfTemplateDefinition = {
	id: 'default',
	sections: [
		{
			key: 'projectSite',
			labelKey: 'quote.projectSite',
			placement: 'beforeTable',
			buildText: buildProjectSiteText
		},
		{
			key: 'commercialSummary',
			labelKey: 'quote.commercialSummary',
			placement: 'beforeTable',
			buildText: buildCommercialSummaryText
		},
		{
			key: 'terms',
			labelKey: 'quote.terms',
			placement: 'postSummary',
			buildText: buildTermsText
		}
	]
};

const QUOTE_PDF_TEMPLATES: Record<QuotePdfTemplateId, QuotePdfTemplateDefinition> = {
	default: DEFAULT_QUOTE_PDF_TEMPLATE
};

function clonePdfBytes(bytes: Uint8Array): Uint8Array {
	return new Uint8Array(bytes);
}

function normaliseInlineWhitespace(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

function measureText(font: PDFFont, text: string, fontSize: number): number {
	return font.widthOfTextAtSize(text, fontSize);
}

function wrapText(text: string, maxWidth: number, font: PDFFont, fontSize: number): string[] {
	const normalised = normaliseInlineWhitespace(text);
	if (!normalised) return [];

	const words = normalised.split(' ');
	const lines: string[] = [];
	let current = '';

	const flush = () => {
		if (current) {
			lines.push(current);
			current = '';
		}
	};

	const breakLongWord = (word: string) => {
		let chunk = '';
		for (const char of word) {
			const candidate = `${chunk}${char}`;
			if (chunk && measureText(font, candidate, fontSize) > maxWidth) {
				lines.push(chunk);
				chunk = char;
				continue;
			}
			chunk = candidate;
		}
		if (chunk) current = chunk;
	};

	for (const word of words) {
		const candidate = current ? `${current} ${word}` : word;
		if (measureText(font, candidate, fontSize) <= maxWidth) {
			current = candidate;
			continue;
		}

		if (current) flush();

		if (measureText(font, word, fontSize) > maxWidth) {
			breakLongWord(word);
			continue;
		}

		current = word;
	}

	flush();
	return lines;
}

function wrapParagraphs(
	text: string | null,
	maxWidth: number,
	font: PDFFont,
	fontSize: number
): string[] {
	if (!text) return [];

	return text
		.split(/\r?\n/)
		.map((paragraph) => paragraph.trim())
		.flatMap((paragraph, index) => {
			const lines = wrapText(paragraph, maxWidth, font, fontSize);
			if (lines.length === 0) {
				return index === 0 ? [] : [''];
			}
			return lines;
		});
}

function normaliseOptionalText(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

function formatCurrency(
	value: number,
	currencyCode = 'AUD',
	dateFormat: string | null | undefined = 'en-AU',
	numberLocale: string | null | undefined = null
): string {
	return formatLocalisedCurrency(value, { currencyCode, dateFormat, numberLocale });
}

function parseDocumentDate(value: string, dateFormat: string | null | undefined = 'en-AU'): Date {
	return parseDocumentDateImpl(value, { dateFormat });
}

export function formatDocumentDate(
	value: string,
	dateFormat: string | null | undefined = 'en-AU',
	languageLocale: string | null | undefined = null,
	numberLocale: string | null | undefined = null
): string {
	return formatLocalisedDate(value, { dateFormat, languageLocale, numberLocale });
}

function topToPdfY(yFromTop: number): number {
	return PAGE_HEIGHT - yFromTop;
}

function getPageBottomY(): number {
	return PAGE_BODY_BOTTOM;
}

function getSectionHeight(lineCount: number, topGap = 0): number {
	return (
		topGap +
		SECTION_LABEL_LINE_HEIGHT +
		SECTION_HEADER_GAP +
		Math.max(1, lineCount) * BODY_LINE_HEIGHT +
		SECTION_TOP_PADDING +
		SECTION_BOTTOM_PADDING +
		SECTION_OUTER_GAP
	);
}

function getPricingColumns(locale: string | null | undefined = 'en-AU'): QuotePdfTableColumnPlan[] {
	let x = MARGIN_X;
	return TABLE_COLUMNS.map((column) => {
		const labelKey =
			column.key === 'description'
				? 'quote.description'
				: column.key === 'price'
					? 'quote.price'
					: column.key === 'quantity'
						? 'quote.quantity'
						: 'quote.amount';
		const next = {
			...column,
			label: getQuoteMessage(locale, labelKey),
			x
		};
		x += column.width;
		return next;
	});
}

function getPageUsedY(page: QuotePdfPagePlan, bodyStartY: number): number {
	let usedY = bodyStartY;

	for (const section of page.sections) {
		usedY += section.height;
	}

	if (page.pricingTable.showsHeader) {
		usedY += TABLE_HEADER_HEIGHT;
	}

	for (const row of page.lineItems) {
		usedY += row.rowHeight;
	}

	return usedY;
}

function createTextBlock(lines: QuotePdfTextBlockLinePlan[], width: number): QuotePdfTextBlockPlan {
	const safeLines = lines.filter((line) => line.text.trim().length > 0);
	return {
		lines: safeLines,
		width,
		height: Math.max(1, safeLines.length) * HEADER_TEXT_LINE_HEIGHT
	};
}

function supportsSeparateTaxIdentifier(countryCode: string | null | undefined): boolean {
	return (countryCode ?? '').trim().toUpperCase() !== 'AU';
}

export function resolveTaxIdentifierCountryCode(
	primaryCountryCode: string | null | undefined,
	fallbackCountryCode: string | null | undefined
): string | null {
	return normaliseOptionalText(primaryCountryCode) ?? normaliseOptionalText(fallbackCountryCode);
}

function buildCustomerDetailsTextBlock(
	payload: QuotePdfPayload,
	languageLocale: string | null | undefined
): QuotePdfTextBlockPlan {
	return createTextBlock(
		[
			{
				text: `${getQuoteMessage(languageLocale, 'quote.quoteNumber')}: ${payload.rfq_number}`,
				tone: 'primary'
			},
			{
				text: `${getQuoteMessage(languageLocale, 'quote.date')}: ${formatDocumentDate(
					payload.issued_date,
					payload.business.dateFormat,
					payload.business.languageLocale,
					payload.business.numberLocale
				)}`,
				tone: 'primary'
			},
			{
				text: `${getQuoteMessage(languageLocale, 'quote.validUntil')}: ${formatDocumentDate(
					payload.valid_until_date,
					payload.business.dateFormat,
					payload.business.languageLocale,
					payload.business.numberLocale
				)}`,
				tone: 'primary'
			},
			...(supportsSeparateTaxIdentifier(
				resolveTaxIdentifierCountryCode(payload.contact?.countryCode, payload.business.countryCode)
			) && normaliseOptionalText(payload.contact?.taxIdValue)
				? [
						{
							text: `${payload.contact?.taxIdLabel || getQuoteMessage(languageLocale, 'quote.taxId')}: ${payload.contact?.taxIdValue!.trim()}`,
							tone: 'primary' as const
						}
					]
				: [])
		],
		CONTACT_TABLE_WIDTH
	);
}

function buildBusinessDetailsTextBlock(
	payload: QuotePdfPayload,
	languageLocale: string | null | undefined,
	fonts: QuotePdfFontContext,
	businessNameMaxWidth: number
): QuotePdfTextBlockPlan {
	return createTextBlock(
		[
			...(normaliseOptionalText(payload.business.contactName)
				? [
						{
							text: payload.business.contactName!.trim(),
							tone: 'primary' as const
						}
					]
				: []),
			...(normaliseOptionalText(payload.business.contactEmail)
				? [
						{
							text: payload.business.contactEmail!.trim(),
							tone: 'primary' as const
						}
					]
				: []),
			...(normaliseOptionalText(payload.business.contactPhone)
				? [
						{
							text: payload.business.contactPhone!.trim(),
							tone: 'primary' as const
						}
					]
				: []),
			...(normaliseOptionalText(payload.business.businessIdValue)
				? [
						{
							text: `${payload.business.businessIdLabel || getQuoteMessage(languageLocale, 'quote.businessId')}: ${payload.business.businessIdValue!.trim()}`,
							tone: 'primary' as const
						}
					]
				: []),
			...(supportsSeparateTaxIdentifier(
				resolveTaxIdentifierCountryCode(payload.business.countryCode, payload.contact?.countryCode)
			) && normaliseOptionalText(payload.business.taxIdValue)
				? [
						{
							text: `${payload.business.taxIdLabel || getQuoteMessage(languageLocale, 'quote.taxId')}: ${payload.business.taxIdValue!.trim()}`,
							tone: 'primary' as const
						}
					]
				: []),
			...(normaliseOptionalText(payload.business.address)
				? wrapParagraphs(
						payload.business.address,
						businessNameMaxWidth,
						fonts.regularFont,
						HEADER_TEXT_FONT_SIZE
					).map((line) => ({ text: line, tone: 'muted' as const }))
				: [])
		],
		businessNameMaxWidth
	);
}

function buildHeaderPlan(payload: QuotePdfPayload, fonts: QuotePdfFontContext): QuotePdfHeaderPlan {
	const locale = resolveLocalisationContext({
		countryCode: payload.business.countryCode ?? payload.contact?.countryCode,
		currencyCode: payload.business.currencyCode,
		dateFormat: payload.business.dateFormat,
		languageLocale: payload.business.languageLocale,
		numberLocale: payload.business.numberLocale,
		taxDisplayLabel: payload.business.taxDisplayLabel,
		taxRatePercentage: payload.business.taxRatePercentage
	});
	const businessName = payload.business.name || 'Kwantflow';
	const businessLogoReserve = payload.business.logoBytes ? HEADER_LOGO_MAX_WIDTH + 10 : 0;
	const businessNameMaxWidth = Math.max(96, BUSINESS_TABLE_WIDTH - businessLogoReserve);
	const businessNameLines = wrapText(
		businessName,
		businessNameMaxWidth,
		fonts.boldFont,
		BUSINESS_NAME_FONT_SIZE
	);
	const customerNameLines = wrapText(
		payload.contact_name || getQuoteMessage(locale.languageLocale, 'quote.walkInContact'),
		CONTACT_TABLE_WIDTH,
		fonts.boldFont,
		CUSTOMER_NAME_FONT_SIZE
	);
	const customerDetails = buildCustomerDetailsTextBlock(payload, locale.languageLocale);

	const businessDetails = buildBusinessDetailsTextBlock(
		payload,
		locale.languageLocale,
		fonts,
		businessNameMaxWidth
	);

	const titleBandHeight = Math.max(TITLE_FONT_SIZE, HEADER_LOGO_MAX_HEIGHT);
	const customerTop = MARGIN_TOP + titleBandHeight + HEADER_TITLE_ROW_GAP;
	const businessNameTop = customerTop;
	const businessDetailsTop =
		businessNameTop + businessNameLines.length * BUSINESS_NAME_LINE_HEIGHT + HEADER_META_GAP;
	const customerBottom =
		customerTop +
		customerNameLines.length * CUSTOMER_NAME_LINE_HEIGHT +
		HEADER_META_GAP +
		customerDetails.height;
	const businessBottom = businessDetailsTop + businessDetails.height;

	return {
		title: getQuoteMessage(locale.languageLocale, 'quote.title'),
		businessName,
		businessNameLines,
		customerNameLines,
		customerDetails,
		businessDetails,
		customerTop,
		businessNameTop,
		businessDetailsTop,
		bottomY: Math.max(customerBottom, businessBottom) + HEADER_TO_BODY_GAP
	};
}

export function resolveQuotePdfRenderConfig(
	config: QuotePdfRenderConfig | undefined
): Required<QuotePdfRenderConfig> {
	return {
		templateId: config?.templateId ?? DEFAULT_QUOTE_PDF_RENDER_CONFIG.templateId
	};
}

function getQuotePdfTemplate(config: QuotePdfRenderConfig | undefined): QuotePdfTemplateDefinition {
	const resolved = resolveQuotePdfRenderConfig(config);
	return QUOTE_PDF_TEMPLATES[resolved.templateId];
}

function buildProjectSiteText(payload: QuotePdfPayload): string {
	return payload.project_name?.trim() ?? '';
}

function buildCommercialSummaryText(payload: QuotePdfPayload): string {
	const parts = [
		payload.option_label
			? `${getQuoteMessage(payload.business.languageLocale, 'quote.option')}: ${payload.option_label}`
			: null,
		payload.lead_time
			? `${getQuoteMessage(payload.business.languageLocale, 'quote.leadTime')}: ${payload.lead_time}`
			: null
	].filter((value): value is string => Boolean(value));

	return parts.join('\n');
}

function buildTermsText(payload: QuotePdfPayload): string {
	return payload.notes?.trim()
		? payload.notes
		: payload.terms_fallback?.trim() || DEFAULT_QUOTE_PDF_TERMS_FALLBACK;
}

function createRowPlan(
	item: PdfLineItem,
	index: number,
	payload: QuotePdfPayload,
	fonts: QuotePdfFontContext
): QuotePdfRowPlan {
	const descriptionLines: QuotePdfDescriptionLine[] = [];
	const assetLines = wrapText(
		item.file_name || 'Quoted item',
		TABLE_COLUMNS[0].width - 12,
		fonts.boldFont,
		BODY_FONT_SIZE
	);
	for (const line of assetLines) {
		descriptionLines.push({ text: line, emphasised: true });
	}

	const detailLines = wrapParagraphs(
		item.description?.trim() ? item.description : 'Included in quoted scope.',
		TABLE_COLUMNS[0].width - 12,
		fonts.regularFont,
		BODY_FONT_SIZE
	);
	for (const line of detailLines) {
		descriptionLines.push({ text: line, emphasised: false });
	}

	const safeDescriptionLines = descriptionLines.length
		? descriptionLines
		: [{ text: 'Quoted item', emphasised: true }];

	return {
		index: index + 1,
		descriptionLines: safeDescriptionLines,
		priceText: formatCurrency(
			item.unit_price,
			payload.business.currencyCode ?? 'AUD',
			payload.business.dateFormat,
			payload.business.numberLocale
		),
		quantityText: Number.isInteger(item.quantity)
			? String(item.quantity)
			: item.quantity.toFixed(2),
		amountText: formatCurrency(
			item.line_total,
			payload.business.currencyCode ?? 'AUD',
			payload.business.dateFormat,
			payload.business.numberLocale
		),
		rowHeight:
			TABLE_ROW_TOP_PADDING +
			safeDescriptionLines.length * BODY_LINE_HEIGHT +
			TABLE_ROW_BOTTOM_PADDING
	};
}

function createContinuationPage(pageNumber: number): QuotePdfPagePlan {
	return {
		pageNumber,
		showsPrimaryHeader: false,
		sections: [],
		pricingTable: {
			columns: getPricingColumns(),
			showsHeader: false
		},
		lineItems: []
	};
}

function appendSectionBlocks(
	pages: QuotePdfPagePlan[],
	bodyStartYForPage: (page: QuotePdfPagePlan) => number,
	sections: Array<{
		key: QuotePdfSectionKey;
		label: string;
		lines: string[];
		placement: 'beforeTable' | 'afterTable' | 'postSummary';
	}>
) {
	let currentPage = pages[pages.length - 1];
	let cursorY = getPageUsedY(currentPage, bodyStartYForPage(currentPage));

	for (const section of sections) {
		const remainingLines = [...section.lines];
		if (remainingLines.length === 0) continue;
		let continued = false;

		while (remainingLines.length > 0) {
			const topGap =
				section.placement === 'afterTable' &&
				currentPage.lineItems.length > 0 &&
				!currentPage.sections.some((existingSection) => existingSection.placement === 'afterTable')
					? AFTER_TABLE_SECTION_TOP_GAP
					: 0;
			const availableHeight = getPageBottomY() - cursorY;
			const minimumSectionHeight = getSectionHeight(1, topGap);

			if (availableHeight < minimumSectionHeight) {
				currentPage = createContinuationPage(pages.length + 1);
				pages.push(currentPage);
				cursorY = getPageUsedY(currentPage, bodyStartYForPage(currentPage));
				continue;
			}

			const maxLines = Math.max(
				1,
				Math.floor(
					(availableHeight -
						topGap -
						SECTION_LABEL_LINE_HEIGHT -
						SECTION_HEADER_GAP -
						SECTION_TOP_PADDING -
						SECTION_BOTTOM_PADDING -
						SECTION_OUTER_GAP) /
						BODY_LINE_HEIGHT
				)
			);
			const lines = remainingLines.splice(0, maxLines);
			const plannedSection: QuotePdfSectionPlan = {
				key: section.key,
				label: section.label,
				lines,
				continued,
				placement: section.placement,
				topGap,
				height: getSectionHeight(lines.length, topGap)
			};

			currentPage.sections.push(plannedSection);
			cursorY += plannedSection.height;
			continued = true;

			if (remainingLines.length > 0) {
				currentPage = createContinuationPage(pages.length + 1);
				pages.push(currentPage);
				cursorY = getPageUsedY(currentPage, bodyStartYForPage(currentPage));
			}
		}
	}
}

function appendPostSummarySectionBlocks(
	pages: QuotePdfPagePlan[],
	bodyStartYForPage: (page: QuotePdfPagePlan) => number,
	sections: Array<{
		key: QuotePdfSectionKey;
		label: string;
		lines: string[];
		placement: 'postSummary';
	}>
) {
	if (sections.length === 0) return;

	let currentPage = pages[pages.length - 1];
	let cursorY =
		getPageUsedY(currentPage, bodyStartYForPage(currentPage)) + SUMMARY_GAP + SUMMARY_HEIGHT;
	let firstSummarySection = true;

	for (const section of sections) {
		const remainingLines = [...section.lines];
		if (remainingLines.length === 0) continue;
		let continued = false;

		while (remainingLines.length > 0) {
			const topGap = firstSummarySection ? AFTER_TABLE_SECTION_TOP_GAP : 0;
			const pageBottom = getPageBottomY() - PAYMENT_TERMS_HEIGHT;
			const availableHeight = pageBottom - cursorY;
			const minimumSectionHeight = getSectionHeight(1, topGap);

			if (availableHeight < minimumSectionHeight) {
				currentPage = createContinuationPage(pages.length + 1);
				pages.push(currentPage);
				cursorY = bodyStartYForPage(currentPage);
				firstSummarySection = false;
				continue;
			}

			const maxLines = Math.max(
				1,
				Math.floor(
					(availableHeight -
						topGap -
						SECTION_LABEL_LINE_HEIGHT -
						SECTION_HEADER_GAP -
						SECTION_TOP_PADDING -
						SECTION_BOTTOM_PADDING -
						SECTION_OUTER_GAP) /
						BODY_LINE_HEIGHT
				)
			);
			const lines = remainingLines.splice(0, maxLines);
			const plannedSection: QuotePdfSectionPlan = {
				key: section.key,
				label: section.label,
				lines,
				continued,
				placement: section.placement,
				topGap,
				height: getSectionHeight(lines.length, topGap)
			};

			currentPage.sections.push(plannedSection);
			cursorY += plannedSection.height;
			continued = true;
			firstSummarySection = false;

			if (remainingLines.length > 0) {
				currentPage = createContinuationPage(pages.length + 1);
				pages.push(currentPage);
				cursorY = bodyStartYForPage(currentPage);
			}
		}
	}
}

function appendRowsToPages(
	pages: QuotePdfPagePlan[],
	bodyStartYForPage: (page: QuotePdfPagePlan) => number,
	rows: QuotePdfRowPlan[],
	forceNewPage = false
) {
	let currentPage = forceNewPage
		? createContinuationPage(pages.length + 1)
		: pages[pages.length - 1];
	if (forceNewPage) pages.push(currentPage);

	let cursorY = getPageUsedY(currentPage, bodyStartYForPage(currentPage));

	if (rows.length === 0 && currentPage.lineItems.length === 0) {
		currentPage.pricingTable.showsHeader = true;
		return;
	}

	for (const row of rows) {
		const pendingHeaderHeight = currentPage.pricingTable.showsHeader ? 0 : TABLE_HEADER_HEIGHT;
		if (cursorY + pendingHeaderHeight + row.rowHeight > getPageBottomY()) {
			currentPage = createContinuationPage(pages.length + 1);
			pages.push(currentPage);
			cursorY = getPageUsedY(currentPage, bodyStartYForPage(currentPage));
		}

		if (!currentPage.pricingTable.showsHeader) {
			currentPage.pricingTable.showsHeader = true;
			cursorY += TABLE_HEADER_HEIGHT;
		}

		currentPage.lineItems.push(row);
		cursorY += row.rowHeight;
	}
}

function ensureFinalBlocksFit(
	pages: QuotePdfPagePlan[],
	bodyStartYForPage: (page: QuotePdfPagePlan) => number,
	extraReservedHeight = 0
) {
	while (pages.length > 0) {
		const lastPage = pages[pages.length - 1];
		const requiredHeight =
			SUMMARY_GAP + SUMMARY_HEIGHT + PAYMENT_TERMS_HEIGHT + extraReservedHeight;
		const usedY = getPageUsedY(lastPage, bodyStartYForPage(lastPage));

		if (usedY + requiredHeight <= getPageBottomY()) {
			return;
		}

		if (lastPage.lineItems.length === 0) {
			pages.push(createContinuationPage(pages.length + 1));
			return;
		}

		const spillRows: QuotePdfRowPlan[] = [];
		while (
			lastPage.lineItems.length > 0 &&
			getPageUsedY(lastPage, bodyStartYForPage(lastPage)) + requiredHeight > getPageBottomY()
		) {
			const moved = lastPage.lineItems.pop();
			if (!moved) break;
			spillRows.unshift(moved);
		}

		if (spillRows.length === 0) {
			pages.push(createContinuationPage(pages.length + 1));
			return;
		}

		appendRowsToPages(pages, bodyStartYForPage, spillRows, true);
	}
}

function drawTextLines(
	page: PDFPage,
	lines: string[],
	x: number,
	startY: number,
	font: PDFFont,
	fontSize: number,
	lineHeight: number,
	colour = TEXT_PRIMARY
) {
	let y = startY;
	for (const line of lines) {
		if (line) {
			page.drawText(line, {
				x,
				y: topToPdfY(y),
				size: fontSize,
				font,
				color: colour
			});
		}
		y += lineHeight;
	}
}

function drawTextBlock(
	page: PDFPage,
	block: QuotePdfTextBlockPlan,
	x: number,
	topY: number,
	fonts: QuotePdfFontContext
) {
	let cursorY = topY + HEADER_TEXT_FONT_SIZE;
	for (const line of block.lines) {
		page.drawText(line.text, {
			x,
			y: topToPdfY(cursorY),
			size: HEADER_TEXT_FONT_SIZE,
			font: fonts.regularFont,
			color: line.tone === 'primary' ? TEXT_PRIMARY : TEXT_SECONDARY
		});
		cursorY += HEADER_TEXT_LINE_HEIGHT;
	}
}

function drawHeaderLogo(
	page: PDFPage,
	logoImage: PDFImage,
	x: number,
	topY: number
): { width: number; height: number } {
	const dimensions = logoImage.scaleToFit(HEADER_LOGO_MAX_WIDTH, HEADER_LOGO_MAX_HEIGHT);
	page.drawImage(logoImage, {
		x,
		y: topToPdfY(topY + dimensions.height),
		width: dimensions.width,
		height: dimensions.height
	});
	return dimensions;
}

function drawPrimaryHeader(
	page: PDFPage,
	header: QuotePdfHeaderPlan,
	fonts: QuotePdfFontContext,
	assets: QuotePdfRenderAssets
) {
	const rightX = MARGIN_X + CONTACT_TABLE_WIDTH + DETAIL_TABLE_GAP;
	const topBandY = MARGIN_TOP;
	const titleBandHeight = HEADER_LOGO_MAX_HEIGHT;
	const titleTop = topBandY + Math.max(0, (titleBandHeight - TITLE_FONT_SIZE) / 2);
	page.drawText(header.title, {
		x: MARGIN_X,
		y: topToPdfY(titleTop + TITLE_FONT_SIZE),
		size: TITLE_FONT_SIZE,
		font: fonts.regularFont,
		color: TEXT_PRIMARY
	});

	let businessNameX = rightX;
	if (assets.logoImage) {
		const logoDimensions = drawHeaderLogo(
			page,
			assets.logoImage,
			rightX,
			header.businessNameTop + Math.max(0, (BUSINESS_NAME_LINE_HEIGHT - HEADER_LOGO_MAX_HEIGHT) / 2)
		);
		businessNameX += logoDimensions.width + 6;
	}

	drawTextLines(
		page,
		header.businessNameLines,
		businessNameX,
		header.businessNameTop + BUSINESS_NAME_FONT_SIZE,
		fonts.boldFont,
		BUSINESS_NAME_FONT_SIZE,
		BUSINESS_NAME_LINE_HEIGHT,
		TEXT_PRIMARY
	);

	const customerNameTop = header.customerTop;
	drawTextLines(
		page,
		header.customerNameLines,
		MARGIN_X,
		customerNameTop + CUSTOMER_NAME_FONT_SIZE,
		fonts.boldFont,
		CUSTOMER_NAME_FONT_SIZE,
		CUSTOMER_NAME_LINE_HEIGHT,
		TEXT_PRIMARY
	);

	drawTextBlock(
		page,
		header.customerDetails,
		MARGIN_X,
		customerNameTop + header.customerNameLines.length * CUSTOMER_NAME_LINE_HEIGHT + HEADER_META_GAP,
		fonts
	);
	drawTextBlock(page, header.businessDetails, rightX, header.businessDetailsTop, fonts);
}

function fitTextToWidth(font: PDFFont, text: string, size: number, maxWidth: number): string {
	if (measureText(font, text, size) <= maxWidth) return text;
	const ellipsis = '…';
	let next = text.trim();
	while (next.length > 0 && measureText(font, `${next}${ellipsis}`, size) > maxWidth) {
		next = next.slice(0, -1).trimEnd();
	}
	return next.length > 0 ? `${next}${ellipsis}` : ellipsis;
}

function drawRunningHeader(
	page: PDFPage,
	payload: QuotePdfPayload,
	pageNumber: number,
	pageCount: number,
	fonts: QuotePdfFontContext,
	assets: QuotePdfRenderAssets
) {
	const y = MARGIN_TOP - 4;
	const pageText = `Page ${pageNumber} of ${pageCount}`;
	let brandText = payload.business.name || 'Kwantflow';
	let brandTextX = MARGIN_X;

	if (assets.logoImage) {
		const logoDimensions = drawHeaderLogo(page, assets.logoImage, MARGIN_X, y - 11);
		brandTextX += logoDimensions.width + 6;
	}

	const pageTextWidth = measureText(fonts.regularFont, pageText, SMALL_FONT_SIZE);
	const maxBrandTextWidth = Math.max(
		60,
		PAGE_WIDTH - MARGIN_X * 2 - pageTextWidth - brandTextX + MARGIN_X - 18
	);
	brandText = fitTextToWidth(fonts.boldFont, brandText, SMALL_FONT_SIZE, maxBrandTextWidth);

	page.drawText(brandText, {
		x: brandTextX,
		y: topToPdfY(y),
		size: SMALL_FONT_SIZE,
		font: fonts.boldFont,
		color: TEXT_MUTED
	});
	page.drawText(pageText, {
		x: PAGE_WIDTH - MARGIN_X - pageTextWidth,
		y: topToPdfY(y),
		size: SMALL_FONT_SIZE,
		font: fonts.regularFont,
		color: TEXT_MUTED
	});
	page.drawLine({
		start: { x: MARGIN_X, y: topToPdfY(y + 8) },
		end: { x: PAGE_WIDTH - MARGIN_X, y: topToPdfY(y + 8) },
		thickness: 0.5,
		color: LINE_DEFAULT
	});
}

function drawSection(
	page: PDFPage,
	section: QuotePdfSectionPlan,
	startY: number,
	fonts: QuotePdfFontContext
) {
	const contentStartY = startY + section.topGap;
	const heading = section.continued ? `${section.label} (cont.)` : section.label;

	page.drawText(heading, {
		x: MARGIN_X,
		y: topToPdfY(contentStartY + SECTION_LABEL_FONT_SIZE),
		size: SECTION_LABEL_FONT_SIZE,
		font: fonts.boldFont,
		color: TEXT_SECONDARY
	});
	page.drawLine({
		start: { x: MARGIN_X, y: topToPdfY(contentStartY + SECTION_LABEL_LINE_HEIGHT) },
		end: { x: PAGE_WIDTH - MARGIN_X, y: topToPdfY(contentStartY + SECTION_LABEL_LINE_HEIGHT) },
		thickness: 0.8,
		color: LINE_STRONG
	});

	drawTextLines(
		page,
		section.lines,
		MARGIN_X,
		contentStartY +
			SECTION_LABEL_LINE_HEIGHT +
			SECTION_HEADER_GAP +
			SECTION_TOP_PADDING +
			BODY_FONT_SIZE,
		fonts.regularFont,
		BODY_FONT_SIZE,
		BODY_LINE_HEIGHT,
		TEXT_PRIMARY
	);
}

function drawTableHeader(
	page: PDFPage,
	columns: QuotePdfTableColumnPlan[],
	startY: number,
	fonts: QuotePdfFontContext
) {
	page.drawRectangle({
		x: MARGIN_X,
		y: topToPdfY(startY + TABLE_HEADER_HEIGHT),
		width: CONTENT_WIDTH,
		height: TABLE_HEADER_HEIGHT,
		color: SURFACE_SUBTLE
	});
	page.drawLine({
		start: { x: MARGIN_X, y: topToPdfY(startY) },
		end: { x: PAGE_WIDTH - MARGIN_X, y: topToPdfY(startY) },
		thickness: 0.8,
		color: LINE_STRONG
	});
	page.drawLine({
		start: { x: MARGIN_X, y: topToPdfY(startY + TABLE_HEADER_HEIGHT) },
		end: { x: PAGE_WIDTH - MARGIN_X, y: topToPdfY(startY + TABLE_HEADER_HEIGHT) },
		thickness: 0.6,
		color: LINE_DEFAULT
	});

	for (const column of columns) {
		const textWidth = measureText(fonts.boldFont, column.label, SMALL_FONT_SIZE);
		const textX =
			column.align === 'right'
				? column.x + column.width - textWidth - 6
				: column.align === 'center'
					? column.x + (column.width - textWidth) / 2
					: column.x + 6;

		page.drawText(column.label, {
			x: textX,
			y: topToPdfY(startY + 14),
			size: SMALL_FONT_SIZE,
			font: fonts.boldFont,
			color: TEXT_PRIMARY
		});
	}
}

function drawRow(
	page: PDFPage,
	row: QuotePdfRowPlan,
	columns: QuotePdfTableColumnPlan[],
	startY: number,
	fonts: QuotePdfFontContext
) {
	const rowBottom = startY + row.rowHeight;

	page.drawLine({
		start: { x: MARGIN_X, y: topToPdfY(rowBottom) },
		end: { x: PAGE_WIDTH - MARGIN_X, y: topToPdfY(rowBottom) },
		thickness: 0.45,
		color: LINE_SOFT
	});

	let descriptionY = startY + TABLE_ROW_TOP_PADDING + BODY_FONT_SIZE;
	for (const line of row.descriptionLines) {
		page.drawText(line.text, {
			x: columns[0].x + 6,
			y: topToPdfY(descriptionY),
			size: BODY_FONT_SIZE,
			font: line.emphasised ? fonts.boldFont : fonts.regularFont,
			color: TEXT_PRIMARY
		});
		descriptionY += BODY_LINE_HEIGHT;
	}

	const firstLineY = startY + TABLE_ROW_TOP_PADDING + BODY_FONT_SIZE;
	const rightAligned = (
		text: string,
		column: QuotePdfTableColumnPlan,
		font: PDFFont,
		size: number
	) => column.x + column.width - measureText(font, text, size) - 6;

	page.drawText(row.priceText, {
		x: rightAligned(row.priceText, columns[1], fonts.regularFont, BODY_FONT_SIZE),
		y: topToPdfY(firstLineY),
		size: BODY_FONT_SIZE,
		font: fonts.regularFont,
		color: TEXT_PRIMARY
	});
	page.drawText(row.quantityText, {
		x:
			columns[2].x +
			(columns[2].width - measureText(fonts.regularFont, row.quantityText, BODY_FONT_SIZE)) / 2,
		y: topToPdfY(firstLineY),
		size: BODY_FONT_SIZE,
		font: fonts.regularFont,
		color: TEXT_PRIMARY
	});
	page.drawText(row.amountText, {
		x: rightAligned(row.amountText, columns[3], fonts.boldFont, BODY_FONT_SIZE),
		y: topToPdfY(firstLineY),
		size: BODY_FONT_SIZE,
		font: fonts.boldFont,
		color: TEXT_PRIMARY
	});
}

function drawSummary(
	page: PDFPage,
	summary: NonNullable<QuotePdfPagePlan['summary']>,
	startY: number,
	fonts: QuotePdfFontContext,
	payload: QuotePdfPayload
) {
	const summaryX = PAGE_WIDTH - MARGIN_X - SUMMARY_WIDTH;
	const rows = [
		{
			label: getQuoteMessage(payload.business.languageLocale, 'quote.subtotal'),
			value: summary.subtotalText,
			emph: false
		},
		{
			label: `${payload.business.taxDisplayLabel || 'Tax'} (${formatLocalisedPercent(payload.business.taxRatePercentage ?? 0, payload.business)}%)`,
			value: summary.gstText,
			emph: false
		},
		{
			label: getQuoteMessage(payload.business.languageLocale, 'quote.total'),
			value: summary.totalText,
			emph: true
		}
	];
	const rowHeight = SUMMARY_HEIGHT / rows.length;

	rows.forEach((row, index) => {
		const top = startY + index * rowHeight;
		const font = row.emph ? fonts.boldFont : fonts.regularFont;
		const size = BODY_FONT_SIZE;

		if (index > 0) {
			page.drawLine({
				start: { x: summaryX, y: topToPdfY(top) },
				end: { x: summaryX + SUMMARY_WIDTH, y: topToPdfY(top) },
				thickness: 0.45,
				color: LINE_SOFT
			});
		}

		page.drawText(row.label, {
			x: summaryX,
			y: topToPdfY(top + 14),
			size,
			font,
			color: TEXT_PRIMARY
		});
		page.drawText(row.value, {
			x: summaryX + SUMMARY_WIDTH - measureText(font, row.value, size),
			y: topToPdfY(top + 14),
			size,
			font,
			color: TEXT_PRIMARY
		});
	});
}

function drawPaymentTerms(
	page: PDFPage,
	paymentTerms: string,
	startY: number,
	fonts: QuotePdfFontContext
) {
	page.drawLine({
		start: { x: MARGIN_X, y: topToPdfY(startY) },
		end: { x: PAGE_WIDTH - MARGIN_X, y: topToPdfY(startY) },
		thickness: 0.8,
		color: LINE_STRONG
	});
	page.drawText(paymentTerms, {
		x: MARGIN_X,
		y: topToPdfY(startY + 12),
		size: BODY_FONT_SIZE,
		font: fonts.regularFont,
		color: TEXT_PRIMARY
	});
}

function drawFooter(
	page: PDFPage,
	pageNumber: number,
	pageCount: number,
	fonts: QuotePdfFontContext,
	assets: QuotePdfRenderAssets
) {
	const pageText = `Page ${pageNumber} of ${pageCount}`;
	const preparedPrefix = 'Prepared with ';
	const preparedBrand = 'Kwantflow';
	const baselineY = topToPdfY(PAGE_HEIGHT - MARGIN_BOTTOM + 8);
	let preparedX = MARGIN_X;
	if (assets.footerLogoImage) {
		const dimensions = assets.footerLogoImage.scaleToFit(FOOTER_LOGO_SIZE, FOOTER_LOGO_SIZE);
		page.drawImage(assets.footerLogoImage, {
			x: MARGIN_X,
			y: baselineY - dimensions.height * 0.18,
			width: dimensions.width,
			height: dimensions.height
		});
		preparedX += dimensions.width + FOOTER_LOGO_GAP;
	}
	page.drawText(preparedPrefix, {
		x: preparedX,
		y: baselineY,
		size: FOOTER_PREPARED_FONT_SIZE,
		font: fonts.regularFont,
		color: TEXT_MUTED
	});
	const prefixWidth = measureText(fonts.regularFont, preparedPrefix, FOOTER_PREPARED_FONT_SIZE);
	page.drawText(preparedBrand, {
		x: preparedX + prefixWidth,
		y: baselineY,
		size: FOOTER_PREPARED_FONT_SIZE,
		font: fonts.boldFont,
		color: TEXT_MUTED
	});
	page.drawText(pageText, {
		x: PAGE_WIDTH - MARGIN_X - measureText(fonts.regularFont, pageText, FOOTER_FONT_SIZE),
		y: baselineY,
		size: FOOTER_FONT_SIZE,
		font: fonts.regularFont,
		color: TEXT_MUTED
	});
}

function buildPagePlan(
	payload: QuotePdfPayload,
	fonts: QuotePdfFontContext,
	config?: QuotePdfRenderConfig
): QuotePdfDocumentPlan {
	const renderConfig = resolveQuotePdfRenderConfig(config);
	const template = getQuotePdfTemplate(renderConfig);
	const header = buildHeaderPlan(payload, fonts);
	const bodyStartYForPage = (page: QuotePdfPagePlan) =>
		page.showsPrimaryHeader ? header.bottomY : CONTINUATION_BODY_START;

	const pages: QuotePdfPagePlan[] = [
		{
			pageNumber: 1,
			showsPrimaryHeader: true,
			header,
			sections: [],
			pricingTable: {
				columns: getPricingColumns(payload.business.languageLocale),
				showsHeader: false
			},
			lineItems: []
		}
	];

	appendSectionBlocks(
		pages,
		bodyStartYForPage,
		template.sections
			.filter((section) => section.placement === 'beforeTable')
			.map((section) => ({
				key: section.key,
				label: getQuoteMessage(payload.business.languageLocale, section.labelKey),
				placement: section.placement,
				lines: wrapParagraphs(
					section.buildText(payload),
					CONTENT_WIDTH - 20,
					fonts.regularFont,
					BODY_FONT_SIZE
				)
			}))
	);

	appendRowsToPages(
		pages,
		bodyStartYForPage,
		payload.line_items.map((item, index) => createRowPlan(item, index, payload, fonts))
	);

	appendSectionBlocks(
		pages,
		bodyStartYForPage,
		template.sections
			.filter((section) => section.placement === 'afterTable')
			.map((section) => ({
				key: section.key,
				label: getQuoteMessage(payload.business.languageLocale, section.labelKey),
				placement: section.placement,
				lines: wrapParagraphs(
					section.buildText(payload),
					CONTENT_WIDTH - 20,
					fonts.regularFont,
					BODY_FONT_SIZE
				)
			}))
	);

	const postSummarySections = template.sections
		.filter((section) => section.placement === 'postSummary')
		.map((section) => ({
			key: section.key,
			label: getQuoteMessage(payload.business.languageLocale, section.labelKey),
			placement: 'postSummary' as const,
			lines: wrapParagraphs(
				section.buildText(payload),
				CONTENT_WIDTH - 20,
				fonts.regularFont,
				BODY_FONT_SIZE
			)
		}));
	const initialPostSummaryReservedHeight =
		postSummarySections.length > 0
			? getSectionHeight(postSummarySections[0].lines.length, AFTER_TABLE_SECTION_TOP_GAP)
			: 0;

	if (!pages.some((page) => page.pricingTable.showsHeader)) {
		pages[0].pricingTable.showsHeader = true;
	}

	ensureFinalBlocksFit(pages, bodyStartYForPage, initialPostSummaryReservedHeight);
	pages[pages.length - 1].summary = {
		subtotalText: formatCurrency(
			payload.subtotal,
			payload.business.currencyCode ?? 'AUD',
			payload.business.dateFormat,
			payload.business.numberLocale
		),
		gstText: formatCurrency(
			payload.gst,
			payload.business.currencyCode ?? 'AUD',
			payload.business.dateFormat,
			payload.business.numberLocale
		),
		totalText: formatCurrency(
			payload.total,
			payload.business.currencyCode ?? 'AUD',
			payload.business.dateFormat,
			payload.business.numberLocale
		)
	};

	appendPostSummarySectionBlocks(pages, bodyStartYForPage, postSummarySections);

	pages[pages.length - 1].paymentTerms =
		payload.payment_terms?.trim() || DEFAULT_QUOTE_PDF_PAYMENT_TERMS;

	return {
		templateId: template.id,
		pages
	};
}

export async function buildQuotePdfPagePlan(
	payload: QuotePdfPayload,
	config?: QuotePdfRenderConfig
): Promise<QuotePdfDocumentPlan> {
	const pdfDoc = await PDFDocument.create({ updateMetadata: false });
	const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
	const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

	return buildPagePlan(payload, { regularFont, boldFont }, config);
}

export function createQuotePdfPackageCacheKey(
	payload: QuotePdfPayload,
	drawingPaths: string[] = [],
	config?: QuotePdfRenderConfig
): string {
	const renderConfig = resolveQuotePdfRenderConfig(config);
	const cachePayload = {
		...payload,
		business: {
			...payload.business,
			logoBytes: null
		}
	};
	return JSON.stringify({
		rendererVersion: QUOTE_PDF_RENDERER_VERSION,
		templateId: renderConfig.templateId,
		payload: cachePayload,
		drawingPaths: [...drawingPaths].sort()
	});
}

export function getCachedQuotePdfPackage(
	payload: QuotePdfPayload,
	drawingPaths: string[] = [],
	config?: QuotePdfRenderConfig
): Uint8Array | undefined {
	const cached = pdfPackageCache.get(createQuotePdfPackageCacheKey(payload, drawingPaths, config));
	return cached ? clonePdfBytes(cached) : undefined;
}

export function setCachedQuotePdfPackage(
	payload: QuotePdfPayload,
	drawingPaths: string[] = [],
	bytes: Uint8Array,
	config?: QuotePdfRenderConfig
) {
	pdfPackageCache.set(
		createQuotePdfPackageCacheKey(payload, drawingPaths, config),
		clonePdfBytes(bytes)
	);
}

export async function generateQuotePdfBytes(
	payload: QuotePdfPayload,
	config?: QuotePdfRenderConfig
): Promise<Uint8Array> {
	const pdfDoc = await PDFDocument.create({ updateMetadata: false });
	const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
	const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
	const fonts = { regularFont, boldFont };
	let logoImage: PDFImage | null = null;
	let footerLogoImage: PDFImage | null = null;
	if (payload.business.logoBytes && payload.business.logoMimeType === 'image/png') {
		logoImage = await pdfDoc.embedPng(payload.business.logoBytes);
	} else if (payload.business.logoBytes && payload.business.logoMimeType === 'image/jpeg') {
		logoImage = await pdfDoc.embedJpg(payload.business.logoBytes);
	}
	if (payload.footerBranding?.logoBytes && payload.footerBranding.logoMimeType === 'image/png') {
		footerLogoImage = await pdfDoc.embedPng(payload.footerBranding.logoBytes);
	} else if (
		payload.footerBranding?.logoBytes &&
		payload.footerBranding.logoMimeType === 'image/jpeg'
	) {
		footerLogoImage = await pdfDoc.embedJpg(payload.footerBranding.logoBytes);
	}
	const assets: QuotePdfRenderAssets = { logoImage, footerLogoImage };
	const plan = buildPagePlan(payload, fonts, config);

	pdfDoc.setTitle(`Quote ${payload.rfq_number}`);
	pdfDoc.setAuthor(payload.business.name || 'Kwantflow');
	pdfDoc.setCreator('Kwantflow');
	pdfDoc.setProducer('Kwantflow');
	pdfDoc.setCreationDate(parseDocumentDate(payload.issued_date, payload.business.dateFormat));
	pdfDoc.setModificationDate(parseDocumentDate(payload.issued_date, payload.business.dateFormat));

	const pageCount = plan.pages.length;

	for (const pagePlan of plan.pages) {
		const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

		if (pagePlan.showsPrimaryHeader && pagePlan.header) {
			drawPrimaryHeader(page, pagePlan.header, fonts, assets);
		} else {
			drawRunningHeader(page, payload, pagePlan.pageNumber, pageCount, fonts, assets);
		}

		let cursorY =
			pagePlan.showsPrimaryHeader && pagePlan.header
				? pagePlan.header.bottomY
				: CONTINUATION_BODY_START;

		for (const section of pagePlan.sections.filter(
			(section) => section.placement === 'beforeTable'
		)) {
			drawSection(page, section, cursorY, fonts);
			cursorY += section.height;
		}

		if (pagePlan.pricingTable.showsHeader) {
			drawTableHeader(page, pagePlan.pricingTable.columns, cursorY, fonts);
			cursorY += TABLE_HEADER_HEIGHT;
		}

		for (const row of pagePlan.lineItems) {
			drawRow(page, row, pagePlan.pricingTable.columns, cursorY, fonts);
			cursorY += row.rowHeight;
		}

		for (const section of pagePlan.sections.filter(
			(section) => section.placement === 'afterTable'
		)) {
			drawSection(page, section, cursorY, fonts);
			cursorY += section.height;
		}

		if (pagePlan.summary) {
			drawSummary(page, pagePlan.summary, cursorY + SUMMARY_GAP, fonts, payload);
			cursorY += SUMMARY_GAP + SUMMARY_HEIGHT;
		}

		for (const section of pagePlan.sections.filter(
			(section) => section.placement === 'postSummary'
		)) {
			const anchoredSectionY =
				section.key === 'terms' && pagePlan.paymentTerms
					? Math.max(cursorY, getPageBottomY() - PAYMENT_TERMS_HEIGHT - section.height - 8)
					: cursorY;
			drawSection(page, section, anchoredSectionY, fonts);
			cursorY = anchoredSectionY + section.height;
		}

		if (pagePlan.paymentTerms) {
			drawPaymentTerms(
				page,
				pagePlan.paymentTerms,
				getPageBottomY() - PAYMENT_TERMS_HEIGHT + 4,
				fonts
			);
		}

		drawFooter(page, pagePlan.pageNumber, pageCount, fonts, assets);
	}

	return clonePdfBytes(
		await pdfDoc.save({
			addDefaultPage: false,
			useObjectStreams: false
		})
	);
}
