<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { Input } from './index.js';

	const { Story } = defineMeta({
		title: 'Design System/UI/Input',
		component: Input,
		tags: ['autodocs']
	});
</script>

<Story name="States">
	<div class="flex w-full max-w-md flex-col gap-3">
		<Input value="Acme Fabrication" />
		<Input size="sm" value="Compact control" />
		<Input placeholder="Placeholder uses muted semantic text" />
		<Input invalidTone="destructive" aria-invalid="true" value="Invalid value" />
		<Input disabled value="Disabled state" />
	</div>
</Story>
