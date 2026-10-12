<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { Button } from './index.js';

	const { Story } = defineMeta({
		title: 'Design System/UI/Button',
		component: Button,
		tags: ['autodocs']
	});
</script>

<Story name="Variants">
	<div class="flex flex-wrap items-center gap-3">
		<Button>Default</Button>
		<Button variant="brand">Brand</Button>
		<Button variant="secondary">Secondary</Button>
		<Button variant="ghost">Ghost</Button>
		<Button variant="destructive">Destructive</Button>
	</div>
</Story>

<Story name="Sizes">
	<div class="flex flex-wrap items-center gap-3">
		<Button size="sm">Compact</Button>
		<Button size="default">Default</Button>
		<Button size="lg">Large</Button>
		<Button size="icon-sm" aria-label="Compact icon">+</Button>
	</div>
</Story>
