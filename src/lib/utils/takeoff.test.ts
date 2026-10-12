import { describe, expect, it } from 'vitest';
import { calculatePathLength, calculatePolygonArea } from './takeoff.js';

describe('takeoff math utilities', () => {
	it('calculates the Euclidean distance of a 2D coordinate path', () => {
		const points: [number, number][] = [
			[0, 0],
			[300, 400], // dy=300, dx=400 -> dist = 500
			[600, 800] // dy=300, dx=400 -> dist = 500
		];
		// Total pixel distance = 1000.
		// Scale: 0.05 meters per pixel.
		const length = calculatePathLength(points, 0.05);
		expect(length).toBeCloseTo(50);
	});

	it('calculates the real-world area of a closed polygon', () => {
		const points: [number, number][] = [
			[0, 0],
			[0, 200],
			[200, 200],
			[200, 0]
		];
		// Square with pixel area = 40000.
		// Scale: 0.1 meters per pixel.
		// Real-world area = 40000 * (0.1)^2 = 400 square meters.
		const area = calculatePolygonArea(points, 0.1);
		expect(area).toBeCloseTo(400);
	});

	it('returns 0 for empty or single-point arrays', () => {
		expect(calculatePathLength([], 1)).toBe(0);
		expect(calculatePathLength([[100, 100]], 1)).toBe(0);
		expect(calculatePolygonArea([], 1)).toBe(0);
		expect(
			calculatePolygonArea(
				[
					[100, 100],
					[200, 200]
				],
				1
			)
		).toBe(0);
	});
});
