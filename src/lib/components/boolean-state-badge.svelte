<script lang="ts">
	import { Badge, type BadgeVariant } from '$lib/components/ui/badge/index.js';
	import { Meta } from '$lib/components/primitives/index.js';

	type BooleanStateTone = 'active' | 'default' | 'configured';
	type FalseMode = 'badge' | 'dash' | 'hidden';

	interface Props {
		value: boolean;
		trueLabel: string;
		falseLabel?: string;
		tone?: BooleanStateTone;
		falseMode?: FalseMode;
		class?: string;
	}

	const toneConfig: Record<
		BooleanStateTone,
		{
			trueVariant: BadgeVariant;
			trueClass: string;
			falseVariant: BadgeVariant;
			falseClass: string;
		}
	> = {
		active: {
			trueVariant: 'default',
			trueClass: 'status-badge-success',
			falseVariant: 'secondary',
			falseClass: 'muted'
		},
		default: {
			trueVariant: 'secondary',
			trueClass: '',
			falseVariant: 'secondary',
			falseClass: 'muted'
		},
		configured: {
			trueVariant: 'outline',
			trueClass: 'status-badge-success',
			falseVariant: 'outline',
			falseClass: 'muted'
		}
	};

	let {
		value,
		trueLabel,
		falseLabel = 'Inactive',
		tone = 'active',
		falseMode = 'badge',
		class: className = ''
	}: Props = $props();

	const config = $derived(toneConfig[tone]);
</script>

{#if value}
	<Badge variant={config.trueVariant} class={`${config.trueClass} ${className}`.trim()}>
		{trueLabel}
	</Badge>
{:else if falseMode === 'badge'}
	<Badge variant={config.falseVariant} class={`${config.falseClass} ${className}`.trim()}>
		{falseLabel}
	</Badge>
{:else if falseMode === 'dash'}
	<Meta as="span" class={className}>—</Meta>
{/if}
