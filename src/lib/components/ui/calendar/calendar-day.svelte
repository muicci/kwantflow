<script lang="ts">
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import { Calendar as CalendarPrimitive } from 'bits-ui';

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: CalendarPrimitive.DayProps = $props();
</script>

<CalendarPrimitive.Day
	bind:ref
	class={cn(
		buttonVariants({ variant: 'ghost' }),
		'calendar-copy ui-radius-sm flex size-(--cell-size) flex-col items-center justify-center gap-1 p-0 leading-none whitespace-nowrap select-none',
		'[&[data-today][data-disabled]]:muted [&[data-today]:not([data-selected])]:bg-accent [&[data-today]:not([data-selected])]:text-accent-foreground',
		'data-[selected]:bg-primary data-[selected]:text-primary-foreground',
		// Outside months
		'[&[data-outside-month]:not([data-selected])]:muted [&[data-outside-month]:not([data-selected])]:hover:text-accent-foreground',
		// Disabled
		'data-[disabled]:muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
		// Unavailable
		'data-[unavailable]:muted data-[unavailable]:line-through',
		// hover
		'dark:hover:text-accent-foreground',
		// focus
		'focus:relative focus:border-ring focus:ring-ring/50',
		// inner spans
		'[&>span]:calendar-caption [&>span]:opacity-70',
		className
	)}
	{...restProps}
/>
