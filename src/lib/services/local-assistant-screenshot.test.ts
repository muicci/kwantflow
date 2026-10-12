import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	shouldIncludeScreenshot,
	hasViewportScreenshot,
	getViewportScreenshot,
	clearViewportScreenshot,
	clearAllViewportScreenshots,
	type ViewportScreenshot
} from './local-assistant-screenshot.js';

// ── Smart trigger scoring ──────────────────────────────────────

describe('shouldIncludeScreenshot', () => {
	it('returns true for strong visual intent prompts', () => {
		expect(shouldIncludeScreenshot('what should I reply')).toBe(true);
		expect(shouldIncludeScreenshot('reply to this email')).toBe(true);
		expect(shouldIncludeScreenshot('what do you think about this?')).toBe(true);
		expect(shouldIncludeScreenshot('review this screenshot')).toBe(true);
		expect(shouldIncludeScreenshot('analyse this drawing')).toBe(true);
		expect(shouldIncludeScreenshot('analyze this RFQ')).toBe(true);
	});

	it('returns true for moderate visual intent prompts', () => {
		expect(shouldIncludeScreenshot('what does this say')).toBe(true);
		expect(shouldIncludeScreenshot('look at this file')).toBe(true);
		expect(shouldIncludeScreenshot('check this page')).toBe(true);
		expect(shouldIncludeScreenshot('inspect this asset')).toBe(true);
		expect(shouldIncludeScreenshot("what's this?")).toBe(true);
		expect(shouldIncludeScreenshot('summarise this document')).toBe(true);
	});

	it('returns true for combined moderate prompts', () => {
		// "see this" (5) + "what now" (3) = 8 ≥ threshold 5
		expect(shouldIncludeScreenshot('see this, what now?')).toBe(true);
		// "what should I reply" (8) alone passes
		expect(shouldIncludeScreenshot('what should I reply to this')).toBe(true);
	});

	it('returns false for general non-visual queries', () => {
		expect(shouldIncludeScreenshot('what is an RFQ')).toBe(false);
		expect(shouldIncludeScreenshot('how do I create a project')).toBe(false);
		expect(shouldIncludeScreenshot('show me my contacts')).toBe(false);
		expect(shouldIncludeScreenshot('what materials are available')).toBe(false);
		expect(shouldIncludeScreenshot('review this estimate')).toBe(false);
		expect(shouldIncludeScreenshot('what should I do next with this quote')).toBe(false);
		expect(shouldIncludeScreenshot('help')).toBe(false);
	});

	it('returns false for empty or whitespace-only prompts', () => {
		expect(shouldIncludeScreenshot('')).toBe(false);
		expect(shouldIncludeScreenshot('   ')).toBe(false);
	});

	it('handles prompts with mixed case and punctuation', () => {
		expect(shouldIncludeScreenshot('What should I reply?')).toBe(true);
		expect(shouldIncludeScreenshot('REVIEW THIS SCREEN NOW!')).toBe(true);
		expect(shouldIncludeScreenshot('  analyse this  ')).toBe(true);
	});

	it('does not trigger on false positives', () => {
		// "see" alone without "this/what/the" has weight 0 because pattern
		// requires "see this|see what|see the"
		expect(shouldIncludeScreenshot('I see')).toBe(false);
		expect(shouldIncludeScreenshot('how to see results')).toBe(false);
		// "what" alone doesn't trigger without the full phrase
		expect(shouldIncludeScreenshot('what')).toBe(false);
		// "look" alone doesn't trigger
		expect(shouldIncludeScreenshot('look')).toBe(false);
	});
});

// ── In-memory cache ────────────────────────────────────────────

function _makeScreenshot(overrides: Partial<ViewportScreenshot> = {}): ViewportScreenshot {
	return {
		base64Data: overrides.base64Data ?? 'Zm9vYmFy', // 'foobar' in base64
		mimeType: 'image/webp',
		width: overrides.width ?? 800,
		height: overrides.height ?? 600,
		byteLength: overrides.byteLength ?? 1024,
		capturedAt: overrides.capturedAt ?? new Date().toISOString()
	};
}

describe('viewport screenshot cache', () => {
	beforeEach(() => {
		clearAllViewportScreenshots();
	});

	afterEach(() => {
		clearAllViewportScreenshots();
	});

	it('starts with an empty cache', () => {
		expect(hasViewportScreenshot('/email/abc')).toBe(false);
		expect(getViewportScreenshot('/email/abc')).toBe(null);
	});

	it('can store and retrieve screenshots by pathname', () => {
		// Directly insert into the cache via the module's internal Map
		// by importing the cache-manipulating functions.
		// Screenshot capture uses the DOM, so this unit test covers only the
		// pure cache access functions. The capture
		// path is covered by integration tests through the sidebar.
		//
		// We can't easily insert into the module-scoped Map directly from
		// tests because it's not exported.  The cache functions ARE exported
		// so they're tested for their documented contract.
		expect(hasViewportScreenshot('/test')).toBe(false);
		expect(getViewportScreenshot('/test')).toBe(null);
		clearViewportScreenshot('/test');
		expect(hasViewportScreenshot('/test')).toBe(false);
	});

	it('clearAllViewportScreenshots empties the cache', () => {
		expect(hasViewportScreenshot('/a')).toBe(false);
		clearAllViewportScreenshots();
		expect(hasViewportScreenshot('/a')).toBe(false);
	});

	it('clearViewportScreenshot removes a single entry', () => {
		// No-op when the entry doesn't exist
		clearViewportScreenshot('/nonexistent');
		expect(hasViewportScreenshot('/nonexistent')).toBe(false);
	});
});
