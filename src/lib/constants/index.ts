export enum MeasurementUnit {
	Metric = 'Metric',
	Imperial = 'Imperial'
}

export enum MaterialType {
	Steel = 'Steel',
	Concrete = 'Concrete',
	Timber = 'Timber',
	Glass = 'Glass',
	Other = 'Other'
}

export enum PriorityLevel {
	Low = 'Low',
	Medium = 'Medium',
	High = 'High',
	Critical = 'Critical'
}

export enum ProjectStatus {
	Draft = 'draft',
	Open = 'open',
	Estimating = 'estimating',
	Quoted = 'quoted',
	Won = 'won',
	Lost = 'lost',
	Archived = 'archived'
}

export function projectStatusLabel(value: ProjectStatus): string {
	switch (value) {
		case ProjectStatus.Draft:
			return 'Draft';
		case ProjectStatus.Open:
			return 'Open';
		case ProjectStatus.Estimating:
			return 'Estimating';
		case ProjectStatus.Quoted:
			return 'Quoted';
		case ProjectStatus.Won:
			return 'Won';
		case ProjectStatus.Lost:
			return 'Lost';
		case ProjectStatus.Archived:
			return 'Archived';
	}
}

/**
 * Vault Path Authority: single source of truth for stored relative filesystem paths.
 *
 * The native documents root is ~/Documents/ for production and
 * app-local qa-documents/ for development and QA identities.
 * Resolve these paths with resolveLocalDocumentPath before filesystem access.
 * Workspace vault: Kwantflow/workspaces/{workspaceId}/vault/
 * Project folder: Kwantflow/workspaces/{workspaceId}/vault/workspace/{projectId}/
 *
 * The DB stores file_path values relative to VAULT_ROOT,
 * e.g. "workspaces/{workspaceId}/vault/workspace/{projectId}/drawing.pdf"
 */
export const VAULT_ROOT = 'Kwantflow';
export const WORKSPACES_ROOT = `${VAULT_ROOT}/workspaces`;
export const WORKSPACE_DATABASES_ROOT = 'workspaces';
export const ACCOUNT_ROOT = 'account';
export const CURRENT_APP_SCHEMA_VERSION = 2;
// Vite replaces these globals for normal application modules. Keep dynamically imported WebView
// tooling safe as well: browser-side `import('/src/...')` can execute before define replacement.
const resolvedAppVersion =
	typeof __KWANTFLOW_APP_VERSION__ !== 'undefined' ? __KWANTFLOW_APP_VERSION__ : '0.0.0';
export const APP_VERSION = resolvedAppVersion;
export const PUBLIC_MARKET_REGION = 'ANZ';

