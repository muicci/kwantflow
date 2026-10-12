<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import {
		FieldError,
		FieldHelp,
		FieldLabelRow,
		FieldShell,
		Heading,
		Meta,
		Panel,
		SectionLabel,
		Stack
	} from './index.js';

	const { Story } = defineMeta({
		title: 'Design System/Primitives/Form Pattern',
		tags: ['autodocs']
	});
</script>

<Story name="Standard Field Stack">
	<Panel class="w-full max-w-xl" inset="md">
		<Stack class="gap-4">
			<div class="space-y-1">
				<Heading tone="panel">Workspace details</Heading>
				<Meta>Shared field composition for dialogs, onboarding, and settings.</Meta>
			</div>
			<FieldShell>
				<FieldLabelRow for="workspace-name" tooltip="Internal workspace label used in the app.">
					Workspace name
				</FieldLabelRow>
				<Input id="workspace-name" size="sm" value="Acme Fabrication" />
				<FieldHelp
					>This label and helper rhythm is the default contract for product fields.</FieldHelp
				>
			</FieldShell>
			<FieldShell invalidTone="destructive">
				<FieldLabelRow for="workspace-abn">Business identifier</FieldLabelRow>
				<Input id="workspace-abn" size="sm" invalidTone="destructive" value="123" />
				<FieldError errors={['Enter a valid business identifier.']} />
			</FieldShell>
			<div class="space-y-2">
				<SectionLabel>Section heading</SectionLabel>
				<Meta>Use the visual twin when the label is not bound to a control.</Meta>
			</div>
			<div class="flex justify-end">
				<Button variant="brand" size="sm">Save changes</Button>
			</div>
		</Stack>
	</Panel>
</Story>
