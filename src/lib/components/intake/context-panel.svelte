<script lang="ts">
	import DatePickerField from '$lib/components/date-picker-field.svelte';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { FieldLabel, FieldShell } from '$lib/components/primitives/index.js';
	import type { RfqValues } from '$lib/schemas/index.js';

	interface Props {
		formValues: RfqValues;
	}

	let { formValues = $bindable() }: Props = $props();

	const id = $props.id();
</script>

<div class="flex flex-col gap-4">
	<div class="grid gap-4 md:grid-cols-2">
		<FieldShell>
			<FieldLabel for="{id}-site-address">Site Address</FieldLabel>
			<Textarea
				id="{id}-site-address"
				bind:value={formValues.site_address}
				rows={3}
				size="default"
				class="min-h-16 bg-background"
				placeholder="Site or work location"
			/>
		</FieldShell>
		<FieldShell>
			<FieldLabel for="{id}-delivery-address">Delivery Address</FieldLabel>
			<Textarea
				id="{id}-delivery-address"
				bind:value={formValues.delivery_address}
				rows={3}
				size="default"
				class="min-h-16 bg-background"
				placeholder="Delivery or install address"
			/>
		</FieldShell>
	</div>
	<div class="grid gap-4 md:grid-cols-2">
		<FieldShell>
			<FieldLabel for="{id}-addendum-label">Addendum / Revision</FieldLabel>
			<Input
				id="{id}-addendum-label"
				bind:value={formValues.addendum_label}
				size="default"
				placeholder="e.g. Addendum 2"
			/>
		</FieldShell>
		<FieldShell>
			<FieldLabel for="{id}-addendum-date">Addendum Date</FieldLabel>
			<DatePickerField
				id="{id}-addendum-date"
				bind:value={formValues.addendum_date}
				placeholder="Select addendum date"
			/>
		</FieldShell>
	</div>
	<FieldShell>
		<FieldLabel for="{id}-addendum-notes">Addendum Notes</FieldLabel>
		<Textarea
			id="{id}-addendum-notes"
			bind:value={formValues.addendum_notes}
			rows={3}
			size="default"
			class="min-h-16 bg-background"
			placeholder="Revision details, addenda received, or tender clarifications"
		/>
	</FieldShell>

	<FieldShell>
		<FieldLabel for="{id}-content">Customer Brief</FieldLabel>
		<Textarea
			id="{id}-content"
			bind:value={formValues.content}
			rows={8}
			size="default"
			class="max-h-60 min-h-24 bg-background"
			placeholder="Paste original customer instructions here..."
		/>
	</FieldShell>

	<FieldShell>
		<FieldLabel for="{id}-note">Internal Notes</FieldLabel>
		<Textarea
			id="{id}-note"
			bind:value={formValues.note}
			rows={4}
			size="default"
			class="min-h-16 bg-background"
			placeholder="Private notes for the estimator..."
		/>
	</FieldShell>
</div>