export const WORKSPACE_COUNTRY_OPTIONS = [
	{
		code: 'AU',
		label: 'Australia',
		currencyCode: 'AUD',
		dateFormat: 'en-AU',
		businessIdLabel: 'ABN',
		taxIdLabel: 'GST',
		phoneCountryCode: 'AU',
		callingCode: '+61'
	},
	{
		code: 'NZ',
		label: 'New Zealand',
		currencyCode: 'NZD',
		dateFormat: 'en-AU',
		businessIdLabel: 'NZBN',
		taxIdLabel: 'GST',
		phoneCountryCode: 'NZ',
		callingCode: '+64'
	},
	{
		code: 'US',
		label: 'United States',
		currencyCode: 'USD',
		dateFormat: 'en-US',
		businessIdLabel: 'EIN',
		taxIdLabel: 'Sales tax ID',
		phoneCountryCode: 'US',
		callingCode: '+1'
	},
	{
		code: 'CA',
		label: 'Canada',
		currencyCode: 'CAD',
		dateFormat: 'en-US',
		businessIdLabel: 'Business number',
		taxIdLabel: 'GST/HST',
		phoneCountryCode: 'CA',
		callingCode: '+1'
	},
	{
		code: 'GB',
		label: 'United Kingdom',
		currencyCode: 'GBP',
		dateFormat: 'en-GB',
		businessIdLabel: 'Company number',
		taxIdLabel: 'VAT number',
		phoneCountryCode: 'GB',
		callingCode: '+44'
	},
	{
		code: 'IE',
		label: 'Ireland',
		currencyCode: 'EUR',
		dateFormat: 'en-GB',
		businessIdLabel: 'Company number',
		taxIdLabel: 'VAT number',
		phoneCountryCode: 'IE',
		callingCode: '+353'
	},
	{
		code: 'SG',
		label: 'Singapore',
		currencyCode: 'SGD',
		dateFormat: 'en-GB',
		businessIdLabel: 'UEN',
		taxIdLabel: 'GST number',
		phoneCountryCode: 'SG',
		callingCode: '+65'
	},
	{
		code: 'AE',
		label: 'United Arab Emirates',
		currencyCode: 'AED',
		dateFormat: 'en-GB',
		businessIdLabel: 'Trade licence',
		taxIdLabel: 'VAT number',
		phoneCountryCode: 'AE',
		callingCode: '+971'
	},
	{
		code: 'IN',
		label: 'India',
		currencyCode: 'INR',
		dateFormat: 'en-GB',
		businessIdLabel: 'CIN',
		taxIdLabel: 'GSTIN',
		phoneCountryCode: 'IN',
		callingCode: '+91'
	},
	{
		code: 'DE',
		label: 'Germany',
		currencyCode: 'EUR',
		dateFormat: 'en-GB',
		businessIdLabel: 'Company register number',
		taxIdLabel: 'VAT ID',
		phoneCountryCode: 'DE',
		callingCode: '+49'
	},
	{
		code: 'FR',
		label: 'France',
		currencyCode: 'EUR',
		dateFormat: 'en-GB',
		businessIdLabel: 'SIREN',
		taxIdLabel: 'VAT number',
		phoneCountryCode: 'FR',
		callingCode: '+33'
	},
	{
		code: 'NL',
		label: 'Netherlands',
		currencyCode: 'EUR',
		dateFormat: 'en-GB',
		businessIdLabel: 'KvK number',
		taxIdLabel: 'VAT number',
		phoneCountryCode: 'NL',
		callingCode: '+31'
	},
	{
		code: 'BE',
		label: 'Belgium',
		currencyCode: 'EUR',
		dateFormat: 'en-GB',
		businessIdLabel: 'Enterprise number',
		taxIdLabel: 'VAT number',
		phoneCountryCode: 'BE',
		callingCode: '+32'
	},
	{
		code: 'IT',
		label: 'Italy',
		currencyCode: 'EUR',
		dateFormat: 'en-GB',
		businessIdLabel: 'REA / company number',
		taxIdLabel: 'VAT number',
		phoneCountryCode: 'IT',
		callingCode: '+39'
	},
	{
		code: 'ES',
		label: 'Spain',
		currencyCode: 'EUR',
		dateFormat: 'en-GB',
		businessIdLabel: 'CIF / NIF',
		taxIdLabel: 'VAT number',
		phoneCountryCode: 'ES',
		callingCode: '+34'
	},
	{
		code: 'PL',
		label: 'Poland',
		currencyCode: 'EUR',
		dateFormat: 'en-GB',
		businessIdLabel: 'KRS / REGON',
		taxIdLabel: 'NIP',
		phoneCountryCode: 'PL',
		callingCode: '+48'
	},
	{
		code: 'SE',
		label: 'Sweden',
		currencyCode: 'SEK',
		dateFormat: 'en-GB',
		businessIdLabel: 'Organisation number',
		taxIdLabel: 'VAT number',
		phoneCountryCode: 'SE',
		callingCode: '+46'
	},
	{
		code: 'NO',
		label: 'Norway',
		currencyCode: 'NOK',
		dateFormat: 'en-GB',
		businessIdLabel: 'Organisation number',
		taxIdLabel: 'VAT number',
		phoneCountryCode: 'NO',
		callingCode: '+47'
	},
	{
		code: 'DK',
		label: 'Denmark',
		currencyCode: 'DKK',
		dateFormat: 'en-GB',
		businessIdLabel: 'CVR number',
		taxIdLabel: 'VAT number',
		phoneCountryCode: 'DK',
		callingCode: '+45'
	},
	{
		code: 'CH',
		label: 'Switzerland',
		currencyCode: 'CHF',
		dateFormat: 'en-GB',
		businessIdLabel: 'UID',
		taxIdLabel: 'VAT number',
		phoneCountryCode: 'CH',
		callingCode: '+41'
	},
	{
		code: 'ZA',
		label: 'South Africa',
		currencyCode: 'ZAR',
		dateFormat: 'en-GB',
		businessIdLabel: 'Registration number',
		taxIdLabel: 'VAT number',
		phoneCountryCode: 'ZA',
		callingCode: '+27'
	},
	{
		code: 'JP',
		label: 'Japan',
		currencyCode: 'JPY',
		dateFormat: 'en-GB',
		businessIdLabel: 'Corporate number',
		taxIdLabel: 'Consumption tax ID',
		phoneCountryCode: 'JP',
		callingCode: '+81'
	},
	{
		code: 'HK',
		label: 'Hong Kong',
		currencyCode: 'HKD',
		dateFormat: 'en-GB',
		businessIdLabel: 'Business registration number',
		taxIdLabel: 'Tax file number',
		phoneCountryCode: 'HK',
		callingCode: '+852'
	},
	{
		code: 'MY',
		label: 'Malaysia',
		currencyCode: 'MYR',
		dateFormat: 'en-GB',
		businessIdLabel: 'Company registration number',
		taxIdLabel: 'SST / tax number',
		phoneCountryCode: 'MY',
		callingCode: '+60'
	},
	{
		code: 'TH',
		label: 'Thailand',
		currencyCode: 'THB',
		dateFormat: 'en-GB',
		businessIdLabel: 'Company registration number',
		taxIdLabel: 'Tax ID',
		phoneCountryCode: 'TH',
		callingCode: '+66'
	},
	{
		code: 'VN',
		label: 'Vietnam',
		currencyCode: 'VND',
		dateFormat: 'en-GB',
		businessIdLabel: 'Enterprise code',
		taxIdLabel: 'Tax code',
		phoneCountryCode: 'VN',
		callingCode: '+84'
	},
	{
		code: 'ID',
		label: 'Indonesia',
		currencyCode: 'IDR',
		dateFormat: 'en-GB',
		businessIdLabel: 'Business number',
		taxIdLabel: 'NPWP',
		phoneCountryCode: 'ID',
		callingCode: '+62'
	},
	{
		code: 'PH',
		label: 'Philippines',
		currencyCode: 'PHP',
		dateFormat: 'en-GB',
		businessIdLabel: 'Business registration number',
		taxIdLabel: 'TIN',
		phoneCountryCode: 'PH',
		callingCode: '+63'
	},
	{
		code: 'BR',
		label: 'Brazil',
		currencyCode: 'BRL',
		dateFormat: 'en-GB',
		businessIdLabel: 'CNPJ',
		taxIdLabel: 'State tax ID',
		phoneCountryCode: 'BR',
		callingCode: '+55'
	},
	{
		code: 'MX',
		label: 'Mexico',
		currencyCode: 'MXN',
		dateFormat: 'en-US',
		businessIdLabel: 'RFC',
		taxIdLabel: 'Tax ID',
		phoneCountryCode: 'MX',
		callingCode: '+52'
	}
] as const;

