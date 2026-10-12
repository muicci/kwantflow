<script lang="ts">
	import { FieldLabelRow, Meta, Text } from '$lib/components/primitives/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { toast } from 'svelte-sonner';
	import { assistantState } from '$lib/state/assistant.svelte.js';
	import { integrationsState } from '$lib/state/integrations.svelte.js';

	interface Props {
		localAiInstalled: boolean;
	}

	let { localAiInstalled }: Props = $props();

	const localAssistantVisible = $derived(localAiInstalled);
</script>

{#if localAiInstalled}
	<div class="space-y-2">
		<Text class="px-1">AI Features</Text>
		<div class="ui-settings-card">
			{#if localAssistantVisible}
				<div class="ui-settings-row">
					<div class="min-w-0">
						<FieldLabelRow tooltip="Show Kwantflow AI in the toolbar when ready.">
							Kwantflow AI
						</FieldLabelRow>
						<Meta>Visible while Kwantflow AI is ready.</Meta>
					</div>
					<Switch
						checked={assistantState.isAssistantEnabled}
						aria-label="Toggle Kwantflow AI"
						onCheckedChange={(checked) => void assistantState.setAssistantEnabled(!!checked)}
					/>
				</div>
			{/if}
			<div class="ui-settings-row">
				<div class="min-w-0">
					<FieldLabelRow
						tooltip={integrationsState.isEmailConnected
							? 'Use Kwantflow AI to check if incoming emails are RFQ requests.'
							: 'Connect your Gmail or Outlook in Integrations to enable Mail RFQ Detection.'}
					>
						Mail RFQ Detection
					</FieldLabelRow>
					<Meta>Auto-tag potential RFQ emails in the Mail sidebar.</Meta>
				</div>
				<Switch
					checked={integrationsState.isEmailConnected && integrationsState.mailRfqDetectionEnabled}
					disabled={!integrationsState.isEmailConnected}
					aria-label="Toggle Mail RFQ Detection"
					onCheckedChange={async (checked) => {
						try {
							await integrationsState.setMailRfqDetectionEnabled(checked);
							toast.success(checked ? 'Mail RFQ Detection enabled' : 'Mail RFQ Detection disabled');
						} catch (error) {
							toast.error(error instanceof Error ? error.message : String(error));
						}
					}}
				/>
			</div>
		</div>
	</div>
{/if}
