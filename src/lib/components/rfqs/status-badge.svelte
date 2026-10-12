<script lang="ts">
	import { Badge, type BadgeVariant } from '$lib/components/ui/badge/index.js';
	import { ProjectStatus, projectStatusLabel } from '$lib/constants/index.js';

	let { status }: { status: ProjectStatus } = $props();

	const badgeClassByStatus: Record<ProjectStatus, string> = {
		[ProjectStatus.Draft]: 'muted',
		[ProjectStatus.Open]: '',
		[ProjectStatus.Estimating]: '',
		[ProjectStatus.Quoted]: '',
		[ProjectStatus.Won]: 'status-badge-success',
		[ProjectStatus.Lost]: 'text-destructive',
		[ProjectStatus.Archived]: 'muted'
	};

	const badgeVariantByStatus: Record<ProjectStatus, BadgeVariant> = {
		[ProjectStatus.Draft]: 'secondary',
		[ProjectStatus.Open]: 'outline',
		[ProjectStatus.Estimating]: 'secondary',
		[ProjectStatus.Quoted]: 'outline',
		[ProjectStatus.Won]: 'default',
		[ProjectStatus.Lost]: 'destructive',
		[ProjectStatus.Archived]: 'secondary'
	};
</script>

<Badge variant={badgeVariantByStatus[status]} class={badgeClassByStatus[status]}>
	{projectStatusLabel(status)}
</Badge>
