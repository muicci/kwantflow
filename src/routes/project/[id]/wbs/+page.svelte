<script lang="ts">
	import WbsTable from '$lib/components/wbs/wbs-table.svelte';
	import ProjectStructureTemplateEditorDialog from '$lib/components/wbs/project-structure-template-editor-dialog.svelte';
	import ProjectStructureTemplatesTable from '$lib/components/wbs/project-structure-templates-table.svelte';
	import { Text } from '$lib/components/primitives/index.js';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import { wbsState } from '$lib/state/wbs.svelte.js';
	import { projectStructureTemplatesState } from '$lib/state/project-structure-templates.svelte.js';

	let { data } = $props();
	let activeTab = $state<'project' | 'templates'>('project');
	let saveTemplateOpen = $state(false);
	const projectHasStructure = $derived(wbsState.list.length > 0);

	$effect(() => {
		void wbsState.hydrate(data.project.id);
		void projectStructureTemplatesState.hydrate();
	});

	async function handleTemplateApplied() {
		activeTab = 'project';
		await wbsState.refresh();
	}
</script>

<div class="ui-route-frame">
	<div class="ui-page-content">
		<Tabs.Root bind:value={activeTab} class="ui-table-page flex min-h-0 flex-1 flex-col gap-4">
			<div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start lg:gap-4">
				<div class="min-w-0 space-y-1.5">
					<h1 class="h3">Project Structure</h1>
					<Text as="p" tone="muted" class="max-w-4xl">
						Organise this project by phase, level, room, or custom structure with optional reusable
						templates.
					</Text>
				</div>

				<Tabs.List aria-label="Project structure views" class="self-start lg:justify-self-end">
					<Tabs.Trigger value="project">Project</Tabs.Trigger>
					<Tabs.Trigger value="templates">Templates</Tabs.Trigger>
				</Tabs.List>
			</div>

			<Tabs.Content value="project" class="flex min-h-0 flex-1 flex-col">
				<WbsTable
					projectId={data.project.id}
					onBrowseTemplates={() => (activeTab = 'templates')}
					onSaveTemplate={() => (saveTemplateOpen = true)}
				/>
			</Tabs.Content>

			<Tabs.Content value="templates" class="flex min-h-0 flex-1 flex-col">
				<ProjectStructureTemplatesTable
					projectId={data.project.id}
					{projectHasStructure}
					onApplied={handleTemplateApplied}
				/>
			</Tabs.Content>
		</Tabs.Root>
	</div>
</div>

<ProjectStructureTemplateEditorDialog bind:open={saveTemplateOpen} sourceNodes={wbsState.list} />
