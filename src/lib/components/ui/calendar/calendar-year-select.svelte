<script lang="ts">
	import { Calendar as CalendarPrimitive } from 'bits-ui';
	import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';

	let {
		ref = $bindable(null),
		class: className,
		value,
		...restProps
	}: WithoutChildrenOrChild<CalendarPrimitive.YearSelectProps> = $props();
</script>

<span
	class={cn(
		'ui-radius-sm field-surface relative flex border border-input has-focus:border-ring has-focus:ring-[3px] has-focus:ring-ring/50',
		className
	)}
>
	<CalendarPrimitive.YearSelect
		bind:ref
		class="absolute inset-0 opacity-0 dark:bg-popover dark:text-popover-foreground"
		{...restProps}
	>
		{#snippet child({ props, yearItems, selectedYearItem })}
			<select {...props} {value}>
				{#each yearItems as yearItem (yearItem.value)}
					<option
						value={yearItem.value}
						selected={value !== undefined
							? yearItem.value === value
							: yearItem.value === selectedYearItem.value}
					>
						{yearItem.label}
					</option>
				{/each}
			</select>
			<span
				class="calendar-copy ui-radius-sm control-height-sm [&>svg]:muted flex items-center gap-1 ps-2 pe-1 select-none [&>svg]:size-3.5"
				aria-hidden="true"
			>
				{yearItems.find((item) => item.value === value)?.label || selectedYearItem.label}
				<ChevronDownIcon class="muted size-4" />
			</span>
		{/snippet}
	</CalendarPrimitive.YearSelect>
</span>
