import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { formatRFQDate } from './date.js';
import { workspaceState } from '../state/workspace.svelte.js';

// Mock the logger to prevent error output during tests
vi.mock('../services/logger.js', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn()
	})
}));

describe('date utils', () => {
	describe('formatRFQDate', () => {
		const originalDateFormat = workspaceState.dateFormat;

		beforeEach(() => {
			workspaceState.dateFormat = 'en-US';
		});

		afterEach(() => {
			workspaceState.dateFormat = originalDateFormat;
			vi.clearAllMocks();
		});

		it('formats date correctly using en-US format', () => {
			expect(formatRFQDate('2023-12-25')).toBe('Dec 25, 2023');
		});

		it('formats date correctly using en-GB format', () => {
			workspaceState.dateFormat = 'en-GB';
			expect(formatRFQDate('2023-12-25')).toBe('25 Dec 2023');
		});

		it('returns original string on invalid date input', () => {
			const invalidDate = 'not-a-valid-date';
			expect(formatRFQDate(invalidDate)).toBe(invalidDate);
		});

		it('returns original string if date-fns throws on invalid ISO string', () => {
			expect(formatRFQDate('2023-13-45')).toBe('2023-13-45');
		});

		it('returns string representation of Date object on error', () => {
			const invalidDate = new Date('invalid');
			expect(formatRFQDate(invalidDate)).toBe(String(invalidDate));
		});
	});
});
