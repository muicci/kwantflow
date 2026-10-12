<script lang="ts">
	import BriefcaseIcon from '@lucide/svelte/icons/briefcase';
	import LayersIcon from '@lucide/svelte/icons/layers';
	import CompassIcon from '@lucide/svelte/icons/compass';
	import InboxIcon from '@lucide/svelte/icons/inbox';
	import MailIcon from '@lucide/svelte/icons/mail';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import { appState } from '$lib/state/app.svelte.js';
	import { projectsState } from '$lib/state/projects.svelte.js';
	import { integrationsState } from '$lib/state/integrations.svelte.js';
	import type { SidebarPanelId } from '$lib/constants/sidebar.js';

	const sidebar = Sidebar.useSidebar();

	type PanelOption = {
		id: SidebarPanelId;
		label: string;
		icon: typeof CompassIcon;
		provider?: 'google_gmail' | 'microsoft_outlook';
	};

	const hasExplorerContent = $derived(
		projectsState.list.some((project) => (project.asset_count ?? 0) > 0)
	);
	const panelOptions = $derived.by<PanelOption[]>(() => {
		const options: PanelOption[] = [{ id: 'pages', label: 'Pages', icon: CompassIcon }];
		if (integrationsState.isGoogleConnected) {
			options.push({
				id: 'mail',
				label: 'Gmail',
				icon: InboxIcon,
				provider: 'google_gmail'
			});
		}
		if (integrationsState.isMicrosoftConnected) {
			options.push({
				id: 'mail',
				label: 'Outlook',
				icon: MailIcon,
				provider: 'microsoft_outlook'
			});
		}
		options.push({ id: 'projects', label: 'Projects', icon: BriefcaseIcon });
		if (hasExplorerContent) {
			options.push({ id: 'explorer', label: 'Explorer', icon: LayersIcon });
		}
		return options;
	});

	function panelButtonClass(option: PanelOption): string {
		const isActive =
			appState.activeSidebarPanel === option.id &&
			(option.id !== 'mail' ||
				!option.provider ||
				integrationsState.activeMailProvider === option.provider);
		return isActive
			? 'bg-sidebar-accent text-sidebar-accent-foreground'
			: 'text-sidebar-foreground/70 hover-surface-sidebar-accent hover:text-sidebar-accent-foreground';
	}

	$effect(() => {
		if (!hasExplorerContent && appState.activeSidebarPanel === 'explorer') {
			void appState.setSidebarPanel('projects');
		}
	});

	$effect(() => {
		if (!integrationsState.isEmailConnected && appState.activeSidebarPanel === 'mail') {
			void appState.setSidebarPanel('pages');
		}
	});

	$effect(() => {
		if (appState.activeSidebarPanel === 'mail') {
			if (
				integrationsState.activeMailProvider === 'google_gmail' &&
				!integrationsState.isGoogleConnected &&
				integrationsState.isMicrosoftConnected
			) {
				integrationsState.activeMailProvider = 'microsoft_outlook';
			} else if (
				integrationsState.activeMailProvider === 'microsoft_outlook' &&
				!integrationsState.isMicrosoftConnected &&
				integrationsState.isGoogleConnected
			) {
				integrationsState.activeMailProvider = 'google_gmail';
			}
		}
	});
</script>

<div class="flex shrink-0 items-center justify-between gap-2 px-2 py-2">
	<div class="flex items-center gap-1">
		{#each panelOptions as option (option.label)}
			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="ghost"
							size="icon"
							class={`ui-radius-tight size-7 ${panelButtonClass(option)}`}
							type="button"
							aria-label={option.label}
							aria-pressed={appState.activeSidebarPanel === option.id &&
								(option.id !== 'mail' ||
									!option.provider ||
									integrationsState.activeMailProvider === option.provider)}
							onclick={() => {
								if (option.id === 'mail' && option.provider) {
									integrationsState.activeMailProvider = option.provider;
									void integrationsState.fetchEmailMessages();
								}
								void appState.setSidebarPanel(option.id);
							}}
						>
							<option.icon class="size-4" strokeWidth={1.5} />
							<span class="sr-only">{option.label}</span>
						</Button>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content side="right" sideOffset={8}>{option.label}</Tooltip.Content>
			</Tooltip.Root>
		{/each}
	</div>
</div>
