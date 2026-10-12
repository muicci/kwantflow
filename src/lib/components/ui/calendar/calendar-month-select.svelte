<script lang="ts">
	import { Calendar as CalendarPrimitive } from 'bits-ui';
	import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';

	let {
		ref = $bindable(null),
		class: className,
		value,
		onchange,
		...restProps
	}: WithoutChildrenOrChild<CalendarPrimitive.MonthSelectProps> = $props();
</script>

<span
	class={cn(
		'ui-radius-sm field-surface relative flex border border-input has-focus:border-ring has-focus:ring-[3px] has-focus:ring-ring/50',
		className
	)}
>
	<CalendarPrimitive.MonthSelect
		bind:ref
		class="absolute inset-0 opacity-0 dark:bg-popover dark:text-popover-foreground"
		{...restProps}
	>
		{#snippet child({ props, monthItems, selectedMonthItem })}
			<select {...props} {value} {onchange}>
				{#each monthItems as monthItem (monthItem.value)}
					<option
						value={monthItem.value}
						selected={value !== undefined
							? monthItem.value === value
							: monthItem.value === selectedMonthItem.value}
					>
						{monthItem.label}
					</option>
				{/each}
			</select>
			<span
				class="calendar-copy ui-radius-sm control-height-sm [&>svg]:muted flex items-center gap-1 ps-2 pe-1 select-none [&>svg]:size-3.5"
				aria-hidden="true"
			>
				{monthItems.find((item) => item.value === value)?.label || selectedMonthItem.label}
				<ChevronDownIcon class="muted size-4" />
			</span>
		{/snippet}
	</CalendarPrimitive.MonthSelect>
</span>
