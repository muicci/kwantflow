<script lang="ts">
	import { onMount } from 'svelte';
	import * as Resizable from '$lib/components/ui/resizable/index.js';
	import PDFViewer from '$lib/components/assets/pdf-viewer.svelte';
	import {
		BRAND_LOGO_EXTENSIONS,
		BRAND_LOGO_MIME_TYPES,
		formatIdentifierLabel
	} from '$lib/constants/index.js';
	import { estimateTotalPrice, getQuoteEngine } from '$lib/state/quote.svelte.js';
	import { errorState } from '$lib/state/errors.svelte.js';
	import { workspaceState } from '$lib/state/workspace.svelte.js';
	import { contactsState } from '$lib/state/contacts.svelte.js';
	import {
		getQuotePackagePreview,
		saveQuotePackageBytes,
		type QuotePackageAttachmentSelection,
		type QuotePdfPayload
	} from '$lib/services/pdf-export.js';
	import { readVaultFile } from '$lib/services/assets.js';
	import {
		createQuotePdfExportDates,
		resolveQuotePdfDefaults
	} from '$lib/services/quote-pdf-export.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import BooleanStateBadge from '$lib/components/boolean-state-badge.svelte';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import FormHelpTooltip from '$lib/components/form-help-tooltip.svelte';
	import { Meta, Text } from '$lib/components/primitives/index.js';
	import { invoke } from '@tauri-apps/api/core';
	import { appState } from '$lib/state/app.svelte.js';
	import { aiState } from '$lib/state/ai.svelte.js';
	import { integrationsState } from '$lib/state/integrations.svelte.js';
	import { toast } from 'svelte-sonner';
	import kwantflowFooterMarkUrl from '$lib/assets/branding/kwantflow-sidebar-mark.svg';
	import type {
		QuoteOption,
		QuotePackageAttachmentOutcome,
		QuoteRevisionLineItem
	} from '$lib/types/index.js';

	import FileDownloadIcon from '@lucide/svelte/icons/file-down';
	import QuoteEmailDialog from '$lib/components/quote/quote-email-dialog.svelte';
	import {
		buildTemplateEmailDraft,
		rewriteQuoteEmailDraft
	} from '$lib/services/quote-email-draft.js';
	import {
		DEFAULT_PDF_PREVIEW_LAYOUT,
		WORKSPACE_RESIZE_HANDLE_CLASS
	} from '$lib/components/assets/viewer-layout.js';

	function uint8ArrayToBase64(bytes: Uint8Array): Promise<string> {
		return new Promise((resolve, reject) => {
			const blob = new Blob([bytes as BlobPart], { type: 'application/octet-stream' });
			const reader = new FileReader();
			reader.onload = () => {
				const dataUrl = reader.result as string;
				const base64 = dataUrl.split(',')[1];
				if (base64) {
					resolve(base64);
				} else {
					reject(new Error('Failed to extract base64 from data URL'));
				}
			};
			reader.onerror = () => reject(reader.error);
			reader.readAsDataURL(blob);
		});
	}

	let { data } = $props();
	const engine = getQuoteEngine();

	const workingAssets = $derived(data.assets.filter((asset) => engine.isSelected(asset.id)));
	const exportableAssets = $derived(
		workingAssets.filter((asset) => engine.isPdfExportReady(asset.id))
	);
	const hasSavedPdfContent = $derived(
		workingAssets.some((asset) => engine.hasSavedQuoteContent(asset.id))
	);
	const pdfReadinessBlockers = $derived(
		workingAssets
			.flatMap((asset) => engine.getPdfReadinessBlockers(asset.id))
			.filter((blocker, index, blockers) => blockers.indexOf(blocker) === index)
	);
	let estimatesReady = $state(false);
	let estimateLoadVersion = 0;

	$effect(() => {
		const assetIds = workingAssets.map((asset) => asset.id);
		if (assetIds.length === 0) {
			estimatesReady = true;
			return;
		}

		const version = ++estimateLoadVersion;
		estimatesReady = false;
		void engine.hydrateEstimatesForAssets(assetIds).then(() => {
			if (estimateLoadVersion === version) {
				estimatesReady = true;
			}
		});
	});

	const canRenderPdf = $derived(exportableAssets.length > 0 && estimatesReady);
	const activeOption = $derived(engine.getActiveQuoteOption());

	let includedFiles = $state<Record<string, boolean>>({});
	const hasAnyPdfFiles = $derived(
		data.assets.some((asset) => asset.files?.some((file) => isPdfAttachment(file.file_path)))
	);
	let previewPdfBytes = $state<Uint8Array | null>(null);
	let previewWarnings = $state<string[]>([]);
	let previewAttachmentOutcomes = $state<QuotePackageAttachmentOutcome[]>([]);
	let previewLoading = $state(false);
	let previewError = $state<string | null>(null);
	let previewVersion = 0;
	const activeContact = $derived(
		data.project.contact_id
			? (contactsState.list.find((contact) => contact.id === data.project.contact_id) ?? null)
			: null
	);

	const contactEmail = $derived(
		(activeContact?.email ?? data.project.requester_contact_id)
			? (contactsState.list.find((c) => c.id === data.project.requester_contact_id)?.email ?? '')
			: ''
	);
	const pdfDefaults = $derived(
		resolveQuotePdfDefaults({
			countryCode: workspaceState.countryCode,
			currencyCode: workspaceState.currencyCode,
			currencySymbol: workspaceState.currencySymbol,
			dateFormat: workspaceState.dateFormat,
			languageLocale: workspaceState.languageLocale,
			numberLocale: workspaceState.numberLocale,
			validityDays: workspaceState.quoteValidityDays,
			paymentTerms: workspaceState.quotePaymentTerms,
			defaultInclusions: workspaceState.quoteDefaultInclusions,
			defaultExclusions: workspaceState.quoteDefaultExclusions,
			defaultTerms: workspaceState.quoteDefaultTerms
		})
	);

	function isPdfAttachment(filePath: string): boolean {
		return filePath.toLowerCase().endsWith('.pdf');
	}

	function normaliseOptionalText(value: string | null | undefined): string | null {
		const trimmed = value?.trim();
		return trimmed ? trimmed : null;
	}

	function supportsSeparateTaxIdentifier(countryCode: string | null | undefined): boolean {
		return (countryCode ?? '').trim().toUpperCase() !== 'AU';
	}

	function buildPdfIdentifier(label: string | null | undefined, value: string | null | undefined) {
		const normalizedValue = normaliseOptionalText(value);
		return {
			label: normalizedValue ? formatIdentifierLabel(label) || null : null,
			value: normalizedValue
		};
	}

	function buildPdfTaxIdentifier(
		countryCode: string | null | undefined,
		fallbackCountryCode: string | null | undefined,
		label: string | null | undefined,
		value: string | null | undefined
	) {
		const resolvedCountryCode =
			normaliseOptionalText(countryCode) ?? normaliseOptionalText(fallbackCountryCode);
		return supportsSeparateTaxIdentifier(resolvedCountryCode)
			? buildPdfIdentifier(label, value)
			: { label: null, value: null };
	}

	function buildActiveContactPayload() {
		if (!activeContact) return null;
		const businessId = buildPdfIdentifier(
			activeContact.business_id_label ?? (activeContact.abn ? 'ABN' : null),
			activeContact.business_id_value ?? activeContact.abn ?? null
		);
		const taxId = buildPdfTaxIdentifier(
			activeContact.country_code,
			pdfDefaults.countryCode,
			activeContact.tax_id_label,
			activeContact.tax_id_value ?? null
		);
		return {
			countryCode: normaliseOptionalText(activeContact.country_code) ?? pdfDefaults.countryCode,
			businessIdLabel: businessId.label,
			businessIdValue: businessId.value,
			taxIdLabel: taxId.label,
			taxIdValue: taxId.value
		};
	}

	function isAttachmentIncluded(fileId: string): boolean {
		return includedFiles[fileId] ?? false;
	}

	function setAttachmentIncluded(fileId: string, value: boolean) {
		includedFiles = { ...includedFiles, [fileId]: value };
	}

	onMount(() => {
		const initial: Record<string, boolean> = {};
		data.assets.forEach((asset) => {
			asset.files?.forEach((file) => {
				if (isPdfAttachment(file.file_path)) {
					initial[file.id] = false;
				}
			});
		});
		includedFiles = initial;
	});

	function buildLineItemsForOption(option: QuoteOption): QuoteRevisionLineItem[] {
		return exportableAssets.flatMap((asset) => {
			const savedEstimate = engine.getSavedEstimate(asset.id);
			if (!savedEstimate) return [];
			const raw = estimateTotalPrice(
				savedEstimate,
				option.markup_percentage,
				option.material_markup_percentage,
				option.labour_markup_percentage,
				option.equipment_markup_percentage,
				option.subcontract_markup_percentage
			);
			const unit_price = engine.roundPrices ? Math.ceil(raw) : raw;
			const quantity = engine.getQuantity(asset.id);

			return {
				file_name: asset.display_name,
				description: savedEstimate.scope_summary ?? '',
				quantity,
				lead_time: option.lead_time,
				unit_price,
				line_total: unit_price * quantity
			};
		});
	}

	function buildAttachmentSelections(): QuotePackageAttachmentSelection[] {
		const selections: QuotePackageAttachmentSelection[] = [];
		data.assets.forEach((asset) => {
			asset.files?.forEach((file) => {
				if (includedFiles[file.id] && isPdfAttachment(file.file_path)) {
					selections.push({
						file_id: file.id,
						file_name: file.original_name,
						file_path: file.file_path
					});
				}
			});
		});
		return selections;
	}

	function resolveWorkspaceLogoMimeType(
		logoPath: string | null | undefined
	): (typeof BRAND_LOGO_MIME_TYPES)[number] | null {
		const lowerPath = logoPath?.trim().toLowerCase() ?? '';
		if (!lowerPath) return null;
		if (lowerPath.endsWith('.png')) return 'image/png';
		if (lowerPath.endsWith('.jpg') || lowerPath.endsWith('.jpeg')) return 'image/jpeg';
		if (lowerPath.endsWith('.svg')) return 'image/svg+xml';
		return null;
	}

	async function rasteriseSvgLogoToPng(svgBytes: Uint8Array): Promise<Uint8Array | null> {
		if (typeof window === 'undefined') return null;

		const svgBlob = new Blob([new Uint8Array([...svgBytes])], { type: 'image/svg+xml' });
		const objectUrl = URL.createObjectURL(svgBlob);

		try {
			const image = await new Promise<HTMLImageElement>((resolve, reject) => {
				const next = new Image();
				next.onload = () => resolve(next);
				next.onerror = () => reject(new Error('Could not load the workspace logo SVG.'));
				next.src = objectUrl;
			});

			const naturalWidth = Math.max(1, image.naturalWidth || 512);
			const naturalHeight = Math.max(1, image.naturalHeight || 192);
			const scale = Math.min(1, 960 / naturalWidth, 320 / naturalHeight);
			const width = Math.max(1, Math.round(naturalWidth * scale));
			const height = Math.max(1, Math.round(naturalHeight * scale));
			const canvas = document.createElement('canvas');
			canvas.width = width;
			canvas.height = height;

			const context = canvas.getContext('2d');
			if (!context) {
				return null;
			}

			context.clearRect(0, 0, width, height);
			context.drawImage(image, 0, 0, width, height);

			const pngBlob = await new Promise<Blob | null>((resolve) => {
				canvas.toBlob((value) => resolve(value), 'image/png');
			});

			return pngBlob ? new Uint8Array(await pngBlob.arrayBuffer()) : null;
		} finally {
			URL.revokeObjectURL(objectUrl);
		}
	}

	let kwantflowFooterLogoPngPromise: Promise<Uint8Array | null> | null = null;

	async function loadKwantflowFooterLogoPng(): Promise<Uint8Array | null> {
		if (kwantflowFooterLogoPngPromise) {
			return kwantflowFooterLogoPngPromise;
		}

		kwantflowFooterLogoPngPromise = (async () => {
			if (typeof window === 'undefined') return null;
			try {
				const response = await fetch(kwantflowFooterMarkUrl);
				if (!response.ok) return null;
				const svgBytes = new Uint8Array(await response.arrayBuffer());
				return await rasteriseSvgLogoToPng(svgBytes);
			} catch {
				// Footer branding fetch is best-effort; PDF preview continues without it
				return null;
			}
		})();

		return kwantflowFooterLogoPngPromise;
	}

	async function buildBusinessPayload() {
		const businessId = buildPdfIdentifier(
			workspaceState.businessIdLabel,
			workspaceState.businessIdValue || null
		);
		const taxId = buildPdfTaxIdentifier(
			pdfDefaults.countryCode,
			workspaceState.countryCode,
			workspaceState.taxIdLabel,
			workspaceState.taxIdValue || null
		);
		const logoFilePath = workspaceState.logoFilePath?.trim() ?? '';
		const logoMimeType = resolveWorkspaceLogoMimeType(logoFilePath);
		const rawLogoBytes =
			logoFilePath &&
			logoMimeType &&
			BRAND_LOGO_EXTENSIONS.some((ext) => logoFilePath.toLowerCase().endsWith(`.${ext}`))
				? await readVaultFile(logoFilePath)
				: null;
		const logoBytes =
			logoMimeType === 'image/svg+xml' && rawLogoBytes
				? await rasteriseSvgLogoToPng(rawLogoBytes).catch(() => null)
				: rawLogoBytes;
		const pdfLogoMimeType: 'image/png' | 'image/jpeg' | null =
			logoMimeType === 'image/svg+xml' ? (logoBytes ? 'image/png' : null) : logoMimeType;

		return {
			name: workspaceState.businessName || workspaceState.displayName || '',
			countryCode: pdfDefaults.countryCode,
			logoFilePath: logoFilePath || null,
			logoMimeType: pdfLogoMimeType,
			logoBytes,
			businessIdLabel: businessId.label,
			businessIdValue: businessId.value,
			taxIdLabel: taxId.label,
			taxIdValue: taxId.value,
			taxDisplayLabel: workspaceState.taxDisplayLabel || null,
			taxRatePercentage: workspaceState.taxRatePercentage || 0,
			address: normaliseOptionalText(workspaceState.businessAddress),
			contactName: normaliseOptionalText(workspaceState.businessContactName),
			contactEmail: normaliseOptionalText(workspaceState.businessContactEmail),
			contactPhone: normaliseOptionalText(workspaceState.businessContactPhone),
			currencyCode: pdfDefaults.currencyCode,
			dateFormat: pdfDefaults.dateFormat,
			languageLocale: pdfDefaults.languageLocale,
			numberLocale: pdfDefaults.numberLocale
		};
	}

	async function buildPayloadForOption(
		option: QuoteOption,
		exportDates = createQuotePdfExportDates(Date.now(), pdfDefaults)
	): Promise<QuotePdfPayload> {
		const lineItems = buildLineItemsForOption(option);
		const subtotal = lineItems.reduce((sum, item) => sum + item.line_total, 0);
		const taxRatePercentage = workspaceState.taxRatePercentage || 0;
		const gst = subtotal * (taxRatePercentage / 100);
		const businessPayload = await buildBusinessPayload();
		const footerLogoBytes = await loadKwantflowFooterLogoPng();

		return {
			rfq_number: data.project.rfq_number,
			contact_name: normaliseOptionalText(data.project.contact_name),
			contact: buildActiveContactPayload(),
			project_name: normaliseOptionalText(data.project.project_name),
			business: {
				...businessPayload,
				taxRatePercentage
			},
			option_label: option.label,
			lead_time: option.lead_time,
			notes: option.notes || null,
			line_items: lineItems,
			subtotal,
			gst,
			total: subtotal + gst,
			issued_date: exportDates.issuedDate,
			valid_until_date: exportDates.validUntilDate,
			payment_terms: pdfDefaults.paymentTerms,
			terms_fallback: pdfDefaults.termsFallback,
			footerBranding: footerLogoBytes
				? {
						logoMimeType: 'image/png',
						logoBytes: footerLogoBytes
					}
				: null
		};
	}

	$effect(() => {
		if (!canRenderPdf) {
			previewPdfBytes = null;
			previewWarnings = [];
			previewAttachmentOutcomes = [];
			previewError = null;
			return;
		}

		const attachments = buildAttachmentSelections();
		const version = ++previewVersion;

		previewLoading = true;
		previewError = null;

		void buildPayloadForOption(activeOption)
			.then((payload) => getQuotePackagePreview(payload, attachments))
			.then((preview) => {
				if (previewVersion !== version) return;
				previewPdfBytes = new Uint8Array(preview.bytes);
				previewWarnings = preview.warnings;
				previewAttachmentOutcomes = preview.attachmentOutcomes;
			})
			.catch(async (err) => {
				if (previewVersion !== version) return;
				previewPdfBytes = null;
				previewWarnings = [];
				previewAttachmentOutcomes = [];
				previewError = 'Could not generate the PDF preview.';
				await errorState.catchError(err, 'Quote PDF Preview');
			})
			.finally(() => {
				if (previewVersion === version) {
					previewLoading = false;
				}
			});
	});

	async function handleDownload() {
		if (!canRenderPdf) return;
		downloading = true;

		try {
			const exportDates = createQuotePdfExportDates(Date.now(), pdfDefaults);
			const payload = await buildPayloadForOption(activeOption, exportDates);
			const attachments = buildAttachmentSelections();
			const preview = await getQuotePackagePreview(payload, attachments);
			const businessPayload = await buildBusinessPayload();
			const contactPayload = buildActiveContactPayload();

			await saveQuotePackageBytes(payload.rfq_number, preview.bytes);

			try {
				const revision = await engine.createQuoteRevision({
					project_id: data.project.id,
					rfq_number: data.project.rfq_number,
					contact_name: normaliseOptionalText(data.project.contact_name),
					contact: contactPayload,
					project_name: normaliseOptionalText(data.project.project_name),
					business: {
						name: businessPayload.name,
						countryCode: businessPayload.countryCode,
						businessIdLabel: businessPayload.businessIdLabel,
						businessIdValue: businessPayload.businessIdValue,
						taxIdLabel: businessPayload.taxIdLabel,
						taxIdValue: businessPayload.taxIdValue,
						taxDisplayLabel: workspaceState.taxDisplayLabel || null,
						taxRatePercentage: workspaceState.taxRatePercentage || 0,
						address: businessPayload.address,
						contactName: businessPayload.contactName,
						contactEmail: businessPayload.contactEmail,
						contactPhone: businessPayload.contactPhone,
						currency_code: pdfDefaults.currencyCode,
						currency_symbol: pdfDefaults.currencySymbol,
						dateFormat: pdfDefaults.dateFormat,
						languageLocale: pdfDefaults.languageLocale,
						numberLocale: pdfDefaults.numberLocale
					},
					issued_date: payload.issued_date,
					valid_until_date: payload.valid_until_date,
					package_attachments: preview.attachmentOutcomes,
					termsSnapshot: {
						paymentTerms: pdfDefaults.paymentTerms,
						termsFallback: pdfDefaults.termsFallback,
						validityDays: pdfDefaults.validityDays
					},
					recipientSnapshot: {
						contactName: normaliseOptionalText(data.project.contact_name),
						projectName: normaliseOptionalText(data.project.project_name)
					},
					options: engine.quoteOptions.map((option, index) => {
						const optionPayload = {
							line_items: buildLineItemsForOption(option),
							option_label: option.label,
							lead_time: option.lead_time,
							notes: option.notes || null
						};
						const subtotalAmount = optionPayload.line_items.reduce(
							(sum, item) => sum + item.line_total,
							0
						);
						const gstAmount = subtotalAmount * ((workspaceState.taxRatePercentage || 0) / 100);
						return {
							source_quote_option_id: option.id,
							label: option.label,
							lead_time: option.lead_time,
							markup_percentage: option.markup_percentage,
							notes: option.notes,
							sort_order: index,
							is_default: option.is_default,
							is_selected: option.id === activeOption.id,
							line_items: optionPayload.line_items,
							subtotal_amount: subtotalAmount,
							gst_amount: gstAmount,
							total_amount: subtotalAmount + gstAmount
						};
					})
				});
				if (preview.warnings.length > 0) {
					toast.warning(
						`PDF saved to Downloads · ${revision.revision_label} recorded · ${preview.warnings[0]}`
					);
				} else {
					toast.success(`PDF saved to Downloads · ${revision.revision_label} recorded`);
				}
			} catch (snapshotError) {
				await errorState.catchError(snapshotError, 'Record Quote Revision', undefined, {
					description: 'PDF saved to Downloads. Revision history was not recorded.'
				});
			}
		} catch (err) {
			await errorState.catchError(err, 'PDF Export');
		} finally {
			downloading = false;
		}
	}

	let downloading = $state(false);
	let sendQuoteOpen = $state(false);
	let sendQuoteDraft = $state<{ subject: string; body: string } | null>(null);
	let sendQuoteToEmail = $state('');
	let sendQuoteCcList = $state<string[]>([]);
	let sendQuoteBccList = $state<string[]>([]);
	let sendQuoteSending = $state(false);
	let sendQuoteGenerating = $state(false);
	let sendQuoteError = $state('');

	async function handleSendViaGmail() {
		if (!sendQuoteToEmail || !sendQuoteDraft) return;
		if (!appState.hasInternet) {
			sendQuoteError =
				'No internet connection. Use "Open in mail app" instead, or connect to the internet to send via Gmail.';
			return;
		}
		sendQuoteSending = true;
		sendQuoteError = '';
		try {
			// Generate PDF bytes in memory and pass to Rust directly
			const option =
				engine.quoteOptions.find((o) => o.id === activeOption.id) ?? engine.quoteOptions[0];
			if (option) {
				const exportDates = createQuotePdfExportDates(Date.now(), pdfDefaults);
				const payload = await buildPayloadForOption(option, exportDates);
				const attachments = buildAttachmentSelections();
				const preview = await getQuotePackagePreview(payload, attachments);
				const pdfBytes = new Uint8Array(preview.bytes);
				const attachmentBase64 = await uint8ArrayToBase64(pdfBytes);
				const rfqNumber = (data.project.rfq_number ?? 'quote').replace(/[^a-zA-Z0-9_-]/g, '');
				const filename = `${rfqNumber}.pdf`;

				const conn = integrationsState.activeEmailConnection;

				await invoke('send_email_message', {
					connectionId: conn?.id ?? '',
					to: sendQuoteToEmail,
					cc: sendQuoteCcList.length ? sendQuoteCcList.join(', ') : null,
					bcc: sendQuoteBccList.length ? sendQuoteBccList.join(', ') : null,
					subject: sendQuoteDraft.subject,
					body: sendQuoteDraft.body,
					attachmentFilename: filename,
					attachmentBase64
				});
			}
			toast.success(
				`Quote sent via ${integrationsState.activeEmailConnection?.provider === 'microsoft_outlook' ? 'Outlook' : 'Gmail'}`
			);

			sendQuoteOpen = false;
		} catch (err) {
			sendQuoteError = String(err);
		} finally {
			sendQuoteSending = false;
		}
	}

	function handleOpenSendQuote() {
		if (!canRenderPdf) return;
		sendQuoteError = '';
		sendQuoteSending = false;
		sendQuoteToEmail = contactEmail;

		if (!sendQuoteDraft) {
			const localPayload = {
				rfq_number: data.project.rfq_number ?? '',
				project_name: data.project.project_name ?? '',
				contact_name: data.project.contact_name ?? null
			};
			const lineItems = buildLineItemsForOption(activeOption);
			const lineSummary = lineItems
				.slice(0, 10)
				.map((item) => {
					const desc = item.description?.trim() || `Item ${item.file_name || ''}`;
					return `${desc} — ${item.quantity} × ${pdfDefaults.currencySymbol}${item.unit_price}`;
				})
				.join('\n');
			const subtotal = lineItems.reduce((sum, item) => sum + item.line_total, 0);
			const taxRatePercentage = workspaceState.taxRatePercentage || 0;
			const totalAmount = subtotal * (1 + taxRatePercentage / 100);
			sendQuoteDraft = buildTemplateEmailDraft(
				localPayload,
				workspaceState.businessName || workspaceState.displayName,
				activeOption.label,
				totalAmount,
				pdfDefaults.currencySymbol,
				aiState.workspaceAiKnowledgeContext,
				activeOption.notes || null,
				activeOption.lead_time || null,
				lineSummary,
				workspaceState.emailSignature
			);
		}
		sendQuoteOpen = true;
	}

	async function handleGenerateDraft() {
		sendQuoteGenerating = true;
		let deterministicFallbackDraft = sendQuoteDraft;
		try {
			const exportDates = createQuotePdfExportDates(Date.now(), pdfDefaults);
			const payload = await buildPayloadForOption(activeOption, exportDates);
			const totalAmount = payload.total;
			const localPayload = {
				rfq_number: data.project.rfq_number ?? '',
				project_name: data.project.project_name ?? '',
				contact_name: data.project.contact_name ?? null
			};

			const lineItems = buildLineItemsForOption(activeOption);
			const lineSummary = lineItems
				.slice(0, 10)
				.map((item) => {
					const desc = item.description?.trim() || `Item ${item.file_name || ''}`;
					return `${desc} — ${item.quantity} × ${pdfDefaults.currencySymbol}${item.unit_price}`;
				})
				.join('\n');

			const currentDraft =
				sendQuoteDraft ??
				buildTemplateEmailDraft(
					localPayload,
					workspaceState.businessName || workspaceState.displayName,
					activeOption.label,
					totalAmount,
					pdfDefaults.currencySymbol,
					aiState.workspaceAiKnowledgeContext,
					activeOption.notes || null,
					activeOption.lead_time || null,
					lineSummary,
					workspaceState.emailSignature
				);
			deterministicFallbackDraft = currentDraft;

			sendQuoteDraft = await rewriteQuoteEmailDraft({
				currentDraft,
				payload: localPayload,
				businessName: workspaceState.businessName || workspaceState.displayName,
				optionLabel: activeOption.label,
				totalAmount,
				currencySymbol: pdfDefaults.currencySymbol,
				countryCode: workspaceState.countryCode,
				workspaceKnowledge: aiState.workspaceAiKnowledgeContext,
				quoteNotes: activeOption.notes || null,
				leadTime: activeOption.lead_time || null,
				lineItemSummary: lineSummary,
				projectContent:
					[
						data.project.content,
						data.project.site_address,
						data.project.customer_tender_reference,
						data.project.note
					]
						.filter(Boolean)
						.join('\n') || null,
				paymentTerms: workspaceState.quotePaymentTerms || null,
				defaultInclusions: workspaceState.quoteDefaultInclusions || null,
				defaultExclusions: workspaceState.quoteDefaultExclusions || null,
				defaultTerms: workspaceState.quoteDefaultTerms || null,
				emailSignature: workspaceState.emailSignature
			});

			toast.success('Email draft generated');
		} catch (err) {
			// AI failed or timed out — fall back to template
			toast.error(err instanceof Error ? err.message : String(err));
			sendQuoteDraft = deterministicFallbackDraft;
		}
		sendQuoteGenerating = false;
	}
