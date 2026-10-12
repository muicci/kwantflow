<script lang="ts">
	import { aiState } from '$lib/state/ai.svelte.js';
	import { assistantState } from '$lib/state/assistant.svelte.js';
	import { onboardingState } from '$lib/state/onboarding.svelte.js';
	import { Button } from '$lib/components/ui/button/index.js';

	const assistantReady = $derived(
		assistantState.isAssistantEnabled &&
			onboardingState.currentStep === 'ready' &&
			(aiState.localAiStatus.installState === 'ready' ||
				aiState.localAiStatus.installState === 'installed' ||
				aiState.localAiStatus.installState === 'loading' ||
				aiState.localAiStatus.installState === 'verifying') &&
			!aiState.localAiStatus.lastError
	);
</script>

{#if assistantReady}
	<Button
		variant="ghost"
		size="sm"
		class="gap-1.5 bg-primary/10 text-primary hover:bg-primary/15"
		onclick={() => assistantState.toggleSidebar()}
	>
		<svg
			viewBox="0 0 1024 1024"
			xmlns="http://www.w3.org/2000/svg"
			class="size-3 shrink-0"
			fill="currentColor"
		>
			<g transform="translate(102, 102) scale(0.808)">
				<path
					d="M254 762H762V254H402C356 249 314 225 286 188C270 168 259 144 254 119V0H0v254h105c46 5 88 29 116 66c17 22 28 48 33 75v367Z"
				/>
				<path d="M0 1016h254V762H0v254ZM762 1016h254V762H762v254ZM762 254h254V0H762v254Z" />
			</g>
		</svg>
		<span class="shell-label">Ask Kwantflow</span>
	</Button>
{/if}
