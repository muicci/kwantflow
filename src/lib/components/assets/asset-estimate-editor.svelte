<script lang="ts">
	import { formatCurrency } from '$lib/utils/format.js';
	import { onDestroy, onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import * as Accordion from '$lib/components/ui/accordion/index.js';
	import * as Resizable from '$lib/components/ui/resizable/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		Cluster,
		FieldError,
		FieldLabel,
		FieldLabelRow,
		FieldShell,
		Meta,
		Panel,
		SectionLabel,
		Text
	} from '$lib/components/primitives/index.js';
	import FormHelpTooltip from '$lib/components/form-help-tooltip.svelte';
	import { Input, SearchInput } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import MultiFileViewer from '$lib/components/assets/MultiFileViewer.svelte';
	import AssetEstimateTakeoffItem from '$lib/components/assets/asset-estimate-takeoff-item.svelte';
	import EstimateAiDraftRow from '$lib/components/assets/estimate-ai-draft-row.svelte';
	import { toast } from 'svelte-sonner';
	import { DEFAULT_ASSET_EDITOR_LAYOUT, WORKSPACE_RESIZE_HANDLE_CLASS } from './viewer-layout.js';
	import SparkleIcon from '@lucide/svelte/icons/sparkle';
	import { costComponentPresetsState } from '$lib/state/cost-component-presets.svelte.js';
	import { estimateTemplatesState } from '$lib/state/estimate-templates.svelte.js';
	import { classificationSystemsState } from '$lib/state/classification-systems.svelte.js';
	import {
		costComponentPresetFormSchema,
		estimateTemplateFormSchema,
		type CostComponentPresetFormValues,
		type EstimateTemplateFormValues
	} from '$lib/schemas/index.js';
	import { getErrorMessage } from '$lib/utils/runtime-form-errors.js';
	import { normaliseEstimateTemplatePayload } from '$lib/utils/estimate-template-normalisation.js';
	import {
		formatEstimateGroupedNumber,
		normaliseEstimateNumericDraft
	} from '$lib/utils/estimate-numeric-inputs.js';
	import { cloneEstimateSnapshot } from '$lib/utils/estimate-snapshot.js';
	import { createLogger } from '$lib/services/logger.js';
	import { resolveDisplayedAiIssues } from '$lib/components/assets/estimate-ai-review.js';
	import { ALIAS_FIELD_HELP_TEXT, ALIAS_INPUT_PLACEHOLDER } from '$lib/constants/alias-guidance.js';
	import { parseAliasesInput } from '$lib/utils/aliases.js';
	import { getFieldInvalidTone } from '$lib/utils/field-errors.js';
	import {
		resolveEstimateAiFileEligibilities,
		summariseEstimateAiFileEligibilities,
		type EstimateAiFileEligibility
	} from '$lib/services/estimate-ai-file-eligibility.js';
	import {
		estimateDisplaySummary,
		estimateTotalCost,
		getQuoteEngine
	} from '$lib/state/quote.svelte.js';
	import { aiState } from '$lib/state/ai.svelte.js';
	import { assistantState } from '$lib/state/assistant.svelte.js';
	import { appState } from '$lib/state/app.svelte.js';
	import { assetPreviewState } from '$lib/state/asset-preview.svelte.js';
	import { errorState } from '$lib/state/errors.svelte.js';
	import { projectsState } from '$lib/state/projects.svelte.js';
	import type {
		AiEvidenceRef,
		Asset,
		ClassificationSystem,
		CostCode,
		CostComponent,
		CostComponentPreset,
		EquipmentRateCard,
		Estimate,
		EstimateTemplate,
		LabourRateCard,
		MaterialCatalogueItem,
		SubcontractRateCard,
		WbsNode
	} from '$lib/types/index.js';
	import {
		filterPickerOptions,
		rankPickerOptions,
		resolvePresetApplySelection,
		shouldAutoApplyPendingAiEstimate,
		resolveTemplateApplySelection,
		type PendingPresetApplyIntent,
		type PendingTemplateApplyIntent
	} from './asset-estimate-editor.helpers.js';

	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import CheckIcon from '@lucide/svelte/icons/check';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';

	type EstimateEditorSection = 'setup' | 'ai' | 'takeoff';

	type PickerOption = {
		id: string;
		label: string;
		code: string | null;
		description: string | null;
		aliases: string[];
		searchText: string;
	};

	function buildTemplatePickerSearchSeed(): string {
		return '';
	}

	function buildClassificationPickerSearchSeed(): string {
		return '';
	}

	function buildStructureRootPickerSearchSeed(): string {
		return '';
	}

	let {
		asset,
		classificationSystems,
		costCodes,
		wbsNodes,
		materialCatalogueItems,
		labourRateCards,
		equipmentRateCards,
		subcontractRateCards,
		costComponentPresets,
		estimateTemplates
	}: {
		asset: Asset;
		classificationSystems: ClassificationSystem[];
		costCodes: CostCode[];
		wbsNodes: WbsNode[];
		materialCatalogueItems: MaterialCatalogueItem[];
		labourRateCards: LabourRateCard[];
		equipmentRateCards: EquipmentRateCard[];
		subcontractRateCards: SubcontractRateCard[];
		costComponentPresets: CostComponentPreset[];
		estimateTemplates: EstimateTemplate[];
	} = $props();

	function buildWbsNodePathLabel(nodeId: string): string | null {
		const nodeMap = new Map(wbsNodes.map((entry) => [entry.id, entry] as const));
		const labels: string[] = [];
		const visited: string[] = [];
		let currentId: string | null = nodeId;

		while (currentId) {
			if (visited.includes(currentId)) break;
			visited.push(currentId);
			const currentNode = nodeMap.get(currentId);
			if (!currentNode) break;
			labels.unshift(currentNode.name);
			currentId = currentNode.parent_id ?? null;
		}

		return labels.length > 0 ? labels.join(' / ') : null;
	}

	const engine = getQuoteEngine();
	const log = createLogger('assetEstimateEditor');
	const estimate = $derived(engine.getEstimate(asset.id));
	const totalCost = $derived(estimateTotalCost(estimate));
	let isAiDraftStarting = $state(false);
	const aiRunState = $derived(aiState.getAssetRunState(asset.id));
	const pendingAiAppliedEstimate = $derived(aiState.getPendingAppliedEstimate(asset.id));
	const pendingAiDraftTotal = $derived.by(() => {
		const appliedEstimate = pendingAiAppliedEstimate;
		return appliedEstimate ? estimateTotalCost(appliedEstimate) : null;
	});
	const pendingAiDraftTotalLabel = $derived.by(() =>
		pendingAiDraftTotal !== null && pendingAiDraftTotal > 0
			? formatCurrency(pendingAiDraftTotal)
			: null
	);
	const restorableEstimateContext = $derived(aiState.getEstimateBeforeApply(asset.id));
	const assetHasPendingAiApply = $derived(aiState.hasPendingAppliedEstimate(asset.id));
	const pendingAiEstimateMatchesEditor = $derived.by(() => {
		const appliedEstimate = pendingAiAppliedEstimate;
		if (!appliedEstimate) return false;
		return estimateContextSignature(appliedEstimate) === estimateContextSignature(estimate);
	});
	const aiDraftAppliedToEditor = $derived(
		aiRunState.editorApplyState === 'applied_to_editor' || pendingAiEstimateMatchesEditor
	);
	const aiRunFeedbackEntry = $derived(aiState.getRunFeedbackEntry(aiRunState.runId));
	const aiDraftAwaitingManualApply = $derived(assetHasPendingAiApply && !aiDraftAppliedToEditor);
	const displayedAiReviewEstimate = $derived.by(() =>
		aiDraftAwaitingManualApply && pendingAiAppliedEstimate ? pendingAiAppliedEstimate : estimate
	);
	const assetEstimateLockedByAi = $derived(aiState.isAssetEstimateLocked(asset.id));
	const assetFiles = $derived(asset.files ?? []);
	const baseAiDraftingAvailability = $derived(aiState.getDraftingAvailability(true));
	const assetFileEligibilitySignature = $derived(
		`${asset.id}:${assetFiles.map((file) => `${file.id}:${file.file_path}:${file.mime_type ?? ''}`).join('|')}`
	);
	const showAiReviewSession = $derived(
		assetHasPendingAiApply ||
			aiRunState.status === 'applied' ||
			aiRunState.status === 'failed' ||
			aiRunState.status === 'cancelled' ||
			isAiRunActive()
	);
	const showAiDraftCard = $derived(true);
	const project = $derived(projectsState.workspaceProject ?? projectsState.active);
	const previewSelection = $derived(assetPreviewState.getSelection(asset.id));
	const previewDetached = $derived(assetPreviewState.isDetachedForAsset(asset.id));
	const aiOpenQuestionCount = $derived(
		displayedAiReviewEstimate.takeoff_items.reduce((total, item) => {
			const value = item.properties?.ai_open_questions;
			return (
				total +
				(Array.isArray(value) ? value.filter((entry) => typeof entry === 'string').length : 0)
			);
		}, 0)
	);
	const aiUnresolvedMappingCount = $derived(
		displayedAiReviewEstimate.takeoff_items.reduce(
			(total, item) =>
				total +
				item.cost_components.filter(
					(component) => component.metadata?.ai_mapping_status === 'unresolved'
				).length,
			0
		)
	);
	const aiCommercialReviewCount = $derived(
		displayedAiReviewEstimate.takeoff_items.reduce(
			(total, item) =>
				total +
				item.cost_components.filter(
					(component) =>
						!Number.isFinite(component.quantity) ||
						component.quantity <= 0 ||
						!Number.isFinite(component.unit_rate) ||
						component.unit_rate <= 0
				).length,
			0
		)
	);
	const displayedAiIssues = $derived(
		resolveDisplayedAiIssues({
			status: aiRunState.status,
			issues: aiRunState.issues,
			estimate
		})
	);
	const hasExistingEstimateContent = $derived(!isBlankEstimateContext(estimate));
	const availableCostComponentPresets = $derived(costComponentPresetsState.list);
	const availableEstimateTemplates = $derived(estimateTemplatesState.list);
	const templatePickerOptions = $derived.by<PickerOption[]>(() =>
		availableEstimateTemplates.map((template) => {
			const aliases = Array.isArray(template.aliases)
				? template.aliases.filter(
						(entry): entry is string => typeof entry === 'string' && entry.trim().length > 0
					)
				: [];
			return {
				id: template.id,
				label: template.name,
				code: template.code?.trim() || null,
				description: template.description?.trim() || null,
				aliases,
				searchText: [
					template.name,
					template.code ?? '',
					template.description ?? '',
					aliases.join(' ')
				]
					.join(' ')
					.toLowerCase()
			};
		})
	);
	const filteredTemplatePickerOptions = $derived.by<PickerOption[]>(() => {
		return rankPickerOptions(
			filterPickerOptions(templatePickerOptions, templatePickerSearch),
			templatePickerSearch
		);
	});
	const classificationPickerOptions = $derived.by<PickerOption[]>(() =>
		classificationSystems.map((system) => {
			const aliases = Array.isArray(system.aliases)
				? system.aliases.filter(
						(entry): entry is string => typeof entry === 'string' && entry.trim().length > 0
					)
				: [];
			return {
				id: system.id,
				label: system.name,
				code: system.code?.trim() || null,
				description: system.classification_type?.trim() || null,
				aliases,
				searchText: [
					system.name,
					system.code ?? '',
					system.classification_type ?? '',
					aliases.join(' ')
				]
					.join(' ')
					.toLowerCase()
			};
		})
	);
	const filteredClassificationPickerOptions = $derived.by<PickerOption[]>(() =>
		rankPickerOptions(
			filterPickerOptions(classificationPickerOptions, classificationPickerSearch),
			classificationPickerSearch
		)
	);
	const structureRootPickerOptions = $derived.by<PickerOption[]>(() =>
		wbsNodes.map((node) => {
			const path = buildWbsNodePathLabel(node.id) ?? '';
			return {
				id: node.id,
				label: node.name,
				code: node.code?.trim() || null,
				description: [node.type?.trim() || null, path || null].filter(Boolean).join(' · ') || null,
				aliases: [],
				searchText: [node.name, node.code ?? '', node.type ?? '', path].join(' ').toLowerCase()
			};
		})
	);
	const filteredStructureRootPickerOptions = $derived.by<PickerOption[]>(() =>
		rankPickerOptions(
			filterPickerOptions(structureRootPickerOptions, structureRootPickerSearch),
			structureRootPickerSearch
		)
	);

	const filteredCostCodes = $derived(
		estimate.classification_system_id
			? costCodes.filter(
					(code) => code.classification_system_id === estimate.classification_system_id
				)
			: costCodes
	);

	let saving = $state(false);
	let activeViewerFileId = $state<string | null>(null);
	let viewerTargetPdfPage = $state<number | null>(null);
	let viewerTargetCadViewLabel = $state<string | null>(null);
	let viewerTargetLocator = $state<Record<string, unknown> | null>(null);
	let templatePickerDialogOpen = $state(false);
	let templatePickerSearch = $state('');
	let classificationPickerDialogOpen = $state(false);
	let classificationPickerSearch = $state('');
	let structureRootPickerDialogOpen = $state(false);
	let structureRootPickerSearch = $state('');
	let numericDrafts = $state<Record<string, string>>({});
	let activeNumericInputs = $state<Record<string, boolean>>({});
	let presetDialogOpen = $state(false);
	let templateDialogOpen = $state(false);
	let targetPresetItemId = $state<string | null>(null);
	let presetFormValues = $state<CostComponentPresetFormValues>({
		code: '',
		name: '',
		description: '',
		aliases: [],
		is_active: true
	});
	let templateFormValues = $state<EstimateTemplateFormValues>({
		code: '',
		name: '',
		description: '',
		aliases: [],
		is_active: true
	});
	let presetFieldErrors = $state<Record<string, string[] | undefined>>({});
	let templateFieldErrors = $state<Record<string, string[] | undefined>>({});
	let savingPreset = $state(false);
	let savingTemplate = $state(false);
	let presetAliasesInput = $state('');
	let templateAliasesInput = $state('');
	let saveWarningDialogOpen = $state(false);
	let pendingReusableSave = $state<{
		kind: 'preset' | 'template';
		unresolvedCount: number;
		rateReviewCount: number;
	} | null>(null);
	let viewerExpanded = $state(appState.previewExpanded);
	let activeEstimateSection = $state<EstimateEditorSection>('ai');
	let estimateSetupWidth = $state(0);
	let collapsedTakeoffSetups = new SvelteSet<string>();
	let confirmTemplateOpen = $state(false);
	let pendingTemplateIntent = $state<PendingTemplateApplyIntent | null>(null);
	let confirmPresetOpen = $state(false);
	let pendingPresetIntent = $state<PendingPresetApplyIntent | null>(null);
	let presetApplyMode = $state<'append' | 'replace'>('append');
	let confirmAiReplaceOpen = $state(false);
	let confirmEstimateResetOpen = $state(false);
	let lastAutoApplyConflictRunId = $state<string | null>(null);
	let suppressPendingAiAutoApply = $state(false);
	let acknowledgedAiFields = new SvelteSet<string>();
	let lastAiHighlightSignature = $state('');
	type PaneController = {
		collapse: () => void;
		expand: () => void;
		isCollapsed: () => boolean;
		isExpanded: () => boolean;
	};

	let estimatePane = $state<PaneController | null>(null);
	let lastSelectionSignature = $state('');
	let eligibilityRequestToken = 0;
	let assetFileEligibilities = $state<EstimateAiFileEligibility[]>([]);
	let assetFileEligibilityResolved = $state(true);
	const assetAiEligibilitySummary = $derived(
		summariseEstimateAiFileEligibilities(assetFileEligibilities)
	);
	const assetAiDraftingAvailability = $derived.by(() => {
		const baseAvailability = baseAiDraftingAvailability;
		if (!assetFileEligibilityResolved && assetFiles.length > 0) {
			return {
				...baseAvailability,
				hasSupportedFiles: false,
				supportedFileCount: 0,
				unsupportedFileCount: 0,
				supportedFiles: [],
				unsupportedFiles: [],
				canDraftEstimate: false,
				unavailableReason: baseAvailability.unavailableReason ?? 'Checking which files AI can use.'
			};
		}

		const unavailableReason =
			baseAvailability.unavailableReason ??
			(assetAiEligibilitySummary.hasEligibleFiles
				? null
				: assetFiles.length === 0
					? 'Add a supported asset file to draft with AI.'
					: 'This asset does not have a supported file for AI drafting yet.');

		return {
			...baseAvailability,
			hasSupportedFiles: assetAiEligibilitySummary.hasEligibleFiles,
			supportedFileCount: assetAiEligibilitySummary.eligibleFiles.length,
			unsupportedFileCount: assetAiEligibilitySummary.ineligibleFiles.length,
			supportedFiles: assetAiEligibilitySummary.eligibleFiles,
			unsupportedFiles: assetAiEligibilitySummary.ineligibleFiles.map((status) => ({
				fileId: status.fileId,
				fileName: status.fileName,
				reason: status.reasonCode === 'supported' ? 'unsupported_file_type' : status.reasonCode,
				detail: status.tooltipDetail
			})),
			canDraftEstimate: unavailableReason === null,
			unavailableReason
		};
	});
	const canDraftEstimateWithAi = $derived(assetAiDraftingAvailability.canDraftEstimate);
	const estimateSetupLayoutMode = $derived(estimateSetupWidth >= 544 ? 'wide' : 'narrow');
	const takeoffSectionMeta = $derived(`${estimate.takeoff_items.length} item(s)`);

	function isEstimateSectionExpanded(section: EstimateEditorSection): boolean {
		return activeEstimateSection === section;
	}

	$effect(() => {
		assistantState.setCurrentEstimateContext({
			assetId: asset.id,
			takeoffItemCount: estimate.takeoff_items.length,
			scopeSummary: estimate.scope_summary,
			notes: estimate.notes,
			totalCost,
			takeoffItems: estimate.takeoff_items.map((item) => ({
				sort_order: item.sort_order,
				name: item.name,
				reasoning: (item.properties as Record<string, unknown>)?.reasoning as string | undefined,
				evidenceRefCount: Array.isArray(item.properties?.ai_evidence_refs)
					? item.properties.ai_evidence_refs.length
					: 0,
				confidence: (item.properties as Record<string, unknown>)?.confidence as string | undefined
			}))
		});
	});

	function selectionSignature(selection: {
		activeFileId: string | null;
		targetPdfPage: number | null;
		targetCadViewLabel: string | null;
	}): string {
		return [
			selection.activeFileId ?? '',
			String(selection.targetPdfPage ?? ''),
			selection.targetCadViewLabel ?? ''
		].join('|');
	}

	function estimateContextSignature(value: typeof estimate | null): string {
		return value ? JSON.stringify(value) : '';
	}

	function itemNameAckKey(itemId: string): string {
		return `takeoff:${itemId}:name`;
	}

	function componentNameAckKey(componentId: string): string {
		return `component:${componentId}:name`;
	}

	function acknowledgeAiField(fieldKey: string): void {
		acknowledgedAiFields.add(fieldKey);
	}

	function isAiFieldAcknowledged(fieldKey: string): boolean {
		return acknowledgedAiFields.has(fieldKey);
	}

	function isBlankEstimateContext(value: typeof estimate | null): boolean {
		if (!value) return false;
		return (
			value.scope_summary.trim().length === 0 &&
			value.notes.trim().length === 0 &&
			value.classification_system_id === null &&
			value.wbs_root_node_id === null &&
			value.applied_template_id === null &&
			value.applied_template_name === null &&
			value.takeoff_items.length === 0
		);
	}

	function resetEstimateEditorTransientState(): void {
		numericDrafts = {};
		activeNumericInputs = {};
	}

	onMount(() => {
		costComponentPresetsState.replaceFromSnapshot(costComponentPresets);
		estimateTemplatesState.replaceFromSnapshot(estimateTemplates);
		void aiState.hydrateLatestRunForAsset(asset.id);
	});

	onDestroy(() => {
		assistantState.clearCurrentEstimateContext(asset.id);
	});

	$effect(() => {
		const signature = assetFileEligibilitySignature;
		const files = assetFiles;
		void signature;
		eligibilityRequestToken += 1;
		const requestToken = eligibilityRequestToken;
		assetFileEligibilities = [];
		assetFileEligibilityResolved = files.length === 0;
		if (files.length === 0) return;

		void resolveEstimateAiFileEligibilities(files)
			.then((statuses) => {
				if (requestToken !== eligibilityRequestToken) return;
				assetFileEligibilities = statuses;
				assetFileEligibilityResolved = true;
			})
			.catch((error) => {
				if (requestToken !== eligibilityRequestToken) return;
				log.warn('Failed to resolve AI file eligibility for asset', {
					assetId: asset.id,
					error
				});
				assetFileEligibilities = files.map((file) => ({
					fileId: file.id,
					fileName: file.original_name,
					status: 'ineligible' as const,
					evidenceMode: 'none' as const,
					reasonCode: 'eligibility_check_failed' as const,
					tooltipLabel: 'Not used by AI draft',
					tooltipDetail: 'Kwantflow could not check this file for AI drafting.'
				}));
				assetFileEligibilityResolved = true;
			});
	});

	$effect(() => {
		const selection = previewSelection;
		const signature = selectionSignature(selection);
		if (signature === lastSelectionSignature) return;
		lastSelectionSignature = signature;
		activeViewerFileId = selection.activeFileId;
		viewerTargetPdfPage = selection.targetPdfPage;
		viewerTargetCadViewLabel = selection.targetCadViewLabel;
	});

	$effect(() => {
		const signature = selectionSignature({
			activeFileId: activeViewerFileId,
			targetPdfPage: viewerTargetPdfPage,
			targetCadViewLabel: viewerTargetCadViewLabel
		});

		if (signature === lastSelectionSignature) return;
		lastSelectionSignature = signature;
		void assetPreviewState.setSelection(asset.id, {
			activeFileId: activeViewerFileId,
			targetPdfPage: viewerTargetPdfPage,
			targetCadViewLabel: viewerTargetCadViewLabel
		});
	});

	$effect(() => {
		if (viewerExpanded === appState.previewExpanded) return;
		void appState.setPreviewExpanded(viewerExpanded);
	});

	$effect(() => {
		const pane = estimatePane;
		if (!pane) return;

		if (previewDetached) {
			if (!pane.isExpanded()) {
				pane.expand();
			}
			return;
		}

		if (viewerExpanded) {
			if (!pane.isCollapsed()) {
				pane.collapse();
			}
			return;
		}

		if (!pane.isExpanded()) {
			pane.expand();
		}
	});

	$effect(() => {
		if (!showAiDraftCard && activeEstimateSection === 'ai') {
			activeEstimateSection = 'setup';
		}
	});

	$effect(() => {
		const snapshot = restorableEstimateContext;
		const shouldRestoreBaseline = aiState.shouldRestoreEstimateBaseline(asset.id);
		if (!snapshot || !shouldRestoreBaseline) return;
		if (engine.isDirty(asset.id)) return;
		if (estimateContextSignature(snapshot) === estimateContextSignature(estimate)) return;
		resetEstimateEditorTransientState();
		engine.restoreEstimateContext(asset.id, cloneEstimateSnapshot(snapshot));
	});

	$effect(() => {
		const appliedEstimate = pendingAiAppliedEstimate;
		if (!appliedEstimate) return;
		if (estimateContextSignature(appliedEstimate) === estimateContextSignature(estimate)) {
			if (aiRunState.editorApplyState !== 'applied_to_editor') {
				aiState.markPendingEstimateAppliedToEditor(asset.id);
			}
			lastAutoApplyConflictRunId = null;
			return;
		}
		if (suppressPendingAiAutoApply) return;

		if (aiRunState.editorApplyState === 'applied_to_editor') {
			return;
		}

		if (lastAutoApplyConflictRunId === aiRunState.runId) {
			return;
		}

		const savedEstimate = engine.getSavedEstimate(asset.id);
		const baselineMatchesCurrent = shouldAutoApplyPendingAiEstimate({
			isDirty: engine.isDirty(asset.id),
			hasRestorableBaseline: Boolean(restorableEstimateContext),
			currentMatchesRestorableBaseline: restorableEstimateContext
				? estimateContextSignature(restorableEstimateContext) === estimateContextSignature(estimate)
				: false,
			hasSavedEstimate: Boolean(savedEstimate),
			currentMatchesSavedEstimate: savedEstimate
				? estimateContextSignature(savedEstimate) === estimateContextSignature(estimate)
				: false,
			isCurrentBlank: isBlankEstimateContext(estimate)
		});
		if (!baselineMatchesCurrent) {
			if (aiRunState.editorApplyState !== 'pending_manual_apply') {
				aiState.markPendingEstimateAwaitingManualApply(asset.id);
			}
			if (lastAutoApplyConflictRunId !== aiRunState.runId) {
				lastAutoApplyConflictRunId = aiRunState.runId;
				log.info('AI draft is waiting for manual apply because the editor state changed', {
					assetId: asset.id,
					runId: aiRunState.runId
				});
			}
			return;
		}
		lastAutoApplyConflictRunId = null;
		resetEstimateEditorTransientState();
		engine.replaceEstimate(asset.id, cloneEstimateSnapshot(appliedEstimate));
		aiState.markPendingEstimateAppliedToEditor(asset.id);
	});

	$effect(() => {
		const signature = [
			aiRunState.runId ?? '',
			aiRunState.status,
			assetHasPendingAiApply ? 'pending' : 'settled'
		].join('|');
		if (signature === lastAiHighlightSignature) return;
		lastAiHighlightSignature = signature;
		acknowledgedAiFields = new SvelteSet<string>();
	});

	const localAiReady = $derived(
		(aiState.localAiStatus.installState === 'ready' ||
			aiState.localAiStatus.installState === 'installed') &&
			!aiState.localAiStatus.lastError
	);
	function aiStageLabel() {
		if (aiRunState.isCancelling) return 'Cancelling';
		switch (aiRunState.status) {
			case 'queued':
				return 'Waiting for the current AI run';
			case 'preprocessing':
			case 'extracting':
				return aiRunState.status === 'extracting' ? 'Reading files' : 'Preparing files';
			case 'drafting':
				switch (aiRunState.progressDetail.draftSubphase) {
					case 'validation':
						return 'Checking draft';
					default:
						return 'Building draft';
				}
			case 'applied':
				return aiDraftAwaitingManualApply ? 'Draft ready to review' : 'Draft applied';
			case 'failed':
				return 'Needs attention';
			case 'cancelled':
				return 'Cancelled';
			default:
				return null;
		}
	}

	function handleAiBlockedAction() {
		appState.openSettingsDialog('ai');
	}

	function isAiRunActive() {
		return (
			aiRunState.status === 'queued' ||
			aiRunState.status === 'preprocessing' ||
			aiRunState.status === 'extracting' ||
			aiRunState.status === 'drafting'
		);
	}

	const aiProgressLabel = $derived(
		aiRunState.isCancelling ? 'Stopping the current run' : aiStageLabel()
	);

	function selectAiEvidence(ref: AiEvidenceRef) {
		const matchingFile =
			(asset.files ?? []).find((file) => file.id === ref.file_id) ??
			(asset.files ?? []).find((file) => file.original_name === ref.file_name);
		if (!matchingFile) return;

		activeViewerFileId = matchingFile.id;
		viewerTargetPdfPage = ref.page_number ?? null;
		viewerTargetCadViewLabel = ref.view_label ?? null;
		viewerTargetLocator = ref.locator ?? null;
	}

	async function toggleDetachedPreview() {
		viewerExpanded = false;

		if (previewDetached) {
			await assetPreviewState.reattach();
			return;
		}

		await assetPreviewState.detach({
			projectId: asset.project_id,
			assetId: asset.id,
			assetName: asset.display_name
		});
	}

	async function cancelAiDraftRun() {
		await aiState.cancelRunForAsset(asset.id);
	}

	function selectedClassificationName() {
		return (
			classificationSystems.find((system) => system.id === estimate.classification_system_id)
				?.name ?? 'Unclassified'
		);
	}

	function selectedWbsRootName() {
		return wbsNodes.find((node) => node.id === estimate.wbs_root_node_id)?.name ?? 'None';
	}

	function templatePickerOptionSelected(optionId: string): boolean {
		return estimate.applied_template_id === optionId;
	}

	function classificationPickerOptionSelected(optionId: string | null): boolean {
		return (estimate.classification_system_id ?? null) === optionId;
	}

	function structureRootPickerOptionSelected(optionId: string | null): boolean {
		return (estimate.wbs_root_node_id ?? null) === optionId;
	}

	function numericDraftKey(id: string, field: string) {
		return `${id}:${field}`;
	}

	function getNumericInputValue(id: string, field: string, currentValue: number) {
		const key = numericDraftKey(id, field);
		const rawValue =
			key in numericDrafts ? numericDrafts[key] : currentValue === 0 ? '' : String(currentValue);

		if ((field !== 'quantity' && field !== 'unit_rate') || activeNumericInputs[key]) {
			return rawValue;
		}

		const normalisedValue = normaliseEstimateNumericDraft(rawValue);
		if (!normalisedValue) return '';

		const parsedValue = Number(normalisedValue);
		return Number.isFinite(parsedValue) ? formatEstimateGroupedNumber(parsedValue) : rawValue;
	}

	function beginNumericInputEdit(id: string, field: string) {
		activeNumericInputs[numericDraftKey(id, field)] = true;
	}

	function endNumericInputEdit(id: string, field: string) {
		delete activeNumericInputs[numericDraftKey(id, field)];
	}

	function updateTakeoffQuantityDraft(itemId: string, rawValue: string) {
		const normalisedValue = normaliseEstimateNumericDraft(rawValue);
		numericDrafts[numericDraftKey(itemId, 'quantity')] = normalisedValue;
		engine.updateTakeoffItem(asset.id, itemId, {
			quantity: Math.max(0, parseFloat(normalisedValue) || 0)
		});
	}

	function updateCostComponentNumberDraft(
		itemId: string,
		componentId: string,
		field: 'quantity' | 'unit_rate',
		rawValue: string
	) {
		const normalisedValue = normaliseEstimateNumericDraft(rawValue);
		numericDrafts[numericDraftKey(componentId, field)] = normalisedValue;
		updateCostComponentField(
			itemId,
			componentId,
			field,
			Math.max(0, parseFloat(normalisedValue) || 0)
		);
	}

	function updateEstimateField(
		field: 'scope_summary' | 'notes' | 'classification_system_id' | 'wbs_root_node_id',
		value: string | null
	) {
		engine.updateEstimate(asset.id, { [field]: value });
	}

	function updateTakeoffItemField(
		itemId: string,
		field: 'name' | 'description' | 'unit' | 'cost_code_id' | 'wbs_node_id',
		value: string | null
	) {
		engine.updateTakeoffItem(asset.id, itemId, { [field]: value });
	}

	function updateTakeoffItemName(itemId: string, value: string): void {
		acknowledgeAiField(itemNameAckKey(itemId));
		updateTakeoffItemField(itemId, 'name', value);
	}

	function updateCostComponentField(
		itemId: string,
		componentId: string,
		field: keyof CostComponent,
		value: string | number | null
	) {
		engine.updateCostComponent(asset.id, itemId, componentId, {
			[field]: value
		} as Partial<CostComponent>);
	}

	function updateCostComponentName(itemId: string, componentId: string, value: string): void {
		acknowledgeAiField(componentNameAckKey(componentId));
		updateCostComponentField(itemId, componentId, 'name', value);
	}

	function getCostComponent(itemId: string, componentId: string): CostComponent | undefined {
		return engine
			.getEstimate(asset.id)
			.takeoff_items.find((item) => item.id === itemId)
			?.cost_components.find((component) => component.id === componentId);
	}

	function linkedCostComponentMetadata(
		component: CostComponent | undefined,
		sourceMetadata: Record<string, unknown>
	): Record<string, unknown> {
		return {
			...sourceMetadata,
			...(component?.metadata ?? {}),
			ai_mapping_status: 'matched'
		};
	}

	function toggleTakeoffSetup(itemId: string) {
		if (collapsedTakeoffSetups.has(itemId)) {
			collapsedTakeoffSetups.delete(itemId);
			return;
		}

		collapsedTakeoffSetups.add(itemId);
	}

	async function addMaterialFromCatalogue(itemId: string, catalogueId: string) {
		const selected = materialCatalogueItems.find((item) => item.id === catalogueId);
		if (!selected) return;
		await engine.addCostComponent(asset.id, itemId, 'material');
		const nextEstimate = engine.getEstimate(asset.id);
		const nextComponent = nextEstimate.takeoff_items
			.find((item) => item.id === itemId)
			?.cost_components.at(-1);
		if (!nextComponent) return;
		engine.updateCostComponent(asset.id, itemId, nextComponent.id, {
			source_type: 'material_catalog',
			source_id: selected.id,
			name: selected.name,
			description: selected.specification ?? '',
			unit: selected.unit,
			unit_rate: selected.default_rate,
			metadata: selected.metadata
		});
	}

	function applyMaterialCatalogueToComponent(
		itemId: string,
		componentId: string,
		catalogueId: string
	) {
		const selected = materialCatalogueItems.find((item) => item.id === catalogueId);
		if (!selected) return;
		const component = getCostComponent(itemId, componentId);
		engine.updateCostComponent(asset.id, itemId, componentId, {
			source_type: 'material_catalog',
			source_id: selected.id,
			name: selected.name,
			description: selected.specification ?? '',
			unit: selected.unit,
			unit_rate: selected.default_rate,
			metadata: linkedCostComponentMetadata(component, selected.metadata)
		});
	}

	async function addLabourFromCatalogue(itemId: string, catalogueId: string) {
		const selected = labourRateCards.find((item) => item.id === catalogueId);
		if (!selected) return;
		await engine.addCostComponent(asset.id, itemId, 'labour');
		const nextEstimate = engine.getEstimate(asset.id);
		const nextComponent = nextEstimate.takeoff_items
			.find((item) => item.id === itemId)
			?.cost_components.at(-1);
		if (!nextComponent) return;
		engine.updateCostComponent(asset.id, itemId, nextComponent.id, {
			source_type: 'labour_rate_card',
			source_id: selected.id,
			name: selected.name,
			description: selected.work_center ?? '',
			unit: selected.unit,
			unit_rate: selected.default_rate,
			metadata: selected.metadata
		});
	}

	function applyLabourCatalogueToComponent(
		itemId: string,
		componentId: string,
		catalogueId: string
	) {
		const selected = labourRateCards.find((item) => item.id === catalogueId);
		if (!selected) return;
		const component = getCostComponent(itemId, componentId);
		engine.updateCostComponent(asset.id, itemId, componentId, {
			source_type: 'labour_rate_card',
			source_id: selected.id,
			name: selected.name,
			description: selected.work_center ?? '',
			unit: selected.unit,
			unit_rate: selected.default_rate,
			metadata: linkedCostComponentMetadata(component, selected.metadata)
		});
	}

	async function addEquipmentFromCatalogue(itemId: string, catalogueId: string) {
		const selected = equipmentRateCards.find((item) => item.id === catalogueId);
		if (!selected) return;
		await engine.addCostComponent(asset.id, itemId, 'equipment');
		const nextEstimate = engine.getEstimate(asset.id);
		const nextComponent = nextEstimate.takeoff_items
			.find((item) => item.id === itemId)
			?.cost_components.at(-1);
		if (!nextComponent) return;
		engine.updateCostComponent(asset.id, itemId, nextComponent.id, {
			source_type: 'equipment_rate_card',
			source_id: selected.id,
			name: selected.name,
			description: selected.work_center ?? '',
			unit: selected.unit,
			unit_rate: selected.default_rate,
			metadata: selected.metadata
		});
	}

	function applyEquipmentCatalogueToComponent(
		itemId: string,
		componentId: string,
		catalogueId: string
	) {
		const selected = equipmentRateCards.find((item) => item.id === catalogueId);
		if (!selected) return;
		const component = getCostComponent(itemId, componentId);
		engine.updateCostComponent(asset.id, itemId, componentId, {
			source_type: 'equipment_rate_card',
			source_id: selected.id,
			name: selected.name,
			description: selected.work_center ?? '',
			unit: selected.unit,
			unit_rate: selected.default_rate,
			metadata: linkedCostComponentMetadata(component, selected.metadata)
		});
	}

	async function addSubcontractFromCatalogue(itemId: string, catalogueId: string) {
		const selected = subcontractRateCards.find((item) => item.id === catalogueId);
		if (!selected) return;
		await engine.addCostComponent(asset.id, itemId, 'subcontract');
		const nextEstimate = engine.getEstimate(asset.id);
		const nextComponent = nextEstimate.takeoff_items
			.find((item) => item.id === itemId)
			?.cost_components.at(-1);
		if (!nextComponent) return;
		engine.updateCostComponent(asset.id, itemId, nextComponent.id, {
			source_type: 'subcontract_rate_card',
			source_id: selected.id,
			name: selected.name,
			description: selected.category ?? '',
			unit: selected.unit,
			unit_rate: selected.default_rate,
			metadata: selected.metadata
		});
	}

	function applySubcontractCatalogueToComponent(
		itemId: string,
		componentId: string,
		catalogueId: string
	) {
		const selected = subcontractRateCards.find((item) => item.id === catalogueId);
		if (!selected) return;
		const component = getCostComponent(itemId, componentId);
		engine.updateCostComponent(asset.id, itemId, componentId, {
			source_type: 'subcontract_rate_card',
			source_id: selected.id,
			name: selected.name,
			description: selected.category ?? '',
			unit: selected.unit,
			unit_rate: selected.default_rate,
			metadata: linkedCostComponentMetadata(component, selected.metadata)
		});
	}

	async function addManualCostComponent(
		itemId: string,
		category: 'material' | 'labour' | 'equipment' | 'subcontract'
	) {
		await engine.addCostComponent(asset.id, itemId, category);
	}

	function removeTakeoffItem(itemId: string) {
		engine.removeTakeoffItem(asset.id, itemId);
	}

	function duplicateCostComponent(itemId: string, componentId: string) {
		engine.duplicateCostComponent(asset.id, itemId, componentId);
	}

	function removeCostComponent(itemId: string, componentId: string) {
		engine.removeCostComponent(asset.id, itemId, componentId);
	}

	function applyPresetToItem(
		itemId: string,
		presetId: string,
		applyMode: 'append' | 'replace' = presetApplyMode
	) {
		const preset = availableCostComponentPresets.find((item) => item.id === presetId);
		const takeoffItem = estimate.takeoff_items.find((item) => item.id === itemId);
		if (!preset || !takeoffItem) {
			log.warn('Preset apply skipped because the preset or takeoff item no longer exists', {
				assetId: asset.id,
				itemId,
				presetId,
				applyMode
			});
			return;
		}
		const presetComponents = preset.components.map((component) => ({
			...component,
			id: crypto.randomUUID(),
			takeoff_item_id: itemId
		}));

		engine.updateTakeoffItem(asset.id, itemId, {
			applied_preset_id: preset.id,
			applied_preset_name: preset.name,
			cost_components:
				applyMode === 'replace'
					? presetComponents
					: [...takeoffItem.cost_components, ...presetComponents]
		});
		log.info('Cost preset applied', {
			assetId: asset.id,
			itemId,
			presetId: preset.id,
			presetName: preset.name,
			applyMode,
			componentCount: presetComponents.length
		});
	}

	function applyEstimateTemplate(templateId: string) {
		const template = availableEstimateTemplates.find((item) => item.id === templateId);
		if (!template) {
			log.warn('Estimate template apply skipped because the template no longer exists', {
				assetId: asset.id,
				templateId
			});
			return;
		}
		const takeoffItems = template.estimate.takeoff_items.map((item) => {
			const takeoffId = crypto.randomUUID();
			return {
				...item,
				id: takeoffId,
				estimate_asset_id: asset.id,
				wbs_node_id: null,
				cost_components: item.cost_components.map((component) => ({
					...component,
					id: crypto.randomUUID(),
					takeoff_item_id: takeoffId
				}))
			};
		});
		engine.updateEstimate(asset.id, {
			scope_summary: template.estimate.scope_summary,
			notes: template.estimate.notes,
			classification_system_id: template.estimate.classification_system_id ?? null,
			wbs_root_node_id: null,
			applied_template_id: template.id,
			applied_template_name: template.name,
			takeoff_items: takeoffItems
		});
		log.info('Estimate template applied', {
			assetId: asset.id,
			templateId: template.id,
			templateName: template.name,
			takeoffItemCount: takeoffItems.length
		});
	}

	function estimateHasReplaceableContent() {
		return (
			estimate.scope_summary.trim().length > 0 ||
			estimate.notes.trim().length > 0 ||
			estimate.classification_system_id != null ||
			estimate.wbs_root_node_id != null ||
			estimate.takeoff_items.length > 0
		);
	}

	function estimateHasAiReplaceableStructure() {
		return estimate.takeoff_items.length > 0;
	}

	function openTemplatePickerDialog() {
		if (availableEstimateTemplates.length === 0) return;
		templatePickerSearch = buildTemplatePickerSearchSeed();
		templatePickerDialogOpen = true;
	}

	function closeTemplatePickerDialog() {
		templatePickerDialogOpen = false;
		templatePickerSearch = '';
	}

	function selectTemplatePickerOption(templateId: string) {
		closeTemplatePickerDialog();
		onTemplatePickerChange(templateId);
	}

	function onTemplatePickerChange(value: string) {
		const resolution = resolveTemplateApplySelection(
			value,
			availableEstimateTemplates,
			estimateHasReplaceableContent()
		);
		if (resolution.kind === 'ignore') {
			if (value) {
				log.warn('Estimate template apply skipped because the selected template no longer exists', {
					assetId: asset.id,
					templateId: value
				});
			}
			return;
		}

		log.info('Estimate template apply requested', {
			assetId: asset.id,
			templateId: resolution.intent.templateId,
			templateName: resolution.intent.templateName,
			requiresConfirm: resolution.kind === 'confirm'
		});

		if (resolution.kind === 'confirm') {
			pendingTemplateIntent = resolution.intent;
			confirmTemplateOpen = true;
			log.info('Estimate template apply confirm opened', {
				assetId: asset.id,
				templateId: resolution.intent.templateId,
				templateName: resolution.intent.templateName
			});
			return;
		}

		applyEstimateTemplate(resolution.intent.templateId);
	}

	function openClassificationPickerDialog() {
		if (classificationSystems.length === 0) return;
		classificationPickerSearch = buildClassificationPickerSearchSeed();
		classificationPickerDialogOpen = true;
	}

	function closeClassificationPickerDialog() {
		classificationPickerDialogOpen = false;
		classificationPickerSearch = '';
	}

	function selectClassificationPickerOption(classificationSystemId: string | null) {
		closeClassificationPickerDialog();
		updateEstimateField('classification_system_id', classificationSystemId);
	}

	function handleClassificationPickerOpenChange(open: boolean) {
		classificationPickerDialogOpen = open;
		if (!open) {
			classificationPickerSearch = '';
		}
	}

	function openStructureRootPickerDialog() {
		if (wbsNodes.length === 0) return;
		structureRootPickerSearch = buildStructureRootPickerSearchSeed();
		structureRootPickerDialogOpen = true;
	}

	function closeStructureRootPickerDialog() {
		structureRootPickerDialogOpen = false;
		structureRootPickerSearch = '';
	}

	function selectStructureRootPickerOption(wbsRootNodeId: string | null) {
		closeStructureRootPickerDialog();
		updateEstimateField('wbs_root_node_id', wbsRootNodeId);
	}

	function handleStructureRootPickerOpenChange(open: boolean) {
		structureRootPickerDialogOpen = open;
		if (!open) {
			structureRootPickerSearch = '';
		}
	}

	function handleTemplateConfirmOpenChange(open: boolean) {
		if (open) {
			confirmTemplateOpen = true;
			return;
		}

		if (!confirmTemplateOpen) return;
		cancelPendingTemplateApply('dismissed');
	}

	function handleTemplatePickerOpenChange(open: boolean) {
		templatePickerDialogOpen = open;
		if (!open) {
			templatePickerSearch = '';
		}
	}

	function onPresetPickerChange(itemId: string, value: string) {
		const takeoffItem = estimate.takeoff_items.find((item) => item.id === itemId);
		if (!takeoffItem) return;
		const resolution = resolvePresetApplySelection(
			itemId,
			value,
			availableCostComponentPresets,
			takeoffItem.cost_components.length > 0
		);
		if (resolution.kind === 'ignore') {
			if (value) {
				log.warn('Cost preset apply skipped because the selected preset no longer exists', {
					assetId: asset.id,
					itemId,
					presetId: value
				});
			}
			return;
		}

		log.info('Cost preset apply requested', {
			assetId: asset.id,
			itemId: resolution.intent.itemId,
			presetId: resolution.intent.presetId,
			presetName: resolution.intent.presetName,
			requiresConfirm: resolution.kind === 'confirm'
		});

		if (resolution.kind === 'confirm') {
			presetApplyMode = 'append';
			pendingPresetIntent = resolution.intent;
			confirmPresetOpen = true;
			log.info('Cost preset apply confirm opened', {
				assetId: asset.id,
				itemId: resolution.intent.itemId,
				presetId: resolution.intent.presetId,
				presetName: resolution.intent.presetName
			});
			return;
		}

		applyPresetToItem(resolution.intent.itemId, resolution.intent.presetId, 'append');
	}

	function handlePresetConfirmOpenChange(open: boolean) {
		if (open) {
			confirmPresetOpen = true;
			return;
		}

		if (!confirmPresetOpen) return;
		cancelPendingPresetApply('dismissed');
	}

	function fallbackAiTableSnapshot() {
		return {
			classificationSystems,
			costCodes,
			wbsNodes,
			materialCatalogItems: materialCatalogueItems,
			labourRateCards,
			equipmentRateCards,
			subcontractRateCards,
			estimateTemplates: availableEstimateTemplates,
			costComponentPresets: availableCostComponentPresets
		};
	}

	async function buildLatestAiTableSnapshot() {
		try {
			const latestReferenceData = await classificationSystemsState.loadWorkspaceReferenceData(
				project?.id ?? asset.project_id
			);
			log.info('Loaded fresh AI table snapshot from SQLite', {
				assetId: asset.id,
				classificationSystemCount: latestReferenceData.classificationSystems.length,
				costCodeCount: latestReferenceData.costCodes.length,
				wbsNodeCount: latestReferenceData.wbsNodes.length,
				materialCount: latestReferenceData.materialCatalogueItems.length,
				labourRateCount: latestReferenceData.labourRateCards.length,
				equipmentRateCount: latestReferenceData.equipmentRateCards.length,
				subcontractRateCount: latestReferenceData.subcontractRateCards.length,
				estimateTemplateCount: latestReferenceData.estimateTemplates.length,
				costPresetCount: latestReferenceData.costComponentPresets.length
			});
			return {
				classificationSystems: latestReferenceData.classificationSystems,
				costCodes: latestReferenceData.costCodes,
				wbsNodes: latestReferenceData.wbsNodes,
				materialCatalogItems: latestReferenceData.materialCatalogueItems,
				labourRateCards: latestReferenceData.labourRateCards,
				equipmentRateCards: latestReferenceData.equipmentRateCards,
				subcontractRateCards: latestReferenceData.subcontractRateCards,
				estimateTemplates: latestReferenceData.estimateTemplates,
				costComponentPresets: latestReferenceData.costComponentPresets
			};
		} catch (error) {
			log.warn('Falling back to in-memory AI table snapshot after SQLite refresh failed', {
				assetId: asset.id,
				error: getErrorMessage(error)
			});
			return fallbackAiTableSnapshot();
		}
	}

	async function applyAiDraftEstimate(): Promise<void> {
		isAiDraftStarting = true;
		try {
			const tableSnapshot = await buildLatestAiTableSnapshot();
			await aiState.draftEstimateForAsset({
				asset,
				project: {
					id: project?.id ?? asset.project_id,
					projectName: project?.project_name ?? null,
					rfqNumber: project?.rfq_number ?? null,
					content: project?.content ?? null,
					note: project?.note ?? null,
					receivedDate: project?.received_date ?? null,
					submissionDeadlineAt: project?.submission_deadline_at ?? null,
					estimatorName: project?.estimator_name ?? null,
					customerTenderReference: project?.customer_tender_reference ?? null,
					addendumLabel: project?.addendum_label ?? null,
					addendumDate: project?.addendum_date ?? null,
					addendumNotes: project?.addendum_notes ?? null,
					siteAddress: project?.site_address ?? null,
					deliveryAddress: project?.delivery_address ?? null
				},
				files: asset.files ?? [],
				currentEstimate: cloneEstimateSnapshot(estimate),
				savedEstimate: engine.getSavedEstimate(asset.id),
				tableSnapshot
			});
		} finally {
			isAiDraftStarting = false;
		}
	}

	async function prepareEstimateForAiReplace(): Promise<void> {
		if (assetHasPendingAiApply) {
			await aiState.revertAutoAppliedEstimate(asset.id);
		}

		resetEstimateEditorTransientState();
	}

	function showDraftButtonBusy(): boolean {
		return isAiDraftStarting || isAiRunActive();
	}

	function onDraftEstimateWithAi(): void {
		if (estimateHasAiReplaceableStructure()) {
			log.info('AI estimate replace confirm opened', {
				assetId: asset.id,
				takeoffItemCount: estimate.takeoff_items.length
			});
			confirmAiReplaceOpen = true;
			return;
		}
		void applyAiDraftEstimate();
	}

	function cancelPendingTemplateApply(reason: 'cancelled' | 'dismissed'): void {
		const intent = pendingTemplateIntent;
		pendingTemplateIntent = null;
		confirmTemplateOpen = false;
		if (!intent) return;
		log.info('Estimate template apply cancelled', {
			assetId: asset.id,
			reason,
			templateId: intent.templateId,
			templateName: intent.templateName
		});
	}

	async function revertToPreAiEstimate(): Promise<void> {
		const snapshot = restorableEstimateContext;
		if (!snapshot) return;
		await aiState.revertAutoAppliedEstimate(asset.id);
		const savedEstimate = engine.getSavedEstimate(asset.id);
		if (
			savedEstimate &&
			estimateContextSignature(savedEstimate) === estimateContextSignature(snapshot)
		) {
			resetEstimateEditorTransientState();
			await engine.discardChanges(asset.id);
		} else if (!savedEstimate && isBlankEstimateContext(snapshot)) {
			resetEstimateEditorTransientState();
			await engine.discardChanges(asset.id);
		} else {
			resetEstimateEditorTransientState();
			engine.replaceEstimate(asset.id, cloneEstimateSnapshot(snapshot));
		}
		toast.success('Reverted AI changes');
	}

	function normaliseAiMergeKey(value: string | null | undefined): string {
		return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
	}

	function preserveExistingRatesInAiDraft(draft: Estimate, existing: Estimate): Estimate {
		const existingRates: Record<string, number | undefined> = {};
		for (const item of existing.takeoff_items) {
			for (const component of item.cost_components) {
				if (component.unit_rate <= 0) continue;
				const key = [
					normaliseAiMergeKey(component.category),
					normaliseAiMergeKey(component.name),
					normaliseAiMergeKey(component.unit)
				].join('|');
				existingRates[key] = component.unit_rate;
			}
		}

		if (Object.keys(existingRates).length === 0) return draft;

		return {
			...draft,
			takeoff_items: draft.takeoff_items.map((item) => ({
				...item,
				cost_components: item.cost_components.map((component) => {
					if (component.unit_rate > 0) return component;
					const key = [
						normaliseAiMergeKey(component.category),
						normaliseAiMergeKey(component.name),
						normaliseAiMergeKey(component.unit)
					].join('|');
					const preservedRate = existingRates[key];
					return preservedRate ? { ...component, unit_rate: preservedRate } : component;
				})
			}))
		};
	}

	function applyPendingAiDraftToEditor(): void {
		const snapshot = pendingAiAppliedEstimate;
		if (!snapshot) return;
		const mergedSnapshot = preserveExistingRatesInAiDraft(
			cloneEstimateSnapshot(snapshot),
			cloneEstimateSnapshot(estimate)
		);
		resetEstimateEditorTransientState();
		engine.replaceEstimate(asset.id, mergedSnapshot);
		aiState.markPendingEstimateAppliedToEditor(asset.id);
		toast.success('Applied AI draft to editor');
	}

	function confirmPendingTemplateApply(): void {
		const intent = pendingTemplateIntent;
		pendingTemplateIntent = null;
		confirmTemplateOpen = false;
		if (!intent) {
			log.warn(
				'Estimate template apply confirm skipped because no pending template intent existed',
				{
					assetId: asset.id
				}
			);
			return;
		}
		log.info('Estimate template apply confirmed', {
			assetId: asset.id,
			templateId: intent.templateId,
			templateName: intent.templateName
		});
		applyEstimateTemplate(intent.templateId);
	}

	function cancelPendingPresetApply(reason: 'cancelled' | 'dismissed'): void {
		const intent = pendingPresetIntent;
		pendingPresetIntent = null;
		presetApplyMode = 'append';
		confirmPresetOpen = false;
		if (!intent) return;
		log.info('Cost preset apply cancelled', {
			assetId: asset.id,
			reason,
			itemId: intent.itemId,
			presetId: intent.presetId,
			presetName: intent.presetName
		});
	}

	function confirmPendingPresetApply(): void {
		const intent = pendingPresetIntent;
		const applyMode = presetApplyMode;
		pendingPresetIntent = null;
		presetApplyMode = 'append';
		confirmPresetOpen = false;
		if (!intent) {
			log.warn('Cost preset apply confirm skipped because no pending preset intent existed', {
				assetId: asset.id
			});
			return;
		}
		log.info('Cost preset apply confirmed', {
			assetId: asset.id,
			itemId: intent.itemId,
			presetId: intent.presetId,
			presetName: intent.presetName,
			applyMode
		});
		applyPresetToItem(intent.itemId, intent.presetId, applyMode);
	}

	function handleAiReplaceOpenChange(open: boolean): void {
		if (open) {
			confirmAiReplaceOpen = true;
			return;
		}

		if (!confirmAiReplaceOpen) return;
		cancelPendingAiReplace('dismissed');
	}

	function cancelPendingAiReplace(reason: 'cancelled' | 'dismissed'): void {
		confirmAiReplaceOpen = false;
		log.info('AI estimate replace cancelled', {
			assetId: asset.id,
			reason,
			takeoffItemCount: estimate.takeoff_items.length
		});
	}

	async function confirmPendingAiReplace(): Promise<void> {
		confirmAiReplaceOpen = false;
		log.info('AI estimate replace confirmed', {
			assetId: asset.id,
			takeoffItemCount: estimate.takeoff_items.length
		});
		await prepareEstimateForAiReplace();
		await applyAiDraftEstimate();
	}

	function openEstimateResetConfirm(): void {
		confirmEstimateResetOpen = true;
		log.info('Estimate reset confirm opened', {
			assetId: asset.id,
			takeoffItemCount: estimate.takeoff_items.length,
			hasScopeSummary: estimate.scope_summary.trim().length > 0,
			hasNotes: estimate.notes.trim().length > 0
		});
	}

	function cancelEstimateReset(): void {
		confirmEstimateResetOpen = false;
		log.info('Estimate reset cancelled', { assetId: asset.id });
	}

	async function confirmEstimateReset(): Promise<void> {
		confirmEstimateResetOpen = false;
		log.info('Estimate reset confirmed', {
			assetId: asset.id,
			takeoffItemCount: estimate.takeoff_items.length
		});
		await aiState.clearAssetRunForEstimateReset(asset.id);
		resetEstimateEditorTransientState();
		await engine.resetEstimate(asset.id);
		activeEstimateSection = 'setup';
		toast.success('Estimate reset');
	}

	function reviewCounts(components: CostComponent[]): {
		unresolvedCount: number;
		rateReviewCount: number;
	} {
		return components.reduce(
			(summary, component) => {
				if (component.metadata?.ai_mapping_status === 'unresolved') {
					summary.unresolvedCount += 1;
				}
				if (!Number.isFinite(component.unit_rate) || component.unit_rate <= 0) {
					summary.rateReviewCount += 1;
				}
				return summary;
			},
			{ unresolvedCount: 0, rateReviewCount: 0 }
		);
	}

	const presetSaveReview = $derived.by(() => {
		if (!targetPresetItemId) {
			return { unresolvedCount: 0, rateReviewCount: 0 };
		}
		const item = estimate.takeoff_items.find((entry) => entry.id === targetPresetItemId);
		return reviewCounts(item?.cost_components ?? []);
	});

	const templateSaveReview = $derived.by(() =>
		reviewCounts(estimate.takeoff_items.flatMap((item) => item.cost_components))
	);

	function saveReviewSummary(summary: {
		unresolvedCount: number;
		rateReviewCount: number;
	}): string {
		const issues: string[] = [];
		if (summary.unresolvedCount > 0) {
			issues.push(
				`${summary.unresolvedCount} unresolved mapping${summary.unresolvedCount === 1 ? '' : 's'}`
			);
		}
		if (summary.rateReviewCount > 0) {
			issues.push(
				`${summary.rateReviewCount} zero or missing rate${summary.rateReviewCount === 1 ? '' : 's'}`
			);
		}
		return issues.join(' and ');
	}

	function requestReusableSaveConfirmation(
		kind: 'preset' | 'template',
		summary: { unresolvedCount: number; rateReviewCount: number }
	): boolean {
		if (summary.unresolvedCount === 0 && summary.rateReviewCount === 0) {
			pendingReusableSave = null;
			saveWarningDialogOpen = false;
			return false;
		}
		pendingReusableSave = { kind, ...summary };
		saveWarningDialogOpen = true;
		return true;
	}

	function cancelReusableSaveWarning(): void {
		saveWarningDialogOpen = false;
		pendingReusableSave = null;
	}

	function openSavePreset(itemId: string) {
		targetPresetItemId = itemId;
		presetFieldErrors = {};
		presetFormValues = {
			code: '',
			name: '',
			description: '',
			aliases: [],
			is_active: true
		};
		presetAliasesInput = '';
		presetDialogOpen = true;
	}

	function openSaveTemplate() {
		templateFieldErrors = {};
		templateFormValues = {
			code: '',
			name: '',
			description: '',
			aliases: [],
			is_active: true
		};
		templateAliasesInput = '';
		templateDialogOpen = true;
	}

	async function persistPreset() {
		if (!targetPresetItemId) return;
		presetFieldErrors = {};
		presetFormValues.aliases = parseAliasesInput(presetAliasesInput);
		const parsed = costComponentPresetFormSchema.safeParse(presetFormValues);
		if (!parsed.success) {
			presetFieldErrors = parsed.error.flatten().fieldErrors;
			toast.error('Validation failed');
			return;
		}

		const item = estimate.takeoff_items.find((entry) => entry.id === targetPresetItemId);
		if (!item) return;
		const presetComponents = item.cost_components.map((component, index) => ({
			...component,
			sort_order: index
		}));

		savingPreset = true;
		try {
			await engine.createCostComponentPreset(parsed.data, presetComponents);
			await costComponentPresetsState.refresh();
			presetDialogOpen = false;
			toast.success(`Preset "${parsed.data.name}" saved`);
		} catch (error) {
			const message = getErrorMessage(error);
			if (message.includes('Preset') && message.includes('already exists')) {
				presetFieldErrors = { ...presetFieldErrors, name: [message] };
			}
			toast.error(message);
		} finally {
			savingPreset = false;
		}
	}

	async function savePreset() {
		if (requestReusableSaveConfirmation('preset', presetSaveReview)) {
			return;
		}
		await persistPreset();
	}

	async function persistTemplate() {
		templateFieldErrors = {};
		templateFormValues.aliases = parseAliasesInput(templateAliasesInput);
		const parsed = estimateTemplateFormSchema.safeParse(templateFormValues);
		if (!parsed.success) {
			templateFieldErrors = parsed.error.flatten().fieldErrors;
			toast.error('Validation failed');
			return;
		}

		savingTemplate = true;
		try {
			await engine.createEstimateTemplate(parsed.data, normaliseEstimateTemplatePayload(estimate));
			await estimateTemplatesState.refresh();
			templateDialogOpen = false;
			toast.success(`Template "${parsed.data.name}" saved`);
		} catch (error) {
			const message = getErrorMessage(error);
			if (message.includes('Template') && message.includes('already exists')) {
				templateFieldErrors = { ...templateFieldErrors, name: [message] };
			}
			toast.error(message);
		} finally {
			savingTemplate = false;
		}
	}

	async function saveTemplate() {
		if (requestReusableSaveConfirmation('template', templateSaveReview)) {
			return;
		}
		await persistTemplate();
	}

	async function confirmReusableSaveWarning(): Promise<void> {
		const context = pendingReusableSave;
		saveWarningDialogOpen = false;
		pendingReusableSave = null;
		if (!context) return;
		if (context.kind === 'preset') {
			await persistPreset();
			return;
		}
		await persistTemplate();
	}
