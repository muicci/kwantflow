<script lang="ts">
	let {
		open = $bindable(false),
		onImported
	}: { open?: boolean; onImported?: () => void | Promise<void> } = $props();

	async function finishImport(): Promise<void> {
		try {
			await onImported?.();
			open = false;
		} catch {
			// The production import dialog preserves the open dialog on callback failure.
		}
	}
</script>

{#if open}
	<button onclick={finishImport}>Finish test import</button>
{/if}