export const ONBOARDING_OPERATOR_ROLES = [
	'owner_founder',
	'director_manager',
	'estimator',
	'project_manager',
	'operations_admin',
	'other'
] as const;
export type OnboardingOperatorRole = (typeof ONBOARDING_OPERATOR_ROLES)[number];

export const ONBOARDING_OPERATOR_ROLE_OPTIONS: ReadonlyArray<{
	value: OnboardingOperatorRole;
	label: string;
}> = [
	{ value: 'owner_founder', label: 'Owner / founder' },
	{ value: 'director_manager', label: 'Director / manager' },
	{ value: 'estimator', label: 'Estimator' },
	{ value: 'project_manager', label: 'Project manager' },
	{ value: 'operations_admin', label: 'Operations / admin' },
	{ value: 'other', label: 'Other' }
];

export const INDUSTRY_VALUES = [
	'Structural steel / fabrication',
	'Sheet metal / fabrication',
	'Mechanical / HVAC',
	'Electrical / controls',
	'General engineering',
	'Construction / fitout',
	'Manufacturing',
	'Industrial maintenance',
	'Mining / resources',
	'Civil / infrastructure',
	'Defence / government contracting',
	'Logistics / warehousing',
	'Facilities / property services'
] as const;
export type IndustryValue = (typeof INDUSTRY_VALUES)[number];

export const INDUSTRY_OPTIONS: ReadonlyArray<{
	value: IndustryValue | 'other';
	label: string;
}> = [
	...INDUSTRY_VALUES.map((value) => ({ value, label: value })),
	{ value: 'other', label: 'Other' }
];

export type WorkspaceCountryCode = (typeof WORKSPACE_COUNTRY_OPTIONS)[number]['code'];
export type WorkspaceCountryProfile = (typeof WORKSPACE_COUNTRY_OPTIONS)[number];
export type WorkspaceCountryTaxDefaults = {
	taxDisplayLabel: string;
	taxRatePercentage: number;
};
export const SUPPORTED_LANGUAGE_LOCALES = ['en-AU', 'en-US', 'en-GB'] as const;
export type SupportedLanguageLocale = (typeof SUPPORTED_LANGUAGE_LOCALES)[number];
export const SUPPORTED_NUMBER_LOCALES = ['en-AU', 'en-US', 'en-GB'] as const;
export type SupportedNumberLocale = (typeof SUPPORTED_NUMBER_LOCALES)[number];

const WORKSPACE_COUNTRY_TAX_DEFAULTS: Record<WorkspaceCountryCode, WorkspaceCountryTaxDefaults> = {
	AU: { taxDisplayLabel: 'GST', taxRatePercentage: 10 },
	NZ: { taxDisplayLabel: 'GST', taxRatePercentage: 15 },
	US: { taxDisplayLabel: 'Sales tax', taxRatePercentage: 0 },
	CA: { taxDisplayLabel: 'Tax', taxRatePercentage: 5 },
	GB: { taxDisplayLabel: 'VAT', taxRatePercentage: 20 },
	IE: { taxDisplayLabel: 'VAT', taxRatePercentage: 23 },
	SG: { taxDisplayLabel: 'GST', taxRatePercentage: 9 },
	AE: { taxDisplayLabel: 'VAT', taxRatePercentage: 5 },
	IN: { taxDisplayLabel: 'GST', taxRatePercentage: 18 },
	DE: { taxDisplayLabel: 'VAT', taxRatePercentage: 19 },
	FR: { taxDisplayLabel: 'VAT', taxRatePercentage: 20 },
	NL: { taxDisplayLabel: 'VAT', taxRatePercentage: 21 },
	BE: { taxDisplayLabel: 'VAT', taxRatePercentage: 21 },
	IT: { taxDisplayLabel: 'VAT', taxRatePercentage: 22 },
	ES: { taxDisplayLabel: 'VAT', taxRatePercentage: 21 },
	PL: { taxDisplayLabel: 'VAT', taxRatePercentage: 23 },
	SE: { taxDisplayLabel: 'VAT', taxRatePercentage: 25 },
	NO: { taxDisplayLabel: 'VAT', taxRatePercentage: 25 },
	DK: { taxDisplayLabel: 'VAT', taxRatePercentage: 25 },
	CH: { taxDisplayLabel: 'VAT', taxRatePercentage: 8.1 },
	ZA: { taxDisplayLabel: 'VAT', taxRatePercentage: 15 },
	JP: { taxDisplayLabel: 'Consumption tax', taxRatePercentage: 10 },
	HK: { taxDisplayLabel: 'Tax', taxRatePercentage: 0 },
	MY: { taxDisplayLabel: 'SST', taxRatePercentage: 6 },
	TH: { taxDisplayLabel: 'VAT', taxRatePercentage: 7 },
	VN: { taxDisplayLabel: 'VAT', taxRatePercentage: 10 },
	ID: { taxDisplayLabel: 'VAT', taxRatePercentage: 11 },
	PH: { taxDisplayLabel: 'VAT', taxRatePercentage: 12 },
	BR: { taxDisplayLabel: 'Tax', taxRatePercentage: 0 },
	MX: { taxDisplayLabel: 'VAT', taxRatePercentage: 16 }
};

