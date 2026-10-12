<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Text } from '$lib/components/primitives/index.js';
	import type { Component } from 'svelte';

	type MobileDialogStepTab = {
		id: string;
		name: string;
		icon: Component<{ class?: string }>;
	};

	let {
		items,
		activeStep,
		onSelect,
		desktopVisible = false
	}: {
		items: MobileDialogStepTab[];
		activeStep: string;
		onSelect: (stepId: string) => void;
		desktopVisible?: boolean;
	} = $props();
</script>

<div class={`shrink-0 px-4 pb-3 ${desktopVisible ? '' : 'md:hidden'}`}>
	<div class="-mx-1 flex items-center gap-1 overflow-x-auto px-1">
		{#each items as item (item.id)}
			<Button
				variant="ghost"
				size="sm"
				class={`ui-radius-md shrink-0 gap-2 px-3 ${
					activeStep === item.id
						? 'surface-accent-selected'
						: 'hover-surface-accent muted hover:text-foreground'
				}`}
				type="button"
				aria-pressed={activeStep === item.id}
				onclick={() => onSelect(item.id)}
			>
				<item.icon class="size-3.5" />
				<Text as="span">{item.name}</Text>
			</Button>
		{/each}
	</div>
</div>
