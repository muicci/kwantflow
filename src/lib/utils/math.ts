import { Decimal } from 'decimal.js';

// Configure for engineering precision & financial rounding
Decimal.set({
	precision: 20,
	rounding: Decimal.ROUND_HALF_UP
});

/**
 * Shorthand for new Decimal(val).
 * Use this for all intermediate financial/engineering calculations.
 */
export const dec = (val: number | string | Decimal) => new Decimal(val);

/**
 * Parse and normalise a positive decimal string for exact-precision persistence.
 *
 * Accepts any string that decimal.js can parse to a finite, positive (> 0) value.
 * Rejects: empty, zero, negative, NaN, Infinity, unparseable strings.
 *
 * Exponent notation (e.g. "1e-6") is accepted and expanded to plain decimal form.
 * Commas in input are NOT accepted — they must be stripped before calling.
 *
 * The output is a canonical plain-decimal string with no leading zeros
 * and no trailing zeros after the decimal point.
 *
 * NEVER converts through JavaScript Number — all parsing stays in decimal.js
 * arbitrary-precision space.
 *
 * @throws {Error} with a descriptive message for invalid inputs.
 */
export function normalizePositiveDecimalString(value: string): string {
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new Error('Value must be a non-empty string.');
	}

	const trimmed = value.trim();

	let decimal: Decimal;
	try {
		decimal = new Decimal(trimmed);
	} catch {
		throw new Error(`Invalid decimal value: "${value}".`);
	}

	if (!decimal.isFinite()) {
		throw new Error(`Value must be finite: "${value}".`);
	}

	if (decimal.isZero()) {
		throw new Error(`Value must be positive (greater than zero): "${value}".`);
	}

	if (decimal.isNegative()) {
		throw new Error(`Value must be positive: "${value}".`);
	}

	// toFixed() guarantees plain decimal notation (no exponent), preserving
	// all significant digits without truncation.
	return decimal.toFixed();
}
