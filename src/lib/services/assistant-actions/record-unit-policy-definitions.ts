/**
 * Canonical record-specific unit policies.
 *
 * This is the sole manually editable owner for record-specific unit definitions.
 * Other modules must consume generated aliases or projections.
 *
 * @packageDocumentation
 */

export type RecordUnitPolicy = {
	allowedUnits: readonly string[];
	aliases?: Readonly<Record<string, string>>;
	displayLabels?: Readonly<Record<string, string>>;
};

export type RecordUnitPolicies = Record<string, RecordUnitPolicy>;

export const RECORD_UNIT_POLICIES = {
	materials: {
		allowedUnits: [
			'ea',
			'set',
			'lot',
			'sheet',
			'pack',
			'box',
			'bag',
			'roll',
			'mm',
			'm',
			'm2',
			'm3',
			'L',
			'kg',
			't'
		],
		aliases: { each: 'ea' },
		displayLabels: { m3: 'm³', m2: 'm²' }
	},
	labour_rates: {
		allowedUnits: ['hr', 'day', 'week'],
		aliases: { hour: 'hr', hours: 'hr' },
		displayLabels: { hr: 'hr', day: 'day', week: 'week' }
	},
	equipment_rates: {
		allowedUnits: ['hr', 'day', 'week', 'month'],
		aliases: { hour: 'hr', hours: 'hr' },
		displayLabels: { hr: 'hr', day: 'day', week: 'week', month: 'month' }
	},
	subcontract_rates: {
		allowedUnits: ['ea', 'point', 'hr', 'day', 'shift', 'm', 'm2', 'm3', 'lump_sum'],
		aliases: {
			lot: 'lump_sum',
			job: 'lump_sum',
			ls: 'lump_sum',
			'lump sum': 'lump_sum',
			'lump-sum': 'lump_sum',
			each: 'ea',
			hour: 'hr',
			hours: 'hr'
		},
		displayLabels: { lump_sum: 'lump sum', m3: 'm³', m2: 'm²' }
	}
} as const satisfies RecordUnitPolicies;

export type RecordUnitPolicyType = keyof typeof RECORD_UNIT_POLICIES;
