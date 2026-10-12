import { storeService } from '$lib/services/store.js';
import { createLogger } from '$lib/services/logger.js';
import {
	OPTIONAL_SETUP_PAGE_IDS,
	type OptionalSetupPageId
} from '$lib/constants/setup-page-visibility.js';
import type { AppShellHref } from '$lib/utils/app-shell-href.js';
import { normaliseAppPathname, isRfqHomeRoute } from '$lib/utils/route-path.js';

const log = createLogger('appTabsState');

export type AppTopLevelTabId =
	| 'rfqs'
	| 'companies'
	| 'materials'
	| 'labour-rates'
	| 'equipment-rates'
	| 'subcontract-rates'
	| 'cost-presets'
	| 'estimate-templates'
	| 'classification';

export type AppShellCreateActionId =
	| 'rfq'
	| 'company'
	| 'material'
	| 'labour-rate'
	| 'equipment-rate'
	| 'subcontract-rate'
	| 'classification-system';

export function isOptionalSetupAppTabId(value: AppTopLevelTabId): value is OptionalSetupPageId {
	return OPTIONAL_SETUP_PAGE_IDS.includes(value as OptionalSetupPageId);
}

type PageTabDestination = {
	id: AppTopLevelTabId;
	kind: 'page';
	route: AppShellHref;
	title: string;
	createActionId?: AppShellCreateActionId;
	searchKeywords?: readonly string[];
};

type ProjectTabDestination = {
	id: `project:${string}`;
	kind: 'project';
	projectId: string;
	route: AppShellHref;
	title: string;
};

type FilePreviewTabDestination = {
	id: `file-preview:${string}`;
	kind: 'file-preview';
	fileId: string;
	route: AppShellHref;
	title: string;
};

type EmailPreviewTabDestination = {
	id: `email-preview:${string}`;
	kind: 'email-preview';
	messageId: string;
	route: AppShellHref;
	title: string;
};

export type AppTabDestination =
	| PageTabDestination
	| ProjectTabDestination
	| FilePreviewTabDestination
	| EmailPreviewTabDestination;
export type AppTabRecord = AppTabDestination & { dirty?: boolean };

export type AppTabsSnapshot = {
	tabs: AppTabRecord[];
	activeTabId: string | null;
};

export const APP_SHELL_PAGE_DESTINATIONS = [
	{
		id: 'rfqs',
		kind: 'page',
		route: '/',
		title: 'RFQs',
		createActionId: 'rfq',
		searchKeywords: ['rfq', 'rfqs', 'project', 'projects']
	},
	{
		id: 'companies',
		kind: 'page',
		route: '/companies',
		title: 'Companies',
		createActionId: 'company',
		searchKeywords: [
			'company',
			'companies',
			'contact',
			'contacts',
			'customer',
			'customers',
			'client',
			'clients'
		]
	},
	{
		id: 'materials',
		kind: 'page',
		route: '/materials',
		title: 'Materials',
		createActionId: 'material',
		searchKeywords: ['material', 'materials', 'catalogue']
	},
	{
		id: 'labour-rates',
		kind: 'page',
		route: '/labour-rates',
		title: 'Labour Rates',
		createActionId: 'labour-rate',
		searchKeywords: ['labour', 'rate', 'rates']
	},
	{
		id: 'equipment-rates',
		kind: 'page',
		route: '/equipment-rates',
		title: 'Equipment Rates',
		createActionId: 'equipment-rate',
		searchKeywords: ['equipment', 'rate', 'rates']
	},
	{
		id: 'subcontract-rates',
		kind: 'page',
		route: '/subcontract-rates',
		title: 'Subcontract Rates',
		createActionId: 'subcontract-rate',
		searchKeywords: ['subcontract', 'subcontractor', 'supplier', 'vendor', 'rates']
	},
	{
		id: 'cost-presets',
		kind: 'page',
		route: '/cost-presets',
		title: 'Cost Presets',
		searchKeywords: ['cost', 'preset', 'presets']
	},
	{
		id: 'estimate-templates',
		kind: 'page',
		route: '/estimate-templates',
		title: 'Estimate Templates',
		searchKeywords: ['estimate', 'template', 'templates']
	},
	{
		id: 'classification',
		kind: 'page',
		route: '/classification-systems',
		title: 'Classification',
		createActionId: 'classification-system',
		searchKeywords: ['classification', 'codes', 'cost code', 'cost codes']
	}
] as const satisfies readonly PageTabDestination[];