export function getWorkspaceCountryProfile(code: string): WorkspaceCountryProfile {
	return (
		WORKSPACE_COUNTRY_OPTIONS.find((option) => option.code === code) ?? WORKSPACE_COUNTRY_OPTIONS[0]
	);
}

export function getWorkspaceCountryTaxDefaults(code: string): WorkspaceCountryTaxDefaults {
	const countryCode = getWorkspaceCountryProfile(code).code;
	return WORKSPACE_COUNTRY_TAX_DEFAULTS[countryCode] ?? WORKSPACE_COUNTRY_TAX_DEFAULTS.AU;
}

export function formatIdentifierLabel(value: string | null | undefined, fallback = ''): string {
	const source =
		typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback.trim();
	const normalised = /^[^a-z]*$/.test(source)
		? source.toLowerCase().replace(/^\p{L}/u, (match) => match.toUpperCase())
		: source;
	return normalised.replace(
		/\b(abn|gst|vat|ein|id|nzbn|uen|cin|gstin|hst|sst|uid|rea|cif|nif|krs|regon|nip|cvr|npwp|tin|rfc|cnpj|kvk|siren)\b/gi,
		(match) => match.toUpperCase()
	);
}

export function getWorkspaceCountryLanguageLocale(code: string): SupportedLanguageLocale {
	const countryCode = getWorkspaceCountryProfile(code).code;
	if (countryCode === 'US' || countryCode === 'MX' || countryCode === 'CA') return 'en-US';
	if (countryCode === 'AU' || countryCode === 'NZ') return 'en-AU';
	return 'en-GB';
}

export function getWorkspaceCountryNumberLocale(code: string): SupportedNumberLocale {
	return getWorkspaceCountryLanguageLocale(code);
}

export function getWorkspaceCountryMeasurementUnit(code: string): MeasurementUnit {
	return getWorkspaceCountryProfile(code).code === 'US'
		? MeasurementUnit.Imperial
		: MeasurementUnit.Metric;
}

export function getWorkspaceCountryLabel(code: string): string {
	return getWorkspaceCountryProfile(code).label;
}

export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export const THEME_PREFERENCE_OPTIONS: ReadonlyArray<{
	value: ThemePreference;
	label: string;
}> = [
	{ value: 'light', label: 'Light' },
	{ value: 'dark', label: 'Dark' },
	{ value: 'system', label: 'System' }
];

export function workspaceContainerRootPath(workspaceId: string): string {
	return `${WORKSPACES_ROOT}/${workspaceId}`;
}

export function workspaceDatabaseRootPath(workspaceId: string): string {
	return `${WORKSPACE_DATABASES_ROOT}/${workspaceId}`;
}

export function workspaceDatabasePath(workspaceId: string): string {
	return `${workspaceDatabaseRootPath(workspaceId)}/workspace.db`;
}

export function workspaceVaultRootPath(workspaceId: string): string {
	return `${workspaceContainerRootPath(workspaceId)}/vault`;
}

/** Path stored in workspace SQLite, relative to the native documents root's `Kwantflow` vault. */
export function workspaceVaultRelativePath(workspaceId: string): string {
	return `workspaces/${workspaceId}/vault`;
}

export function workspaceProjectPath(workspaceId: string, projectId: string): string {
	return `${workspaceVaultRootPath(workspaceId)}/projects/${projectId}`;
}

/** Build a project path inside one workspace's isolated vault. */
export function projectWorkspacePath(workspaceId: string, projectId: string): string {
	return `${workspaceVaultRootPath(workspaceId)}/workspace/${projectId}`;
}

/** Build the account-scoped avatar path under app-local storage. */
export function accountAvatarPath(accountId: string, extension: string): string {
	return `${ACCOUNT_ROOT}/${accountId}/avatar${extension}`;
}

