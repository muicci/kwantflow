export function shouldBypassProtectedRouteGuard(pathname: string): boolean {
	return /^\/preview\/asset\/[^/]+\/[^/]+\/?$/.test(pathname);
}

export function shouldRedirectProtectedRoute(pathname: string, isAccessReady: boolean): boolean {
	if (shouldBypassProtectedRouteGuard(pathname)) return false;
	if (pathname === '/') return false;
	return !isAccessReady;
}
