import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'path';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import { svelteTesting } from '@testing-library/svelte/vite';
const dirname = path.dirname(fileURLToPath(import.meta.url));

// More info at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon
export default defineConfig({
	plugins: [svelte()],
	resolve: {
		alias: {
			$lib: resolve(dirname, 'src/lib'),
			$app: resolve(dirname, 'src/app')
		}
	},
	optimizeDeps: {
		include: ['@lucide/svelte/icons/circle-alert']
	},
	test: {
		deps: {
			optimizer: {
				client: {
					exclude: ['typescript']
				},
				ssr: {
					exclude: ['typescript']
				}
			}
		},
		projects: [
			{
				extends: true,
				plugins: [svelteTesting({ autoCleanup: false })],
				test: {
					name: 'unit',
					environment: 'jsdom',
					globals: true,
					setupFiles: ['./src/tests/setup.ts'],
					include: ['src/**/*.{test,spec}.{ts,svelte}', 'scripts/**/*.{test,spec}.ts'],
					testTimeout: 30000,
					alias: {
						$lib: resolve(dirname, 'src/lib'),
						$app: resolve(dirname, 'src/app')
					}
				}
			},
			{
				extends: true,
				plugins: [
					// The plugin will run tests for the stories defined in your Storybook config
					// See options at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon#storybooktest
					storybookTest({
						configDir: path.join(dirname, '.storybook')
					})
				],
				test: {
					name: 'storybook',
					browser: {
						enabled: true,
						headless: true,
						provider: playwright({}),
						instances: [
							{
								browser: 'webkit'
							}
						]
					}
				}
			}
		]
	}
});
