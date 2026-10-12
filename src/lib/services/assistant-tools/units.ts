import { Decimal } from 'decimal.js';
import { z } from 'zod';
import { normaliseUnitCode } from '$lib/constants/index.js';

export const ConvertEstimatorUnitParametersSchema = z.object({
	value: z.string().trim().min(1).max(120),
	fromUnit: z.string().trim().min(1),
	toUnit: z.string().trim().min(1),
	precision: z.number().int().min(1).max(40).default(20),
	decimalPlaces: z.number().int().min(0).max(12).optional(),
	workdayHours: z.string().trim().min(1).max(20).optional(),
	workWeekDays: z.string().trim().min(1).max(20).optional()
});

type ConvertEstimatorUnitParameters = z.infer<typeof ConvertEstimatorUnitParametersSchema>;

export type UnitConversionResult = {
	value: string;
	fromUnit: string;
	toUnit: string;
	factor: string;
	provenance: {
		toolName: 'units_convert';
		engine: 'decimal.js';
	};
};

type ConversionFamily = 'length' | 'mass' | 'time' | 'count' | 'area' | 'volume';

const LOCAL_UNIT_MAP: Record<string, string> = {
	// Length
	mm: 'mm',
	milimeter: 'mm',
	milimeters: 'mm',
	millimetre: 'mm',
	millimetres: 'mm',
	cm: 'cm',
	centimeter: 'cm',
	centimeters: 'cm',
	centimetre: 'cm',
	centimetres: 'cm',
	m: 'm',
	meter: 'm',
	meters: 'm',
	metre: 'm',
	metres: 'm',
	lm: 'm',
	km: 'km',
	kilometer: 'km',
	kilometers: 'km',
	kilometre: 'km',
	kilometres: 'km',
	in: 'in',
	inch: 'in',
	inches: 'in',
	'"': 'in',
	ft: 'ft',
	foot: 'ft',
	feet: 'ft',
	"'": 'ft',
	yd: 'yd',
	yard: 'yd',
	yards: 'yd',

	// Area
	m2: 'm2',
	sqm: 'm2',
	'm^2': 'm2',
	'square meter': 'm2',
	'square meters': 'm2',
	cm2: 'cm2',
	ft2: 'ft2',
	sqft: 'ft2',
	'square foot': 'ft2',
	'square feet': 'ft2',
	yd2: 'yd2',
	sqyd: 'yd2',
	'square yard': 'yd2',
	'square yards': 'yd2',
	acre: 'acre',
	acres: 'acre',

	// Volume
	m3: 'm3',
	cum: 'm3',
	'm^3': 'm3',
	'cubic meter': 'm3',
	'cubic meters': 'm3',
	l: 'L',
	L: 'L',
	litre: 'L',
	litres: 'L',
	liter: 'L',
	liters: 'L',
	ft3: 'ft3',
	cuft: 'ft3',
	'cubic foot': 'ft3',
	'cubic feet': 'ft3',
	yd3: 'yd3',
	cuyd: 'yd3',
	'cubic yard': 'yd3',
	'cubic yards': 'yd3',
	gal: 'gal',
	gallon: 'gal',
	gallons: 'gal',

	// Mass
	kg: 'kg',
	kilogram: 'kg',
	kilograms: 'kg',
	t: 't',
	tonne: 't',
	tonnes: 't',
	ton: 't',
	tons: 't',
	lb: 'lb',
	lbs: 'lb',
	pound: 'lb',
	pounds: 'lb',
	oz: 'oz',
	ounce: 'oz',
	ounces: 'oz',

	// Time
	hr: 'hr',
	hrs: 'hr',
	hour: 'hr',
	hours: 'hr',
	day: 'day',
	days: 'day',
	shift: 'shift',
	shifts: 'shift',
	week: 'week',
	weeks: 'week',

	// Count
	ea: 'ea',
	each: 'ea',
	item: 'ea',
	items: 'ea',
	lot: 'lot',
	job: 'job',
	fixed: 'fixed'
};

const LOCAL_UNIT_FAMILY: Record<string, ConversionFamily> = {
	// Length
	mm: 'length',
	cm: 'length',
	m: 'length',
	km: 'length',
	in: 'length',
	ft: 'length',
	yd: 'length',

	// Area
	m2: 'area',
	cm2: 'area',
	ft2: 'area',
	yd2: 'area',
	acre: 'area',

	// Volume
	m3: 'volume',
	L: 'volume',
	ft3: 'volume',
	yd3: 'volume',
	gal: 'volume',

	// Mass
	kg: 'mass',
	t: 'mass',
	lb: 'mass',
	oz: 'mass',

	// Time
	hr: 'time',
	day: 'time',
	shift: 'time',
	week: 'time',

	// Count
	ea: 'count',
	lot: 'count',
	job: 'count',
	fixed: 'count'
};

function decimalFromInput(Dec: typeof Decimal, value: string, label: string): Decimal {
	try {
		const decimal = new Dec(value);
		if (!decimal.isFinite()) throw new Error('not finite');
		return decimal;
	} catch {
		throw new Error(`Invalid decimal ${label}: ${value}`);
	}
}

