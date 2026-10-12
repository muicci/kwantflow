<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import MonitorCogIcon from '@lucide/svelte/icons/monitor-cog';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import SunIcon from '@lucide/svelte/icons/sun';
	import Settings2Icon from '@lucide/svelte/icons/settings-2';
	import CheckIcon from '@lucide/svelte/icons/check';
	import LoaderIcon from '@lucide/svelte/icons/loader';
	import BriefcaseBusinessIcon from '@lucide/svelte/icons/briefcase-business';
	import { Meta, Text } from '$lib/components/primitives/index.js';
	import * as Avatar from '$lib/components/ui/avatar/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { getVaultImagePreviewUrl } from '$lib/services/assets.js';
	import { appState } from '$lib/state/app.svelte.js';
	import { workspaceState } from '$lib/state/workspace.svelte.js';
	import { workspaceManagerState } from '$lib/state/workspace-manager.svelte.js';
	import { errorState } from '$lib/state/errors.svelte.js';

	let {
		user,
		variant = 'sidebar',
		open = $bindable(false),
		triggerClassName = ''
	}: {
		user: { name: string; email: string; avatar: string };
		variant?: 'sidebar' | 'toolbar';
		open?: boolean;
		triggerClassName?: string;
	} = $props();

	const sidebar = Sidebar.useSidebar();
	let managerHydrated = $state(false);
	let workspaceLogoPreviewUrl = $state('');
	const hasWorkspaceSwitchOptions = $derived(workspaceManagerState.workspaces.length > 1);
	const avatarSrc = $derived(workspaceLogoPreviewUrl || user.avatar);
	const userInitials = $derived(getUserInitials(user.name));

	function getUserInitials(name: string): string {
		const words = name.trim().split(/\s+/).filter(Boolean);
		const letters =
			words.length > 1 ? words.slice(0, 2).map((word) => word[0]) : words[0]?.slice(0, 2);
		const initials = Array.isArray(letters) ? letters.join('') : letters;
		return (initials || 'WO').toUpperCase();
	}

	$effect(() => {
		if (managerHydrated) return;
		managerHydrated = true;
		void workspaceManagerState.hydrate();
	});

	$effect(() => {
		const logoFilePath = workspaceState.logoFilePath?.trim();
		let cancelled = false;
		let objectUrl: string | null = null;

		if (!logoFilePath) {
			workspaceLogoPreviewUrl = '';
			return;
		}

		void (async () => {
			const preview = await getVaultImagePreviewUrl(logoFilePath);
			if (cancelled) {
				URL.revokeObjectURL(preview);
				return;
			}
			objectUrl = preview;
			workspaceLogoPreviewUrl = preview;
		})();

		return () => {
			cancelled = true;
			workspaceLogoPreviewUrl = '';
			if (objectUrl) URL.revokeObjectURL(objectUrl);
		};
	});

	async function switchWorkspace(workspaceId: string): Promise<void> {
		try {
			await goto(resolve('/'), { replaceState: true });
			await workspaceManagerState.switchWorkspace(workspaceId);
			await goto(resolve('/'), { replaceState: true });
		} catch (error) {
			await errorState.catchError(error, 'Switch workspace');
		}
	}
</script>

