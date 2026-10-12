import { isRfqHomeRoute, normaliseAppPathname } from '$lib/utils/route-path.js';

export type NavChildItem =
	| {
			title: string;
			url: string;
	  }
	| {
			separator: true;
			key: string;
	  };

export type NavItem = {
	title: string;
	url?: string;
	items?: NavChildItem[];
};

function isUrlActive(url: string, pathname: string): boolean {
	const normalisedPathname = normaliseAppPathname(pathname);

	if (url === '/') return isRfqHomeRoute(normalisedPathname);
	return normalisedPathname === url || normalisedPathname.startsWith(`${url}/`);
}

export function isNavItemActive(item: NavItem, pathname: string): boolean {
	if (item.items?.length) {
		return item.items.some((child) => 'url' in child && isUrlActive(child.url, pathname));
	}

	return item.url ? isUrlActive(item.url, pathname) : false;
}

export function isNavGroupOpen(
	item: NavItem,
	pathname: string,
	manuallyExpanded: boolean
): boolean {
	if (!item.items?.length) return false;
	return isNavItemActive(item, pathname) || manuallyExpanded;
}