const PAGE_DESTINATION_MAP: Record<AppTopLevelTabId, PageTabDestination> =
	APP_SHELL_PAGE_DESTINATIONS.reduce(
		(map, destination) => {
			map[destination.id] = destination;
			return map;
		},
		{} as Record<AppTopLevelTabId, PageTabDestination>
	);

export function createHomeTabDestination(): AppTabDestination {
	return PAGE_DESTINATION_MAP.rfqs;
}

export function buildTabDestination(input: {
	pathname: string;
	routeId?: string;
	projectId?: string | null;
	projectNumber?: string | null;
	fileId?: string | null;
	fileName?: string | null;
	emailTitle?: string | null;
}): AppTabDestination | null {
	const pathname = normaliseAppPathname(input.pathname);

	if (isRfqHomeRoute(pathname, input.routeId ?? '')) {
		return createHomeTabDestination();
	}

	if (pathname.startsWith('/project/')) {
		const projectId = input.projectId ?? pathname.split('/')[2] ?? null;
		if (!projectId) return null;
		return {
			id: `project:${projectId}`,
			kind: 'project',
			projectId,
			route: pathname as AppShellHref,
			title: input.projectNumber?.trim() || projectId
		};
	}

	if (pathname.startsWith('/preview/file/')) {
		const fileId = input.fileId ?? pathname.split('/')[3] ?? null;
		if (!fileId) return null;
		return {
			id: `file-preview:${fileId}`,
			kind: 'file-preview',
			fileId,
			route: pathname as AppShellHref,
			title: input.fileName?.trim() || fileId
		};
	}

	if (pathname.startsWith('/preview/email/')) {
		const messageId = pathname.split('/')[3] ?? null;
		if (!messageId) return null;
		const initialTitle = (input.emailTitle ?? 'Email').slice(0, 50);
		return {
			id: `email-preview:${messageId}`,
			kind: 'email-preview',
			messageId,
			route: pathname as AppShellHref,
			title: initialTitle
		};
	}

	if (pathname.startsWith('/classification-systems')) {
		return {
			...PAGE_DESTINATION_MAP.classification,
			route: pathname as AppShellHref
		};
	}

	const pageMatch = APP_SHELL_PAGE_DESTINATIONS.find(
		(destination) => destination.route === pathname
	);
	if (!pageMatch) return null;
	return pageMatch;
}

function isValidTabRecord(value: unknown): value is AppTabRecord {
	if (!value || typeof value !== 'object') return false;

	const candidate = value as Partial<AppTabRecord>;
	if (typeof candidate.id !== 'string') return false;
	if (
		candidate.kind !== 'page' &&
		candidate.kind !== 'project' &&
		candidate.kind !== 'file-preview' &&
		candidate.kind !== 'email-preview'
	)
		return false;
	if (typeof candidate.route !== 'string' || candidate.route.length === 0) return false;
	if (typeof candidate.title !== 'string' || candidate.title.length === 0) return false;
	if (candidate.kind === 'project' && typeof candidate.projectId !== 'string') return false;
	if (candidate.kind === 'file-preview' && typeof candidate.fileId !== 'string') return false;
	if (candidate.kind === 'email-preview' && typeof candidate.messageId !== 'string') return false;
	if (candidate.dirty !== undefined && typeof candidate.dirty !== 'boolean') return false;

	return true;
}

