<script lang="ts">
	type Align = 'left' | 'right' | 'center';

	let {
		text,
		align = 'left'
	}: {
		text: string;
		align?: Align;
	} = $props();
</script>

<div
	class={`table-heading ${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : ''}`}
>
	{text}
</div>
