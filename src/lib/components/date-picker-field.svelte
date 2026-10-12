<script lang="ts">
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import { CalendarDate, getLocalTimeZone, parseDate } from '@internationalized/date';
	import { Button } from '$lib/components/ui/button/index.js';
	import Calendar from '$lib/components/ui/calendar/calendar.svelte';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { Meta } from '$lib/components/primitives/index.js';
	import { workspaceState } from '$lib/state/workspace.svelte.js';

	type DatePickerMode = 'date' | 'datetime';

	interface Props {
		id: string;
		value?: string;
		mode?: DatePickerMode;
		placeholder?: string;
		defaultTime?: string;
		onChange?: () => void;
	}

	let {
		id,
		value = $bindable<string | undefined>(),
		mode = 'date',
		placeholder = 'Select date',
		defaultTime = '17:00',
		onChange = () => {}
	}: Props = $props();

	type CalendarLike =
		CalendarDate | string | { year?: number; month?: number; day?: number; toDate?: unknown };

	let open = $state(false);
	let calendarValue = $state<CalendarLike | undefined>();
	let timeValue = $state('');
	let previousExternalValue = $state<string | undefined>();

	function padDatePart(value: number): string {
		return String(value).padStart(2, '0');
	}

	function normaliseCalendarDate(date: CalendarLike | undefined): CalendarDate | undefined {
		if (!date) return undefined;
		if (date instanceof CalendarDate) return date;
		if (typeof date === 'string') return parseCalendarDate(date);
		if (
			typeof date.year === 'number' &&
			typeof date.month === 'number' &&
			typeof date.day === 'number'
		) {
			return new CalendarDate(date.year, date.month, date.day);
		}
		return undefined;
	}

	function calendarDateToString(date: CalendarLike): string {
		const normalised = normaliseCalendarDate(date);
		return normalised
			? `${normalised.year}-${padDatePart(normalised.month)}-${padDatePart(normalised.day)}`
			: '';
	}

	function dateToNativeDate(date: CalendarLike): Date | undefined {
		if (typeof date !== 'string' && typeof date.toDate === 'function') {
			return date.toDate(getLocalTimeZone());
		}
		return normaliseCalendarDate(date)?.toDate(getLocalTimeZone());
	}

	function datePart(raw: string | null | undefined): string {
		return raw?.split('T')[0]?.trim() ?? '';
	}

	function timePart(raw: string | null | undefined): string {
		const time = raw?.split('T')[1]?.slice(0, 5)?.trim();
		return time || defaultTime;
	}

	function parseCalendarDate(raw: string | null | undefined): CalendarDate | undefined {
		const date = datePart(raw);
		if (!date) return undefined;
		try {
			return parseDate(date);
		} catch {
			return undefined;
		}
	}

	function composeValue(date: CalendarLike, time: string): string {
		const nextDate = calendarDateToString(date);
		if (!nextDate) return '';
		return mode === 'datetime' ? `${nextDate}T${time || defaultTime}` : nextDate;
	}

	function displayValue(): string {
		if (!calendarValue) return placeholder;
		const nativeDate = dateToNativeDate(calendarValue);
		if (!nativeDate || Number.isNaN(nativeDate.getTime())) return placeholder;
		const formattedDate = nativeDate.toLocaleDateString(workspaceState.dateFormat, {
			day: 'numeric',
			month: 'short',
			year: 'numeric'
		});
		return mode === 'datetime' ? `${formattedDate} · ${timeValue}` : formattedDate;
	}

	function commitValue(nextDate = calendarValue, nextTime = timeValue): void {
		if (!nextDate) return;
		const nextValue = composeValue(nextDate, nextTime);
		if (!nextValue || nextValue === value) return;
		value = nextValue;
		previousExternalValue = nextValue;
		onChange();
	}

	function clearValue(): void {
		if (!value && !calendarValue) return;
		value = '';
		calendarValue = undefined;
		timeValue = defaultTime;
		previousExternalValue = '';
		onChange();
		open = false;
	}

	$effect(() => {
		if (value === previousExternalValue) return;
		previousExternalValue = value;
		calendarValue = parseCalendarDate(value);
		timeValue = timePart(value);
	});

	$effect(() => {
		if (!calendarValue) return;
		commitValue(calendarValue, timeValue);
	});
</script>

<Popover.Root bind:open>
	<Popover.Trigger>
		{#snippet child({ props })}
			<button
				{...props}
				{id}
				type="button"
				class="field-copy ui-field-control-base ui-select-control ui-field-control-focus ui-field-size-default w-full text-left disabled:cursor-not-allowed disabled:opacity-50"
				aria-label={displayValue()}
			>
				<span class={calendarValue ? 'truncate' : 'muted truncate'}>{displayValue()}</span>
				<CalendarIcon class="muted size-4" />
			</button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content align="start" class="ui-popover-padding-none">
		<div class="flex flex-col gap-3 p-3">
			<Calendar
				type="single"
				bind:value={calendarValue}
				captionLayout="dropdown"
				locale={workspaceState.languageLocale || workspaceState.dateFormat}
			/>
			{#if mode === 'datetime'}
				<div class="flex items-center gap-2 border-t pt-3">
					<ClockIcon class="muted size-4" />
					<div class="min-w-0 flex-1">
						<Meta>Time</Meta>
						<Input
							type="time"
							bind:value={timeValue}
							size="default"
							oninput={() => commitValue(calendarValue, timeValue)}
						/>
					</div>
				</div>
			{/if}
			<div class="flex justify-end gap-2 border-t pt-3">
				<Button type="button" variant="ghost" size="sm" onclick={clearValue}>Clear</Button>
				<Button type="button" variant="default" size="sm" onclick={() => (open = false)}
					>Done</Button
				>
			</div>
		</div>
	</Popover.Content>
</Popover.Root>
