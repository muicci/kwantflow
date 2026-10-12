<script lang="ts">
	import kwantflowLogoUrl from '$lib/assets/branding/kwantflow-sidebar-mark.svg';
	import { isTauri } from '$lib/utils/env.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';

	export interface ConsentFeature {
		title: string;
		description: string;
	}

	export interface ConsentPrivacyNote {
		title: string;
		description: string;
	}

	let {
		open = $bindable(false),
		providerName = 'Google',
		providerLogo = '',
		title = `Connect ${providerName} Mail`,
		description = '',
		features = [] as ConsentFeature[],
		privacyNotes = [] as ConsentPrivacyNote[],
		consentText = `I agree to let Kwantflow connect to my ${providerName} account in accordance with the`,
		consentLinkLabel = '',
		consentHref = '',
		onconnect = () => {}
	}: {
		open?: boolean;
		providerName?: string;
		providerLogo: string;
		title?: string;
		description: string;
		features: ConsentFeature[];
		privacyNotes?: ConsentPrivacyNote[];
		consentText?: string;
		consentLinkLabel?: string;
		consentHref?: string;
		onconnect?: () => void;
	} = $props();

	const displayItems = $derived.by(() => {
		const items: { main: string; grey: string }[] = [];

		// Feature items — each as its own line
		for (const feature of features) {
			items.push({
				main: feature.title,
				grey: feature.description
			});
		}

		// Privacy notes — each as its own line
		for (const note of resolvedPrivacyNotes) {
			items.push({
				main: note.title,
				grey: note.description
			});
		}

		return items;
	});

	const defaultPrivacyNotes: ConsentPrivacyNote[] = [
		{
			title: 'Your data stays on device.',
			description:
				'RFQ processing and AI run locally. Email access and sending communicate directly with your provider.'
		},
		{
			title: "You're in control.",
			description: 'Disconnect anytime from your Connections settings.'
		},
		{
			title: 'Apps may introduce elevated risk.',
			description: 'Connect only mailboxes you intend to use in this workspace.'
		},
		{
			title: 'Data shared with this app.',
			description:
				'Kwantflow reads RFQ emails, manages message status, and sends quotes from your connected mailbox.'
		}
	];

	const resolvedPrivacyNotes = $derived(
		privacyNotes.length > 0 ? privacyNotes : defaultPrivacyNotes
	);

	function handleCancel(): void {
		open = false;
	}

	function handleConnect(): void {
		onconnect();
		open = false;
	}

	async function handleOpenLink(): Promise<void> {
		if (isTauri()) {
			const { openUrl } = await import('@tauri-apps/plugin-opener');
			await openUrl(consentHref);
		} else {
			window.open(consentHref, '_blank', 'noopener,noreferrer');
		}
	}
</script>

<AlertDialog.Root bind:open>
	<AlertDialog.Content class="max-w-[480px] overflow-hidden" style="padding: 0">
		<div class="relative overflow-hidden p-6 text-center">
			<!-- Wave background -->
			<div class="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden="true">
				<div class="wave-a absolute -top-8 -right-8 h-64 w-80 opacity-75"></div>
				<div class="wave-b absolute -top-4 -left-10 h-52 w-52 opacity-65"></div>
				<div class="wave-c absolute -bottom-4 -left-6 h-40 w-44 opacity-55"></div>
			</div>

			<!-- Close button -->
			<button
				onclick={handleCancel}
				class="muted absolute top-4 right-4 z-20 rounded-full p-1 transition-colors hover:bg-foreground/5 hover:text-foreground"
				aria-label="Close"
			>
				<svg class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>

			<div class="relative z-10">
				<!-- Logos -->
				<div class="mt-2 flex items-center justify-center gap-4">
					<div
						class="ui-radius-lg flex size-12 items-center justify-center border border-border/80 bg-white p-2.5"
					>
						<img src={kwantflowLogoUrl} alt="Kwantflow" class="size-6" />
					</div>
					<div class="h-6 w-px bg-border/80"></div>
					<div
						class="ui-radius-lg flex size-12 items-center justify-center border border-border/80 bg-white p-2.5"
					>
						<img src={providerLogo} alt={providerName} class="size-6" />
					</div>
				</div>

				<!-- Title & Description -->
				<AlertDialog.Title class="mt-4 text-foreground" style="font-size: 1.5rem"
					><strong>{title}</strong></AlertDialog.Title
				>
				{#if description}
					<AlertDialog.Description class="caption muted mx-auto mt-2 leading-normal">
						{description}
					</AlertDialog.Description>
				{/if}

				<div class="mt-5 flex justify-center">
					<Button
						onclick={handleConnect}
						variant="default"
						size="sm"
						class="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
					>
						<img src={providerLogo} alt="" class="size-4" aria-hidden="true" />
						Connect with {providerName}
					</Button>
				</div>
			</div>
		</div>

		<div class="px-6 pt-3 pb-6">
			{#if consentHref}
				<div class="flex items-center justify-between gap-3 pb-2">
					<p class="caption leading-normal select-none" style="color: var(--foreground)">
						{consentText}
						<!-- eslint-disable svelte/no-navigation-without-resolve -->
						<a
							href={consentHref}
							onclick={(e) => {
								if (isTauri()) {
									e.preventDefault();
									handleOpenLink();
								}
							}}
							target="_blank"
							rel="noopener noreferrer"
							class="underline"
							style="color: var(--foreground)"
						>
							{consentLinkLabel}
						</a><!-- eslint-enable svelte/no-navigation-without-resolve -->.
					</p>
				</div>
				<hr class="m-0 border-border/60" />
			{/if}

			{#if displayItems.length > 0}
				<div class="flex flex-col pt-2" style="gap: var(--space-1-5)">
					{#each displayItems as item (item.main)}
						<p class="caption leading-normal">
							<span style="color: var(--foreground)">{item.main}</span>
							{#if item.grey}
								<span style="color: var(--muted-foreground)"> {item.grey}</span>
							{/if}
						</p>
					{/each}
				</div>
			{/if}
		</div>
	</AlertDialog.Content>
</AlertDialog.Root>

<style>
	.wave-a {
		background: radial-gradient(
			ellipse 80% 60% at 60% 30%,
			hsl(204 100% 65%) 0%,
			hsl(204 100% 78%) 40%,
			transparent 70%
		);
	}
	.wave-b {
		background: radial-gradient(
			ellipse 70% 50% at 30% 20%,
			hsl(34 85% 76%) 0%,
			hsl(33 40% 84%) 35%,
			transparent 65%
		);
	}
	.wave-c {
		background: radial-gradient(
			ellipse 60% 50% at 20% 60%,
			hsl(214 87% 45%) 0%,
			hsl(204 100% 65%) 30%,
			transparent 60%
		);
	}
</style>
