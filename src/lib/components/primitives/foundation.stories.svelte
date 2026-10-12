<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import {
		Cluster,
		Divider,
		Eyebrow,
		Heading,
		Meta,
		Panel,
		Stack,
		Surface,
		Text
	} from './index.js';

	const { Story } = defineMeta({
		title: 'Design System/Primitives/Foundation',
		tags: ['autodocs']
	});
</script>

<Story name="Typography Roles">
	<Stack class="w-full max-w-2xl gap-4">
		<div>
			<Eyebrow>Workspace context</Eyebrow>
			<Heading tone="page">Owned desktop design system</Heading>
			<Text tone="body">
				Product copy stays content, but its rendering comes through owned primitives and semantic
				type roles.
			</Text>
		</div>
		<Divider />
		<Cluster class="items-center gap-3">
			<Meta>Compact metadata row</Meta>
			<Meta>Australian English defaults</Meta>
			<Meta>Token-backed roles</Meta>
		</Cluster>
	</Stack>
</Story>

<Story name="Surface Tones">
	<Cluster class="w-full max-w-4xl items-stretch gap-4">
		<Surface class="ui-radius-md border p-4">
			<Stack class="gap-2">
				<Eyebrow>Surface</Eyebrow>
				<Heading tone="panel">Base</Heading>
				<Text tone="muted">Default neutral reading surface.</Text>
			</Stack>
		</Surface>
		<Panel tone="subtle" inset="md">
			<Stack class="gap-2">
				<Eyebrow>Panel</Eyebrow>
				<Heading tone="panel">Subtle</Heading>
				<Text tone="muted">Used for grouped workflow context and quieter shells.</Text>
			</Stack>
		</Panel>
		<Panel tone="brand" inset="md">
			<Stack class="gap-2">
				<Eyebrow>Panel</Eyebrow>
				<Heading tone="panel">Brand</Heading>
				<Text tone="muted">Used sparingly for selected or guided states.</Text>
			</Stack>
		</Panel>
	</Cluster>
</Story>
