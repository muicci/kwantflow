<script lang="ts">
	import { Meta, Text } from '$lib/components/primitives/index.js';
	import type { AiRunProgressDetail } from '$lib/types/index.js';
	import {
		buildEstimateAiTerminalLines,
		type EstimateAiTerminalLineTone
	} from './estimate-ai-progress-terminal.js';

	let {
		status,
		runActive,
		isCancelling,
		progressDetail,
		progressValueLabel = null,
		errorMessage = null,
		unsupportedFileCount = 0,
		issueCount = 0,
		appliedToEditor = false,
		canApplyPending = false,
		localRuntimeReady
	}: {
		status: string;
		runActive: boolean;
		isCancelling: boolean;
		progressDetail: AiRunProgressDetail;
		progressValueLabel?: string | null;
		errorMessage?: string | null;
		unsupportedFileCount?: number;
		issueCount?: number;
		appliedToEditor?: boolean;
		canApplyPending?: boolean;
		localRuntimeReady: boolean;
	} = $props();

	const lines = $derived(
		buildEstimateAiTerminalLines({
			status,
			runActive,
			isCancelling,
			progressDetail,
			progressValueLabel,
			errorMessage,
			unsupportedFileCount,
			issueCount,
			appliedToEditor,
			canApplyPending,
			localRuntimeReady
		})
	);

	function toneClass(tone: EstimateAiTerminalLineTone): string {
		switch (tone) {
			case 'active':
				return 'ui-ai-terminal-line-active';
			case 'success':
				return 'ui-ai-terminal-line-success';
			case 'warning':
				return 'ui-ai-terminal-line-warning';
			case 'error':
				return 'ui-ai-terminal-line-error';
			case 'pending':
			default:
				return 'ui-ai-terminal-line-pending';
		}
	}

	function toneMarker(tone: EstimateAiTerminalLineTone): string {
		switch (tone) {
			case 'active':
				return '→';
			case 'success':
				return '✓';
			case 'warning':
				return '!';
			case 'error':
				return '×';
			case 'pending':
			default:
				return '•';
		}
	}
</script>

<div class="ui-ai-terminal">
	<div
		class="ui-ai-terminal-body"
		role="log"
		aria-live="polite"
		aria-label="Kwantflow AI progress log"
	>
		{#each lines as line (line.id)}
			<div class={`ui-ai-terminal-line ${toneClass(line.tone)}`}>
				<span class="ui-ai-terminal-marker" aria-hidden="true">{toneMarker(line.tone)}</span>
				<div class="min-w-0 space-y-0.5">
					<Text as="p" class="ui-ai-terminal-message">{line.message}</Text>
					{#if line.detail}
						<Meta>{line.detail}</Meta>
					{/if}
				</div>
			</div>
		{/each}
	</div>
</div>
