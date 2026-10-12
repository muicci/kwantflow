import html2canvas from 'html2canvas';
import { createLogger } from '$lib/services/logger.js';

const log = createLogger('assistantScreenshot');

/** Selector for the main content element to capture (set in +layout.svelte). */
const VIEWPORT_SELECTOR = '[data-viewport-screenshot]';

/** Max width/height the screenshot is scaled to before conversion. */
const MAX_VIEWPORT_SCREENSHOT_EDGE = 768;

/** WebP quality (0.0–1.0) for the screenshot. Higher = larger file. */
const WEBP_QUALITY = 0.75;

// ── In-memory cache (cleared on app restart) ──────────────────────

export interface ViewportScreenshot {
	/** Raw base64 bytes (no data-URL prefix). */
	base64Data: string;
	/** Always 'image/webp'. */
	mimeType: 'image/webp';
	/** Pixel width of the captured image. */
	width: number;
	/** Pixel height of the captured image. */
	height: number;
	/** Byte length of the encoded WebP payload. */
	byteLength: number;
	/** ISO timestamp of when the capture was taken. */
	capturedAt: string;
}

const _cache = new Map<string, ViewportScreenshot>();

// ── DOM helpers ────────────────────────────────────────────────────

function findViewportElement(): HTMLElement | null {
	if (typeof document === 'undefined') return null;
	const el = document.querySelector(VIEWPORT_SELECTOR);
	if (!(el instanceof HTMLElement)) return null;
	// In Tauri, the element must be an Element; html2canvas needs an HTMLElement.
	return el;
}

function clampDimensions(width: number, height: number): { width: number; height: number } {
	if (width <= 0 || height <= 0)
		return { width: MAX_VIEWPORT_SCREENSHOT_EDGE, height: MAX_VIEWPORT_SCREENSHOT_EDGE };
	const longest = Math.max(width, height);
	if (longest <= MAX_VIEWPORT_SCREENSHOT_EDGE) return { width, height };
	const scale = MAX_VIEWPORT_SCREENSHOT_EDGE / longest;
	return {
		width: Math.round(width * scale),
		height: Math.round(height * scale)
	};
}

// ── Capture ────────────────────────────────────────────────────────

/**
 * Immediately capture the main content area as a WebP screenshot
 * and store it in the in-memory cache, keyed by pathname.
 */
export async function captureViewportScreenshot(pathname: string): Promise<void> {
	const element = findViewportElement();
	if (!element) {
		log.debug('No viewport element found for screenshot capture');
		return;
	}

	// Temporarily override the main global window's getComputedStyle to catch all calls by html2canvas
	const originalGlobalGetComputedStyle = window.getComputedStyle;
	window.getComputedStyle = function (elt: Element, pseudoElt?: string | null) {
		const style = originalGlobalGetComputedStyle.call(window, elt, pseudoElt);
		return new Proxy(style, {
			get(target, prop) {
				const value = Reflect.get(target, prop, target);
				if (typeof value === 'function') {
					if (prop === 'getPropertyValue') {
						return function (key: string) {
							const val = target.getPropertyValue(key);
							if (typeof val === 'string') {
								return cleanUnsupportedColors(val);
							}
							return val;
						};
					}
					return value.bind(target);
				}
				if (typeof value === 'string') {
					return cleanUnsupportedColors(value);
				}
				return value;
			}
		});
	};

	try {
		const { width: naturalWidth, height: naturalHeight } = element.getBoundingClientRect();
		if (naturalWidth <= 0 || naturalHeight <= 0) return;

		const { width, height } = clampDimensions(naturalWidth, naturalHeight);

		const canvas = await html2canvas(element, {
			width,
			height,
			scale: 1,
			useCORS: true,
			allowTaint: false,
			backgroundColor: null, // preserve theme background
			logging: false,
			onclone: (clonedDoc) => {
				const clonedWindow = clonedDoc.defaultView;
				if (!clonedWindow) return;

				const originalGetComputedStyle = clonedWindow.getComputedStyle;
				clonedWindow.getComputedStyle = function (elt: Element, pseudoElt?: string | null) {
					const style = originalGetComputedStyle.call(clonedWindow, elt, pseudoElt);
					return new Proxy(style, {
						get(target, prop) {
							const value = Reflect.get(target, prop, target);
							if (typeof value === 'function') {
								if (prop === 'getPropertyValue') {
									return function (key: string) {
										const val = target.getPropertyValue(key);
										if (typeof val === 'string') {
											return cleanUnsupportedColors(val);
										}
										return val;
									};
								}
								return value.bind(target);
							}
							if (typeof value === 'string') {
								return cleanUnsupportedColors(value);
							}
							return value;
						}
					});
				};
			}
		});

		const dataUrl = canvas.toDataURL('image/webp', WEBP_QUALITY);
		// Strip the data-URL prefix to get raw base64 (matches LocalAssistantImageAttachment format).
		const base64Data = dataUrl.replace(/^data:image\/webp;base64,/, '');
		const byteLength = Math.round((base64Data.length * 3) / 4);

		const screenshot: ViewportScreenshot = {
			base64Data,
			mimeType: 'image/webp',
			width: canvas.width,
			height: canvas.height,
			byteLength,
			capturedAt: new Date().toISOString()
		};

		_cache.set(pathname, screenshot);
		log.debug('Viewport screenshot captured', {
			pathname,
			width: canvas.width,
			height: canvas.height,
			byteLength
		});
	} catch (error) {
		log.warn('Viewport screenshot capture failed', {
			pathname,
			error: error instanceof Error ? error.message : String(error)
		});
	} finally {
		// Restore the original global window.getComputedStyle
		window.getComputedStyle = originalGlobalGetComputedStyle;
	}
}