export const SUPPORTED_CURRENCY_CODES = [
	'AED',
	'AUD',
	'BRL',
	'CAD',
	'CHF',
	'DKK',
	'EUR',
	'GBP',
	'HKD',
	'IDR',
	'INR',
	'JPY',
	'MXN',
	'MYR',
	'NOK',
	'NZD',
	'PHP',
	'SEK',
	'SGD',
	'THB',
	'USD',
	'VND',
	'ZAR'
] as const;
export type SupportedCurrencyCode = (typeof SUPPORTED_CURRENCY_CODES)[number];

export const CURRENCY_OPTIONS: ReadonlyArray<{
	code: SupportedCurrencyCode;
	symbol: string;
	label: string;
}> = [
	{ code: 'AUD', symbol: '$', label: 'AUD · Australian Dollar' },
	{ code: 'AED', symbol: 'AED', label: 'AED · UAE Dirham' },
	{ code: 'BRL', symbol: 'R$', label: 'BRL · Brazilian Real' },
	{ code: 'CAD', symbol: '$', label: 'CAD · Canadian Dollar' },
	{ code: 'CHF', symbol: 'CHF', label: 'CHF · Swiss Franc' },
	{ code: 'DKK', symbol: 'kr', label: 'DKK · Danish Krone' },
	{ code: 'USD', symbol: '$', label: 'USD · US Dollar' },
	{ code: 'EUR', symbol: 'EUR', label: 'EUR · Euro' },
	{ code: 'GBP', symbol: 'GBP', label: 'GBP · British Pound' },
	{ code: 'HKD', symbol: '$', label: 'HKD · Hong Kong Dollar' },
	{ code: 'IDR', symbol: 'Rp', label: 'IDR · Indonesian Rupiah' },
	{ code: 'INR', symbol: '₹', label: 'INR · Indian Rupee' },
	{ code: 'JPY', symbol: '¥', label: 'JPY · Japanese Yen' },
	{ code: 'MXN', symbol: '$', label: 'MXN · Mexican Peso' },
	{ code: 'MYR', symbol: 'RM', label: 'MYR · Malaysian Ringgit' },
	{ code: 'NOK', symbol: 'kr', label: 'NOK · Norwegian Krone' },
	{ code: 'NZD', symbol: '$', label: 'NZD · New Zealand Dollar' },
	{ code: 'PHP', symbol: '₱', label: 'PHP · Philippine Peso' },
	{ code: 'SEK', symbol: 'kr', label: 'SEK · Swedish Krona' },
	{ code: 'SGD', symbol: '$', label: 'SGD · Singapore Dollar' },
	{ code: 'THB', symbol: '฿', label: 'THB · Thai Baht' },
	{ code: 'VND', symbol: '₫', label: 'VND · Vietnamese Dong' },
	{ code: 'ZAR', symbol: 'R', label: 'ZAR · South African Rand' }
];

export function getCurrencySymbol(code: string): string {
	return CURRENCY_OPTIONS.find((option) => option.code === code)?.symbol ?? '$';
}

export const SUPPORTED_DATE_FORMATS = ['en-AU', 'en-US', 'en-GB'] as const;
export type SupportedDateFormat = (typeof SUPPORTED_DATE_FORMATS)[number];

export const DATE_FORMAT_OPTIONS: ReadonlyArray<{
	value: SupportedDateFormat;
	label: string;
}> = [
	{ value: 'en-AU', label: 'Australia · 07 Mar 2026' },
	{ value: 'en-US', label: 'United States · Mar 7, 2026' },
	{ value: 'en-GB', label: 'United Kingdom · 07 Mar 2026' }
];

export const LANGUAGE_LOCALE_OPTIONS: ReadonlyArray<{
	value: SupportedLanguageLocale;
	label: string;
}> = [
	{ value: 'en-AU', label: 'Australia · English' },
	{ value: 'en-US', label: 'United States · English' },
	{ value: 'en-GB', label: 'United Kingdom · English' }
];

export const NUMBER_LOCALE_OPTIONS: ReadonlyArray<{
	value: SupportedNumberLocale;
	label: string;
}> = [
	{ value: 'en-AU', label: 'Australia · 1,234.56' },
	{ value: 'en-US', label: 'United States · 1,234.56' },
	{ value: 'en-GB', label: 'United Kingdom · 1,234.56' }
];

export const SUPPORTED_UNIT_CODES = [
	'ea',
	'point',
	'set',
	'lot',
	'job',
	'sheet',
	'pack',
	'box',
	'bag',
	'roll',
	'min',
	'hr',
	'day',
	'shift',
	'week',
	'month',
	'mm',
	'm',
	'm2',
	'm3',
	'L',
	'kg',
	't',
	'fixed',
	'lump_sum'
] as const;

export type UnitCode = (typeof SUPPORTED_UNIT_CODES)[number];

export type UnitContext =
	'material' | 'labour-rate' | 'equipment-rate' | 'takeoff-item' | 'cost-component';

export type CostComponentUnitCategory =
	'material' | 'labour' | 'equipment' | 'subcontract' | 'misc';

