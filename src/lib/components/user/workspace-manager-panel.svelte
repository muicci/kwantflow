<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import {
		FieldError,
		FieldLabel,
		FieldLabelRow,
		FieldShell,
		Meta,
		Text
	} from '$lib/components/primitives/index.js';
	import { errorState } from '$lib/state/errors.svelte.js';
	import {
		workspaceManagerState,
		DEFAULT_WORKSPACE_MANAGER_CREATE_VALUES,
		type WorkspaceManagerCreateValues
	} from '$lib/state/workspace-manager.svelte.js';
	import type { WorkspaceRegistryEntry } from '$lib/types/index.js';

	let createDialogOpen = $state(false);
	let deleteDialogOpen = $state(false);
	let createValues = $state<WorkspaceManagerCreateValues>({
		...DEFAULT_WORKSPACE_MANAGER_CREATE_VALUES
	});
	let createErrors = $state<Record<string, string[] | undefined>>({});
	let deleteConfirmation = $state('');
	let workspaceToDelete = $state<WorkspaceRegistryEntry | null>(null);
	let loaded = $state(false);

	$effect(() => {
		if (loaded) return;
		loaded = true;
		void workspaceManagerState.hydrate();
	});

	function openCreateDialog(): void {
		createValues = workspaceManagerState.buildCreateDefaults();
		createErrors = {};
		createDialogOpen = true;
	}

	function closeCreateDialog(): void {
		createDialogOpen = false;
		createErrors = {};
	}

	function promptDeleteWorkspace(workspace: WorkspaceRegistryEntry): void {
		workspaceToDelete = workspace;
		deleteConfirmation = '';
		deleteDialogOpen = true;
	}

	function closeDeleteDialog(): void {
		deleteDialogOpen = false;
		workspaceToDelete = null;
		deleteConfirmation = '';
	}

	async function handleSwitchWorkspace(workspaceId: string): Promise<void> {
		try {
			await goto(resolve('/'), { replaceState: true });
			await workspaceManagerState.switchWorkspace(workspaceId);
			await goto(resolve('/'), { replaceState: true });
			toast.success('Workspace opened');
		} catch (error) {
			await errorState.catchError(error, 'Switch workspace');
		}
	}

	async function handleCreateWorkspace(): Promise<void> {
		createErrors = {};
		createValues.workspaceName = createValues.workspaceName.trim();
		if (!createValues.workspaceName) {
			createErrors.workspaceName = ['Workspace name is required'];
			return;
		}

		try {
			await goto(resolve('/'), { replaceState: true });
			const created = await workspaceManagerState.createWorkspace(createValues);
			await goto(resolve('/'), { replaceState: true });
			toast.success(`Created ${created.displayName}`);
			closeCreateDialog();
		} catch (error) {
			await errorState.catchError(error, 'Create workspace');
		}
	}

	async function handleDeleteWorkspace(): Promise<void> {
		if (!workspaceToDelete) return;
		try {
			const deletingActiveWorkspace =
				workspaceToDelete.id === workspaceManagerState.activeWorkspaceId;
			if (deletingActiveWorkspace) {
				await goto(resolve('/'), { replaceState: true });
			}
			await workspaceManagerState.deleteWorkspace(workspaceToDelete.id, deleteConfirmation);
			if (deletingActiveWorkspace) {
				await goto(resolve('/'), { replaceState: true });
			}
			toast.success('Workspace deleted');
			closeDeleteDialog();
		} catch (error) {
			await errorState.catchError(error, 'Delete workspace');
		}
	}
</script>

