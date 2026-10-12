import { describe, expect, it } from 'vitest';
import { isNavGroupOpen, isNavItemActive, type NavItem } from './nav-main.helpers.js';

const estimatingItem: NavItem = {
	title: 'Estimating',
	items: [
		{ title: 'Materials', url: '/materials' },
		{ title: 'Labour Rates', url: '/labour-rates' },
		{ title: 'Classification', url: '/classification-systems' },
		{ separator: true, key: 'reuse' },
		{ title: 'Estimate Templates', url: '/estimate-templates' }
	]
};

describe('nav-main grouped navigation', () => {
	it('treats the SPA fallback index path as the RFQ home route', () => {
		expect(isNavItemActive({ title: 'RFQs', url: '/' }, '/index.html')).toBe(true);
	});

	it('treats an empty pathname as the RFQ home route', () => {
		expect(isNavItemActive({ title: 'RFQs', url: '/' }, '')).toBe(true);
	});

	it('treats grouped parents as active when any child route is active', () => {
		expect(isNavItemActive(estimatingItem, '/materials')).toBe(true);
		expect(isNavItemActive(estimatingItem, '/labour-rates')).toBe(true);
		expect(isNavItemActive(estimatingItem, '/classification-systems/abc')).toBe(true);
		expect(isNavItemActive(estimatingItem, '/estimate-templates')).toBe(true);
		expect(isNavItemActive(estimatingItem, '/companies')).toBe(false);
	});

	it('keeps grouped parents open when a child route is active', () => {
		expect(isNavGroupOpen(estimatingItem, '/classification-systems/abc', false)).toBe(true);
		expect(isNavGroupOpen(estimatingItem, '/companies', true)).toBe(true);
		expect(isNavGroupOpen(estimatingItem, '/companies', false)).toBe(false);
	});
});
