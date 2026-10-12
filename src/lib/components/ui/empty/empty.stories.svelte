<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import FileQuestion from '@lucide/svelte/icons/file-question';
	import { Empty, Header, Media, Title, Description, Content } from './index.js';

	const { Story } = defineMeta({
		title: 'Design System/UI/Empty State',
		component: Empty,
		tags: ['autodocs']
	});
</script>

<Story name="Default">
	<Empty class="w-full max-w-lg">
		<Header>
			<Media variant="icon">
				<FileQuestion />
			</Media>
			<Title>No project files yet</Title>
			<Description>
				Use the owned empty-state shell for first-class tables, viewers, and setup surfaces.
			</Description>
		</Header>
		<Content class="caption muted"
			>Next actions belong in the content slot below the summary.</Content
		>
	</Empty>
</Story>
