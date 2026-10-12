export function normaliseAppPathname(pathname: string): string {
	if (pathname === '/index.html') return '/';
	if (pathname.endsWith('/index.html')) {
		const basePath = pathname.slice(0, -'/index.html'.length);
		return basePath || '/';
	}
	return pathname;
}

export function isRfqHomeRoute(pathname: string, routeId = ''): boolean {
	const normalisedPathname = normaliseAppPathname(pathname);
	return routeId === '/' || normalisedPathname === '/' || normalisedPathname === '';
}

export function getAppShellTitle(
	pathname: string,
	routeId: string,
	currentProjectNumber: string | null,
	currentPreviewFileName: string | null = null
): string {
	const normalisedPathname = normaliseAppPathname(pathname);

	if (isRfqHomeRoute(normalisedPathname, routeId)) return 'RFQs';
	if (normalisedPathname === '/companies') return 'Companies';
	if (normalisedPathname === '/materials') return 'Materials';
	if (normalisedPathname === '/labour-rates') return 'Labour Rates';
	if (normalisedPathname === '/equipment-rates') return 'Equipment Rates';
	if (normalisedPathname === '/subcontract-rates') return 'Subcontract Rates';
	if (normalisedPathname === '/cost-presets') return 'Cost Presets';
	if (normalisedPathname === '/estimate-templates') return 'Estimate Templates';
	if (normalisedPathname.startsWith('/classification-systems')) return 'Classification';
	if (normalisedPathname.startsWith('/preview/file/')) {
		return currentPreviewFileName?.trim() || 'File Preview';
	}
	if (normalisedPathname.startsWith('/project/') && currentProjectNumber) {
		return currentProjectNumber;
	}

	return 'Kwantflow';
}
