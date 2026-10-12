import {
	format,
	formatDistanceToNow,
	differenceInBusinessDays,
	isBefore,
	startOfDay,
	parseISO
} from 'date-fns';
import { createLogger } from '../services/logger.js';
import { workspaceState } from '../state/workspace.svelte';

const log = createLogger('dateUtils');

function parseRFQDate(date: string | Date): Date {
	if (!date) return new Date();
	return typeof date === 'string' ? parseISO(date) : date;
}

/**
 * Formats a date according to the user's preferred format (en-GB vs standard).
 * High-density HUD standard.
 */
export function formatRFQDate(date: string | Date): string {
	try {
		const d = parseRFQDate(date);
		const pattern = workspaceState.dateFormat === 'en-US' ? 'MMM d, yyyy' : 'dd MMM yyyy';
		return format(d, pattern);
	} catch (err) {
		log.error('Failed to format date', err);
		return String(date);
	}
}

/**
 * Returns a relative time string (e.g., "in 3 days", "2 hours ago").
 */
export function formatRelativeDate(date: string | Date): string {
	try {
		return formatDistanceToNow(parseRFQDate(date), { addSuffix: true });
	} catch {
		return '';
	}
}

/**
 * Calculates urgency level for UI coloring and status dots.
 */
export function getUrgencyLevel(date: string | Date): 'none' | 'warning' | 'critical' {
	try {
		const d = parseRFQDate(date);
		const today = startOfDay(new Date());

		if (isBefore(d, today)) return 'critical';

		// If due within 2 business days, it's a warning
		if (differenceInBusinessDays(d, today) <= 2) return 'warning';

		return 'none';
	} catch {
		return 'none';
	}
}

export { addBusinessDays, differenceInBusinessDays } from 'date-fns';
