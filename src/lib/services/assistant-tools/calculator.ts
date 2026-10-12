import { Decimal } from 'decimal.js';
import { z } from 'zod';
import { normaliseUnitCode } from '$lib/constants/index.js';

const ROUNDING_MODES = {
	half_up: Decimal.ROUND_HALF_UP,
	half_even: Decimal.ROUND_HALF_EVEN,
	down: Decimal.ROUND_DOWN,
	up: Decimal.ROUND_UP,
	floor: Decimal.ROUND_FLOOR,
	ceil: Decimal.ROUND_CEIL
} as const;

export const DecimalRoundingModeSchema = z.preprocess(
	(value) => (typeof value === 'string' ? value.toLowerCase() : value),
	z.enum(['half_up', 'half_even', 'down', 'up', 'floor', 'ceil'])
);

// Model-facing: the ONLY parameter the LLM should set.  The app
// owns precision, rounding, decimal places, unit, and sign rules.
export const ModelEvaluateDecimalParametersSchema = z.object({
	expression: z
		.string()
		.trim()
		.min(1)
		.max(500)
		.describe(
			'A mathematical expression. Supports: +, -, *, /, ^ (power), parentheses, PI constant, and functions: sqrt(x), abs(x), round(x, dp), ceil(x), floor(x), min(a,b), max(a,b).\n' +
				'Examples: "pi * 2.5^2", "sqrt(3^2 + 4^2)", "ceil(14.2) * 85", "min(12.5, max(8.0, 10.0))".'
		)
});

// Internal: full schema with safe defaults.  Never expose precision,
// roundingMode, decimalPlaces, unit, or allowNegative to the model.
export const EvaluateDecimalParametersSchema = z.object({
	expression: z.string().trim().min(1).max(500),
	precision: z.number().int().min(20).max(40).default(20),
	roundingMode: DecimalRoundingModeSchema.default('half_up'),
	decimalPlaces: z.number().int().min(0).max(12).optional(),
	unit: z.string().trim().min(1).optional(),
	allowNegative: z.boolean().default(true)
});

export const ValidateQuantityFormulaParametersSchema = z.object({
	formula: z.string().trim().min(1).max(500),
	precision: z.number().int().min(20).max(40).default(20),
	roundingMode: DecimalRoundingModeSchema.default('half_up'),
	decimalPlaces: z.number().int().min(0).max(12).optional(),
	unit: z.string().trim().min(1).optional()
});

type DecimalConstructor = typeof Decimal;

type Token =
	| { type: 'number'; value: string }
	| { type: 'operator'; value: '+' | '-' | '*' | '/' | '^' }
	| { type: 'paren'; value: '(' | ')' }
	| { type: 'comma'; value: ',' }
	| { type: 'percent'; value: '%' }
	| { type: 'identifier'; value: string };

export type DecimalToolResult = {
	value: string;
	precision: number;
	roundingMode: z.infer<typeof DecimalRoundingModeSchema>;
	decimalPlaces: number | null;
	unit: string | null;
	provenance: {
		toolName: 'calculator_evaluate_decimal';
		engine: 'decimal.js';
		inputExpression: string;
	};
};

export type QuantityFormulaValidationResult = {
	valid: boolean;
	value: string | null;
	unit: string | null;
	issues: Array<{ code: 'invalid_unit' | 'invalid_formula'; message: string }>;
	provenance: {
		toolName: 'formula_validate_quantity';
		calculatorToolName: 'calculator_evaluate_decimal';
	};
};

function tokenize(expression: string): Token[] {
	const tokens: Token[] = [];
	let index = 0;
	while (index < expression.length) {
		const char = expression[index];
		if (/\s/.test(char)) {
			index += 1;
			continue;
		}
		if (char === '+' || char === '-' || char === '*' || char === '/' || char === '^') {
			tokens.push({ type: 'operator', value: char });
			index += 1;
			continue;
		}
		if (char === '(' || char === ')') {
			tokens.push({ type: 'paren', value: char });
			index += 1;
			continue;
		}
		if (char === ',') {
			tokens.push({ type: 'comma', value: char });
			index += 1;
			continue;
		}
		if (char === '%') {
			tokens.push({ type: 'percent', value: char });
			index += 1;
			continue;
		}
		if (/[a-zA-Z_]/.test(char)) {
			const start = index;
			while (index < expression.length && /[a-zA-Z0-9_]/.test(expression[index])) {
				index += 1;
			}
			const value = expression.slice(start, index);
			tokens.push({ type: 'identifier', value });
			continue;
		}
		if (/\d|\./.test(char)) {
			const start = index;
			let hasDecimalPoint = false;
			while (index < expression.length && /\d|\./.test(expression[index])) {
				if (expression[index] === '.') {
					if (hasDecimalPoint) {
						throw new Error('Invalid decimal expression: number contains multiple decimal points.');
					}
					hasDecimalPoint = true;
				}
				index += 1;
			}
			const value = expression.slice(start, index);
			if (!/^\d+(\.\d+)?$|^\.\d+$/.test(value)) {
				throw new Error(`Invalid decimal expression: invalid number "${value}".`);
			}
			tokens.push({ type: 'number', value });
			continue;
		}
		throw new Error(`Unsupported token in decimal expression: "${char}".`);
	}
	return tokens;
}

