export type TwoPaneLayout = [number, number];

export const DEFAULT_ASSET_EDITOR_LAYOUT: TwoPaneLayout = [54, 46];
export const DEFAULT_ESTIMATE_EDITOR_VERTICAL_LAYOUT: TwoPaneLayout = [34, 66];
export const EXPANDED_ASSET_VIEWER_LAYOUT: TwoPaneLayout = [6, 94];
export const DEFAULT_PDF_PREVIEW_LAYOUT: TwoPaneLayout = [76, 24];
export const WORKSPACE_RESIZE_HANDLE_CLASS =
	'bg-border/45 after:bg-transparent [&[data-direction=horizontal]>div]:border-border/70 [&[data-direction=horizontal]>div]:bg-muted/80 [&[data-direction=horizontal]>div]:opacity-100 [&[data-direction=vertical]>div]:border-border/80 [&[data-direction=vertical]>div]:bg-background/95 [&[data-direction=vertical]>div]:opacity-80';

export function normaliseTwoPaneLayout(
	layout: number[] | null | undefined,
	fallback: TwoPaneLayout
): TwoPaneLayout {
	if (
		!layout ||
		layout.length !== 2 ||
		layout.some((value) => !Number.isFinite(value) || value <= 0)
	) {
		return fallback;
	}

	const total = layout[0] + layout[1];
	if (!Number.isFinite(total) || total <= 0) {
		return fallback;
	}

	const first = Math.round((layout[0] / total) * 100);
	return [first, 100 - first];
}

export function layoutsMatch(
	a: number[] | null | undefined,
	b: TwoPaneLayout,
	tolerance = 1
): boolean {
	if (!a || a.length !== 2) return false;
	return Math.abs(a[0] - b[0]) <= tolerance && Math.abs(a[1] - b[1]) <= tolerance;
}