function sanitiseSnapshot(snapshot: AppTabsSnapshot | null | undefined): AppTabsSnapshot | null {
	if (!snapshot || typeof snapshot !== 'object') return null;
	if (!Array.isArray(snapshot.tabs)) return null;

	const tabs = snapshot.tabs.filter(isValidTabRecord);
	if (tabs.length === 0) return null;

	const activeTabId =
		typeof snapshot.activeTabId === 'string' && tabs.some((tab) => tab.id === snapshot.activeTabId)
			? snapshot.activeTabId
			: (tabs[0]?.id ?? null);

	return { tabs, activeTabId };
}

export class AppTabsState {
	tabs: AppTabRecord[] = $state([]);
	activeTabId: string | null = $state(null);
	approvedProjectTabCloseId: `project:${string}` | null = $state(null);
	pendingCloseTabId: string | null = $state(null);
	pendingNavigationRoute: AppShellHref | null = $state(null);
	isHydrated: boolean = $state(false);
	private hydrationPromise: Promise<string | null> | null = null;

	get activeTab(): AppTabRecord | null {
		return this.tabs.find((tab) => tab.id === this.activeTabId) ?? null;
	}

	ensureDefaultTab(): void {
		if (this.tabs.length > 0) {
			if (!this.activeTabId) {
				this.activeTabId = this.tabs[0]?.id ?? null;
			}
			return;
		}

		const homeTab = createHomeTabDestination();
		this.tabs = [homeTab];
		this.activeTabId = homeTab.id;
	}

	resetForWorkspaceChange(): void {
		const homeTab = { ...createHomeTabDestination(), dirty: false };
		this.tabs = [homeTab];
		this.activeTabId = homeTab.id;
		this.approvedProjectTabCloseId = null;
		this.pendingCloseTabId = null;
		this.pendingNavigationRoute = homeTab.route;
		this.isHydrated = true;
	}

	openOrFocus(destination: AppTabDestination): void {
		const existingTab = this.tabs.find((tab) => tab.id === destination.id);
		if (existingTab) {
			// Preserve API-resolved title for email tabs (don't overwrite with URL-encoded version)
			const title =
				existingTab.kind === 'email-preview' && existingTab.title !== 'Email'
					? existingTab.title
					: destination.title;
			const nextTab = { ...existingTab, ...destination, title, dirty: existingTab.dirty };
			const changed =
				existingTab.route !== nextTab.route ||
				existingTab.title !== nextTab.title ||
				existingTab.kind !== nextTab.kind ||
				(existingTab.kind === 'project' &&
					nextTab.kind === 'project' &&
					existingTab.projectId !== nextTab.projectId) ||
				(existingTab.kind === 'file-preview' &&
					nextTab.kind === 'file-preview' &&
					existingTab.fileId !== nextTab.fileId);
			if (changed) {
				this.tabs = this.tabs.map((tab) => (tab.id === destination.id ? nextTab : tab));
			}
			if (this.activeTabId !== destination.id) {
				this.activeTabId = destination.id;
			}
			return;
		}

		this.tabs = [...this.tabs, { ...destination, dirty: false }];
		if (this.activeTabId !== destination.id) {
			this.activeTabId = destination.id;
		}
	}

	reorderTabs(orderedIds: AppTabRecord['id'][]): void {
		if (this.tabs.length <= 1) return;
		if (orderedIds.length !== this.tabs.length) return;

		const currentIds = this.tabs.map((tab) => tab.id);
		if (orderedIds.every((id, index) => id === currentIds[index])) return;

		const tabById = Object.fromEntries(this.tabs.map((tab) => [tab.id, tab] as const)) as Record<
			string,
			AppTabRecord
		>;
		const nextTabs = orderedIds
			.map((id) => tabById[id] ?? null)
			.filter((tab): tab is AppTabRecord => tab !== null);

		if (nextTabs.length !== this.tabs.length) return;
		this.tabs = nextTabs;
	}

	activate(tabId: string): void {
		if (!this.tabs.some((tab) => tab.id === tabId)) return;
		if (this.activeTabId !== tabId) {
			this.activeTabId = tabId;
		}
	}

