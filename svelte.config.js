// Tauri doesn't have a Node.js server, so the desktop shell stays in SPA mode.
// Keep the fallback separate from the prerendered root document so the packaged app
// retains the real startup shell instead of overwriting index.html during static output.
import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({
			fallback: '200.html'
		})
	}
};

export default config;
