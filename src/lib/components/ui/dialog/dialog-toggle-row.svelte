<script lang="ts">
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import FormHelpTooltip from '$lib/components/form-help-tooltip.svelte';
	import { Text } from '$lib/components/primitives/index.js';
	import { cn } from '$lib/utils.js';

	interface Props {
		checked?: boolean;
		label: string;
		tooltip?: string;
		class?: string;
	}

	let { checked = $bindable(false), label, tooltip, class: className = '' }: Props = $props();
</script>

<label class={cn('flex items-start gap-3 px-1 py-1', className)}>
	<Checkbox bind:checked />
	<div class="flex min-w-0 flex-col">
		<Text as="span" class="flex items-center gap-1.5">
			{label}
			{#if tooltip}
				<FormHelpTooltip content={tooltip} />
			{/if}
		</Text>
	</div>
</label>
