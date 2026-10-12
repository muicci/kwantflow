<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { Badge } from './index.js';

	const { Story } = defineMeta({
		title: 'Design System/UI/Badge',
		component: Badge,
		tags: ['autodocs']
	});
</script>

<Story name="Variants">
	<div class="flex flex-wrap items-center gap-3">
		<Badge>Default</Badge>
		<Badge variant="brand">Selected</Badge>
		<Badge variant="secondary">Secondary</Badge>
		<Badge variant="destructive">Blocked</Badge>
		<Badge variant="outline">Outline</Badge>
	</div>
</Story>
