import { describe, expect, it } from 'vitest';

import type { AppTabRecord } from '$lib/state/app-tabs.svelte.js';

import {
	computeTabStripLayout,
	MAX_VISIBLE_TABS,
	MIN_TAB_WIDTH_PX,
	TAB_ACTION_BUTTON_WIDTH_PX,
	TAB_GAP_PX,
	TAB_RAIL_PADDING_PX
} from './app-shell-tab-strip.layout.js';

function createTabs(count: number): AppTabRecord[] {
	return Array.from({ length: count }, (_, index) => ({
		id: index === 0 ? 'rfqs' : (`project:${index}` as const),
		kind: index === 0 ? 'page' : 'project',
		...(index === 0
			? { route: '/', title: 'RFQs' }
			: {
					projectId: `project-${index}`,
					route: `/project/project-${index}`,
					title: `RFQ-${index}`
				}),
		dirty: false
	})) as AppTabRecord[];
}

function widthForSlots(tabCount: number, includeOverflow = false): number {
	const buttonCount = includeOverflow ? 2 : 1;
	const gapCount = includeOverflow ? 1 : 0;
	return (
		tabCount * (MIN_TAB_WIDTH_PX + TAB_GAP_PX) -
		TAB_GAP_PX +
		buttonCount * TAB_ACTION_BUTTON_WIDTH_PX +
		gapCount * TAB_GAP_PX +
		TAB_RAIL_PADDING_PX
	);
}

describe('computeTabStripLayout', () => {
	it('shows all tabs when there is enough width', () => {
		const tabs = createTabs(4);
		const layout = computeTabStripLayout({
			tabs,
			activeTabId: 'project:2',
			availableWidthPx: widthForSlots(4)
		});

		expect(layout.visibleTabs.map((tab) => tab.id)).toEqual(tabs.map((tab) => tab.id));
		expect(layout.overflowTabs).toEqual([]);
		expect(layout.showOverflowTrigger).toBe(false);
	});

	it('caps visible tabs at the shared maximum', () => {
		const tabs = createTabs(14);
		const layout = computeTabStripLayout({
			tabs,
			activeTabId: 'project:11',
			availableWidthPx: widthForSlots(12, true)
		});

		expect(layout.visibleTabs).toHaveLength(MAX_VISIBLE_TABS);
		expect(layout.showOverflowTrigger).toBe(true);
		expect(layout.visibleTabs.some((tab) => tab.id === 'project:11')).toBe(true);
	});

	it('keeps the active tab visible near the end of the sequence', () => {
		const tabs = createTabs(12);
		const layout = computeTabStripLayout({
			tabs,
			activeTabId: 'project:10',
			availableWidthPx: widthForSlots(6, true)
		});

		expect(layout.visibleTabs.some((tab) => tab.id === 'project:10')).toBe(true);
		expect(layout.overflowTabs.some((tab) => tab.id === 'project:10')).toBe(false);
	});

	it('keeps overflow tabs in order outside the visible window', () => {
		const tabs = createTabs(9);
		const layout = computeTabStripLayout({
			tabs,
			activeTabId: 'project:4',
			availableWidthPx: widthForSlots(5, true)
		});

		expect(layout.overflowTabs.map((tab) => tab.id)).toEqual([
			'rfqs',
			'project:1',
			'project:7',
			'project:8'
		]);
	});
});
