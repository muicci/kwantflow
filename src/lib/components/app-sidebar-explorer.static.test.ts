import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string) =>
	readFileSync(join(process.cwd(), relativePath), 'utf8');

describe('explorer sidebar shell', () => {
	it('wires the explorer panel into the sidebar shell and rail', () => {
		const sidebarSource = readSource('src/lib/components/app-sidebar.svelte');
		const railSource = readSource('src/lib/components/app-sidebar-panel-rail.svelte');
		const panelSource = readSource('src/lib/components/app-sidebar-explorer-panel.svelte');
		const previewSource = readSource('src/routes/preview/file/[fileId]/+page.svelte');
		const workspaceViewerSource = readSource('src/lib/components/assets/MultiFileViewer.svelte');
		const singleViewerSource = readSource('src/lib/components/assets/single-file-viewer.svelte');

		expect(sidebarSource).toContain(
			"import AppSidebarExplorerPanel from './app-sidebar-explorer-panel.svelte';"
		);
		expect(sidebarSource).toContain("{:else if appState.activeSidebarPanel === 'projects'}");
		expect(sidebarSource).toContain('<AppSidebarExplorerPanel');
		expect(railSource).toContain("label: 'Explorer'");
		expect(railSource).toContain("id: 'explorer'");
		expect(panelSource).toContain('href={resolve(`/preview/file/${file.id}`)}');
		expect(panelSource).not.toContain('projectsState.getProjectFiles(');
		expect(panelSource).toContain('placeholder="Search..."');
		expect(panelSource).toContain("import { appTabsState } from '$lib/state/app-tabs.svelte.js';");
		expect(panelSource).toContain("import { ProjectStatus } from '$lib/constants/index.js';");
		expect(panelSource).toContain("import FileIcon from '@lucide/svelte/icons/file';");
		expect(panelSource).toContain("import FolderIcon from '@lucide/svelte/icons/folder';");
		expect(panelSource).toContain("import FolderOpenIcon from '@lucide/svelte/icons/folder-open';");
		expect(panelSource).toContain('<Text');
		expect(panelSource).toContain('class={`min-w-0 flex-1 truncate text-start ${');
		expect(panelSource).toContain('entry.project.status === ProjectStatus.Archived');
		expect(panelSource).toContain('Archived</span>');
		expect(panelSource).toContain('const activeFileId = $derived(');
		expect(panelSource).toContain("appTabsState.activeTab?.kind === 'file-preview'");
		expect(panelSource).toContain('appTabsState.activeTab.fileId');
		expect(panelSource).toContain('await appState.getExplorerTreeState()');
		expect(panelSource).toContain('void appState.setExplorerTreeState({');
		expect(panelSource).toContain('if (!hasHydratedTreeState || searchActive) return;');
		expect(panelSource).toContain('void explorerState.loadProjectBranch(projectId);');
		expect(panelSource).toContain('let collapsedAssetIds = $state.raw<string[]>([]);');
		expect(panelSource).toContain('function toggleAsset(assetId: string): void {');
		expect(panelSource).toContain(
			'{@const branchLoaded = explorerState.projectChildren[entry.project.id]?.loaded ?? false}'
		);
		expect(panelSource).toContain(
			'{@const showAssetFiles = searchActive || !isAssetCollapsed(assetEntry.asset.id)}'
		);
		expect(panelSource).toContain('{#if isProjectLoading(entry.project.id) || !branchLoaded}');
		expect(panelSource).toContain('{@const isActiveFile = activeFileId === file.id}');
		expect(panelSource).toContain('<FolderIcon class="size-4" />');
		expect(panelSource).toContain('<FolderOpenIcon class="size-4" />');
		expect(panelSource).toContain('<FileIcon class="size-4" />');
		expect(panelSource).not.toContain('Standalone file');
		expect(previewSource).not.toContain('Explorer preview');
		expect(previewSource).toContain(
			"import SingleFileViewer from '$lib/components/assets/single-file-viewer.svelte';"
		);
		expect(previewSource).not.toContain(
			"import PDFViewer from '$lib/components/assets/pdf-viewer.svelte';"
		);
		expect(workspaceViewerSource).toContain(
			"import SingleFileViewer from './single-file-viewer.svelte';"
		);
		expect(workspaceViewerSource).not.toContain("import PDFViewer from './pdf-viewer.svelte';");
		expect(singleViewerSource).toContain("{#await import('./pdf-viewer.svelte')");
		expect(singleViewerSource).toContain("{#await import('./text-viewer.svelte')");
		expect(singleViewerSource).toContain("{#await import('./document-viewer.svelte')");
		expect(singleViewerSource).toContain("{#await import('./spreadsheet-viewer.svelte')");
		expect(singleViewerSource).not.toContain("previewKind === 'converted'");
	});
});
