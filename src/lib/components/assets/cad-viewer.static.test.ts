import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('cad viewer detached sizing', () => {
	it('measures the real canvas viewport and refits after loading settles', () => {
		const source = readFileSync(
			join(process.cwd(), 'src/lib/components/assets/cad-viewer.svelte'),
			'utf8'
		);

		expect(source).toContain("import { onMount, tick, untrack } from 'svelte';");
		expect(source).toContain('let viewportRef: HTMLDivElement | undefined = $state();');
		expect(source).toContain('let viewerActive = false;');
		expect(source).toContain('let sceneInitGeneration = 0;');
		expect(source).toContain('let wheelCanvas: HTMLCanvasElement | null = null;');
		expect(source).not.toContain('if (!viewportRef || !renderer || !camera) return;');
		expect(source).toContain('const rect = viewportRef.getBoundingClientRect();');
		expect(source).toContain('renderer.setSize(w, h, false);');
		expect(source).toContain('const ro = new ResizeObserver(() => scheduleResize());');
		expect(source).toContain('scheduleResize();');
		expect(source).not.toContain('rect.height - 40');
		expect(source).toContain('loading = false;');
		expect(source).toContain('await tick();');
		expect(source).toContain('fitToView();');
		expect(source).toContain('if (viewportRef) ro.observe(viewportRef);');
		expect(source).toContain('if (!viewerActive || !canvasRef?.isConnected) return;');
		expect(source).toContain('!viewerActive ||');
		expect(source).toContain('!viewportRef ||');
		expect(source).toContain('!viewportRef.isConnected ||');
		expect(source).toContain('!canvasRef ||');
		expect(source).toContain('!canvasRef.isConnected ||');
		expect(source).toContain('!renderer ||');
		expect(source).toContain('!camera');
		expect(source).toContain('viewerActive = true;');
		expect(source).toContain('viewerActive = false;');
		expect(source).toContain('const initGeneration = ++sceneInitGeneration;');
		expect(source).toContain('const canvas = canvasRef;');
		expect(source).toContain('canvasRef !== canvas');
		expect(source).toContain("wheelCanvas?.removeEventListener('wheel', handleWheel);");
		expect(source).not.toContain('new THREE.Box3().setFromObject(loadedObject)');
	});

	it('clamps CAD line widths to 1 (WebGL ALIASED_LINE_WIDTH_RANGE is always [1,1] on modern hardware)', () => {
		const source = readFileSync(
			join(process.cwd(), 'src/lib/components/assets/cad-viewer.svelte'),
			'utf8'
		);

		expect(source).toContain('lineMaterial.linewidth = 1;');
		expect(source).toContain('lineMaterial.wireframeLinewidth = 1;');
		expect(source).not.toContain('const gl = renderer.getContext();');
		expect(source).not.toContain('gl.ALIASED_LINE_WIDTH_RANGE');
		expect(source).not.toContain('return 1 / Math.max(1, pixelRatio);');
	});

	it('supports previewable wire geometry and a metadata-only CAD fallback', () => {
		const source = readFileSync(
			join(process.cwd(), 'src/lib/components/assets/cad-viewer.svelte'),
			'utf8'
		);

		expect(source).toContain('let metadataOnlyReason = $state<string | null>(null);');
		expect(source).toContain('let loadedBounds: CadBounds | null = null;');
		expect(source).toContain('loadedBounds = result.renderBounds;');
		expect(source).toContain("metadata.previewMode === 'wire'");
		expect(source).toContain("kind === 'metadata_only'");
		expect(source).toContain('No preview available for this file');
		expect(source).toContain(
			'This CAD file is valid, but it does not contain drawable geometry for preview.'
		);
		expect(source).not.toContain('{metadataOnlyReason}');
		expect(source).toContain('{metadata.format.toUpperCase()}');
	});
});
