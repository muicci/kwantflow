import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function serviceSource(): string {
	return readFileSync(join(process.cwd(), 'src/lib/services/cad-viewer-service.ts'), 'utf8');
}

describe('CAD viewer service', () => {
	it('exports all expected lifecycle and command functions', () => {
		const source = serviceSource();
		const exports = [
			'function initCadViewer',
			'function isCadViewerReady',
			'function getInstance',
			'async function openCadDocument',
			'function destroyCadViewer',
			'function cadZoomExtents',
			'function cadSwitchBackground',
			'function cadToggleLineWeight',
			'function getCadLineWeightEnabled',
			'function cadPan',
			'function cadRegen',
			'function cadMeasureDistance',
			'function cadMeasureArea',
			'function cadMeasureAngle',
			'function cadMeasureArc',
			'function cadExportPng',
			'function cadErase',
			'function cadExportSvg',
			'function cadExportDxf',
			'function cadIsolateLayers',
			'function cadUnisolateLayers',
			'function cadLockLayer',
			'function cadUnlockLayer',
			'function cadFreezeLayer',
			'function cadThawAllLayers',
			'function cadLayerOff',
			'function cadLayerOn',
			'function cadCopy',
			'function cadMove',
			'function cadRotate',
			'function cadOffset',
			'function cadDimlinear',
			'function cadInstallTrackpadPan',
			'function getAllLayers',
			'function toggleLayerVisibility',
			'function toggleLayerLock',
			'function getEntityById',
			'function cadSelectAllOnLayer',
			'function cadSelect'
		];

		for (const fn of exports) {
			expect(source).toContain(fn);
		}
	});

	it('does not export the unsafe cadZoomWindow function', () => {
		const source = serviceSource();
		expect(source).not.toContain('cadZoomWindow');
	});

	it('uses getInstance() wrapper instead of direct AcApDocManager.instance access', () => {
		const source = serviceSource();
		const directAccessLines = source
			.split('\n')
			.filter(
				(l) =>
					l.includes('AcApDocManager.instance') &&
					!l.trim().startsWith('//') &&
					!l.trim().startsWith('*')
			)
			.map((l) => l.trim());

		for (const line of directAccessLines) {
			const isInTryCatch = line.includes('try') || line.includes('catch');
			const isInCreateInstanceGuard = line.includes('if (!AcApDocManager.instance)');
			const isInGetterWrapper = line.includes('return AcApDocManager.instance');
			expect(
				isInTryCatch || isInCreateInstanceGuard || isInGetterWrapper,
				`Found unsafe AcApDocManager.instance direct access: ${line}`
			).toBe(true);
		}
	});

	it('resets initialized flag synchronously in destroyCadViewer', () => {
		const source = serviceSource();
		const destroyIndex = source.indexOf('export function destroyCadViewer');
		const destroyBlock = source.slice(destroyIndex, destroyIndex + 900);
		expect(destroyBlock).toContain('_initialized = false');
		expect(destroyBlock).toContain('_container = null');
		expect(destroyBlock).toContain('releaseCadViewerInstance(inst, container)');

		const resetIndex = destroyBlock.indexOf('_initialized = false');
		const destroyCallIndex = destroyBlock.indexOf('releaseCadViewerInstance(inst, container)');
		expect(resetIndex).toBeGreaterThan(0);
		expect(destroyCallIndex).toBeGreaterThan(0);
		expect(resetIndex).toBeLessThan(destroyCallIndex);
	});

	it('releases WebGL state and owned canvas nodes during singleton teardown', () => {
		const source = serviceSource();
		const teardownIndex = source.indexOf('async function releaseCadViewerInstance');
		const teardownBlock = source.slice(teardownIndex, teardownIndex + 2200);

		expect(teardownBlock).toContain('view?.stopAnimationLoop?.()');
		expect(teardownBlock).toContain('renderer?.dispose?.()');
		expect(teardownBlock).toContain('renderer?.forceContextLoss?.()');
		expect(teardownBlock).toContain('container?.replaceChildren()');
		expect(teardownBlock).toContain('_trackpadCanvas.removeEventListener');
	});

	it('hoists getInstance() before await to avoid TOCTOU race', () => {
		const source = serviceSource();
		const openIndex = source.indexOf('export async function openCadDocument');
		const openBlock = source.slice(openIndex, openIndex + 2000);

		// Find the specific hoist inside openCadDocument — there's another 'const inst'
		// in cadZoomExtents so we search from openBlock only
		const hoistIndex = openBlock.indexOf('const inst = getInstance();');
		expect(hoistIndex).toBeGreaterThanOrEqual(0);

		const afterHoist = openBlock.slice(hoistIndex);
		expect(afterHoist).toContain('inst!.openDocument');
	});

	it('worker URLs point to /workers/ path', () => {
		const source = serviceSource();
		expect(source).toContain("dwgParser: '/workers/libredwg-parser-worker.js'");
		expect(source).toContain("mtextRender: '/workers/mtext-renderer-worker.js'");
	});
});