class DecimalExpressionParser {
	private index = 0;

	constructor(
		private readonly tokens: Token[],
		private readonly Dec: DecimalConstructor
	) {}

	parse(): Decimal {
		if (this.tokens.length === 0) {
			throw new Error('Invalid decimal expression: expression is empty.');
		}
		const value = this.parseExpression();
		if (this.peek()) {
			throw new Error('Invalid decimal expression: unexpected trailing token.');
		}
		return value;
	}

	private parseExpression(): Decimal {
		let value = this.parseTerm();
		while (this.matchOperator('+') || this.matchOperator('-')) {
			const operator = this.previous().value;
			const right = this.parseTerm();
			value = operator === '+' ? value.plus(right) : value.minus(right);
		}
		return value;
	}

	private parseTerm(): Decimal {
		let value = this.parseExponent();
		while (this.matchOperator('*') || this.matchOperator('/')) {
			const operator = this.previous().value;
			const right = this.parseExponent();
			if (operator === '/') {
				if (right.isZero()) {
					throw new Error('Division by zero is not allowed in decimal expressions.');
				}
				value = value.div(right);
			} else {
				value = value.mul(right);
			}
		}
		return value;
	}

	private parseExponent(): Decimal {
		let value = this.parsePostfix();
		if (this.matchOperator('^')) {
			const right = this.parseExponent();
			value = value.pow(right);
		}
		return value;
	}

	private parsePostfix(): Decimal {
		let value = this.parseFactor();
		while (this.peek()?.type === 'percent') {
			this.index += 1;
			value = value.div(100);
		}
		return value;
	}

	private parseFactor(): Decimal {
		if (this.matchOperator('+')) return this.parseFactor();
		if (this.matchOperator('-')) return this.parseFactor().neg();

		const token = this.peek();
		if (!token) {
			throw new Error('Invalid decimal expression: expected a number, constant, or function call.');
		}

		if (token.type === 'identifier') {
			this.index += 1;
			const name = token.value.toLowerCase();
			if (name === 'pi') {
				return new this.Dec('3.14159265358979323846');
			}

			if (!this.matchParen('(')) {
				throw new Error(
					`Invalid decimal expression: expected "(" after function name "${token.value}".`
				);
			}

			const args: Decimal[] = [];
			if (!this.matchParen(')')) {
				args.push(this.parseExpression());
				while (this.matchComma()) {
					args.push(this.parseExpression());
				}
				if (!this.matchParen(')')) {
					throw new Error(
						`Invalid decimal expression: missing closing parenthesis for function "${token.value}".`
					);
				}
			}

			if (name === 'sqrt') {
				if (args.length !== 1) {
					throw new Error('Function "sqrt" expects exactly 1 argument.');
				}
				if (args[0].isNegative()) {
					throw new Error('Square root of negative number is not allowed in decimal expressions.');
				}
				return args[0].sqrt();
			}
			if (name === 'abs') {
				if (args.length !== 1) {
					throw new Error('Function "abs" expects exactly 1 argument.');
				}
				return args[0].abs();
			}
			if (name === 'ceil') {
				if (args.length !== 1) {
					throw new Error('Function "ceil" expects exactly 1 argument.');
				}
				return args[0].ceil();
			}
			if (name === 'floor') {
				if (args.length !== 1) {
					throw new Error('Function "floor" expects exactly 1 argument.');
				}
				return args[0].floor();
			}
			if (name === 'round') {
				if (args.length < 1 || args.length > 2) {
					throw new Error('Function "round" expects 1 or 2 arguments.');
				}
				const dp = args.length === 2 ? Number(args[1].toString()) : 0;
				if (!Number.isInteger(dp) || dp < 0 || dp > 12) {
					throw new Error(
						'Function "round" second argument (decimal places) must be an integer between 0 and 12.'
					);
				}
				return args[0].toDecimalPlaces(dp, Decimal.ROUND_HALF_UP);
			}
			if (name === 'min') {
				if (args.length < 2) {
					throw new Error('Function "min" expects at least 2 arguments.');
				}
				let val = args[0];
				for (let i = 1; i < args.length; i++) {
					if (args[i].lt(val)) val = args[i];
				}
				return val;
			}
			if (name === 'max') {
				if (args.length < 2) {
					throw new Error('Function "max" expects at least 2 arguments.');
				}
				let val = args[0];
				for (let i = 1; i < args.length; i++) {
					if (args[i].gt(val)) val = args[i];
				}
				return val;
			}

			throw new Error(`Unsupported mathematical function or constant: "${token.value}".`);
		}

		if (token.type === 'number') {
			this.index += 1;
			return new this.Dec(token.value);
		}
		if (token.type === 'paren' && token.value === '(') {
			this.index += 1;
			const value = this.parseExpression();
			if (!this.matchParen(')')) {
				throw new Error('Invalid decimal expression: missing closing parenthesis.');
			}
			return value;
		}
		throw new Error('Invalid decimal expression: expected a number, constant, or function call.');
	}

