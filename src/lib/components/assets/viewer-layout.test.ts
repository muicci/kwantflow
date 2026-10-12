import { describe, expect, it } from 'vitest';

import {
	DEFAULT_ASSET_EDITOR_LAYOUT,
	DEFAULT_ESTIMATE_EDITOR_VERTICAL_LAYOUT,
	layoutsMatch,
	normaliseTwoPaneLayout
} from './viewer-layout.js';

describe('viewer layout helpers', () => {
	it('falls back when the layout is missing or invalid', () => {
		expect(normaliseTwoPaneLayout(undefined, DEFAULT_ASSET_EDITOR_LAYOUT)).toEqual(
			DEFAULT_ASSET_EDITOR_LAYOUT
		);
		expect(normaliseTwoPaneLayout([0, 100], DEFAULT_ASSET_EDITOR_LAYOUT)).toEqual(
			DEFAULT_ASSET_EDITOR_LAYOUT
		);
		expect(normaliseTwoPaneLayout([100], DEFAULT_ASSET_EDITOR_LAYOUT)).toEqual(
			DEFAULT_ASSET_EDITOR_LAYOUT
		);
	});

	it('normalises two-pane layouts to a clean 100% total', () => {
		expect(normaliseTwoPaneLayout([540, 460], DEFAULT_ASSET_EDITOR_LAYOUT)).toEqual([54, 46]);
		expect(normaliseTwoPaneLayout([53.6, 46.4], DEFAULT_ASSET_EDITOR_LAYOUT)).toEqual([54, 46]);
	});

	it('matches layouts with a small tolerance', () => {
		expect(layoutsMatch([54, 46], [54, 46])).toBe(true);
		expect(layoutsMatch([53.5, 46.5], [54, 46])).toBe(true);
		expect(layoutsMatch([40, 60], [54, 46])).toBe(false);
	});

	it('keeps a sane default for the vertical estimate editor split', () => {
		expect(DEFAULT_ESTIMATE_EDITOR_VERTICAL_LAYOUT).toEqual([34, 66]);
		expect(
			normaliseTwoPaneLayout(DEFAULT_ESTIMATE_EDITOR_VERTICAL_LAYOUT, DEFAULT_ASSET_EDITOR_LAYOUT)
		).toEqual([34, 66]);
	});
});
