<script lang="ts">
	type Tone = 'primary' | 'secondary';
	type Align = 'left' | 'right' | 'center';

	let {
		primaryText,
		secondaryText,
		align = 'left',
		tabular = false,
		primaryTone = 'primary',
		secondaryTone = 'secondary',
		primaryClass = '',
		secondaryClass = ''
	}: {
		primaryText: string | number | null | undefined;
		secondaryText?: string | number | null | undefined;
		align?: Align;
		tabular?: boolean;
		primaryTone?: Tone;
		secondaryTone?: Tone;
		primaryClass?: string;
		secondaryClass?: string;
	} = $props();

	function normalize(value: string | number | null | undefined): string {
		if (value === undefined || value === null) return '—';
		const normalized = String(value).trim();
		return normalized.length > 0 ? normalized : '—';
	}

	const primaryDisplay = $derived(normalize(primaryText));
	const secondaryDisplay = $derived(secondaryText === undefined ? '' : normalize(secondaryText));
	const alignmentClass = $derived(
		align === 'right'
			? 'items-end text-right'
			: align === 'center'
				? 'items-center text-center'
				: ''
	);
	const primaryToneClass = $derived(primaryTone === 'secondary' ? 'muted' : '');
	const secondaryToneClass = $derived(secondaryTone === 'secondary' ? 'muted' : '');
</script>

<div class="flex flex-col {alignmentClass} {tabular ? 'tabular-nums' : ''}">
	<div class="table-copy {primaryToneClass} {primaryClass}">{primaryDisplay}</div>
	{#if secondaryDisplay}
		<div class="table-caption {secondaryToneClass} {secondaryClass}">{secondaryDisplay}</div>
	{/if}
</div>