	private matchOperator(value: '+' | '-' | '*' | '/' | '^'): boolean {
		const token = this.peek();
		if (token?.type !== 'operator' || token.value !== value) return false;
		this.index += 1;
		return true;
	}

	private matchParen(value: '(' | ')'): boolean {
		const token = this.peek();
		if (token?.type !== 'paren' || token.value !== value) return false;
		this.index += 1;
		return true;
	}

	private matchComma(): boolean {
		const token = this.peek();
		if (token?.type !== 'comma') return false;
		this.index += 1;
		return true;
	}

	private previous(): Token & { type: 'operator' } {
		return this.tokens[this.index - 1] as Token & { type: 'operator' };
	}

	private peek(): Token | undefined {
		return this.tokens[this.index];
	}
}

function normaliseFormulaUnit(value: string | undefined): string | null {
	if (!value) return null;
	return normaliseUnitCode(value) ?? value.trim();
}

export function evaluateDecimalExpression(input: unknown): DecimalToolResult {
	const parsed = EvaluateDecimalParametersSchema.parse(input);
	let expr = parsed.expression.trim();

	// Strip common leading conversational helper words (e.g. "calculate ", "evaluate ", "count ")
	// if they are followed by a space and are not known functions or constants.
	const firstWordMatch = expr.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s+/);
	if (firstWordMatch) {
		const word = firstWordMatch[1].toLowerCase();
		const allowed = ['sqrt', 'abs', 'ceil', 'floor', 'round', 'min', 'max', 'pi'];
		if (!allowed.includes(word)) {
			expr = expr.slice(firstWordMatch[0].length).trim();
		}
	}

	// Also strip trailing helper words like " equals" or " is"
	expr = expr.replace(/\s+(?:equals|is)\s*$/i, '');

	const Dec = Decimal.clone({
		precision: parsed.precision,
		rounding: ROUNDING_MODES[parsed.roundingMode]
	});
	const tokens = tokenize(expr);
	let value = new DecimalExpressionParser(tokens, Dec).parse();
	if (!value.isFinite()) {
		throw new Error('Invalid decimal expression: result must be finite.');
	}
	if (!parsed.allowNegative && value.isNegative()) {
		throw new Error(
			'Negative result rejected: construction quantities and rates cannot be negative. Use allowNegative=true only for financial adjustments (credits, reversals).'
		);
	}
	if (parsed.decimalPlaces !== undefined) {
		value = value.toDecimalPlaces(parsed.decimalPlaces, ROUNDING_MODES[parsed.roundingMode]);
	}
	return {
		value: value.toString(),
		precision: parsed.precision,
		roundingMode: parsed.roundingMode,
		decimalPlaces: parsed.decimalPlaces ?? null,
		unit: normaliseFormulaUnit(parsed.unit),
		provenance: {
			toolName: 'calculator_evaluate_decimal',
			engine: 'decimal.js',
			inputExpression: parsed.expression
		}
	};
}

export function validateQuantityFormula(input: unknown): QuantityFormulaValidationResult {
	const parsed = ValidateQuantityFormulaParametersSchema.parse(input);
	const issues: QuantityFormulaValidationResult['issues'] = [];
	const unit = normaliseFormulaUnit(parsed.unit);
	if (parsed.unit && !normaliseUnitCode(parsed.unit)) {
		issues.push({ code: 'invalid_unit', message: `Unsupported estimator unit: ${parsed.unit}` });
	}

	try {
		const result = evaluateDecimalExpression({
			expression: parsed.formula,
			precision: parsed.precision,
			roundingMode: parsed.roundingMode,
			decimalPlaces: parsed.decimalPlaces,
			unit: parsed.unit,
			allowNegative: false
		});
		return {
			valid: issues.length === 0,
			value: result.value,
			unit,
			issues,
			provenance: {
				toolName: 'formula_validate_quantity',
				calculatorToolName: 'calculator_evaluate_decimal'
			}
		};
	} catch (error) {
		issues.push({
			code: 'invalid_formula',
			message: error instanceof Error ? error.message : 'Invalid quantity formula.'
		});
		return {
			valid: false,
			value: null,
			unit,
			issues,
			provenance: {
				toolName: 'formula_validate_quantity',
				calculatorToolName: 'calculator_evaluate_decimal'
			}
		};
	}
}
