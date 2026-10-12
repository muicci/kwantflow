import type { SidebarPanelId } from '$lib/constants/sidebar.js';
import { APP_SHELL_PAGE_DESTINATIONS, type AppTopLevelTabId } from '$lib/state/app-tabs.svelte.js';
import type { OptionalSetupPageId } from '$lib/constants/setup-page-visibility.js';
import type { Project } from '$lib/types/index.js';
import {
	getProjectCompanyDisplayName,
	getProjectRequesterDisplayName
} from '$lib/utils/project-contact.js';

const PRIMARY_PAGE_IDS = new Set<AppTopLevelTabId>(['rfqs', 'companies']);

function normaliseQuery(query: string): string {
	return query.trim().toLowerCase();
}

function matchesPageDestinationQuery(
	query: string,
	destination: (typeof APP_SHELL_PAGE_DESTINATIONS)[number]
): boolean {
	if (query.length === 0) return true;

	return [destination.title, ...(destination.searchKeywords ?? [])].some((value) =>
		value.toLowerCase().includes(query)
	);
}

export function filterSidebarPageDestinations(
	query: string,
	hiddenPageIds: readonly OptionalSetupPageId[] = []
) {
	const normalisedQuery = normaliseQuery(query);
	const hiddenPageIdSet = new Set(hiddenPageIds);
	const matches = APP_SHELL_PAGE_DESTINATIONS.filter(
		(destination) =>
			!hiddenPageIdSet.has(destination.id as OptionalSetupPageId) &&
			matchesPageDestinationQuery(normalisedQuery, destination)
	);

	return {
		primary: matches.filter((destination) => PRIMARY_PAGE_IDS.has(destination.id)),
		estimating: matches.filter((destination) => !PRIMARY_PAGE_IDS.has(destination.id))
	};
}

function matchesProjectQuery(project: Project, normalisedQuery: string): boolean {
	if (normalisedQuery.length === 0) return true;

	return [
		project.rfq_number,
		getProjectCompanyDisplayName(project),
		getProjectRequesterDisplayName(project),
		project.project_name
	]
		.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
		.some((value) => value.toLowerCase().includes(normalisedQuery));
}

export function splitSidebarProjects(
	projects: Project[],
	recentProjects: Project[],
	query: string
) {
	const normalisedQuery = normaliseQuery(query);
	const matchingProjects = projects.filter((project) =>
		matchesProjectQuery(project, normalisedQuery)
	);
	const matchingProjectIds = new Set(matchingProjects.map((project) => project.id));

	const favourites = projects.filter(
		(project) => project.is_favourite && matchingProjectIds.has(project.id)
	);
	const favouriteIds = new Set(favourites.map((project) => project.id));
	const recent = recentProjects.filter(
		(project) => matchingProjectIds.has(project.id) && !favouriteIds.has(project.id)
	);

	return { favourites, recent };
}

export function isSidebarPanelId(value: string): value is SidebarPanelId {
	return value === 'pages' || value === 'projects' || value === 'explorer';
}