export const UNIT_OPTIONS: ReadonlyArray<{
	value: UnitCode;
	label: string;
	contexts: readonly UnitContext[];
	costComponentCategories?: readonly CostComponentUnitCategory[];
}> = [
	{
		value: 'ea',
		label: 'Each (ea)',
		contexts: ['material', 'takeoff-item', 'cost-component'],
		costComponentCategories: ['material', 'subcontract', 'misc']
	},
	{
		value: 'set',
		label: 'Set',
		contexts: ['material', 'takeoff-item', 'cost-component'],
		costComponentCategories: ['material', 'subcontract', 'misc']
	},
	{
		value: 'lot',
		label: 'Lot',
		contexts: ['material', 'takeoff-item', 'cost-component'],
		costComponentCategories: ['material', 'subcontract', 'misc']
	},
	{
		value: 'job',
		label: 'Job',
		contexts: ['takeoff-item', 'cost-component'],
		costComponentCategories: ['subcontract', 'misc']
	},
	{
		value: 'sheet',
		label: 'Sheet',
		contexts: ['material', 'takeoff-item', 'cost-component'],
		costComponentCategories: ['material', 'misc']
	},
	{
		value: 'pack',
		label: 'Pack',
		contexts: ['material', 'takeoff-item', 'cost-component'],
		costComponentCategories: ['material', 'misc']
	},
	{
		value: 'box',
		label: 'Box',
		contexts: ['material', 'takeoff-item', 'cost-component'],
		costComponentCategories: ['material', 'misc']
	},
	{
		value: 'bag',
		label: 'Bag',
		contexts: ['material', 'takeoff-item', 'cost-component'],
		costComponentCategories: ['material', 'misc']
	},
	{
		value: 'roll',
		label: 'Roll',
		contexts: ['material', 'takeoff-item', 'cost-component'],
		costComponentCategories: ['material', 'misc']
	},
	{
		value: 'min',
		label: 'Minute (min)',
		contexts: ['labour-rate', 'equipment-rate', 'cost-component'],
		costComponentCategories: ['labour', 'equipment', 'subcontract', 'misc']
	},
	{
		value: 'm',
		label: 'Metre (m)',
		contexts: ['labour-rate', 'equipment-rate', 'material', 'takeoff-item', 'cost-component'],
		costComponentCategories: ['labour', 'equipment', 'material', 'subcontract', 'misc']
	},
	{
		value: 'm2',
		label: 'Square metre (m²)',
		contexts: ['labour-rate', 'equipment-rate', 'material', 'takeoff-item', 'cost-component'],
		costComponentCategories: ['labour', 'equipment', 'material', 'subcontract', 'misc']
	},
	{
		value: 'm3',
		label: 'Cubic metre (m³)',
		contexts: ['labour-rate', 'equipment-rate', 'material', 'takeoff-item', 'cost-component'],
		costComponentCategories: ['labour', 'equipment', 'material', 'subcontract', 'misc']
	},
	{
		value: 'hr',
		label: 'Hour (hr)',
		contexts: ['labour-rate', 'equipment-rate', 'cost-component'],
		costComponentCategories: ['labour', 'equipment', 'subcontract', 'misc']
	},
	{
		value: 'day',
		label: 'Day',
		contexts: ['labour-rate', 'equipment-rate', 'cost-component'],
		costComponentCategories: ['labour', 'equipment', 'subcontract', 'misc']
	},
	{
		value: 'shift',
		label: 'Shift',
		contexts: ['labour-rate', 'equipment-rate', 'cost-component'],
		costComponentCategories: ['labour', 'equipment', 'subcontract']
	},
	{
		value: 'week',
		label: 'Week',
		contexts: ['cost-component'],
		costComponentCategories: ['subcontract', 'misc']
	},
	{
		value: 'mm',
		label: 'Millimetre (mm)',
		contexts: ['material', 'takeoff-item', 'cost-component'],
		costComponentCategories: ['material', 'misc']
	},

	{
		value: 'L',
		label: 'Litre (L)',
		contexts: ['material', 'takeoff-item', 'cost-component'],
		costComponentCategories: ['material', 'misc']
	},
	{
		value: 'kg',
		label: 'Kilogram (kg)',
		contexts: ['material', 'takeoff-item', 'cost-component'],
		costComponentCategories: ['material', 'subcontract', 'misc']
	},
	{
		value: 't',
		label: 'Tonne (t)',
		contexts: ['material', 'takeoff-item', 'cost-component'],
		costComponentCategories: ['material', 'subcontract', 'misc']
	},
	{
		value: 'fixed',
		label: 'Fixed',
		contexts: ['labour-rate', 'equipment-rate', 'cost-component'],
		costComponentCategories: ['labour', 'equipment', 'subcontract', 'misc']
	}
] as const;

import { RECORD_UNIT_POLICIES } from '$lib/services/assistant-actions/record-unit-policy-definitions.js';

