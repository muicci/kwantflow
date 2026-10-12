<script lang="ts">
	import { cn } from '$lib/utils.js';
	import type { HTMLAttributes } from 'svelte/elements';

	let { class: className, ...restProps }: HTMLAttributes<HTMLHRElement> = $props();
</script>

<hr data-kf-primitive="divider" class={cn('ui-divider', className)} {...restProps} />
