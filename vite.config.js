import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { createLogger, defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';

const host = process.env.TAURI_DEV_HOST;
const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const KNOWN_BROWSER_EXTERNAL_WARNING_FRAGMENTS = ['occt-import-js', '@mlightcad/libredwg-web'];
const KNOWN_CHUNK_SIZE_WARNING_FRAGMENT = 'Some chunks are larger than';

/** @param {string} message */
function isKnownBrowserExternalWarning(message) {
	return (
		message.includes('externalized for browser compatibility') &&
		KNOWN_BROWSER_EXTERNAL_WARNING_FRAGMENTS.some((fragment) => message.includes(fragment))
	);
}

// https://vite.dev/config/
export default defineConfig(() => {
	const customLogger = createLogger();
	const defaultWarn = customLogger.warn;
	customLogger.warn = (message, options) => {
		if (isKnownBrowserExternalWarning(message)) {
			return;
		}
		if (message.includes(KNOWN_CHUNK_SIZE_WARNING_FRAGMENT)) {
			return;
		}
		defaultWarn(message, options);
	};

	return {
		customLogger,
		plugins: [tailwindcss(), sveltekit()],
		worker: {
			format: 'es'
		},
		define: {
			__KWANTFLOW_APP_VERSION__: JSON.stringify(packageJson.version)
		},
		// Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
		//
		// 1. prevent Vite from obscuring rust errors
		clearScreen: false,

		// 2. OCCT import ships a CommonJS runtime plus a WASM binary. Vite dev serves native ESM,
		//    so the CommonJS wrapper must be pre-bundled while the .wasm stays a static asset.
		optimizeDeps: {
			// Pre-bundle all lucide icon imports, mammoth, and dxf-renew so late-discovered paths
			// don't trigger a Vite re-optimization + full page reload during development.
			include: [
				'occt-import-js',
				'@lucide/svelte/icons',
				'@lucide/svelte/icons/camera',
				'@lucide/svelte/icons/circle-dot',
				'@lucide/svelte/icons/copy-plus',
				'@lucide/svelte/icons/copy',
				'@lucide/svelte/icons/download',
				'@lucide/svelte/icons/eye-off',
				'@lucide/svelte/icons/filter',
				'@lucide/svelte/icons/grid-3x3',
				'@lucide/svelte/icons/hand',
				'@lucide/svelte/icons/lock-open',
				'@lucide/svelte/icons/lock',
				'@lucide/svelte/icons/move',
				'@lucide/svelte/icons/pentagon',
				'@lucide/svelte/icons/ruler',
				'@mlightcad/cad-simple-viewer',
				'mammoth',
				'@linkiez/dxf-renew',
				'pdfjs-dist/legacy/build/pdf.mjs',
				'three/examples/jsm/controls/OrbitControls.js'
			]
		},
		environments: {
			client: {
				dev: {
					// Tauri devtools try to fetch dependency sourcemaps through the webview and spam
					// the console with access-control noise for every pre-bundled dep.
					sourcemap: false
				}
			}
		},
		assetsInclude: ['**/*.wasm'],

		build: {
			// Desktop builds intentionally carry large worker/vendor chunks for PDF, CAD, and local AI tooling.
			// Keep this above the known production baseline so builds only surface unexpected regressions.
			chunkSizeWarningLimit: 5000,
			rolldownOptions: {
				checks: {
					pluginTimings: false
				},
				onLog(level, log, defaultHandler) {
					if (level === 'warn' && isKnownBrowserExternalWarning(log.message)) {
						return;
					}

					defaultHandler(level, log);
				}
			}
		},

		// 3. tauri expects a fixed port, fail if that port is not available
		server: {
			port: 1420,
			strictPort: true,
			host: host || false,
			hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
			fs: {
				allow: [repoRoot]
			},
			watch: {
				// Keep native dev runs stable when pnpm scratch projects update.
				// Also ignore SvelteKit's prerendered output — rebuilding it during dev triggers
				// infinite page reload loops (regenerate → Vite detects change → reload → regenerate).
				ignored: ['**/src-tauri/**', '**/.pnpm-store/**', '**/.svelte-kit/**']
			}
		}
	};
});