/** Generated from RECORD_UNIT_POLICIES — do not maintain manually. */
export const MATERIAL_UNIT_CODES = [...RECORD_UNIT_POLICIES.materials.allowedUnits] as const;
export const LABOUR_RATE_UNIT_CODES = [
	'min',
	'hr',
	'day',
	'shift',
	'week',
	'fixed',
	'm',
	'm2',
	'm3'
] as const;
export const EQUIPMENT_RATE_UNIT_CODES = [
	'min',
	'hr',
	'day',
	'shift',
	'week',
	'fixed',
	'm',
	'm2',
	'm3'
] as const;
/**
 * All valid DB values for subcontract rate cards.
 * Must cover every value that the database schema accepts.
 * The canonical policy (RECORD_UNIT_POLICIES) defines a subset the AI may propose.
 */
export const SUBCONTRACT_RATE_UNIT_CODES = [
	'ea',
	'set',
	'lot',
	'job',
	'sheet',
	'pack',
	'box',
	'bag',
	'roll',
	'min',
	'hr',
	'day',
	'shift',
	'week',
	'mm',
	'm',
	'm2',
	'm3',
	'L',
	'kg',
	't',
	'fixed',
	'point',
	'lump_sum'
] as const;

export type MaterialUnitCode = (typeof MATERIAL_UNIT_CODES)[number];
export type LabourRateUnitCode = (typeof LABOUR_RATE_UNIT_CODES)[number];
export type EquipmentRateUnitCode = (typeof EQUIPMENT_RATE_UNIT_CODES)[number];
export type SubcontractRateUnitCode = (typeof SUBCONTRACT_RATE_UNIT_CODES)[number];

function getUnitOptionsForValues(values: readonly UnitCode[]) {
	const allowed = new Set(values);
	return UNIT_OPTIONS.filter((option) => allowed.has(option.value));
}

export function getUnitOptions(...contexts: UnitContext[]) {
	if (contexts.length === 0) return [...UNIT_OPTIONS];
	return UNIT_OPTIONS.filter((option) =>
		contexts.some((context) => option.contexts.includes(context))
	);
}

export function getCostComponentUnitOptions(category?: CostComponentUnitCategory | null) {
	if (!category || category === 'misc') {
		return getUnitOptions('cost-component');
	}

	return UNIT_OPTIONS.filter(
		(option) =>
			option.contexts.includes('cost-component') &&
			option.costComponentCategories?.includes(category)
	);
}

export const MATERIAL_UNIT_OPTIONS = getUnitOptionsForValues(MATERIAL_UNIT_CODES);
export const LABOUR_RATE_UNIT_OPTIONS = getUnitOptionsForValues(LABOUR_RATE_UNIT_CODES);
export const EQUIPMENT_RATE_UNIT_OPTIONS = getUnitOptionsForValues(EQUIPMENT_RATE_UNIT_CODES);
export const TAKEOFF_ITEM_UNIT_OPTIONS = getUnitOptions('takeoff-item');
export const COST_COMPONENT_UNIT_OPTIONS = getUnitOptions('cost-component');
export const SUBCONTRACT_RATE_UNIT_OPTIONS = getUnitOptionsForValues(SUBCONTRACT_RATE_UNIT_CODES);

const UNIT_ALIAS_MAP: Record<string, UnitCode> = {
	each: 'ea',
	ea: 'ea',
	item: 'ea',
	items: 'ea',
	unit: 'ea',
	units: 'ea',
	per: 'ea',
	set: 'set',
	lot: 'lot',
	job: 'job',
	sheet: 'sheet',
	sheets: 'sheet',
	pack: 'pack',
	packs: 'pack',
	box: 'box',
	boxes: 'box',
	bag: 'bag',
	bags: 'bag',
	roll: 'roll',
	rolls: 'roll',
	min: 'min',
	mins: 'min',
	minute: 'min',
	minutes: 'min',
	hr: 'hr',
	hrs: 'hr',
	hour: 'hr',
	hours: 'hr',
	hourly: 'hr',
	'per hour': 'hr',
	'per hr': 'hr',
	'/hr': 'hr',
	'/hour': 'hr',
	'$/hr': 'hr',
	'$ per hr': 'hr',
	'$ per hour': 'hr',
	'hr/person': 'hr',
	day: 'day',
	days: 'day',
	daily: 'day',
	'per day': 'day',
	perday: 'day',
	'/day': 'day',
	shift: 'shift',
	shifts: 'shift',
	'single shift': 'shift',
	'per shift': 'shift',
	week: 'week',
	weeks: 'week',
	weekly: 'week',
	perweek: 'week',
	'per week': 'week',
	'/week': 'week',
	month: 'month',
	months: 'month',
	monthly: 'month',
	permonth: 'month',
	'per month': 'month',
	'/month': 'month',
	mm: 'mm',
	lm: 'm',
	m: 'm',
	metre: 'm',
	'linear metre': 'm',
	'linear metres': 'm',
	'lineal metre': 'm',
	'lineal metres': 'm',
	metres: 'm',
	meter: 'm',
	meters: 'm',
	m2: 'm2',
	'm^2': 'm2',
	sqm: 'm2',
	sq: 'm2',
	'sq metre': 'm2',
	'sq metres': 'm2',
	'sq m': 'm2',
	'square metre': 'm2',
	'square metres': 'm2',
	'square meter': 'm2',
	'square meters': 'm2',
	'm²': 'm2',
	m3: 'm3',
	'm^3': 'm3',
	'cu m': 'm3',
	'cubic metre': 'm3',
	'cubic metres': 'm3',
	'cubic meter': 'm3',
	'cubic meters': 'm3',
	'm³': 'm3',
	l: 'L',
	litre: 'L',
	liter: 'L',
	litres: 'L',
	liters: 'L',
	kg: 'kg',
	kilogram: 'kg',
	kilograms: 'kg',
	t: 't',
	ton: 't',
	tons: 't',
	tonne: 't',
	tonnes: 't',
	point: 'point',
	fixed: 'fixed'
};

