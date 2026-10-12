/**
 * Calculates the total length of a path of coordinates.
 * @param points Array of [y, x] coordinates in the normalized 0-1000 space
 * @param calibrationFactor Scale factor (meters per pixel coordinate)
 */
export function calculatePathLength(points: [number, number][], calibrationFactor: number): number {
	if (!Array.isArray(points) || points.length < 2) return 0;
	let total = 0;
	for (let i = 0; i < points.length - 1; i++) {
		const [y1, x1] = points[i];
		const [y2, x2] = points[i + 1];
		const dx = x2 - x1;
		const dy = y2 - y1;
		total += Math.sqrt(dx * dx + dy * dy);
	}
	return total * calibrationFactor;
}

/**
 * Calculates the area of a closed polygon using the Shoelace formula.
 * @param points Array of [y, x] coordinates in the normalized 0-1000 space
 * @param calibrationFactor Scale factor (meters per pixel coordinate)
 */
export function calculatePolygonArea(
	points: [number, number][],
	calibrationFactor: number
): number {
	if (!Array.isArray(points) || points.length < 3) return 0;
	let area = 0;
	const n = points.length;
	for (let i = 0; i < n; i++) {
		const [y1, x1] = points[i];
		const [y2, x2] = points[(i + 1) % n];
		area += x1 * y2 - x2 * y1;
	}
	const pixelArea = Math.abs(area) / 2;
	// Real-world area scales with the square of the linear scale factor
	return pixelArea * calibrationFactor * calibrationFactor;
}
