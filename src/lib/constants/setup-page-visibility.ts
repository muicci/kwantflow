export const OPTIONAL_SETUP_PAGE_IDS = [
	'materials',
	'labour-rates',
	'equipment-rates',
	'subcontract-rates',
	'cost-presets',
	'estimate-templates'
] as const;

export type OptionalSetupPageId = (typeof OPTIONAL_SETUP_PAGE_IDS)[number];

const OPTIONAL_SETUP_PAGE_ID_SET = new Set<string>(OPTIONAL_SETUP_PAGE_IDS);

export function isOptionalSetupPageId(value: string): value is OptionalSetupPageId {
	return OPTIONAL_SETUP_PAGE_ID_SET.has(value);
}