	syncActiveRoute(route: string): void {
		if (!this.activeTabId) return;
		const normalisedRoute = normaliseAppPathname(route) as AppShellHref;
		const activeTab = this.tabs.find((tab) => tab.id === this.activeTabId);
		if (!activeTab || activeTab.route === normalisedRoute) return;
		this.tabs = this.tabs.map((tab) =>
			tab.id === this.activeTabId ? { ...tab, route: normalisedRoute } : tab
		);
	}

	updateTabTitle(tabId: string, title: string): void {
		const existingTab = this.tabs.find((tab) => tab.id === tabId);
		if (!existingTab || existingTab.title === title) return;
		this.tabs = this.tabs.map((tab) => (tab.id === tabId ? { ...tab, title } : tab));
	}

	setProjectDirty(projectId: string, dirty: boolean): void {
		const tabId = `project:${projectId}`;
		const projectTab = this.tabs.find((tab) => tab.id === tabId);
		if (!projectTab || projectTab.dirty === dirty) return;
		this.tabs = this.tabs.map((tab) => (tab.id === tabId ? { ...tab, dirty } : tab));
	}

	approveProjectTabClose(projectId: string): void {
		this.approvedProjectTabCloseId = `project:${projectId}`;
	}

	consumeApprovedProjectTabClose(projectId: string): boolean {
		const tabId = `project:${projectId}`;
		if (this.approvedProjectTabCloseId !== tabId) return false;
		this.approvedProjectTabCloseId = null;
		return true;
	}

	close(tabId: string): { closed: boolean; nextTabId: string | null } {
		const index = this.tabs.findIndex((tab) => tab.id === tabId);
		if (index < 0) return { closed: false, nextTabId: this.activeTabId };
		this.approvedProjectTabCloseId = null;

		const nextTabs = this.tabs.filter((tab) => tab.id !== tabId);
		if (nextTabs.length === 0) {
			const homeTab = createHomeTabDestination();
			this.tabs = [homeTab];
			this.activeTabId = homeTab.id;
			return { closed: true, nextTabId: homeTab.id };
		}

		let nextTabId = this.activeTabId;
		if (this.activeTabId === tabId) {
			nextTabId = nextTabs[index]?.id ?? nextTabs[index - 1]?.id ?? nextTabs[0]?.id ?? null;
		}

		this.tabs = nextTabs;
		this.activeTabId = nextTabId;
		return { closed: true, nextTabId };
	}

	handleDeletedProjects(projectIds: string[]): void {
		if (projectIds.length === 0 || this.tabs.length === 0) return;

		const deletedTabIds = projectIds.map((projectId) => `project:${projectId}`);
		const isDeletedTabId = (tabId: string | null | undefined): boolean =>
			typeof tabId === 'string' && deletedTabIds.includes(tabId);
		const activeIndex = this.tabs.findIndex((tab) => tab.id === this.activeTabId);
		const activeTabWasDeleted = isDeletedTabId(this.activeTabId);
		const nextTabs = this.tabs.filter((tab) => !deletedTabIds.includes(tab.id));

		if (!this.pendingCloseTabId || isDeletedTabId(this.pendingCloseTabId)) {
			this.pendingCloseTabId = null;
		}
		if (isDeletedTabId(this.approvedProjectTabCloseId)) {
			this.approvedProjectTabCloseId = null;
		}

		if (nextTabs.length === this.tabs.length) return;

		if (nextTabs.length === 0) {
			const homeTab = { ...createHomeTabDestination(), dirty: false };
			this.tabs = [homeTab];
			this.activeTabId = homeTab.id;
			if (activeTabWasDeleted) {
				this.pendingNavigationRoute = homeTab.route;
			}
			return;
		}

		const fallbackTab = activeTabWasDeleted
			? (nextTabs[activeIndex] ?? nextTabs[activeIndex - 1] ?? nextTabs[0] ?? null)
			: null;

		this.tabs = nextTabs;
		if (activeTabWasDeleted) {
			this.activeTabId = fallbackTab?.id ?? nextTabs[0]?.id ?? null;
			if (fallbackTab) {
				this.pendingNavigationRoute = fallbackTab.route;
			}
			return;
		}

		if (!this.activeTabId || !nextTabs.some((tab) => tab.id === this.activeTabId)) {
			this.activeTabId = nextTabs[0]?.id ?? null;
		}
	}

