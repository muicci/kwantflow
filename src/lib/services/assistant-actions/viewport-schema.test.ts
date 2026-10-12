import { describe, it, expect } from 'vitest';
import { resolveScreenHint, SCREEN_ROUTE_HINTS } from './viewport-schema';

describe('resolveScreenHint', () => {
	it('returns null for unknown routes', () => {
		expect(resolveScreenHint('/')).toBeNull();
		expect(resolveScreenHint('/unknown-path')).toBeNull();
		expect(resolveScreenHint('/some/random/route')).toBeNull();
	});

	it('matches exact routes', () => {
		expect(resolveScreenHint('/contacts')).toEqual(SCREEN_ROUTE_HINTS['/contacts']);
		expect(resolveScreenHint('/materials')).toEqual(SCREEN_ROUTE_HINTS['/materials']);
		expect(resolveScreenHint('/settings')).toEqual(SCREEN_ROUTE_HINTS['/settings']);
	});

	it('matches routes by prefix', () => {
		expect(resolveScreenHint('/contacts/123')).toEqual(SCREEN_ROUTE_HINTS['/contacts']);
		expect(resolveScreenHint('/contacts/new/edit')).toEqual(SCREEN_ROUTE_HINTS['/contacts']);
		expect(resolveScreenHint('/settings/profile')).toEqual(SCREEN_ROUTE_HINTS['/settings']);
	});

	it('prioritizes longer prefixes over shorter ones', () => {
		// /project/ is longer than /project
		expect(resolveScreenHint('/project/123')).toEqual(SCREEN_ROUTE_HINTS['/project/']);
		expect(resolveScreenHint('/project/123/edit')).toEqual(SCREEN_ROUTE_HINTS['/project/']);

		// Exact match on /project should match /project (which has length 8, vs /project/ length 9)
		expect(resolveScreenHint('/project')).toEqual(SCREEN_ROUTE_HINTS['/project']);
	});
});
