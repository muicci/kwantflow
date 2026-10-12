<script lang="ts">
	import { Badge, type BadgeVariant } from '$lib/components/ui/badge/index.js';
	import { PriorityLevel } from '$lib/constants/index.js';

	let { priority = PriorityLevel.Medium }: { priority?: PriorityLevel | null } = $props();

	const badgeClassByPriority: Record<PriorityLevel, string> = {
		[PriorityLevel.Low]: 'muted',
		[PriorityLevel.Medium]: '',
		[PriorityLevel.High]: '',
		[PriorityLevel.Critical]: ''
	};

	const badgeVariantByPriority: Record<PriorityLevel, BadgeVariant> = {
		[PriorityLevel.Low]: 'outline',
		[PriorityLevel.Medium]: 'outline',
		[PriorityLevel.High]: 'secondary',
		[PriorityLevel.Critical]: 'destructive'
	};
</script>

<Badge
	variant={priority ? badgeVariantByPriority[priority] : 'outline'}
	class={priority ? badgeClassByPriority[priority] : ''}
>
	{priority || 'Unknown'}
</Badge>
