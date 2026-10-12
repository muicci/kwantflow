import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('detached preview shell wiring', () => {
	it('bypasses the normal app shell when running inside the detached preview window', () => {
		const source = readFileSync(join(process.cwd(), 'src/routes/+layout.svelte'), 'utf8');

		expect(source).toContain('getCurrentWindow().label');
		expect(source).toContain('DETACHED_ASSET_PREVIEW_WINDOW_LABEL');
		expect(source).toContain(
			"const detachedPreviewRouteId = '/preview/asset/[projectId]/[assetId]';"
		);
		expect(source).toContain(
			'const detachedPreviewPathnamePattern = /^\\/preview\\/asset\\/[^/]+\\/[^/]+\\/?$/;'
		);
		expect(source).toContain('{:else if isDetachedPreviewSurface && !appState.bootFailureMessage}');
		expect(source).toContain('currentWindowLabel === DETACHED_ASSET_PREVIEW_WINDOW_LABEL');
		expect(source).toContain('const isDetachedPreviewSurface = $derived(');
		expect(source).toContain('<div class="ui-detached-shell">');
		expect(source).toContain('<div class="flex min-h-0 flex-1 flex-col overflow-hidden">');
		expect(source).toContain('{@render children()}');
	});

	it('coordinates detached preview lifecycle from the main shell layout', () => {
		const source = readFileSync(join(process.cwd(), 'src/routes/+layout.svelte'), 'utf8');

		expect(source).toContain('resolveDetachedAssetPreviewTarget(routeId, page.data)');
		expect(source).toContain('detachedAssetPreviewWindowService.isOpen()');
		expect(source).toContain("window.addEventListener('focus', handleMainWindowFocus);");
		expect(source).toContain("window.removeEventListener('focus', handleMainWindowFocus);");
		expect(source).toContain('ASSET_PREVIEW_REQUEST_SYNC_EVENT');
		expect(source).toContain('ASSET_PREVIEW_SELECTION_CHANGED_EVENT');
		expect(source).toContain('ASSET_PREVIEW_CLOSED_EVENT');
		expect(source).toContain('void assetPreviewState.followAsset(target);');
		expect(source).toContain('assetPreviewState.finalizeDetachedSession()');
	});

	it('uses the standalone detached preview route instead of the project workspace shell', () => {
		const serviceSource = readFileSync(
			join(process.cwd(), 'src/lib/services/detached-asset-preview-window.ts'),
			'utf8'
		);
		const standaloneRouteSource = readFileSync(
			join(process.cwd(), 'src/routes/preview/asset/[projectId]/[assetId]/+page.svelte'),
			'utf8'
		);
		const standaloneLoadSource = readFileSync(
			join(process.cwd(), 'src/routes/preview/asset/[projectId]/[assetId]/+page.ts'),
			'utf8'
		);

		expect(serviceSource).toContain(
			'export type DetachedAssetPreviewRoute = `/preview/asset/${string}/${string}`;'
		);
		expect(serviceSource).toContain('return `/preview/asset/${projectId}/${assetId}`;');
		expect(standaloneLoadSource).toContain('export const ssr = false;');
		expect(standaloneLoadSource).toContain('projectId: params.projectId');
		expect(standaloneLoadSource).toContain('assetId: params.assetId');
		expect(standaloneRouteSource).toContain(
			"import { projectsState } from '$lib/state/projects.svelte.js';"
		);
		expect(standaloneRouteSource).toContain('function setDocumentTitle(title: string): void {');
		expect(standaloneRouteSource).toContain('document.title = title;');
		expect(standaloneRouteSource).toContain(
			"const previewTitle = `Preview • ${asset?.display_name ?? 'Preview'}`;"
		);
		expect(standaloneRouteSource).toContain(
			'<div class="flex h-full min-h-0 flex-1 flex-col overflow-hidden">'
		);
		expect(standaloneRouteSource).toContain('void loadAsset(data.projectId, data.assetId);');
		expect(standaloneRouteSource).toContain(
			"emitTo('main', ASSET_PREVIEW_REQUEST_SYNC_EVENT, { assetId })"
		);
		expect(standaloneRouteSource).toContain("emitTo('main', ASSET_PREVIEW_CLOSED_EVENT, {");
	});

	it('uses window close as the single return-to-main path for the detached preview route', () => {
		const source = readFileSync(
			join(process.cwd(), 'src/routes/preview/asset/[projectId]/[assetId]/+page.svelte'),
			'utf8'
		);

		expect(source).toContain('let isClosing = $state(false);');
		expect(source).toContain('async function notifyMainWindowPreviewClosed() {');
		expect(source).toContain('await notifyMainWindowPreviewClosed();');
		expect(source).toContain('await currentWindow.close();');
		expect(source).toContain('await currentWindow.setFullscreen(!fullscreen);');
		expect(source).toContain('fullscreen = await currentWindow.isFullscreen();');
		expect(source).toContain('if (isClosing) return;');
		expect(source).toContain('event.preventDefault();');
		expect(source).toContain('currentWindow.onCloseRequested(async (event) => {');
	});

	it('threads detached mode through file viewers and hides no-op expand actions', () => {
		const routeSource = readFileSync(
			join(process.cwd(), 'src/routes/preview/file/[fileId]/+page.svelte'),
			'utf8'
		);
		const singleFileViewerSource = readFileSync(
			join(process.cwd(), 'src/lib/components/assets/single-file-viewer.svelte'),
			'utf8'
		);
		const viewerFiles = [
			'src/lib/components/assets/cad-viewer.svelte',
			'src/lib/components/assets/pdf-viewer.svelte',
			'src/lib/components/assets/image-viewer.svelte',
			'src/lib/components/assets/text-viewer.svelte',
			'src/lib/components/assets/document-viewer.svelte',
			'src/lib/components/assets/spreadsheet-viewer.svelte'
		];

		expect(routeSource).toContain('allowExpand={false}');
		expect(singleFileViewerSource).toContain('allowExpand?: boolean;');
		expect(singleFileViewerSource).toContain('allowExpand = true,');
		expect(singleFileViewerSource).toContain('{allowExpand}');
		expect(singleFileViewerSource).toContain('detached?: boolean;');
		expect(singleFileViewerSource).toContain('detached = false,');
		expect(singleFileViewerSource).toContain('{detached}');
		expect(singleFileViewerSource).toContain(
			'<div class="ui-viewer-shell flex h-full min-h-0 flex-1 flex-col">'
		);

		for (const file of viewerFiles) {
			const source = readFileSync(join(process.cwd(), file), 'utf8');
			expect(source).toContain('allowExpand?: boolean;');
			expect(source).toContain('allowExpand = true');
			expect(source).toContain('detached?: boolean;');
			expect(source).toContain('{#if allowExpand && !detached}');
		}
	});

	it('treats first detached-window creation as informational and snapshots log details', () => {
		const serviceSource = readFileSync(
			join(process.cwd(), 'src/lib/services/detached-asset-preview-window.ts'),
			'utf8'
		);
		const assetPreviewStateSource = readFileSync(
			join(process.cwd(), 'src/lib/state/asset-preview.svelte.ts'),
			'utf8'
		);
		const shellSource = readFileSync(join(process.cwd(), 'src/routes/+layout.svelte'), 'utf8');

		expect(serviceSource).toContain("const log = createLogger('detachedPreviewWindow');");
		expect(serviceSource).toContain(
			"log.info('No existing detached preview window found; creating a new one.');"
		);
		expect(serviceSource).not.toContain('console.info(');
		expect(assetPreviewStateSource).toContain("const log = createLogger('assetPreviewState');");
		expect(shellSource).toContain("const shellLog = createLogger('appShell');");
		expect(shellSource).not.toContain('attachDevConsoleMirroring');
	});

	it('splits detached preview permissions away from the main window capability', () => {
		const mainCapability = readFileSync(
			join(process.cwd(), 'src-tauri/capabilities/default.json'),
			'utf8'
		);
		const previewCapability = readFileSync(
			join(process.cwd(), 'src-tauri/capabilities/asset-preview.json'),
			'utf8'
		);

		expect(JSON.parse(mainCapability).windows).toEqual(['main']);
		expect(mainCapability).toContain('core:webview:allow-create-webview-window');
		expect(mainCapability).toContain('core:window:allow-show');
		expect(mainCapability).toContain('core:window:allow-unminimize');
		expect(JSON.parse(previewCapability).windows).toEqual(['asset-preview']);
		expect(previewCapability).toContain('core:window:allow-close');
		expect(previewCapability).toContain('core:window:allow-destroy');
		expect(previewCapability).toContain('core:window:allow-is-fullscreen');
		expect(previewCapability).toContain('core:window:allow-set-fullscreen');
		expect(previewCapability).toContain('opener:allow-open-url');
		expect(previewCapability).toContain('opener:deny-open-path');
		expect(previewCapability).toContain('opener:deny-reveal-item-in-dir');
		expect(previewCapability).not.toContain('opener:default');
		expect(previewCapability).not.toContain('opener:allow-open-path');
		expect(previewCapability).not.toContain('updater:default');
	});

	it('adds fullscreen to the detached viewer toolbar without introducing a duplicate header', () => {
		const viewerSource = readFileSync(
			join(process.cwd(), 'src/lib/components/assets/MultiFileViewer.svelte'),
			'utf8'
		);

		expect(viewerSource).toContain('fullscreen?: boolean;');
		expect(viewerSource).toContain('onToggleFullscreen?: (() => void | Promise<void>) | null;');
		expect(viewerSource).toContain(
			"tooltip={fullscreen ? 'Exit full screen' : 'Enter full screen'}"
		);
		expect(viewerSource).toContain(
			'<div class="ui-viewer-shell flex h-full min-h-0 flex-1 flex-col overflow-hidden">'
		);
		expect(viewerSource).toContain('<Maximize2Icon class="size-3.5" />');
		expect(viewerSource).toContain('<Minimize2Icon class="size-3.5" />');
	});
});
