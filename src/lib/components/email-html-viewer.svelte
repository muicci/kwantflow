<script lang="ts">
	import { errorState } from '$lib/state/errors.svelte.js';
	import { buildEmailSrcdoc, sanitiseEmailHtml } from '$lib/services/email-content.js';
	import { isTauri } from '$lib/utils/env.js';
	import { Button } from '$lib/components/ui/button/index.js';

	interface Props {
		html: string;
		title?: string;
		class?: string;
	}

	let { html, title = 'Email content', class: className = '' }: Props = $props();

	const sanitised = $derived(sanitiseEmailHtml(html));
	const srcdoc = $derived(
		buildEmailSrcdoc(sanitised.html, {
			foreground: resolveToken('--foreground', 'CanvasText'),
			background: resolveToken('--background', 'Canvas'),
			link: resolveToken('--primary', 'LinkText'),
			border: resolveToken('--border', 'GrayText')
		})
	);

	function resolveToken(name: string, fallback: string): string {
		if (typeof document === 'undefined') return fallback;
		return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
	}

	async function openExternalHref(href: string): Promise<void> {
		try {
			if (isTauri()) {
				const { openUrl } = await import('@tauri-apps/plugin-opener');
				await openUrl(href);
				return;
			}
			globalThis.open?.(href, '_blank', 'noopener,noreferrer');
		} catch (cause) {
			errorState.catchError(cause, 'Open email link', undefined, {
				description: 'Could not open this link in your browser.'
			});
		}
	}
</script>

<div class={`flex min-h-0 flex-1 flex-col ${className}`}>
	{#if sanitised.blockedRemoteImageCount > 0}
		<div class="flex shrink-0 items-center justify-between gap-3 border-b border-border px-3 py-2">
			<span class="caption">Remote images are blocked for privacy.</span>
		</div>
	{/if}
	<iframe
		{title}
		sandbox="allow-same-origin"
		referrerpolicy="no-referrer"
		{srcdoc}
		class="min-h-0 w-full flex-1 border-0"
	></iframe>
	{#if sanitised.links.length > 0}
		<details class="shrink-0 border-t border-border">
			<summary class="caption cursor-pointer px-3 py-2">Links in this email</summary>
			<div class="max-h-40 space-y-2 overflow-y-auto px-3 pb-3">
				{#each sanitised.links as link (link.href)}
					<div class="flex flex-col items-start gap-1">
						{#if link.label !== link.href}
							<span class="small break-words">{link.label}</span>
						{/if}
						<Button
							variant="link"
							size="sm"
							class="h-auto justify-start p-0 text-left break-all whitespace-normal"
							onclick={() => openExternalHref(link.href)}
						>
							{link.href}
						</Button>
					</div>
				{/each}
			</div>
		</details>
	{/if}
</div>