<DropdownMenu.Root bind:open>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			{#if variant === 'sidebar'}
				<Sidebar.Menu class="w-full">
					<Sidebar.MenuItem>
						<Sidebar.MenuButton
							{...props}
							size="lg"
							class="group-data-[collapsible=icon]:control-height-md data-[state=open]:surface-sidebar-accent h-auto min-h-12 overflow-visible group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0 data-[state=open]:text-sidebar-accent-foreground"
						>
							<Avatar.Root class="ui-radius-md size-8 grayscale">
								<Avatar.Image src={avatarSrc} alt={user.name} />
								<Avatar.Fallback class="ui-radius-md">{userInitials}</Avatar.Fallback>
							</Avatar.Root>
							<div class="grid flex-1 gap-0.5 text-start group-data-[collapsible=icon]:hidden">
								<Text as="span" class="truncate">{user.name}</Text>
								<Meta as="span" class="truncate">
									{user.email}
								</Meta>
							</div>
						</Sidebar.MenuButton>
					</Sidebar.MenuItem>
				</Sidebar.Menu>
			{:else}
				<Button
					aria-label="Open user menu"
					{...props}
					variant="ghost"
					size="icon"
					class={`surface-overlay-soft hover-surface-accent-strong ui-button-radius size-7 border border-border/70 p-0 backdrop-blur-sm ${triggerClassName}`.trim()}
					type="button"
				>
					<Avatar.Root class="ui-radius-pill size-6 grayscale">
						<Avatar.Image src={avatarSrc} alt={user.name} />
						<Avatar.Fallback class="avatar-initials ui-radius-pill">{userInitials}</Avatar.Fallback>
					</Avatar.Root>
					<span class="sr-only">Open user menu</span>
				</Button>
			{/if}
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content
		class={variant === 'sidebar' ? 'w-(--bits-dropdown-menu-anchor-width) min-w-56' : 'min-w-56'}
		side={variant === 'sidebar' ? (sidebar.isMobile ? 'bottom' : 'right') : 'bottom'}
		align="end"
		sideOffset={variant === 'sidebar' ? 4 : 8}
	>
		<DropdownMenu.Label class="p-0">
			<div class="flex items-center gap-2 px-1 py-1.5 text-start">
				<Avatar.Root
					class={variant === 'sidebar' ? 'ui-radius-md size-8' : 'ui-radius-pill size-8'}
				>
					<Avatar.Image src={avatarSrc} alt={user.name} />
					<Avatar.Fallback class={variant === 'sidebar' ? 'ui-radius-md' : 'ui-radius-pill'}>
						{userInitials}
					</Avatar.Fallback>
				</Avatar.Root>
				<div class="grid flex-1 gap-0.5 text-start">
					<Text as="span" class="truncate">{user.name}</Text>
					<Meta as="span" class="truncate">
						{user.email}
					</Meta>
				</div>
			</div>
		</DropdownMenu.Label>
		{#if hasWorkspaceSwitchOptions}
			<DropdownMenu.Separator />
			<DropdownMenu.Sub>
				<DropdownMenu.SubTrigger>
					<BriefcaseBusinessIcon class="size-4" />
					Switch workspace
				</DropdownMenu.SubTrigger>
				<DropdownMenu.SubContent class="ui-menu-width-md">
					{#each workspaceManagerState.workspaces as workspace (workspace.id)}
						<DropdownMenu.Item
							disabled={workspaceManagerState.isSwitching ||
								workspace.id === workspaceManagerState.activeWorkspaceId}
							onclick={() => void switchWorkspace(workspace.id)}
						>
							{#if workspaceManagerState.switchingWorkspaceId === workspace.id}
								<LoaderIcon class="size-4 animate-spin" />
							{:else if workspace.id === workspaceManagerState.activeWorkspaceId}
								<CheckIcon class="size-4" />
							{:else}
								<span class="size-4" aria-hidden="true"></span>
							{/if}
							{workspace.displayName}
						</DropdownMenu.Item>
					{/each}
				</DropdownMenu.SubContent>
			</DropdownMenu.Sub>
		{/if}

		<DropdownMenu.Separator />
		<DropdownMenu.Group>
			<DropdownMenu.Item onclick={() => appState.openSettingsDialog()}>
				<Settings2Icon />
				Settings
			</DropdownMenu.Item>
		</DropdownMenu.Group>

		<DropdownMenu.Separator />
		<DropdownMenu.Sub>
			<DropdownMenu.SubTrigger>
				<MonitorCogIcon class="size-4" />
				Theme
			</DropdownMenu.SubTrigger>
			<DropdownMenu.SubContent class="ui-menu-width">
				<DropdownMenu.RadioGroup value={appState.themePreference}>
					<DropdownMenu.RadioItem
						value="light"
						onclick={() => void appState.setThemePreference('light')}
					>
						<SunIcon class="size-4" />
						Light
					</DropdownMenu.RadioItem>
					<DropdownMenu.RadioItem
						value="dark"
						onclick={() => void appState.setThemePreference('dark')}
					>
						<MoonIcon class="size-4" />
						Dark
					</DropdownMenu.RadioItem>
					<DropdownMenu.RadioItem
						value="system"
						onclick={() => void appState.setThemePreference('system')}
					>
						<MonitorCogIcon class="size-4" />
						System
					</DropdownMenu.RadioItem>
				</DropdownMenu.RadioGroup>
			</DropdownMenu.SubContent>
		</DropdownMenu.Sub>
	</DropdownMenu.Content>
</DropdownMenu.Root>
