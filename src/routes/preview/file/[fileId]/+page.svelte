<script lang="ts">
	import type { PageProps } from './$types';
	import { page } from '$app/stores';
	import SingleFileViewer from '$lib/components/assets/single-file-viewer.svelte';

	let { data }: PageProps = $props();

	let expanded = $state(false);

	const previewFile = $derived(data.previewFile);
	const file = $derived(previewFile?.file ?? null);

	const targetPdfPage = $derived(
		$page.url.searchParams.get('page') ? Number($page.url.searchParams.get('page')) : null
	);
	const targetCadViewLabel = $derived($page.url.searchParams.get('view') ?? null);
</script>

<SingleFileViewer
	{file}
	bind:expanded
	allowExpand={false}
	{targetPdfPage}
	{targetCadViewLabel}
	emptyTitle="This file is no longer available."
	emptyDescription="Select another file from Explorer."
/>
