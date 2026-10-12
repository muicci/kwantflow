import { describe, expect, it } from 'vitest';

import { getAppShellTitle, isRfqHomeRoute } from './route-path.js';

describe('isRfqHomeRoute', () => {
	it('returns true when routeId is "/"', () => {
		expect(isRfqHomeRoute('/some-path', '/')).toBe(true);
	});

	it('returns true when pathname is "/"', () => {
		expect(isRfqHomeRoute('/', '/some-route')).toBe(true);
	});

	it('returns true when pathname normalises to "/"', () => {
		expect(isRfqHomeRoute('/index.html', '/some-route')).toBe(true);
		expect(isRfqHomeRoute('/index.html')).toBe(true);
	});

	it('returns true when pathname is empty', () => {
		expect(isRfqHomeRoute('', '/some-route')).toBe(true);
	});

	it('returns false for other paths', () => {
		expect(isRfqHomeRoute('/companies', '/companies')).toBe(false);
		expect(isRfqHomeRoute('/projects/123', '/projects/[id]')).toBe(false);
	});
});

describe('getAppShellTitle', () => {
	it('uses Companies for the canonical companies route only', () => {
		expect(getAppShellTitle('/companies', '/companies', null)).toBe('Companies');
	});
});
