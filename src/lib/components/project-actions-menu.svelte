<script lang="ts">
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import IntakeDialog from './intake/intake-dialog.svelte';
	import FolderIcon from '@lucide/svelte/icons/folder';
	import CopyIcon from '@tabler/icons-svelte/icons/copy';
	import ArchiveIcon from '@lucide/svelte/icons/archive';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import Settings2Icon from '@lucide/svelte/icons/settings-2';

	import { projectsState } from '$lib/state/projects.svelte.js';
	import { appState } from '$lib/state/app.svelte.js';
	import type { Project } from '$lib/types/index.js';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import type { Snippet } from 'svelte';
	import { ProjectStatus } from '$lib/constants/index.js';

	type DropdownSide = 'top' | 'right' | 'bottom' | 'left';
	type DropdownAlign = 'start' | 'center' | 'end';
	type AppHref = `/project/${string}`;

	let {
		project,
		triggerSnippet,
		onAction = () => {},
		onEditRequest,
		onDeleteRequest,
		dropdownSide = 'bottom',
		dropdownAlign = 'start'
	}: {
		project: Project;
		triggerSnippet: Snippet<[{ props: Record<string, unknown> }]>;
		onAction?: () => void;
		onEditRequest?: (project: Project) => void;
		onDeleteRequest?: (project: Project) => void;
		dropdownSide?: DropdownSide;
		dropdownAlign?: DropdownAlign;
	} = $props();

	let isEditDialogOpen = $state(false);
	let isArchiveDialogOpen = $state(false);
	let isDeleteDialogOpen = $state(false);
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			{@render triggerSnippet({ props })}
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content class="ui-radius-lg w-48" side={dropdownSide} align={dropdownAlign}>
		<DropdownMenu.Item
			onclick={() => {
				onAction();
				if (onEditRequest) {
					onEditRequest(project);
					return;
				}
				setTimeout(() => {
					isEditDialogOpen = true;
				}, 0);
			}}
		>
			<Settings2Icon class="muted size-3.5" />
			<span>Edit RFQ</span>
		</DropdownMenu.Item>
		<DropdownMenu.Item
			onclick={() => {
				onAction();
				const full = projectsState.list.find((p) => p.id === project.id);
				if (full) {
					projectsState.setActive(full);
				}
				appState.prepareForWorkspaceEntry();
				goto(resolve(`/project/${project.id}` as AppHref));
			}}
		>
			<FolderIcon class="muted size-3.5" />
			<span>Open Workspace</span>
		</DropdownMenu.Item>
		<DropdownMenu.Item
			class="gap-2"
			onclick={() => {
				onAction();
				void projectsState.duplicateProject(project.id);
			}}
		>
			<CopyIcon class="muted size-3.5" />
			<span>Duplicate RFQ</span>
		</DropdownMenu.Item>
		<DropdownMenu.Separator />
		{#if project.status === ProjectStatus.Archived}
			<DropdownMenu.Item
				class="gap-2"
				onclick={() => {
					onAction();
					void projectsState.restoreProject(project.id);
				}}
			>
				<RotateCcwIcon class="muted size-3.5" />
				<span>Restore RFQ</span>
			</DropdownMenu.Item>
			<DropdownMenu.Item
				variant="destructive"
				onclick={() => {
					onAction();
					if (onDeleteRequest) {
						onDeleteRequest(project);
						return;
					}
					setTimeout(() => {
						isDeleteDialogOpen = true;
					}, 0);
				}}
			>
				<Trash2Icon class="muted size-3.5" />
				<span>Delete RFQ</span>
			</DropdownMenu.Item>
		{:else}
			<DropdownMenu.Item
				class="menu-item-destructive gap-2"
				onclick={() => {
					onAction();
					setTimeout(() => {
						isArchiveDialogOpen = true;
					}, 0);
				}}
			>
				<ArchiveIcon class="size-3.5" />
				<span>Archive RFQ</span>
			</DropdownMenu.Item>
		{/if}
	</DropdownMenu.Content>
</DropdownMenu.Root>

<IntakeDialog bind:open={isEditDialogOpen} {project} hideTrigger={true} />

<AlertDialog.Root bind:open={isArchiveDialogOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Archive RFQ?</AlertDialog.Title>
			<AlertDialog.Description>
				This moves <strong>{project.rfq_number}</strong> out of the default RFQ list. You can restore
				it later or delete it permanently from the archived view.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel onclick={() => (isArchiveDialogOpen = false)}>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				variant="destructive"
				onclick={() => {
					projectsState.archiveProject(project.id);
					isArchiveDialogOpen = false;
				}}
			>
				Archive RFQ
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root bind:open={isDeleteDialogOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete RFQ?</AlertDialog.Title>
			<AlertDialog.Description>
				This action cannot be undone. This will permanently delete the archived RFQ <strong
					>{project.rfq_number}</strong
				> and remove all associated data.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel onclick={() => (isDeleteDialogOpen = false)}>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				variant="destructive"
				onclick={() => {
					projectsState.deleteProject(project.id);
					isDeleteDialogOpen = false;
				}}
			>
				Delete RFQ
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