// ── Cache access ───────────────────────────────────────────────────

/** Return the cached screenshot for a pathname, or null. */
export function getViewportScreenshot(pathname: string): ViewportScreenshot | null {
	return _cache.get(pathname) ?? null;
}

/** True when a cached (and reasonably fresh) screenshot exists. */
export function hasViewportScreenshot(pathname: string): boolean {
	return _cache.has(pathname);
}

/** Clear a single entry from the cache. */
export function clearViewportScreenshot(pathname: string): void {
	_cache.delete(pathname);
}

/** Clear the entire screenshot cache (e.g. on session reset). */
export function clearAllViewportScreenshots(): void {
	_cache.clear();
}

// ── Smart triggering ───────────────────────────────────────────────

/**
 * Keywords / phrases that suggest the AI assistant would benefit from
 * seeing what's currently on screen.  Scored — more matches = higher
 * confidence that a screenshot should be included.
 */
const VISUAL_INTENT_PATTERNS: Array<{ pattern: RegExp; weight: number }> = [
	// Strong visual intent — high weight
	{ pattern: /\bwhat\s+should\s+(I|we)\s+reply\b/i, weight: 8 },
	{ pattern: /\breply\s+to\s+this\b/i, weight: 8 },
	{ pattern: /\bwhat\s+do\s+you\s+think\b/i, weight: 7 },
	{
		pattern: /\breview\s+this\s+(screen|screenshot|image|photo|picture|drawing|plan|pdf)\b/i,
		weight: 7
	},
	{ pattern: /\banaly[sz]e\s+this\b/i, weight: 7 },
	{ pattern: /\bwhat\s+(am\s+I|are\s+we)\s+looking\s+at\b/i, weight: 7 },
	// Moderate visual intent
	{ pattern: /\bwhat\s+does\s+this\s+(say|show|mean)\b/i, weight: 6 },
	{ pattern: /\blook\s+at\s+this\b/i, weight: 6 },
	{ pattern: /\bcheck\s+this\b/i, weight: 5 },
	{ pattern: /\bsee\s+(this|what|the)\b/i, weight: 5 },
	{ pattern: /\b(inspect|examine)\s+this\b/i, weight: 5 },
	{ pattern: /\bwhat(['’]?s)\s+(this|that|here)\b/i, weight: 5 },
	// Lighter intent — may still benefit from visual
	{ pattern: /\bsummari[sz]e\s+this\b/i, weight: 4 },
	{ pattern: /\bthis\s+(page|screen|view|file|document|email)\b/i, weight: 4 },
	{ pattern: /\bhow\s+(should|would|do)\s+(I|we)\s+(respond|answer)\b/i, weight: 4 },
	{ pattern: /\bwhat\s+now\b/i, weight: 3 },
	{ pattern: /\bexplain\s+this\b/i, weight: 3 }
];

/** Minimum cumulative score to auto-include the screenshot. */
const VISUAL_INTENT_THRESHOLD = 5;

/**
 * Returns `true` when the user's prompt indicates they'd benefit from
 * the AI seeing the current screen.  Use a cumulative weighted score
 * across all matched patterns — avoids false positives on single weak
 * matches.
 */
export function shouldIncludeScreenshot(prompt: string): boolean {
	const trimmed = prompt.trim();
	if (!trimmed) return false;

	let score = 0;
	for (const { pattern, weight } of VISUAL_INTENT_PATTERNS) {
		if (pattern.test(trimmed)) {
			score += weight;
			if (score >= VISUAL_INTENT_THRESHOLD) return true;
		}
	}
	return false;
}

// ── Color conversion helpers for html2canvas WebKit compatibility ──

function parseColorComponent(str: string): number {
	if (str.endsWith('%')) {
		return parseFloat(str) / 100;
	}
	return parseFloat(str);
}

function parseAlphaComponent(str: string): number {
	if (str.endsWith('%')) {
		return parseFloat(str) / 100;
	}
	return parseFloat(str);
}

function convertDisplayP3ToRgb(colorStr: string): string {
	return colorStr.replace(
		/color\((?:display-p3|srgb|rec2020|a98-rgb|prophoto-rgb)\s+([0-9.%]+)\s+([0-9.%]+)\s+([0-9.%]+)(?:\s*\/\s*([0-9.%]+))?\)/g,
		(match, rStr, gStr, bStr, aStr) => {
			const r = Math.round(parseColorComponent(rStr) * 255);
			const g = Math.round(parseColorComponent(gStr) * 255);
			const b = Math.round(parseColorComponent(bStr) * 255);
			if (aStr !== undefined) {
				const a = parseAlphaComponent(aStr);
				return `rgba(${r}, ${g}, ${b}, ${a})`;
			}
			return `rgb(${r}, ${g}, ${b})`;
		}
	);
}

function cleanUnsupportedColors(colorStr: string): string {
	if (!colorStr) return colorStr;
	let cleaned = colorStr;
	if (cleaned.includes('color(')) {
		cleaned = convertDisplayP3ToRgb(cleaned);
	}
	if (cleaned.includes('oklab(') || cleaned.includes('oklch(')) {
		// Convert oklab() or oklch() to a simple fallback color to prevent html2canvas parser crash.
		// html2canvas fails with "Attempting to parse an unsupported color function 'oklab'" on oklab/oklch colors.
		// Replace them with a safe fallback like rgb(244, 244, 245).
		cleaned = cleaned.replace(/oklab\([^)]+\)/g, 'rgb(244, 244, 245)');
		cleaned = cleaned.replace(/oklch\([^)]+\)/g, 'rgb(244, 244, 245)');
	}
	return cleaned;
}
