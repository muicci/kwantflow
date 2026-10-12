<script lang="ts">
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import { onMount } from 'svelte';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import { Meta } from '$lib/components/primitives/index.js';

	interface Props {
		content: string;
	}

	let { content }: Props = $props();
	let canAutoOpen = $state(false);

	onMount(() => {
		const timeout = window.setTimeout(() => {
			canAutoOpen = true;
		}, 250);

		return () => {
			window.clearTimeout(timeout);
		};
	});
</script>

{#if canAutoOpen}
	<Tooltip.Provider delayDuration={250}>
		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<button
						{...props}
						type="button"
						class="inline-flex shrink-0 items-center self-center leading-none"
						aria-label="More information"
					>
						<span
							class="ui-radius-pill inline-flex size-3.5 items-center justify-center opacity-60 transition-opacity hover:opacity-100"
						>
							<CircleAlertIcon class="size-3" />
						</span>
					</button>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content sideOffset={8} class="max-w-56">
				<Meta>{content}</Meta>
			</Tooltip.Content>
		</Tooltip.Root>
	</Tooltip.Provider>
{:else}
	<button
		type="button"
		class="inline-flex shrink-0 items-center self-center leading-none"
		aria-label="More information"
		tabindex="-1"
	>
		<span
			class="ui-radius-pill inline-flex size-3.5 items-center justify-center opacity-60 transition-opacity"
		>
			<CircleAlertIcon class="size-3" />
		</span>
	</button>
{/if}
