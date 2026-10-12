import type { AppTabRecord } from '$lib/state/app-tabs.svelte.js';

export const MAX_VISIBLE_TABS = 10;
export const MIN_TAB_WIDTH_PX = 128;
export const TAB_GAP_PX = 4;
export const TAB_RAIL_PADDING_PX = 8;
export const TAB_ACTION_BUTTON_WIDTH_PX = 28;

export type TabStripLayout = {
	visibleTabs: AppTabRecord[];
	overflowTabs: AppTabRecord[];
	capacity: number;
	showOverflowTrigger: boolean;
};

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(Math.max(value, minimum), maximum);
}

function getActionWidthPx(showOverflowTrigger: boolean): number {
	const buttonCount = showOverflowTrigger ? 2 : 1;
	const gapCount = showOverflowTrigger ? 1 : 0;
	return buttonCount * TAB_ACTION_BUTTON_WIDTH_PX + gapCount * TAB_GAP_PX + TAB_RAIL_PADDING_PX;
}

function getCapacityForWidth(availableWidthPx: number, showOverflowTrigger: boolean): number {
	const actionWidth = getActionWidthPx(showOverflowTrigger);
	const usableWidth = Math.max(0, availableWidthPx - actionWidth);
	const slotWidth = MIN_TAB_WIDTH_PX + TAB_GAP_PX;
	const capacity = Math.floor((usableWidth + TAB_GAP_PX) / slotWidth);
	return clamp(capacity, 1, MAX_VISIBLE_TABS);
}

export function computeTabStripLayout({
	tabs,
	activeTabId,
	availableWidthPx
}: {
	tabs: AppTabRecord[];
	activeTabId: string | null;
	availableWidthPx: number;
}): TabStripLayout {
	if (tabs.length === 0) {
		return {
			visibleTabs: [],
			overflowTabs: [],
			capacity: 1,
			showOverflowTrigger: false
		};
	}

	const capacityWithoutOverflow = getCapacityForWidth(availableWidthPx, false);
	if (tabs.length <= capacityWithoutOverflow) {
		return {
			visibleTabs: tabs,
			overflowTabs: [],
			capacity: capacityWithoutOverflow,
			showOverflowTrigger: false
		};
	}

	const capacityWithOverflow = getCapacityForWidth(availableWidthPx, true);
	const activeIndex = Math.max(
		0,
		tabs.findIndex((tab) => tab.id === activeTabId)
	);
	const start = clamp(
		activeIndex - Math.floor(capacityWithOverflow / 2),
		0,
		Math.max(0, tabs.length - capacityWithOverflow)
	);
	const end = start + capacityWithOverflow;
	const visibleTabs = tabs.slice(start, end);
	const overflowTabs = [...tabs.slice(0, start), ...tabs.slice(end)];

	return {
		visibleTabs,
		overflowTabs,
		capacity: capacityWithOverflow,
		showOverflowTrigger: overflowTabs.length > 0
	};
}