</script>

{#snippet EditorContent()}
	<div class="relative h-full w-full min-w-0">
		<div
			class="absolute inset-0 flex flex-col overflow-hidden bg-background"
			bind:offsetWidth={estimateSetupWidth}
		>
			<div class="min-h-0 flex-1 overflow-hidden">
				<Accordion.Root
					type="single"
					bind:value={activeEstimateSection}
					class="h-full overflow-hidden"
				>
					{#if showAiDraftCard}
						<Accordion.Item
							value="ai"
							class={`min-h-0 ${isEstimateSectionExpanded('ai') ? 'flex flex-1 flex-col' : 'flex-none'}`}
						>
							<Accordion.Header>
								<div class="flex h-full min-w-0 flex-1 items-center justify-between gap-3">
									<div class="flex min-w-0 flex-1 items-center gap-1.5">
										<Text as="span" class="shell-label-strong truncate">AI Draft</Text>
									</div>
									<div class="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1.5">
										{#if isAiRunActive() || aiRunState.isCancelling}
											<Button
												variant="secondary"
												size="sm"
												class="px-2.5"
												disabled={aiRunState.isCancelling}
												onclick={cancelAiDraftRun}
											>
												{aiRunState.isCancelling ? 'Cancelling AI...' : 'Cancel AI'}
											</Button>
										{:else}
											{#if aiDraftAwaitingManualApply}
												<Button
													variant="secondary"
													size="sm"
													class="px-2.5"
													onclick={applyPendingAiDraftToEditor}
												>
													Apply draft to editor
												</Button>
											{/if}
											{#if aiDraftAppliedToEditor && restorableEstimateContext}
												<Button
													variant="secondary"
													size="sm"
													class="px-2.5"
													onclick={revertToPreAiEstimate}
												>
													Revert AI draft
												</Button>
											{/if}
											<Button
												variant="secondary"
												size="sm"
												class="gap-1.5 px-2.5"
												loading={showDraftButtonBusy()}
												loadingLabel="Starting AI draft"
												onclick={canDraftEstimateWithAi
													? onDraftEstimateWithAi
													: handleAiBlockedAction}
											>
												{#if !showDraftButtonBusy()}
													<SparkleIcon class="size-3.5" strokeWidth={1.5} />
												{/if}
												Draft with AI
											</Button>
										{/if}
										<Accordion.Trigger
											class="ui-accordion-trigger-icon"
											aria-label={isEstimateSectionExpanded('ai')
												? 'Collapse AI draft'
												: 'Expand AI draft'}
										>
											<ChevronDownIcon
												class={`muted size-4 shrink-0 transition-transform ${isEstimateSectionExpanded('ai') ? 'rotate-180' : ''}`}
											/>
										</Accordion.Trigger>
									</div>
								</div>
							</Accordion.Header>
							<Accordion.Content class="flex min-h-0 flex-1 flex-col overflow-hidden">
								<div class="min-h-0 flex-1 overflow-y-auto px-4 py-3">
									<EstimateAiDraftRow
										progressValueLabel={aiProgressLabel}
										progressDetail={aiRunState.progressDetail}
										errorMessage={aiRunState.errorMessage}
										runActive={isAiRunActive()}
										isCancelling={aiRunState.isCancelling}
										status={aiRunState.status}
										issues={displayedAiIssues}
										evidenceRefs={aiRunState.evidenceRefs}
										unsupportedFiles={assetAiDraftingAvailability.unsupportedFiles}
										openQuestionCount={aiOpenQuestionCount}
										unresolvedMappingCount={aiUnresolvedMappingCount}
										rateReviewCount={aiCommercialReviewCount}
										pendingDraftTotal={pendingAiDraftTotalLabel}
										appliedToEditor={aiDraftAppliedToEditor}
										canApplyPending={aiDraftAwaitingManualApply}
										runId={aiRunState.runId}
										feedbackSubmitted={Boolean(aiRunFeedbackEntry)}
										submittedFeedbackText={aiRunFeedbackEntry?.feedbackText ?? null}
										localRuntimeReady={localAiReady}
										onEvidenceSelect={selectAiEvidence}
										onSubmitFeedback={(text) =>
											aiState.submitRunFeedback({
												runId: aiRunState.runId ?? '',
												assetId: asset.id,
												estimateId: estimate.asset_id,
												feedbackText: text
											})}
									/>
								</div>
							</Accordion.Content>
						</Accordion.Item>
					{/if}

					<Accordion.Item
						value="setup"
						class={`min-h-0 ${isEstimateSectionExpanded('setup') ? 'flex flex-1 flex-col' : 'flex-none'}`}
					>
						<Accordion.Header>
							<div class="flex h-full min-w-0 flex-1 items-center justify-between gap-3">
								<div class="flex min-w-0 flex-1 items-center gap-1.5">
									<Text as="span" class="shell-label-strong truncate">Estimate Setup</Text>
								</div>
								<div class="ml-auto flex shrink-0 items-center gap-1.5">
									<Button
										variant="secondary"
										size="sm"
										class="gap-1.5 px-2.5"
										disabled={assetEstimateLockedByAi || !hasExistingEstimateContent}
										onclick={openEstimateResetConfirm}
									>
										Reset
									</Button>
									<Accordion.Trigger
										class="ui-accordion-trigger-icon"
										aria-label={isEstimateSectionExpanded('setup')
											? 'Collapse estimate setup'
											: 'Expand estimate setup'}
									>
										<ChevronDownIcon
											class={`muted size-4 shrink-0 transition-transform ${isEstimateSectionExpanded('setup') ? 'rotate-180' : ''}`}
										/>
									</Accordion.Trigger>
								</div>
							</div>
						</Accordion.Header>
						<Accordion.Content class="flex min-h-0 flex-1 flex-col overflow-hidden">
							<div class="min-h-0 flex-1 overflow-y-auto px-4 py-3">
								<fieldset
									disabled={assetEstimateLockedByAi}
									class="ui-estimate-compact-density space-y-3"
								>
									<div
										class={`grid gap-3 ${estimateSetupLayoutMode === 'wide' ? 'grid-cols-2' : ''}`}
									>
										<FieldShell>
											<FieldLabel>Scope Summary</FieldLabel>
											<Input
												type="text"
												size="sm"
												class="w-full"
												placeholder="Scope summary"
												value={estimate.scope_summary}
												oninput={(e) => updateEstimateField('scope_summary', e.currentTarget.value)}
											/>
										</FieldShell>
										<FieldShell>
											<FieldLabel>Estimate Template</FieldLabel>
											<div
												class={`grid gap-2 ${estimateSetupLayoutMode === 'wide' ? 'grid-cols-[auto_auto] items-end justify-start' : 'grid-cols-[auto_auto] justify-start'}`}
											>
												<Button
													variant="secondary"
													size="sm"
													class="shrink-0 px-3 whitespace-nowrap"
													disabled={availableEstimateTemplates.length === 0}
													onclick={openTemplatePickerDialog}
												>
													Apply template
												</Button>
												<Button
													variant="secondary"
													size="sm"
													class="shrink-0 px-3 whitespace-nowrap"
													disabled={assetEstimateLockedByAi || estimate.takeoff_items.length === 0}
													onclick={openSaveTemplate}
												>
													Save template
												</Button>
											</div>
										</FieldShell>
										<FieldShell class="min-w-0">
											<FieldLabel>Classification</FieldLabel>
											{#if classificationSystems.length > 0}
												<Button
													variant="secondary"
													size="sm"
													class="ui-field-trigger-button w-full min-w-0 justify-between gap-2"
													onclick={openClassificationPickerDialog}
												>
													<Text as="span" class="truncate text-left">
														{selectedClassificationName()}
													</Text>
													<ChevronDownIcon class="muted size-4 shrink-0" />
												</Button>
											{:else}
												<Input
													readonly
													value="No classifications yet"
													class="muted w-full"
													size="sm"
												/>
											{/if}
										</FieldShell>
										<FieldShell class="min-w-0">
											<FieldLabel>Structure Root</FieldLabel>
											{#if wbsNodes.length > 0}
												<Button
													variant="secondary"
													size="sm"
													class="ui-field-trigger-button w-full min-w-0 justify-between gap-2"
													onclick={openStructureRootPickerDialog}
												>
													<Text as="span" class="truncate text-left">
														{selectedWbsRootName()}
													</Text>
													<ChevronDownIcon class="muted size-4 shrink-0" />
												</Button>
											{:else}
												<Input
													readonly
													value="No structure roots yet"
													class="muted w-full"
													size="sm"
												/>
											{/if}
										</FieldShell>
									</div>
									{#if estimate.applied_template_name}
										<Panel tone="subtle" class="flex min-w-0 items-center gap-2 py-2">
											<Meta class="shrink-0">Based on template</Meta>
											<Text as="span" class="min-w-0 truncate">
												{estimate.applied_template_name}
											</Text>
										</Panel>
									{/if}
									<FieldShell>
										<Cluster gap="var(--space-1-5)" align="center">
											<FieldLabel>Estimate Notes</FieldLabel>
											<FormHelpTooltip
												content="Internal notes for estimating decisions and review context."
											/>
										</Cluster>
										<Textarea
											size="sm"
											class="ui-field-note-sm"
											placeholder="Internal estimating notes"
											value={estimate.notes}
											oninput={(e) => updateEstimateField('notes', e.currentTarget.value)}
										/>
									</FieldShell>
								</fieldset>
							</div>
						</Accordion.Content>
					</Accordion.Item>

					<Accordion.Item
						value="takeoff"
						class={`min-h-0 ${isEstimateSectionExpanded('takeoff') ? 'flex flex-1 flex-col' : 'flex-none'}`}
					>
						<Accordion.Header>
							<div class="flex h-full min-w-0 flex-1 items-center justify-between gap-3">
								<div class="flex min-w-0 flex-1 items-center gap-1.5">
									<Text as="span" class="shell-label-strong truncate">Takeoff Items</Text>
									<Meta class="shrink-0">{takeoffSectionMeta}</Meta>
								</div>
								<div class="ml-auto flex shrink-0 items-center gap-1.5">
									<Button
										variant="secondary"
										size="sm"
										class="gap-1.5 px-2.5"
										disabled={assetEstimateLockedByAi}
										onclick={() => {
											activeEstimateSection = 'takeoff';
											engine.addTakeoffItem(asset.id);
										}}
									>
										<PlusIcon class="size-3.5" />
										Add Item
									</Button>
									<Accordion.Trigger
										class="ui-accordion-trigger-icon"
										aria-label={isEstimateSectionExpanded('takeoff')
											? 'Collapse takeoff items'
											: 'Expand takeoff items'}
									>
										<ChevronDownIcon
											class={`muted size-4 shrink-0 transition-transform ${isEstimateSectionExpanded('takeoff') ? 'rotate-180' : ''}`}
										/>
									</Accordion.Trigger>
								</div>
							</div>
						</Accordion.Header>

						<Accordion.Content class="flex min-h-0 flex-1 flex-col overflow-hidden">
							<fieldset
								disabled={assetEstimateLockedByAi}
								class="flex min-h-0 min-w-0 flex-1 flex-col"
							>
								<div class="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-4">
									{#if estimate.takeoff_items.length === 0}
										<div
											class="ui-empty-state-xl ui-radius-lg flex items-center justify-center border bg-background"
										>
											<Text as="span" tone="muted" class="text-center">
												Add a takeoff item to begin costing this scope item.
											</Text>
										</div>
									{:else}
										<div class="space-y-4">
											{#each estimate.takeoff_items as item (item.id)}
												<AssetEstimateTakeoffItem
													{item}
													{filteredCostCodes}
													{wbsNodes}
													{materialCatalogueItems}
													{labourRateCards}
													{equipmentRateCards}
													{subcontractRateCards}
													costComponentPresets={availableCostComponentPresets}
													showAiHighlights={aiDraftAppliedToEditor}
													{showAiReviewSession}
													disabled={assetEstimateLockedByAi}
													collapsed={collapsedTakeoffSetups.has(item.id)}
													{getNumericInputValue}
													{beginNumericInputEdit}
													{endNumericInputEdit}
													{toggleTakeoffSetup}
													{updateTakeoffItemField}
													{updateTakeoffItemName}
													{updateTakeoffQuantityDraft}
													{updateCostComponentField}
													{updateCostComponentName}
													{updateCostComponentNumberDraft}
													{addMaterialFromCatalogue}
													{addLabourFromCatalogue}
													{addEquipmentFromCatalogue}
													{addSubcontractFromCatalogue}
													{applyMaterialCatalogueToComponent}
													{applyLabourCatalogueToComponent}
													{applyEquipmentCatalogueToComponent}
													{applySubcontractCatalogueToComponent}
													{onPresetPickerChange}
													{openSavePreset}
													{removeTakeoffItem}
													{addManualCostComponent}
													{duplicateCostComponent}
													{removeCostComponent}
													onAiEvidenceSelect={selectAiEvidence}
													{isAiFieldAcknowledged}
													{itemNameAckKey}
													{componentNameAckKey}
												/>
											{/each}
										</div>
									{/if}
								</div>
							</fieldset>
						</Accordion.Content>
					</Accordion.Item>
				</Accordion.Root>
			</div>

			<div class="ui-pane-footer">
				<div class="grid gap-x-6 gap-y-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
					<div class="ui-estimate-footer-summary min-w-0">
						<SectionLabel as="div">Estimate Summary</SectionLabel>
						<Text as="div" class="muted-strong truncate">
							{estimateDisplaySummary(estimate) || 'No summary yet'}
						</Text>
					</div>
					<div class="flex flex-wrap items-center justify-end gap-4 sm:justify-self-end">
						<div class="ui-estimate-footer-total">
							<SectionLabel as="div" class="justify-end text-right">
								Total Estimate Cost
							</SectionLabel>
							<div class="title-copy text-right tabular-nums">{formatCurrency(totalCost)}</div>
						</div>
						<Button
							variant="brand"
							size="sm"
							class="h-8 min-w-24 self-center px-4"
							disabled={!engine.isDirty(asset.id) || saving || assetEstimateLockedByAi}
							onclick={async () => {
								saving = true;
								suppressPendingAiAutoApply = true;
								try {
									const estimateSnapshot = cloneEstimateSnapshot(estimate);
									await engine.saveEstimate(asset.id);
									await aiState.recordEstimateSaved(asset.id, estimateSnapshot);
									toast.success('Estimate saved');
								} catch (error) {
									await errorState.catchError(error, 'Save Estimate');
								} finally {
									suppressPendingAiAutoApply = false;
									saving = false;
								}
							}}
						>
							{saving ? 'Saving...' : 'Save'}
						</Button>
					</div>
				</div>
			</div>
		</div>
	</div>
{/snippet}

<div class="h-full w-full">
	{#if !previewDetached}
		<Resizable.PaneGroup direction="horizontal" class="ui-radius-lg h-full w-full">
			<Resizable.Pane
				class="min-w-0 overflow-hidden"
				bind:this={estimatePane}
				defaultSize={DEFAULT_ASSET_EDITOR_LAYOUT[0]}
				minSize={42}
				collapsible
				collapsedSize={0}
			>
				{@render EditorContent()}
			</Resizable.Pane>

			{#if !viewerExpanded}
				<Resizable.Handle withHandle class={WORKSPACE_RESIZE_HANDLE_CLASS} />
			{/if}

			<Resizable.Pane
				class="min-w-0 overflow-hidden"
				defaultSize={DEFAULT_ASSET_EDITOR_LAYOUT[1]}
				minSize={25}
			>
				<MultiFileViewer
					{asset}
					bind:expanded={viewerExpanded}
					bind:activeFileId={activeViewerFileId}
					targetPdfPage={viewerTargetPdfPage}
					targetCadViewLabel={viewerTargetCadViewLabel}
					targetLocator={viewerTargetLocator}
					onToggleDetached={toggleDetachedPreview}
				/>
			</Resizable.Pane>
		</Resizable.PaneGroup>
	{:else}
		<div class="h-full w-full overflow-hidden bg-background">
			{@render EditorContent()}
		</div>
	{/if}
</div>

<Dialog.Root open={templatePickerDialogOpen} onOpenChange={handleTemplatePickerOpenChange}>
	<Dialog.FormFrame
		title="Apply Estimate Template"
		description="Search by name, code, or alias to apply a saved estimate template."
		bodyClass="ui-dialog-field-density space-y-3"
		class="ui-dialog-size-md"
	>
		<div class="space-y-3">
			<FieldShell>
				<Cluster gap="var(--space-1-5)" align="center">
					<FieldLabel for="template-picker-search">Search</FieldLabel>
					<FormHelpTooltip
						content="Type scope shorthand, customer phrasing, or alternate template names."
					/>
				</Cluster>
				<SearchInput
					id="template-picker-search"
					size="sm"
					bind:value={templatePickerSearch}
					autofocus
					placeholder="Search name, code, or alias"
				/>
			</FieldShell>
			<div class="ui-picker-surface ui-scroll-panel">
				{#if filteredTemplatePickerOptions.length > 0}
					{#each filteredTemplatePickerOptions as option (option.id)}
						{@const selected = templatePickerOptionSelected(option.id)}
						<button
							type="button"
							class="field-copy ui-picker-option"
							role="option"
							data-selected={selected}
							aria-selected={selected}
							onclick={() => selectTemplatePickerOption(option.id)}
						>
							<div class="flex items-start justify-between gap-3">
								<div class="min-w-0 flex-1">
									<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
										<Text>{option.label}</Text>
										{#if option.code}
											<Meta>{option.code}</Meta>
										{/if}
									</div>
									{#if option.description}
										<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
											<Meta>{option.description}</Meta>
											{#if option.aliases.length > 0}
												<FormHelpTooltip content={`Aliases: ${option.aliases.join(', ')}`} />
											{/if}
										</div>
									{/if}
								</div>
								{#if selected}
									<CheckIcon class="mt-0.5 size-4 shrink-0 text-primary" />
								{/if}
							</div>
						</button>
					{/each}
				{:else}
					<div class="ui-picker-empty">
						<Text>No estimate templates found</Text>
						<Meta>Try another keyword or save a template first.</Meta>
					</div>
				{/if}
			</div>
		</div>
		{#snippet footer()}
			<Button variant="secondary" size="default" onclick={closeTemplatePickerDialog}>Cancel</Button>
		{/snippet}
	</Dialog.FormFrame>
</Dialog.Root>

<Dialog.Root
	open={classificationPickerDialogOpen}
	onOpenChange={handleClassificationPickerOpenChange}
>
	<Dialog.FormFrame
		title="Choose Classification"
		description="Search by name, code, type, or alias to set the estimate classification."
		bodyClass="ui-dialog-field-density space-y-3"
		class="ui-dialog-size-md"
	>
		<div class="space-y-3">
			<FieldShell>
				<Cluster gap="var(--space-1-5)" align="center">
					<FieldLabel for="classification-picker-search">Search</FieldLabel>
					<FormHelpTooltip
						content="Type common trade language, alternate naming, or internal shorthand."
					/>
				</Cluster>
				<SearchInput
					id="classification-picker-search"
					size="sm"
					bind:value={classificationPickerSearch}
					autofocus
					placeholder="Search name, code, type, or alias"
				/>
			</FieldShell>
			<div class="ui-picker-surface ui-scroll-panel">
				<button
					type="button"
					class="field-copy ui-picker-option"
					role="option"
					data-selected={classificationPickerOptionSelected(null)}
					aria-selected={classificationPickerOptionSelected(null)}
					onclick={() => selectClassificationPickerOption(null)}
				>
					<div class="flex items-start justify-between gap-3">
						<div class="min-w-0 flex-1">
							<Text>Unclassified</Text>
							<Meta>Leave the estimate without a classification system.</Meta>
						</div>
						{#if classificationPickerOptionSelected(null)}
							<CheckIcon class="mt-0.5 size-4 shrink-0 text-primary" />
						{/if}
					</div>
				</button>
				{#if filteredClassificationPickerOptions.length > 0}
					{#each filteredClassificationPickerOptions as option (option.id)}
						{@const selected = classificationPickerOptionSelected(option.id)}
						<button
							type="button"
							class="field-copy ui-picker-option"
							role="option"
							data-selected={selected}
							aria-selected={selected}
							onclick={() => selectClassificationPickerOption(option.id)}
						>
							<div class="flex items-start justify-between gap-3">
								<div class="min-w-0 flex-1">
									<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
										<Text>{option.label}</Text>
										{#if option.code}
											<Meta>{option.code}</Meta>
										{/if}
									</div>
									{#if option.description}
										<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
											<Meta>{option.description}</Meta>
											{#if option.aliases.length > 0}
												<FormHelpTooltip content={`Aliases: ${option.aliases.join(', ')}`} />
											{/if}
										</div>
									{/if}
								</div>
								{#if selected}
									<CheckIcon class="mt-0.5 size-4 shrink-0 text-primary" />
								{/if}
							</div>
						</button>
					{/each}
				{:else}
					<div class="ui-picker-empty">
						<Text>No classifications found</Text>
						<Meta>Try another keyword or create a classification first.</Meta>
					</div>
				{/if}
			</div>
		</div>
		{#snippet footer()}
			<Button variant="secondary" size="default" onclick={closeClassificationPickerDialog}>
				Cancel
			</Button>
		{/snippet}
	</Dialog.FormFrame>
</Dialog.Root>

<Dialog.Root
	open={structureRootPickerDialogOpen}
	onOpenChange={handleStructureRootPickerOpenChange}
>
	<Dialog.FormFrame
		title="Choose Structure Root"
		description="Search by name, code, or path to set the starting structure node for this estimate."
		bodyClass="ui-dialog-field-density space-y-3"
		class="ui-dialog-size-md"
	>
		<div class="space-y-3">
			<FieldShell>
				<Cluster gap="var(--space-1-5)" align="center">
					<FieldLabel for="structure-root-picker-search">Search</FieldLabel>
					<FormHelpTooltip
						content="Type part of the structure path, code, or root name to find the right node faster."
					/>
				</Cluster>
				<SearchInput
					id="structure-root-picker-search"
					size="sm"
					bind:value={structureRootPickerSearch}
					autofocus
					placeholder="Search name, code, or path"
				/>
			</FieldShell>
			<div class="ui-picker-surface ui-scroll-panel">
				<button
					type="button"
					class="field-copy ui-picker-option"
					role="option"
					data-selected={structureRootPickerOptionSelected(null)}
					aria-selected={structureRootPickerOptionSelected(null)}
					onclick={() => selectStructureRootPickerOption(null)}
				>
					<div class="flex items-start justify-between gap-3">
						<div class="min-w-0 flex-1">
							<Text>None</Text>
							<Meta>Do not constrain this estimate to a structure root.</Meta>
						</div>
						{#if structureRootPickerOptionSelected(null)}
							<CheckIcon class="mt-0.5 size-4 shrink-0 text-primary" />
						{/if}
					</div>
				</button>
				{#if filteredStructureRootPickerOptions.length > 0}
					{#each filteredStructureRootPickerOptions as option (option.id)}
						{@const selected = structureRootPickerOptionSelected(option.id)}
						<button
							type="button"
							class="field-copy ui-picker-option"
							role="option"
							data-selected={selected}
							aria-selected={selected}
							onclick={() => selectStructureRootPickerOption(option.id)}
						>
							<div class="flex items-start justify-between gap-3">
								<div class="min-w-0 flex-1">
									<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
										<Text>{option.label}</Text>
										{#if option.code}
											<Meta>{option.code}</Meta>
										{/if}
									</div>
									{#if option.description}
										<Meta>{option.description}</Meta>
									{/if}
								</div>
								{#if selected}
									<CheckIcon class="mt-0.5 size-4 shrink-0 text-primary" />
								{/if}
							</div>
						</button>
					{/each}
				{:else}
					<div class="ui-picker-empty">
						<Text>No structure roots found</Text>
						<Meta>Try another keyword or create a structure template first.</Meta>
					</div>
				{/if}
			</div>
		</div>
		{#snippet footer()}
			<Button variant="secondary" size="default" onclick={closeStructureRootPickerDialog}>
				Cancel
			</Button>
		{/snippet}
	</Dialog.FormFrame>
</Dialog.Root>

<Dialog.Root open={confirmAiReplaceOpen} onOpenChange={handleAiReplaceOpenChange}>
	<Dialog.Content class="ui-dialog-size-sm">
		<Dialog.Header>
			<Dialog.Title>Apply AI draft to the editor?</Dialog.Title>
			<Dialog.Description>
				This will replace the current takeoff items and cost rows for this scope item. The estimate
				will stay unsaved so you can review and edit it before saving.
			</Dialog.Description>
		</Dialog.Header>
		<div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
			<Button
				variant="secondary"
				size="default"
				onclick={() => cancelPendingAiReplace('cancelled')}
			>
				Cancel
			</Button>
			<Button variant="brand" size="default" autofocus onclick={confirmPendingAiReplace}>
				Apply draft
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root open={confirmTemplateOpen} onOpenChange={handleTemplateConfirmOpenChange}>
	<Dialog.Content class="ui-dialog-size-sm">
		<Dialog.Header>
			<Dialog.Title>Replace current estimate?</Dialog.Title>
			<Dialog.Description>
				Applying a template will replace the current estimate header, takeoff items, and cost
				components for this scope item.
			</Dialog.Description>
		</Dialog.Header>
		<div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
			<Button
				variant="secondary"
				size="default"
				autofocus
				onclick={() => cancelPendingTemplateApply('cancelled')}
			>
				Cancel
			</Button>
			<Button variant="brand" size="default" onclick={confirmPendingTemplateApply}>
				Apply template
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root open={confirmPresetOpen} onOpenChange={handlePresetConfirmOpenChange}>
	<Dialog.Content class="ui-dialog-size-md">
		<Dialog.Header>
			<Dialog.Title>Apply cost preset</Dialog.Title>
			<Dialog.Description>
				This takeoff item already has cost rows. Choose whether to append the preset rows or replace
				the existing cost rows for this item.
			</Dialog.Description>
		</Dialog.Header>
		<div class="space-y-2">
			<FieldShell>
				<FieldLabel>Apply Mode</FieldLabel>
				<Cluster gap="var(--space-2)">
					<Button
						type="button"
						variant={presetApplyMode === 'append' ? 'brand' : 'outline'}
						size="default"
						onclick={() => (presetApplyMode = 'append')}
					>
						Append Preset
					</Button>
					<Button
						type="button"
						variant={presetApplyMode === 'replace' ? 'brand' : 'outline'}
						size="default"
						onclick={() => (presetApplyMode = 'replace')}
					>
						Replace Existing
					</Button>
				</Cluster>
			</FieldShell>
		</div>
		<div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
			<Button
				variant="secondary"
				size="default"
				autofocus
				onclick={() => cancelPendingPresetApply('cancelled')}
			>
				Cancel
			</Button>
			<Button variant="brand" size="default" onclick={confirmPendingPresetApply}>
				Apply preset
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={presetDialogOpen}>
	<Dialog.FormFrame
		title="Save Cost Preset"
		description="Store the current cost components as a reusable preset for future takeoff items."
		class="ui-dialog-size-md"
	>
		<div class="space-y-4">
			<FieldShell>
				<FieldLabel for="preset-name">Preset Name</FieldLabel>
				<Input
					id="preset-name"
					bind:value={presetFormValues.name}
					invalidTone={getFieldInvalidTone(presetFieldErrors.name)}
					placeholder="e.g. Fabrication Pack"
				/>
				<FieldError errors={presetFieldErrors.name} />
			</FieldShell>
			<div class="grid gap-4 md:grid-cols-2">
				<FieldShell>
					<FieldLabel for="preset-code">Code</FieldLabel>
					<Input id="preset-code" bind:value={presetFormValues.code} placeholder="Optional code" />
				</FieldShell>
				<FieldShell>
					<FieldLabel for="preset-active">Status</FieldLabel>
					<Select.Root
						type="single"
						value={presetFormValues.is_active ? 'active' : 'inactive'}
						onValueChange={(value: string) => {
							presetFormValues.is_active = value !== 'inactive';
						}}
					>
						<Select.Trigger id="preset-active" class="w-full">
							{presetFormValues.is_active ? 'Active' : 'Inactive'}
						</Select.Trigger>
						<Select.Content>
							<Select.Item value="active">Active</Select.Item>
							<Select.Item value="inactive">Inactive</Select.Item>
						</Select.Content>
					</Select.Root>
				</FieldShell>
			</div>
			<FieldShell>
				<FieldLabel for="preset-description">Description</FieldLabel>
				<Textarea
					id="preset-description"
					bind:value={presetFormValues.description}
					class="ui-field-note-md"
					placeholder="Optional preset notes"
				/>
			</FieldShell>
			<FieldShell>
				<FieldLabelRow for="preset-aliases" tooltip={ALIAS_FIELD_HELP_TEXT}>Aliases</FieldLabelRow>
				<Input
					id="preset-aliases"
					bind:value={presetAliasesInput}
					placeholder={ALIAS_INPUT_PLACEHOLDER}
				/>
			</FieldShell>
			{#if presetSaveReview.unresolvedCount > 0 || presetSaveReview.rateReviewCount > 0}
				<Alert.Root variant="warning">
					<TriangleAlertIcon />
					<div class="space-y-1">
						<Alert.Title>Save with review items</Alert.Title>
						<Alert.Description>
							This preset still contains {saveReviewSummary(presetSaveReview)}. Saving it now will
							reuse those review items in future estimates.
						</Alert.Description>
					</div>
				</Alert.Root>
			{/if}
		</div>

		{#snippet footer()}
			<Button variant="secondary" onclick={() => (presetDialogOpen = false)}>Cancel</Button>
			<Button variant="brand" onclick={savePreset} disabled={savingPreset}>Save Preset</Button>
		{/snippet}
	</Dialog.FormFrame>
</Dialog.Root>

<Dialog.Root bind:open={templateDialogOpen}>
	<Dialog.FormFrame
		title="Save Estimate Template"
		description="Store the current estimate header, takeoff items, and cost components as a reusable template."
		class="ui-dialog-size-md"
	>
		<div class="space-y-4">
			<FieldShell>
				<FieldLabel for="template-name">Template Name</FieldLabel>
				<Input
					id="template-name"
					bind:value={templateFormValues.name}
					invalidTone={getFieldInvalidTone(templateFieldErrors.name)}
					placeholder="e.g. Basic Fabrication Scope"
				/>
				<FieldError errors={templateFieldErrors.name} />
			</FieldShell>
			<div class="grid gap-4 md:grid-cols-2">
				<FieldShell>
					<FieldLabel for="template-code">Code</FieldLabel>
					<Input
						id="template-code"
						bind:value={templateFormValues.code}
						placeholder="Optional code"
					/>
				</FieldShell>
				<FieldShell>
					<FieldLabel for="template-active">Status</FieldLabel>
					<Select.Root
						type="single"
						value={templateFormValues.is_active ? 'active' : 'inactive'}
						onValueChange={(value: string) => {
							templateFormValues.is_active = value !== 'inactive';
						}}
					>
						<Select.Trigger id="template-active" class="w-full">
							{templateFormValues.is_active ? 'Active' : 'Inactive'}
						</Select.Trigger>
						<Select.Content>
							<Select.Item value="active">Active</Select.Item>
							<Select.Item value="inactive">Inactive</Select.Item>
						</Select.Content>
					</Select.Root>
				</FieldShell>
			</div>
			<FieldShell>
				<FieldLabel for="template-description">Description</FieldLabel>
				<Textarea
					id="template-description"
					bind:value={templateFormValues.description}
					class="ui-field-note-md"
					placeholder="Optional template notes"
				/>
			</FieldShell>
			<FieldShell>
				<FieldLabelRow for="template-aliases" tooltip={ALIAS_FIELD_HELP_TEXT}>Aliases</FieldLabelRow
				>
				<Input
					id="template-aliases"
					bind:value={templateAliasesInput}
					placeholder={ALIAS_INPUT_PLACEHOLDER}
				/>
			</FieldShell>
			{#if templateSaveReview.unresolvedCount > 0 || templateSaveReview.rateReviewCount > 0}
				<Alert.Root variant="warning">
					<TriangleAlertIcon />
					<div class="space-y-1">
						<Alert.Title>Save with review items</Alert.Title>
						<Alert.Description>
							This template still contains {saveReviewSummary(templateSaveReview)}. Saving it now
							will reuse those review items in future estimates.
						</Alert.Description>
					</div>
				</Alert.Root>
			{/if}
		</div>

		{#snippet footer()}
			<Button variant="secondary" onclick={() => (templateDialogOpen = false)}>Cancel</Button>
			<Button variant="brand" onclick={saveTemplate} disabled={savingTemplate}>Save Template</Button
			>
		{/snippet}
	</Dialog.FormFrame>
</Dialog.Root>

<AlertDialog.Root bind:open={saveWarningDialogOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Save reusable record with review items?</AlertDialog.Title>
			<AlertDialog.Description>
				{#if pendingReusableSave}
					This {pendingReusableSave.kind === 'preset' ? 'preset' : 'template'} still contains
					{saveReviewSummary(pendingReusableSave)}. Saving it now will carry those unresolved or
					zero-rate rows into future estimates.
				{:else}
					This reusable record still contains unresolved or zero-rate rows.
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel onclick={cancelReusableSaveWarning}>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action onclick={confirmReusableSaveWarning}>Save anyway</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root bind:open={confirmEstimateResetOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Reset estimate?</AlertDialog.Title>
			<AlertDialog.Description>
				This clears the scope summary, notes, classification, structure root, and all takeoff items
				for this scope item. The reset is saved immediately and cannot be undone.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel onclick={cancelEstimateReset}>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action variant="destructive" onclick={confirmEstimateReset}>
				Reset estimate
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
