import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Vite CAD dependency discovery', () => {
	it('prebundles lazy Three.js viewer imports before cold RFQ navigation', () => {
		const source = readFileSync(join(process.cwd(), 'vite.config.js'), 'utf8');

		expect(source).toContain("'three/examples/jsm/controls/OrbitControls.js'");
	});

	it('prebundles CAD-route CommonJS and lazy icon dependencies used by the viewer', () => {
		const source = readFileSync(join(process.cwd(), 'vite.config.js'), 'utf8');

		expect(source).toContain("'occt-import-js'");
		expect(source).not.toContain("exclude: ['occt-import-js']");
		expect(source).toContain("'@mlightcad/cad-simple-viewer'");
		expect(source).toContain("'@lucide/svelte/icons/camera'");
		expect(source).toContain("'@lucide/svelte/icons/circle-dot'");
		expect(source).toContain("'@lucide/svelte/icons/ruler'");
		expect(source).toContain("'@lucide/svelte/icons/grid-3x3'");
		expect(source).toContain("'@lucide/svelte/icons/pentagon'");
	});

	it('prebundles PDF.js before cold mixed-evidence navigation', () => {
		const source = readFileSync(join(process.cwd(), 'vite.config.js'), 'utf8');

		expect(source).toContain("'pdfjs-dist/legacy/build/pdf.mjs'");
	});
});
