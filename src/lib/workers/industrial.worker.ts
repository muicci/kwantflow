import * as Comlink from 'comlink';
import {
	analyseSetupImportWorkbook,
	parseSetupImportFile,
	type ParseSetupImportFileInput
} from '../services/setup-import.js';

type CanvasFactoryOptions = {
	ownerDocument?: Document;
	enableHWA?: boolean;
};

type CanvasAndContext = {
	canvas: OffscreenCanvas | null;
	context: OffscreenCanvasRenderingContext2D | null;
};

type PdfJsLike = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

let pdfjs: PdfJsLike | null = null;
let pdfWorker: Worker | null = null;
let pdfJsWorker: import('pdfjs-dist/legacy/build/pdf.mjs').PDFWorker | null = null;
let pdfjsReady: Promise<void> | null = null;

class WorkerCanvasFactory {
	private readonly enableHWA: boolean;

	constructor({ enableHWA = false }: CanvasFactoryOptions = {}) {
		this.enableHWA = enableHWA;
	}

	create(width: number, height: number): CanvasAndContext {
		if (width <= 0 || height <= 0) {
			throw new Error('Invalid canvas size');
		}

		const canvas = new OffscreenCanvas(width, height);
		const context = canvas.getContext('2d', {
			willReadFrequently: !this.enableHWA
		});
		if (!context) {
			throw new Error('Cannot create 2d canvas context in worker');
		}

		return { canvas, context };
	}

	reset(canvasAndContext: CanvasAndContext, width: number, height: number): void {
		if (!canvasAndContext.canvas) {
			throw new Error('Canvas is not specified');
		}
		if (width <= 0 || height <= 0) {
			throw new Error('Invalid canvas size');
		}

		canvasAndContext.canvas.width = width;
		canvasAndContext.canvas.height = height;
	}

	destroy(canvasAndContext: CanvasAndContext): void {
		if (!canvasAndContext.canvas) {
			throw new Error('Canvas is not specified');
		}

		canvasAndContext.canvas.width = 0;
		canvasAndContext.canvas.height = 0;
		canvasAndContext.canvas = null;
		canvasAndContext.context = null;
	}
}

async function ensurePdfjs() {
	if (pdfjs) return;
	if (pdfjsReady) return pdfjsReady;

	pdfjsReady = (async () => {
		const [pdfjsLib, { default: PdfJsWorker }] = await Promise.all([
			import('pdfjs-dist/legacy/build/pdf.mjs'),
			import('pdfjs-dist/legacy/build/pdf.worker.mjs?worker')
		]);

		pdfjs = pdfjsLib;
		pdfWorker = new PdfJsWorker();
		pdfJsWorker = pdfjs.PDFWorker.create({ port: pdfWorker });
	})();

	return pdfjsReady;
}

const THUMB_MAX_PX = 200;

/**
 * Industrial Worker Authority
 * Handles heavy computation (PDF, CAD, Math) in a background thread.
 */
const workerAPI = {
	ping: () => 'pong',

	/**
	 * Renders a PDF page to an OffscreenCanvas and returns the image data as a Blob.
	 */
	async renderPdfThumbnail(pdfBytes: Uint8Array): Promise<Blob> {
		await ensurePdfjs();
		if (!pdfjs || !pdfJsWorker) throw new Error('PDF.js failed to initialize');
		const loadingTask = pdfjs.getDocument({
			data: pdfBytes,
			worker: pdfJsWorker,
			useWasm: false,
			CanvasFactory: WorkerCanvasFactory
		});
		try {
			const pdf = await loadingTask.promise;
			const page = await pdf.getPage(1);
			const base = page.getViewport({ scale: 1.0 });

			const maxDim = Math.max(base.width, base.height);
			const scale = THUMB_MAX_PX / maxDim;
			const viewport = page.getViewport({ scale });

			// Use OffscreenCanvas for background rendering (available in modern browsers/Tauri)
			const canvas = new OffscreenCanvas(viewport.width, viewport.height);
			const ctx = canvas.getContext('2d');
			if (!ctx) throw new Error('Cannot get 2d context');

			// PDF.js renders through the supplied 2D context with canvas: null. Its browser
			// declarations omit OffscreenCanvas even though the same rendering path supports it.
			await page.render({
				canvas: null,
				canvasContext: ctx as unknown as CanvasRenderingContext2D,
				viewport
			}).promise;

			const blob = await canvas.convertToBlob({ type: 'image/png' });
			return blob;
		} finally {
			await loadingTask.destroy();
		}
	},

	async parseAndAnalyseSetupImport(input: ParseSetupImportFileInput) {
		const workbook = await parseSetupImportFile(input, { localOnly: true });
		const analysis = await analyseSetupImportWorkbook(workbook, { localOnly: true });
		return { workbook, analysis };
	}
};

Comlink.expose(workerAPI);

export type IndustrialWorkerAPI = typeof workerAPI;