</script>

<div class="h-full min-h-0 w-full overflow-hidden">
	<Resizable.PaneGroup
		direction="horizontal"
		class="h-full min-h-0 w-full"
		onLayoutChange={() => {}}
	>
		<Resizable.Pane
			defaultSize={DEFAULT_PDF_PREVIEW_LAYOUT[0]}
			minSize={52}
			class="min-h-0 min-w-0"
		>
			<div class="relative h-full w-full">
				<div class="absolute inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden">
					<div class="ui-pane-header ui-pane-header-between ui-pane-header-compact">
						<Text as="span" class="title-copy">Quote PDF — {data.project.rfq_number}</Text>
						<div class="flex items-center gap-2">
							<Button
								onclick={handleDownload}
								size="xs"
								class="gap-2"
								disabled={!canRenderPdf || previewLoading || downloading}
							>
								<FileDownloadIcon class="size-3.5" />
								{downloading ? 'Saving…' : 'Download PDF'}
							</Button>
							<Button
								onclick={handleOpenSendQuote}
								size="xs"
								variant="secondary"
								class="gap-2"
								disabled={!canRenderPdf}
							>
								Send Quote
							</Button>
						</div>
					</div>

					<div class="ui-pane-header ui-pane-header-between ui-pane-header-compact">
						<div class="flex min-w-0 items-center gap-1.5">
							<h4 class="title-copy">Quote Option</h4>
							<FormHelpTooltip content="Preview and export the selected commercial option." />
						</div>
						<div class="w-full md:w-48">
							<Select.Root
								type="single"
								value={activeOption.id}
								onValueChange={(value) => {
									if (value) engine.setActiveQuoteOption(String(value));
								}}
							>
								<Select.Trigger id="pdf-quote-option" size="default" class="w-full">
									{activeOption.label}
								</Select.Trigger>
								<Select.Content>
									{#each engine.quoteOptions as option (option.id)}
										<Select.Item value={option.id} label={option.label}>
											<div class="flex min-w-0 items-center justify-between gap-2">
												<span class="truncate">{option.label}</span>
												{#if option.is_default}
													<BooleanStateBadge
														value={true}
														trueLabel="Default"
														tone="default"
														falseMode="hidden"
														class="shrink-0"
													/>
												{/if}
											</div>
										</Select.Item>
									{/each}
								</Select.Content>
							</Select.Root>
						</div>
					</div>

					{#if previewWarnings.length > 0}
						<div class="ui-pane-status status-panel-warning">
							{#each previewWarnings as warning (warning)}
								<Text>{warning}</Text>
							{/each}
							{#each previewAttachmentOutcomes.filter((outcome) => outcome.status === 'omitted') as outcome (outcome.file_name)}
								<Text tone="muted">{outcome.file_name}</Text>
							{/each}
						</div>
					{/if}

					{#if canRenderPdf && previewPdfBytes}
						<PDFViewer pdfBytes={previewPdfBytes} />
					{:else if canRenderPdf && previewLoading}
						<div class="ui-pane-empty">
							<Text as="span" class="max-w-sm text-center"
								>Generating the production PDF preview…</Text
							>
						</div>
					{:else if canRenderPdf && previewError}
						<div class="ui-pane-empty">
							<Text as="span" class="max-w-sm text-center">{previewError}</Text>
						</div>
					{:else if workingAssets.length > 0 && !estimatesReady}
						<div class="ui-pane-empty">
							<Text as="span" class="max-w-sm text-center">Loading selected estimate details…</Text>
						</div>
					{:else if workingAssets.length === 0}
						<div class="ui-pane-empty">
							<Text as="span" class="max-w-sm text-center">
								Select assets in Quote before opening PDF Preview.
							</Text>
						</div>
					{:else if hasSavedPdfContent && pdfReadinessBlockers.length > 0}
						<div class="ui-pane-empty">
							<Text as="span" class="max-w-sm text-center">
								Review AI draft rates and source matches before opening PDF Preview.
							</Text>
							<Meta class="max-w-sm text-center">{pdfReadinessBlockers[0]}</Meta>
						</div>
					{:else if hasSavedPdfContent}
						<div class="ui-pane-empty">
							<Text as="span" class="max-w-sm text-center">
								Select at least one included asset with saved quote content to activate PDF Preview.
							</Text>
						</div>
					{:else}
						<div class="ui-pane-empty">
							<Text as="span" class="max-w-sm text-center">
								Add saved estimate details or cost components to at least one asset in Quote before
								opening PDF Preview.
							</Text>
						</div>
					{/if}
				</div>
			</div>
		</Resizable.Pane>

		{#if hasAnyPdfFiles}
			<Resizable.Handle withHandle class={WORKSPACE_RESIZE_HANDLE_CLASS} />

			<Resizable.Pane
				defaultSize={DEFAULT_PDF_PREVIEW_LAYOUT[1]}
				minSize={18}
				class="min-h-0 min-w-0"
			>
				<div class="relative h-full w-full">
					<aside class="ui-pane-shell absolute inset-0 h-full">
						<header class="ui-pane-header ui-pane-header-compact">
							<Text as="span" class="title-copy">Attachments</Text>
						</header>
						<div class="min-h-0 flex-1 overflow-y-auto p-3">
							<div class="ui-pane-card shrink-0">
								<div class="ui-pane-card-header ui-pane-header-compact flex items-center">
									<Text as="span" class="title-copy">Technical Drawings (PDF)</Text>
								</div>
								<div class="space-y-2 p-3">
									{#each data.assets as asset (asset.id)}
										{#if asset.files}
											{#each asset.files.filter( (file) => isPdfAttachment(file.file_path) ) as file (file.id)}
												<label class="ui-file-row cursor-pointer" for="inc-{file.id}">
													<Checkbox
														id="inc-{file.id}"
														checked={isAttachmentIncluded(file.id)}
														onCheckedChange={(value) => setAttachmentIncluded(file.id, !!value)}
													/>
													<Text as="span" class="table-copy truncate">{file.original_name}</Text>
												</label>
											{/each}
										{/if}
									{/each}
								</div>
							</div>
						</div>
						<footer class="ui-pane-footer">
							<Meta class="text-center">
								Selected drawings will be appended to the end of the quote package.
							</Meta>
						</footer>
					</aside>
				</div>
			</Resizable.Pane>
		{/if}
	</Resizable.PaneGroup>
</div>

<QuoteEmailDialog
	draft={sendQuoteDraft}
	open={sendQuoteOpen}
	onclose={() => (sendQuoteOpen = false)}
	ongenerate={handleGenerateDraft}
	generating={sendQuoteGenerating}
	toEmail={sendQuoteToEmail}
	onToEmailChange={(email) => (sendQuoteToEmail = email)}
	isEmailConnected={integrationsState.isEmailConnected}
	providerName={integrationsState.activeMailProvider === 'microsoft_outlook' ? 'Outlook' : 'Gmail'}
	onSendViaEmail={handleSendViaGmail}
	sending={sendQuoteSending}
	sendError={sendQuoteError}
	hasInternet={appState.hasInternet}
	contactEmails={[
		...contactsState.allCompanies
			.filter((c) => c.email)
			.map((c) => ({
				label: c.name || c.email!,
				email: c.email!
			})),
		...contactsState.list
			.filter((c) => c.email && c.kind === 'person')
			.map((c) => ({
				label: c.name || c.email!,
				email: c.email!
			}))
	]}
	localAiReady={(aiState.localAiStatus.installState === 'ready' ||
		aiState.localAiStatus.installState === 'installed') &&
		aiState.localAiStatus.modelReady}
	ccList={sendQuoteCcList}
	onCcListChange={(list) => (sendQuoteCcList = list)}
	bccList={sendQuoteBccList}
	onBccListChange={(list) => (sendQuoteBccList = list)}
	onRemoveAttachment={() => {}}
/>