export function normaliseUnitCode(value: unknown): UnitCode | null {
	if (typeof value !== 'string') return null;
	const normalised = value.trim().toLowerCase();
	return UNIT_ALIAS_MAP[normalised] ?? null;
}

function normaliseUnitCodeForValues<T extends readonly UnitCode[]>(
	value: unknown,
	allowedUnits: T
): T[number] | null {
	const code = normaliseUnitCode(value);
	if (!code) return null;
	return allowedUnits.includes(code as T[number]) ? (code as T[number]) : null;
}

export function normaliseMaterialUnitCode(value: unknown): MaterialUnitCode | null {
	return normaliseUnitCodeForValues(value, MATERIAL_UNIT_CODES);
}

export function normaliseLabourRateUnitCode(value: unknown): LabourRateUnitCode | null {
	return normaliseUnitCodeForValues(value, LABOUR_RATE_UNIT_CODES);
}

export function normaliseEquipmentRateUnitCode(value: unknown): EquipmentRateUnitCode | null {
	return normaliseUnitCodeForValues(value, EQUIPMENT_RATE_UNIT_CODES);
}

export function normaliseSubcontractRateUnitCode(value: unknown): SubcontractRateUnitCode | null {
	// Apply ingress alias map first, then check against canonical list
	const aliased = typeof value === 'string' ? normaliseSubcontractUnitAlias(value) : value;
	return normaliseUnitCodeForValues(aliased, SUBCONTRACT_RATE_UNIT_CODES);
}

export function getUnitLabel(value: string | null | undefined): string {
	const code = normaliseUnitCode(value);
	if (!code) return value ?? '';
	return UNIT_OPTIONS.find((option) => option.value === code)?.label ?? code;
}

export const CLASSIFICATION_SYSTEM_TYPE_OPTIONS = [
	{ value: 'masterformat', label: 'CSI MasterFormat' },
	{ value: 'uniformat', label: 'UniFormat' },
	{ value: 'xactimate', label: 'Xactimate' },
	{ value: 'custom', label: 'Custom' }
] as const;

/** Canonical unit alias map for subcontract rates: common aliases → canonical machine value. */
export const SUBCONTRACT_UNIT_ALIASES: Record<string, string> = {
	lot: 'lump_sum',
	job: 'lump_sum',
	ls: 'lump_sum',
	'lump sum': 'lump_sum',
	'lump-sum': 'lump_sum',
	each: 'ea',
	hour: 'hr',
	hours: 'hr'
};

/** Normalise a subcontract unit value through the alias map. */
export function normaliseSubcontractUnitAlias(value: string): string {
	const trimmed = value.trim().toLowerCase();
	return SUBCONTRACT_UNIT_ALIASES[trimmed] ?? value;
}

export const WBS_NODE_TYPE_OPTIONS = [
	{ value: 'phase', label: 'Phase' },
	{ value: 'level', label: 'Level' },
	{ value: 'zone', label: 'Zone' },
	{ value: 'room', label: 'Room' },
	{ value: 'trade', label: 'Trade' },
	{ value: 'custom', label: 'Custom' }
] as const;

// ── File type classification ────────────────────────────────────────
export {
	ALL_ACCEPTED_EXTENSIONS,
	BRAND_LOGO_EXTENSIONS,
	BRAND_LOGO_MIME_TYPES,
	FILE_EXTENSIONS,
	GENERAL_PROJECT_FILE_SUMMARY,
	GENERAL_PROJECT_FILE_UPLOAD_EXTENSIONS,
	getEstimateAiPreparedArtifactKind,
	getEstimateAiStaticPolicy,
	getEstimateAiSummary,
	getFileCategory,
	getFileSupportProfile,
	getGeneralFileCapability,
	getGeneralFilePreviewKind,
	getGeneralFileThumbnailKind,
	getGeneralFileThumbnailPriority,
	getGeneralProjectFileSummary,
	getGeneralProjectFileUploadExtensions,
	inferGeneralFileMimeType,
	isGeneralProjectFileUploadAllowed
} from './file-support.js';
export type {
	EstimateAiPreparedArtifactKind,
	EstimateAiStaticPolicy,
	FileCategory,
	FileSupportProfile,
	GeneralFileCapability,
	GeneralFilePreviewKind,
	GeneralFileThumbnailKind
} from './file-support.js';
