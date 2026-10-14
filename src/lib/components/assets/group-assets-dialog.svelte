<script lang="ts">
	import { onMount } from 'svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { FieldLabel, FieldShell } from '$lib/components/primitives/index.js';

	let {
		open = $bindable(false),
		selectedCount = 0,
		defaultName = '',
		onConfirm
	}: {
		open: boolean;
		selectedCount: number;
		defaultName: string;
		onConfirm: (name: string) => void;
	} = $props();

	let name = $state('');

	onMount(() => {
		name = defaultName;
	});

	function handleSubmit(e: Event) {
		e.preventDefault();
		if (name.trim()) {
			onConfirm(name.trim());
			open = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.FormFrame
		title={`Create Asset from ${selectedCount} File${selectedCount === 1 ? '' : 's'}`}
		description="These project files will be bundled into a single scope item."
		class="ui-dialog-size-compact"
		bodyClass="grid gap-4"
	>
		<FieldShell>
			<FieldLabel for="name">Asset Name</FieldLabel>
			<Input id="name" bind:value={name} placeholder="e.g. Bracket Assembly" autofocus />
		</FieldShell>
		{#snippet footer()}
			<Button type="button" variant="secondary" onclick={() => (open = false)}>Cancel</Button>
			<Button type="button" disabled={!name.trim()} onclick={(e) => handleSubmit(e)}>
				Create Asset
			</Button>
		{/snippet}
	</Dialog.FormFrame>
</Dialog.Root>
