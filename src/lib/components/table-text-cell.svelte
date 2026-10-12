<script lang="ts">
	type Tone = 'primary' | 'secondary';
	type Align = 'left' | 'right' | 'center';

	let {
		text,
		tone = 'primary',
		align = 'left',
		tabular = false,
		truncate = true
	}: {
		text: string | number | null | undefined;
		tone?: Tone;
		align?: Align;
		tabular?: boolean;
		truncate?: boolean;
	} = $props();

	const displayText = $derived.by(() => {
		if (text === undefined || text === null) return '—';
		const normalized = String(text).trim();
		return normalized.length > 0 ? normalized : '—';
	});

	const toneClass = $derived(tone === 'secondary' ? 'muted' : '');
	const alignClass = $derived(
		align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
	);
</script>

<div
	class="table-copy {toneClass} {alignClass} {tabular ? 'tabular-nums' : ''} {truncate
		? 'truncate'
		: ''}"
>
	{displayText}
</div>
