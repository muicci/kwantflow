import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function readViewer(fileName: string): string {
	return readFileSync(join(process.cwd(), 'src/lib/components/assets', fileName), 'utf8');
}

describe('asset viewer resize scheduling', () => {
	it('queues PDF resize-driven rerenders through requestAnimationFrame with dimension guards', () => {
		const source = readViewer('pdf-viewer.svelte');

		expect(source).toContain('let resizeFrameId: number | null = null;');
		expect(source).toContain('function flushResize() {');
		expect(source).toContain('if (width === 0 || height === 0) return;');
		expect(source).toContain(
			'if (width === lastResizeWidth && height === lastResizeHeight) return;'
		);
		expect(source).toContain('if (pdfDoc && fitMode) scheduleRender(100);');
		expect(source).toContain('const ro = new ResizeObserver((entries) => {');
		expect(source).toContain('const width = Math.max(0, Math.round(entry.contentRect.width));');
		expect(source).toContain('cancelAnimationFrame(resizeFrameId);');
	});

	it('queues image resize reactions through requestAnimationFrame with dimension guards', () => {
		const imageSource = readViewer('image-viewer.svelte');

		expect(imageSource).toContain('let resizeFrameId: number | null = null;');
		expect(imageSource).toContain('function flushResize() {');
		expect(imageSource).toContain('if (width === 0 || height === 0) return;');
		expect(imageSource).toContain(
			'if (width === lastResizeWidth && height === lastResizeHeight) return;'
		);
		expect(imageSource).toContain('const ro = new ResizeObserver((entries) => {');
		expect(imageSource).toContain(
			'const width = Math.max(0, Math.round(entry.contentRect.width));'
		);
		expect(imageSource).toContain('cancelAnimationFrame(resizeFrameId);');

		expect(imageSource).toContain('if (fitMode) calcFitScale();');
	});

	it('keeps text viewer wrap controls lean and independent of resize observers', () => {
		const textSource = readViewer('text-viewer.svelte');

		expect(textSource).toContain("tooltip={wordWrap ? 'Disable line wrap' : 'Wrap lines'}");
		expect(textSource).not.toContain('let canToggleWrap = $state(false);');
		expect(textSource).not.toContain('const ro = new ResizeObserver((entries) => {');
		expect(textSource).not.toContain('updateWrapAvailability();');
		expect(textSource).not.toContain('bind:viewportRef');
		expect(textSource).not.toContain('bind:this={measureRef}');
	});
});
