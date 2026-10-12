<script lang="ts">
	import LocalAiSetupCard from '$lib/components/local-ai-setup-card.svelte';
	import AiToggleControls from '$lib/components/user/ai-toggle-controls.svelte';
	import { FieldLabelRow } from '$lib/components/primitives/index.js';
	import { aiState } from '$lib/state/ai.svelte.js';

	const localAiInstalled = $derived(
		(aiState.localAiStatus.installState === 'ready' ||
			aiState.localAiStatus.installState === 'installed') &&
			!aiState.localAiStatus.lastError
	);
</script>

<div class="space-y-4">
	<div class="space-y-1">
		<FieldLabelRow
			tooltip="Kwantflow AI prepares draft estimates on this device. Download the model once, then draft offline without an account."
		>
			Agent
		</FieldLabelRow>
	</div>

	<div class="space-y-3">
		<LocalAiSetupCard compact showRemove />

		<AiToggleControls {localAiInstalled} />
	</div>
</div>
