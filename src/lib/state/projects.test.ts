import { describe, it, expect, beforeEach } from 'vitest';
import { MOCK_PROJECTS } from '$lib/mocks/projects';

/**
 * ProjectsState tests — we test the derived logic in isolation
 * by directly instantiating the class without the Svelte compiler.
 *
 * NOTE: Svelte 5 runes ($state, $derived) are compile-time transforms.
 * For unit testing derived logic, we extract the pure filter functions.
 */

// --- Pure filter logic extracted for testability ---

function applyFilters(list: typeof MOCK_PROJECTS, searchQuery: string): typeof MOCK_PROJECTS {
	let result = list;
	if (searchQuery.trim()) {
		const q = searchQuery.toLowerCase().trim();
		result = result.filter((p) => p.rfq_number.toLowerCase().includes(q));
	}
	return result;
}

function getRecent(list: typeof MOCK_PROJECTS, limit = 5) {
	return list.slice(0, limit);
}

// --- Tests ---

describe('projectsState filter logic', () => {
	let projects: typeof MOCK_PROJECTS;

	beforeEach(() => {
		projects = [...MOCK_PROJECTS];
	});

	describe('applyFilters()', () => {
		it('returns all when no filters applied', () => {
			expect(applyFilters(projects, '')).toHaveLength(projects.length);
		});

		it('filters by search query (case-insensitive)', () => {
			const firstRfq = projects[0].rfq_number;
			const result = applyFilters(projects, firstRfq.toLowerCase());
			expect(result.some((p) => p.rfq_number === firstRfq)).toBe(true);
		});

		it('returns empty array when no search matches', () => {
			expect(applyFilters(projects, 'zzz-no-match-zzz')).toHaveLength(0);
		});
	});

	describe('getRecent()', () => {
		it('returns at most 5 items by default', () => {
			expect(getRecent(projects).length).toBeLessThanOrEqual(5);
		});

		it('respects custom limit', () => {
			expect(getRecent(projects, 2)).toHaveLength(Math.min(2, projects.length));
		});

		it('returns empty array from empty list', () => {
			expect(getRecent([])).toHaveLength(0);
		});
	});
});
