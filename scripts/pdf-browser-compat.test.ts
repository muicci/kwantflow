// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('PDF runtime compatibility', () => {
	it('parses a real PDF without native Promise.try or Promise.withResolvers', () => {
		const sources = [
			'src/lib/components/assets/pdf-viewer.svelte',
			'src/lib/workers/industrial.worker.ts'
		].map((file) => readFileSync(file, 'utf8'));
		const entries = sources.map((source) => {
			const entry = source.match(/import\('(pdfjs-dist\/[^']+\/pdf\.mjs)'\)/)?.[1];
			expect(entry).toBe('pdfjs-dist/legacy/build/pdf.mjs');
			expect(source).toContain("import('pdfjs-dist/legacy/build/pdf.worker.mjs?worker')");
			return entry;
		});
		const output = execFileSync(
			process.execPath,
			[
				'--input-type=module',
				'-e',
				`
import { PDFDocument } from 'pdf-lib';
const fixture = await PDFDocument.create();
fixture.addPage([72, 72]);
const bytes = await fixture.save();
// Parsing this blank page does not use a matrix or rasterizer. Browser rendering
// still requires native WebView acceptance; this isolates the missing APIs.
globalThis.DOMMatrix = class DOMMatrix {};
delete Promise.withResolvers;
delete Promise.try;
const pdfjs = await import(${JSON.stringify(entries[0])});
const task = pdfjs.getDocument({ data: bytes, useWasm: false, verbosity: pdfjs.VerbosityLevel.ERRORS });
try {
  const document = await task.promise;
  const page = await document.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  console.log('PDF_COMPAT=' + JSON.stringify({
    pages: document.numPages, width: viewport.width, height: viewport.height,
    withResolvers: typeof Promise.withResolvers, promiseTry: typeof Promise.try
  }));
} finally { await task.destroy(); }
`
			],
			{ cwd: process.cwd(), encoding: 'utf8', timeout: 25_000 }
		);
		const result = output.split('\n').find((line) => line.startsWith('PDF_COMPAT='));
		expect(result).toBeDefined();
		expect(JSON.parse(result!.slice('PDF_COMPAT='.length))).toEqual({
			pages: 1,
			width: 72,
			height: 72,
			withResolvers: 'function',
			promiseTry: 'function'
		});
	});
});
