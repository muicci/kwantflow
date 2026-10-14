import prettier from 'eslint-config-prettier';
import path from 'node:path';
import { includeIgnoreFile } from '@eslint/compat';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.js';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	{
		ignores: [
			'src/lib/components/ui/button/button.svelte',
			// Pre-existing lint debt from before the whole tree was linted. Fix and remove entries.
			'src/lib/components/app-sidebar-mail-panel.svelte',
			'src/lib/components/app-sidebar-panel-rail.svelte',
			'src/lib/components/ask-kwantflow-page-reference.svelte',
			'src/lib/components/ask-kwantflow-sidebar.svelte',
			'src/lib/components/assistant-proposal-dialog.svelte',
			'src/lib/contracts/ai-prompts.ts',
			'src/tests/dwg-core-converter.test.ts',
			'src/tests/setup.ts'
		]
	},
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs.recommended,
	prettier,
	...svelte.configs.prettier,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: {
			// typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
			// see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
			'no-undef': 'off',
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ varsIgnorePattern: '^_', argsIgnorePattern: '^_' }
			]
		}
	},
	{
		files: ['src/lib/components/**/*.{svelte,ts,js}', 'src/routes/**/*.{svelte,ts,js}'],
		ignores: ['src/lib/components/ui/**/*'],
		rules: {
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ varsIgnorePattern: '^_', argsIgnorePattern: '^_' }
			],
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: [
								'$lib/services/db*',
								'$lib/services/store*',
								'../services/db*',
								'../services/store*',
								'../../services/db*',
								'../../services/store*',
								'../../../services/db*',
								'../../../services/store*',
								'../../../../services/db*',
								'../../../../services/store*'
							],
							message:
								'Components and routes must not import db/store services directly. Go through state hubs.'
						},
						{
							group: ['@tauri-apps/plugin-store'],
							message:
								'Components and routes must not import raw Tauri persistence plugins directly.'
						}
					]
				}
			]
		}
	},
	{
		files: ['**/*.svelte'],
		ignores: ['src/lib/components/ui/**/*'],
		rules: {
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ varsIgnorePattern: '^_', argsIgnorePattern: '^_' }
			],
			/* Kwantflow Design Authority Enforcement */
			'no-restricted-syntax': [
				'error',
				{
					selector:
						'SvelteAttribute[key.name="class"] > SvelteLiteral[value=/text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl)/]',
					message:
						'DO NOT use Tailwind text sizing classes in application code. Use semantic classes from app.css.'
				},
				{
					selector:
						'SvelteAttribute[key.name="class"] > SvelteLiteral[value=/font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)/]',
					message:
						'DO NOT use Tailwind font weight classes in application code. Use semantic typography classes.'
				},
				{
					selector:
						'SvelteAttribute[key.name="class"] > SvelteLiteral[value=/text-muted-foreground/]',
					message:
						'DO NOT use text-muted-foreground in application templates. Use .muted or .caption semantic classes.'
				}
			]
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],

		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser,
				svelteConfig
			}
		}
	}
);
