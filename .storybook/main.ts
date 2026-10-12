import type { StorybookConfig } from '@storybook/sveltekit';

const config: StorybookConfig = {
	core: { disableTelemetry: true },
	stories: ['../src/**/*.stories.@(ts|svelte)'],
	addons: [
		'@storybook/addon-svelte-csf',
		'@storybook/addon-vitest',
		'@storybook/addon-a11y',
		'@storybook/addon-docs'
	],
	framework: '@storybook/sveltekit'
};

export default config;
