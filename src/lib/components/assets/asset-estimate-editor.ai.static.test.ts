import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const editorPath = join(process.cwd(), 'src/lib/components/assets/asset-estimate-editor.svelte');
const aiRowPath = join(process.cwd(), 'src/lib/components/assets/estimate-ai-draft-row.svelte');
const aiTerminalPath = join(
	process.cwd(),
	'src/lib/components/assets/estimate-ai-progress-terminal.svelte'
);
const takeoffItemPath = join(
	process.cwd(),
	'src/lib/components/assets/asset-estimate-takeoff-item.svelte'
);

describe('asset estimate editor AI surface', () => {
	it('puts the AI section first and feeds the compact AI row with friendly runtime and progress props', () => {
		const source = readFileSync(editorPath, 'utf8');

		expect(source).toContain("let activeEstimateSection = $state<EstimateEditorSection>('ai');");
		expect(source.indexOf('value="ai"')).toBeLessThan(source.indexOf('value="setup"'));
		expect(source.indexOf('value="setup"')).toBeLessThan(source.indexOf('value="takeoff"'));
		expect(source).toContain('const localAiReady = $derived(');
		expect(source).not.toContain('const runtimeToggleDisabled = $derived(');
		expect(source).not.toContain('const runtimeHint = $derived.by(() => {');
		expect(source).not.toContain('function aiProgressValue()');
		expect(source).toContain('const aiProgressLabel = $derived(');
		expect(source).not.toContain('function handleAiRuntimePreferenceChange(');
		expect(source).toContain(
			'const baseAiDraftingAvailability = $derived(aiState.getDraftingAvailability(true));'
		);
		expect(source).not.toContain('progressValue=');
		expect(source).toContain('progressValueLabel={aiProgressLabel}');
		expect(source).not.toContain('runtimePreference={aiState.runtimePreference}');
		expect(source).toContain('localRuntimeReady={localAiReady}');
		expect(source).not.toContain('{runtimeToggleDisabled}');
		expect(source).not.toContain('{runtimeHint}');
		expect(source).not.toContain('onRuntimePreferenceChange={handleAiRuntimePreferenceChange}');
		expect(source).not.toContain('{#if aiStageLabel()}');
		expect(source).not.toContain('lockedDescription={aiLockedStateDescription()}');
		expect(source).not.toContain('processingSummary={aiProcessingSummary()}');
		expect(source).not.toContain('aiLockedStateTitle()');
		expect(source).not.toContain('Preparing AI evidence from');
		expect(source).not.toContain('Matching records');
		expect(source).not.toContain('Composing estimate');
		expect(source).not.toContain('Validating draft');
		expect(source).not.toContain("return 'Upgrade plan';");
		expect(source).not.toContain('requestSupportReportDialog()');
	});

	it('uses the new lean AI row contract instead of the older nested card language', () => {
		const editorSource = readFileSync(editorPath, 'utf8');
		const aiRowSource = readFileSync(aiRowPath, 'utf8');
		const aiTerminalSource = readFileSync(aiTerminalPath, 'utf8');
		const themeSource = readFileSync(join(process.cwd(), 'src/lib/design/theme.css'), 'utf8');

		expect(aiRowSource).not.toContain(
			"import { Switch } from '$lib/components/ui/switch/index.js';"
		);
		expect(aiRowSource).toContain(
			"import * as Accordion from '$lib/components/ui/accordion/index.js';"
		);
		expect(aiRowSource).toContain("import Badge from '$lib/components/ui/badge/badge.svelte';");
		expect(editorSource).toContain('AI Draft');
		expect(aiRowSource).not.toContain('Cloud');
		expect(aiRowSource).not.toContain('<Badge variant="success">Local AI</Badge>');
		expect(editorSource).toContain('Draft with AI');
		expect(editorSource).toContain('Cancel AI');
		expect(editorSource).toContain('Apply draft to editor');
		expect(aiRowSource).not.toContain('Cancel AI');
		expect(aiRowSource).toContain('Attention needed');
		expect(aiRowSource).toContain('Evidence used');
		expect(aiRowSource).toContain('Context skipped');
		expect(aiRowSource).toContain('Guide future drafts');
		expect(aiRowSource).toContain('Optional note saved locally for this workspace.');
		expect(aiRowSource).not.toContain('generated workspace skill');
		expect(aiRowSource).toContain('Draft applied — review before saving.');
		expect(aiRowSource).toContain('Draft ready — review before applying.');
		expect(aiRowSource).not.toContain('ui-note-panel ui-note-panel-flat space-y-3');
		expect(aiRowSource).not.toContain('aiDraftSummary');
		expect(aiRowSource).not.toContain('Before saving:');
		expect(aiRowSource).not.toContain('unavailableReason');
		expect(aiRowSource).toContain('EstimateAiProgressTerminal');
		expect(aiRowSource).toContain('progressDetail: AiRunProgressDetail');
		expect(aiRowSource).not.toContain('<div class="flex justify-center pt-0.5">');
		expect(aiTerminalSource).toContain('role="log"');
		expect(aiTerminalSource).not.toContain('Local AI progress</Text>');
		expect(aiTerminalSource).not.toContain('{line.prefix}</span>');
		expect(aiTerminalSource).toContain('ui-ai-terminal-message');
		expect(themeSource).toContain('.ui-note-panel-flat {');
		expect(themeSource).toContain('border-color: transparent;');
		expect(themeSource).toContain('background: transparent;');
		expect(themeSource).toContain('.ui-ai-terminal-message {');
		expect(themeSource).toContain('.ui-workspace-asset-nav-row {');
		expect(themeSource).not.toContain('font-family: var(--font-mono);');
		expect(aiRowSource).not.toContain('variant="success"');
		expect(aiRowSource).toContain('variant="secondary"');
		expect(aiRowSource).not.toContain('ui-pill-panel');
		expect(aiRowSource).not.toContain('border-t pt-4');
		expect(aiRowSource).not.toContain('{#if stageLabel}');
		expect(aiRowSource).not.toContain('lockedDescription');
		expect(aiRowSource).not.toContain('progressDetailLabel');
		expect(aiRowSource).not.toContain('Preparing evidence');
		expect(aiRowSource).not.toContain('Hide details');
		expect(aiRowSource).not.toContain('Preparing AI evidence from');
		expect(aiRowSource).not.toContain('AI is preparing evidence in the background');
		expect(aiRowSource).not.toContain('FieldError');
		expect(aiRowSource).not.toContain('Panel');
	});

	it('does not re-apply a pending AI estimate over user edits after the draft is in the editor', () => {
		const source = readFileSync(editorPath, 'utf8');

		expect(source).toContain('let suppressPendingAiAutoApply = $state(false);');
		expect(source).toContain('if (suppressPendingAiAutoApply) return;');
		expect(source).toContain("if (aiRunState.editorApplyState === 'applied_to_editor') {");
		expect(source).toContain('if (lastAutoApplyConflictRunId === aiRunState.runId) {');
		expect(source).toContain('suppressPendingAiAutoApply = true;');
		expect(source).toContain('suppressPendingAiAutoApply = false;');
		expect(
			source.indexOf("if (aiRunState.editorApplyState === 'applied_to_editor') {")
		).toBeLessThan(source.indexOf('const savedEstimate = engine.getSavedEstimate(asset.id);'));
		expect(source).toContain('preserveExistingRatesInAiDraft(');
	});

	it('renders takeoff-item AI review as a compact accordion instead of a large panel', () => {
		const source = readFileSync(takeoffItemPath, 'utf8');

		expect(source).toContain("import * as Accordion from '$lib/components/ui/accordion/index.js';");
		expect(source).toContain('<Accordion.Root type="multiple"');
		expect(source).toContain('AI review');
		expect(source).toContain('Evidence used');
		expect(source).toContain('Component review');
		expect(source).toContain('function itemAiReviewCount(currentItem: TakeoffItem): number');
		expect(source).not.toContain('<Panel tone="subtle" class="space-y-2">');
	});
});
