<script lang="ts">
	import type { Snippet, Component } from 'svelte';
	import { cn } from '$lib/utils.js';
	import DialogRailFrame from './dialog-rail-frame.svelte';

	type DialogWorkflowSize = 'sm' | 'md' | 'lg' | 'workbench';

	type WorkflowDialogStep = {
		id: string;
		name: string;
		icon: Component<{ class?: string }>;
	};

	interface Props {
		title: string;
		description?: string;
		steps: WorkflowDialogStep[];
		activeStep: string;
		onStepSelect: (stepId: string) => void;
		bodyClass?: string;
		size?: DialogWorkflowSize;
		class?: string;
		children: Snippet;
		footer?: Snippet;
	}

	let {
		title,
		description = '',
		steps,
		activeStep,
		onStepSelect,
		bodyClass = '',
		size = 'md',
		class: className = '',
		children,
		footer
	}: Props = $props();

	const workflowFrameSizeClass: Record<Exclude<DialogWorkflowSize, 'workbench'>, string> = {
		sm: 'ui-dialog-frame-size-sm',
		md: 'ui-dialog-frame-size-md',
		lg: 'ui-dialog-frame-size-lg'
	};

	const workflowFrameClass = $derived(
		size === 'workbench' ? 'ui-dialog-workbench' : size ? workflowFrameSizeClass[size] : ''
	);
</script>

<DialogRailFrame
	rootLabel={title}
	{description}
	items={steps}
	activeItemId={activeStep}
	onItemSelect={onStepSelect}
	{bodyClass}
	size={size && size !== 'workbench' ? size : undefined}
	class={cn('dialog-shell-workflow', workflowFrameClass, className)}
	{children}
	{footer}
/>
