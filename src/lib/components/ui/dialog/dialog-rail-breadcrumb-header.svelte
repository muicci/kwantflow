<script lang="ts">
	import * as Breadcrumb from '$lib/components/ui/breadcrumb/index.js';
	import { Text } from '$lib/components/primitives/index.js';
	import XIcon from '@lucide/svelte/icons/x';

	interface Props {
		rootLabel: string;
		pageLabel: string;
		onCloseRequest?: (() => void) | undefined;
	}

	let { rootLabel, pageLabel, onCloseRequest }: Props = $props();
</script>

<header class="ui-dialog-shell-header flex items-center justify-between gap-3">
	<Breadcrumb.Root>
		<Breadcrumb.List>
			<Breadcrumb.Item class="hidden md:block">
				<span data-slot="breadcrumb-link">
					<Text as="span" class="shell-label opacity-70 transition-colors">{rootLabel}</Text>
				</span>
			</Breadcrumb.Item>
			<Breadcrumb.Separator class="hidden md:block" />
			<Breadcrumb.Item>
				<Breadcrumb.Page>{pageLabel}</Breadcrumb.Page>
			</Breadcrumb.Item>
		</Breadcrumb.List>
	</Breadcrumb.Root>
	{#if onCloseRequest}
		<button
			type="button"
			class="ui-radius-tight opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none"
			aria-label="Close settings"
			onclick={onCloseRequest}
		>
			<XIcon class="size-4" />
		</button>
	{/if}
</header>
