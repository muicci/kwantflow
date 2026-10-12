import { describe, expect, it } from 'vitest';

describe('onboarding route guard helpers', () => {
	it('does not redirect the detached asset preview route', async () => {
		const { shouldBypassProtectedRouteGuard, shouldRedirectProtectedRoute } =
			await import('./onboarding-route-guard.js');

		expect(shouldBypassProtectedRouteGuard('/preview/asset/project-1/asset-1')).toBe(true);
		expect(shouldRedirectProtectedRoute('/preview/asset/project-1/asset-1', false)).toBe(false);
	});

	it('does not redirect the root route', async () => {
		const { shouldRedirectProtectedRoute } = await import('./onboarding-route-guard.js');
		expect(shouldRedirectProtectedRoute('/', false)).toBe(false);
	});

	it('does not redirect once onboarding access is ready', async () => {
		const { shouldRedirectProtectedRoute } = await import('./onboarding-route-guard.js');
		expect(shouldRedirectProtectedRoute('/project/project-1', true)).toBe(false);
	});

	it('redirects protected routes while onboarding is still gated', async () => {
		const { shouldRedirectProtectedRoute } = await import('./onboarding-route-guard.js');
		expect(shouldRedirectProtectedRoute('/project/project-1', false)).toBe(true);
	});
});
