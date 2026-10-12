<script lang="ts">
	import { onMount } from 'svelte';
	import FileIcon from '@lucide/svelte/icons/file';
	import { Meta, Text } from '$lib/components/primitives/index.js';
	import { errorState } from '$lib/state/errors.svelte.js';

	interface Props {
		error: unknown;
		fileName: string;
	}

	let { error, fileName }: Props = $props();

	onMount(() => {
		void errorState.catchError(error, `Load preview ${fileName}`, undefined, { silent: true });
	});
</script>

<div class="ui-pane-empty">
	<div class="flex max-w-sm flex-col items-center gap-3 text-center">
		<FileIcon class="muted size-10" />
		<div class="grid gap-1">
			<Text tone="muted">Preview unavailable for this file type.</Text>
			<div title={fileName}>
				<Meta class="truncate">{fileName}</Meta>
			</div>
		</div>
	</div>
</div>