<div class="space-y-3">
	<div class="flex items-center justify-between gap-3">
		<div class="min-w-0 space-y-1">
			<FieldLabelRow tooltip="Create, switch, rename, and delete local workspaces on this device.">
				Workspace Manager
			</FieldLabelRow>
		</div>
		<Button
			variant="secondary"
			size="sm"
			class="gap-2"
			title="Create a local workspace"
			disabled={workspaceManagerState.isCreating || workspaceManagerState.isSwitching}
			onclick={openCreateDialog}
		>
			<PlusIcon class="size-4" />
			New workspace
		</Button>
	</div>
	{#each workspaceManagerState.workspaces as workspace (workspace.id)}
		<div class="ui-note-panel flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
			<div class="min-w-0 space-y-1">
				<Text>{workspace.displayName}</Text>
				<div class="flex flex-wrap items-center gap-2">
					<Meta
						>{workspace.id === workspaceManagerState.activeWorkspaceId
							? 'Current workspace'
							: 'Available workspace'}</Meta
					>
					{#if workspace.isDefault}
						<Meta>Default</Meta>
					{/if}
					{#if workspace.lastOpenedAt}
						<Meta>Opened {new Date(workspace.lastOpenedAt).toLocaleString()}</Meta>
					{/if}
				</div>
			</div>
			<div class="flex flex-wrap items-center gap-2 md:justify-end">
				<Button
					variant={workspace.id === workspaceManagerState.activeWorkspaceId ? 'secondary' : 'brand'}
					size="sm"
					class={workspace.id === workspaceManagerState.activeWorkspaceId
						? 'ui-integration-btn'
						: ''}
					disabled={workspace.id === workspaceManagerState.activeWorkspaceId ||
						workspaceManagerState.isSwitching}
					loading={workspaceManagerState.switchingWorkspaceId === workspace.id}
					loadingLabel="Opening"
					onclick={() => void handleSwitchWorkspace(workspace.id)}
				>
					{workspace.id === workspaceManagerState.activeWorkspaceId ? 'Current' : 'Open'}
				</Button>
				<Button
					variant="destructiveSoft"
					size="sm"
					disabled={!workspaceManagerState.canDeleteWorkspace || workspaceManagerState.isDeleting}
					onclick={() => promptDeleteWorkspace(workspace)}
				>
					<Trash2Icon class="size-3.5" />
					Delete
				</Button>
			</div>
		</div>
	{/each}
</div>

<Dialog.Root bind:open={createDialogOpen}>
	<Dialog.Content class="ui-dialog-size-xl">
		<Dialog.Header>
			<Dialog.Title>Create Workspace</Dialog.Title>
			<Dialog.Description>
				Name the local workspace. Business profile details can be added later in Settings.
			</Dialog.Description>
		</Dialog.Header>
		<div class="flex flex-col gap-5">
			<FieldShell>
				<FieldLabel for="workspace-manager-workspace-name">Workspace Name</FieldLabel>
				<Input
					id="workspace-manager-workspace-name"
					bind:value={createValues.workspaceName}
					size="default"
					invalidTone={createErrors.workspaceName?.length ? 'destructive' : 'neutral'}
					placeholder="e.g. North Yard"
					onblur={() => {
						createValues.workspaceName = createValues.workspaceName.trim();
					}}
				/>
				<FieldError errors={createErrors.workspaceName} />
			</FieldShell>
		</div>
		<Dialog.Footer density="compact">
			<Button variant="secondary" size="sm" onclick={closeCreateDialog}>Cancel</Button>
			<Button
				variant="brand"
				size="sm"
				disabled={workspaceManagerState.isCreating}
				loading={workspaceManagerState.isCreating}
				loadingLabel="Creating"
				onclick={() => void handleCreateWorkspace()}
			>
				Create Workspace
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<AlertDialog.Root bind:open={deleteDialogOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete Workspace</AlertDialog.Title>
			<AlertDialog.Description>
				This permanently removes the workspace database and files on this device. Type the workspace
				name to confirm.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<div class="space-y-4">
			<div class="ui-note-panel space-y-1">
				<Text>{workspaceToDelete?.displayName ?? 'Workspace'}</Text>
			</div>
			<FieldShell>
				<FieldLabel for="workspace-manager-delete-confirmation">Confirm Workspace Name</FieldLabel>
				<Input
					id="workspace-manager-delete-confirmation"
					bind:value={deleteConfirmation}
					size="default"
					placeholder={workspaceToDelete?.displayName ?? 'Type workspace name'}
				/>
			</FieldShell>
		</div>
		<AlertDialog.Footer>
			<AlertDialog.Cancel onclick={closeDeleteDialog}>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				onclick={() => void handleDeleteWorkspace()}
				disabled={workspaceManagerState.isDeleting}
			>
				Delete Workspace
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
