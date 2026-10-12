<script lang="ts">
	import { getFieldErrorMessage, getFieldInvalidTone } from '$lib/utils/field-errors.js';
	import FieldHelp from './field-help.svelte';

	let {
		errors,
		class: className
	}: {
		errors?: string[] | null;
		class?: string;
	} = $props();

	const message = $derived(getFieldErrorMessage(errors));
	const tone = $derived(getFieldInvalidTone(errors) === 'destructive' ? 'destructive' : 'default');
</script>

{#if message}
	<FieldHelp {tone} class={className}>
		{message}
	</FieldHelp>
{/if}