	consumePendingNavigationRoute(): AppShellHref | null {
		const nextRoute = this.pendingNavigationRoute;
		this.pendingNavigationRoute = null;
		return nextRoute;
	}

	restore(snapshot: AppTabsSnapshot | null | undefined): void {
		const sanitised = sanitiseSnapshot(snapshot);
		if (!sanitised) {
			if (snapshot) {
				log.warn('Stored app tab snapshot was invalid and has been reset');
			}
			this.tabs = [];
			this.activeTabId = null;
			this.approvedProjectTabCloseId = null;
			this.pendingCloseTabId = null;
			this.pendingNavigationRoute = null;
			this.ensureDefaultTab();
			this.isHydrated = true;
			return;
		}

		this.tabs = sanitised.tabs.map((tab) => ({ ...tab, dirty: tab.dirty ?? false }));
		this.activeTabId = sanitised.activeTabId;
		this.approvedProjectTabCloseId = null;
		this.pendingCloseTabId = null;
		this.pendingNavigationRoute = null;
		this.isHydrated = true;
	}

	async hydrate(
		currentDestination: AppTabDestination | null,
		currentPathname: string
	): Promise<string | null> {
		if (this.isHydrated) return null;
		if (this.hydrationPromise) return this.hydrationPromise;

		this.hydrationPromise = (async () => {
			try {
				const snapshot = await storeService.getAppTabsSnapshot<AppTabsSnapshot>();
				this.restore(snapshot);

				const restoreRoute =
					currentDestination?.id === 'rfqs' &&
					currentPathname === '/' &&
					this.activeTab?.route &&
					this.activeTab.route !== currentPathname
						? this.activeTab.route
						: null;

				if (!restoreRoute && currentDestination) {
					this.openOrFocus(currentDestination);
					this.syncActiveRoute(currentPathname);
				}
				if (restoreRoute) {
					log.info('Restored app tab route from persisted shell snapshot', {
						restoreRoute,
						activeTabId: this.activeTabId
					});
				}

				return restoreRoute;
			} finally {
				this.hydrationPromise = null;
			}
		})();

		return this.hydrationPromise;
	}

	async persist(snapshot: AppTabsSnapshot = this.toSnapshot()): Promise<void> {
		if (!this.isHydrated) return;
		await storeService.setAppTabsSnapshot(snapshot);
	}

	toSnapshot(): AppTabsSnapshot {
		return {
			tabs: this.tabs.map((tab) => ({ ...tab })),
			activeTabId: this.activeTabId
		};
	}

	getCloseFallbackTab(tabId: string): AppTabRecord | null {
		const index = this.tabs.findIndex((tab) => tab.id === tabId);
		if (index < 0) return null;

		const nextTabs = this.tabs.filter((tab) => tab.id !== tabId);
		if (nextTabs.length === 0) {
			return { ...createHomeTabDestination(), dirty: false };
		}

		return nextTabs[index] ?? nextTabs[index - 1] ?? nextTabs[0] ?? null;
	}

	queuePendingClose(tabId: string): void {
		this.pendingCloseTabId = tabId;
	}

	finalisePendingClose(): { closed: boolean; nextTabId: string | null } {
		if (!this.pendingCloseTabId) {
			return { closed: false, nextTabId: this.activeTabId };
		}

		const pendingTabId = this.pendingCloseTabId;
		this.pendingCloseTabId = null;
		return this.close(pendingTabId);
	}
}

export const appTabsState = new AppTabsState();