function getFactorToBase(
	unit: string,
	parsed: ConvertEstimatorUnitParameters,
	Dec: typeof Decimal
): Decimal {
	switch (unit) {
		// Length (base: m)
		case 'm':
			return new Dec(1);
		case 'mm':
			return new Dec('0.001');
		case 'cm':
			return new Dec('0.01');
		case 'km':
			return new Dec('1000');
		case 'in':
			return new Dec('0.0254');
		case 'ft':
			return new Dec('0.3048');
		case 'yd':
			return new Dec('0.9144');

		// Area (base: m2)
		case 'm2':
			return new Dec(1);
		case 'cm2':
			return new Dec('0.0001');
		case 'ft2':
			return new Dec('0.09290304');
		case 'yd2':
			return new Dec('0.83612736');
		case 'acre':
			return new Dec('4046.8564224');

		// Volume (base: m3)
		case 'm3':
			return new Dec(1);
		case 'L':
			return new Dec('0.001');
		case 'ft3':
			return new Dec('0.028316846592');
		case 'yd3':
			return new Dec('0.764554857984');
		case 'gal':
			return new Dec('0.003785411784');

		// Mass (base: kg)
		case 'kg':
			return new Dec(1);
		case 't':
			return new Dec('1000');
		case 'lb':
			return new Dec('0.45359237');
		case 'oz':
			return new Dec('0.028349523125');

		// Time (base: hr)
		case 'hr':
			return new Dec(1);
		case 'day': {
			if (!parsed.workdayHours) {
				throw new Error('Ambiguous unit conversion involving day. Provide workdayHours.');
			}
			return decimalFromInput(Dec, parsed.workdayHours, 'workdayHours');
		}
		case 'shift': {
			if (!parsed.workdayHours) {
				throw new Error('Ambiguous unit conversion involving shift. Provide workdayHours.');
			}
			return decimalFromInput(Dec, parsed.workdayHours, 'workdayHours');
		}
		case 'week': {
			if (!parsed.workdayHours) {
				throw new Error('Ambiguous unit conversion involving week. Provide workdayHours.');
			}
			const workdayHours = decimalFromInput(Dec, parsed.workdayHours, 'workdayHours');
			const workWeekDays = decimalFromInput(Dec, parsed.workWeekDays || '5', 'workWeekDays');
			return workdayHours.mul(workWeekDays);
		}

		// Count (base: ea)
		case 'ea':
			return new Dec(1);
		case 'lot':
			return new Dec(1);
		case 'job':
			return new Dec(1);
		case 'fixed':
			return new Dec(1);

		default:
			throw new Error(`Unsupported base conversion unit: ${unit}`);
	}
}

export function convertEstimatorUnit(input: unknown): UnitConversionResult {
	const parsed = ConvertEstimatorUnitParametersSchema.parse(input);

	// Try local map first, fall back to global map if not found
	const localFrom = LOCAL_UNIT_MAP[parsed.fromUnit.trim().toLowerCase()];
	const localTo = LOCAL_UNIT_MAP[parsed.toUnit.trim().toLowerCase()];

	const fromUnit = localFrom ?? normaliseUnitCode(parsed.fromUnit);
	const toUnit = localTo ?? normaliseUnitCode(parsed.toUnit);

	if (!fromUnit || !toUnit) {
		throw new Error(`Ambiguous unit conversion from ${parsed.fromUnit} to ${parsed.toUnit}.`);
	}

	const fromFamily = LOCAL_UNIT_FAMILY[fromUnit];
	const toFamily = LOCAL_UNIT_FAMILY[toUnit];

	if (!fromFamily || !toFamily || fromFamily !== toFamily) {
		throw new Error(`Ambiguous unit conversion from ${fromUnit} to ${toUnit}.`);
	}

	if (fromFamily === 'count' && fromUnit !== toUnit) {
		throw new Error(`Ambiguous unit conversion from ${fromUnit} to ${toUnit}.`);
	}

	const Dec = Decimal.clone({ precision: parsed.precision, rounding: Decimal.ROUND_HALF_UP });
	const value = decimalFromInput(Dec, parsed.value, 'value');

	const fromFactor = getFactorToBase(fromUnit, parsed, Dec);
	const toFactor = getFactorToBase(toUnit, parsed, Dec);

	const factor = fromFactor.div(toFactor);
	let converted = value.mul(factor);

	if (parsed.decimalPlaces !== undefined) {
		converted = converted.toDecimalPlaces(parsed.decimalPlaces, Decimal.ROUND_HALF_UP);
	}

	const globalFrom = normaliseUnitCode(fromUnit) ?? fromUnit;
	const globalTo = normaliseUnitCode(toUnit) ?? toUnit;

	return {
		value: converted.toString(),
		fromUnit: globalFrom,
		toUnit: globalTo,
		factor: factor.toString(),
		provenance: {
			toolName: 'units_convert',
			engine: 'decimal.js'
		}
	};
}
