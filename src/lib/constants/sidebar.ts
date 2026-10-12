export const SIDEBAR_PANELS = ['pages', 'projects', 'explorer', 'mail'] as const;

export type SidebarPanelId = (typeof SIDEBAR_PANELS)[number];
