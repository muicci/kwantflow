export function extractBalancedJsonObject(text: string): string | null {
	const start = text.search(/[{[]/);
	if (start < 0) {
		return null;
	}

	let depth = 0;
	let inString = false;
	let escaped = false;
	// Track the stack of open brackets to reconstruct the closing sequence.
	const stack: string[] = [];
	let endIndex = -1;
	let lastMatchedIndex = -1;

	for (let index = start; index < text.length; index += 1) {
		const char = text[index];

		if (escaped) {
			escaped = false;
			if (!inString) {
				lastMatchedIndex = index;
			}
			continue;
		}

		if (char === '\\') {
			escaped = true;
			if (!inString) {
				lastMatchedIndex = index;
			}
			continue;
		}

		if (char === '"') {
			inString = !inString;
			lastMatchedIndex = index;
			continue;
		}

		if (inString) {
			continue;
		}

		if (char === '{' || char === '[') {
			stack.push(char);
			depth += 1;
			lastMatchedIndex = index;
			continue;
		}

		if (char === '}' || char === ']') {
			const expected = stack.pop();
			const expectedClosing = expected === '{' ? '}' : ']';
			if (char === expectedClosing) {
				depth -= 1;
				lastMatchedIndex = index;
				if (depth === 0) {
					endIndex = index + 1;
					break;
				}
			} else {
				// Mismatched bracket — put it back and ignore.
				// Do NOT update lastMatchedIndex so that we do not slice trailing garbage.
				if (expected) {
					stack.push(expected);
				}
			}
			continue;
		}

		// Any other character updates lastMatchedIndex
		if (char !== ' ' && char !== '\n' && char !== '\t' && char !== '\r') {
			lastMatchedIndex = index;
		}
	}

	if (endIndex > 0) {
		return text.slice(start, endIndex);
	}

	// Depth > 0 means JSON was truncated. Auto-complete by appending
	// the missing closing brackets in reverse order.
	if (depth > 0 && lastMatchedIndex >= start) {
		const suffix = stack
			.slice()
			.reverse()
			.map((b) => (b === '{' ? '}' : ']'))
			.join('');
		const completed = text.slice(start, lastMatchedIndex + 1) + suffix;
		// Verify the completed JSON parses correctly.
		try {
			JSON.parse(completed);
			return completed;
		} catch {
			return null;
		}
	}

	return null;
}

function parseCandidate(candidate: string | null): Record<string, unknown> | null {
	if (!candidate) {
		return null;
	}

	const trimmed = candidate.trim();
	if (!trimmed) {
		return null;
	}

	try {
		const parsed = JSON.parse(trimmed);
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function findBalancedFunctionArguments(text: string, functionName: string): string | null {
	const callStart = text.indexOf(`${functionName}(`);
	if (callStart < 0) return null;

	const start = callStart + functionName.length + 1;
	let depth = 1;
	let inString: '"' | "'" | null = null;
	let escaped = false;

	for (let index = start; index < text.length; index += 1) {
		const char = text[index];

		if (escaped) {
			escaped = false;
			continue;
		}
		if (char === '\\') {
			escaped = true;
			continue;
		}
		if (inString) {
			if (char === inString) inString = null;
			continue;
		}
		if (char === '"' || char === "'") {
			inString = char;
			continue;
		}
		if (char === '(') {
			depth += 1;
			continue;
		}
		if (char === ')') {
			depth -= 1;
			if (depth === 0) return text.slice(start, index);
		}
	}

	return text.slice(start).trim();
}

function quotePythonStyleStrings(text: string): string {
	return text.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, value: string) =>
		JSON.stringify(value.replace(/\\'/g, "'"))
	);
}

function removeVerboseFunctionArgumentFields(text: string): string {
	return text.replace(
		/(^|,)\s*["']?(?:unit_?content|raw_?text|evidence_?text|textContent)["']?\s*:\s*(?:"[^"]*(?:"|$)|'[^']*(?:'|$)|\[[\s\S]*?(?:\]|$)|\{[\s\S]*?(?:\}|$)|[^,}\]]*)/gi,
		'$1'
	);
}

export function normaliseFunctionCallJsonLikeContent(
	raw: unknown,
	functionName: string
): Record<string, unknown> | null {
	const text = String(raw ?? '').trim();
	if (!text || !functionName) return null;

	const argumentsText = findBalancedFunctionArguments(text, functionName);
	if (!argumentsText) return null;

	return normaliseFunctionArgumentsJsonLikeContent(argumentsText);
}

export function normaliseFunctionArgumentsJsonLikeContent(
	raw: unknown
): Record<string, unknown> | null {
	const trimmedArguments = String(raw ?? '').trim();
	if (!trimmedArguments) return {};

	const direct = parseCandidate(trimmedArguments);
	if (direct) return direct;

	const wrappedArguments = trimmedArguments
		.replace(/(^|,)\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/g, '$1 "$2":')
		.replace(/=\s*/g, ': ')
		// Gemma native function calls can use Python-like bare object keys inside an
		// otherwise JSON-shaped argument value, e.g. units=[{unitKey: "cad:metadata"}].
		// Restrict this repair to argument normalisation so ordinary evidence text is untouched.
		.replace(/([[{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
	const candidates = [
		wrappedArguments,
		`{${wrappedArguments}}`,
		quotePythonStyleStrings(wrappedArguments),
		`{${quotePythonStyleStrings(wrappedArguments)}}`,
		removeVerboseFunctionArgumentFields(wrappedArguments),
		`{${removeVerboseFunctionArgumentFields(wrappedArguments)}}`,
		quotePythonStyleStrings(removeVerboseFunctionArgumentFields(wrappedArguments)),
		`{${quotePythonStyleStrings(removeVerboseFunctionArgumentFields(wrappedArguments))}}`
	];

	for (const candidate of candidates) {
		try {
			return normaliseJsonLikeContent(candidate);
		} catch {
			// Try the next repair candidate.
		}
	}

	return null;
}

export function normaliseToolCallArguments(
	raw: unknown,
	functionName?: string
): Record<string, unknown> {
	if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
		return raw as Record<string, unknown>;
	}

	try {
		return normaliseJsonLikeContent(raw ?? '{}');
	} catch (directError) {
		if (functionName) {
			const repairedFunctionCall = normaliseFunctionCallJsonLikeContent(raw, functionName);
			if (repairedFunctionCall) return repairedFunctionCall;
		}
		const repairedArguments = normaliseFunctionArgumentsJsonLikeContent(raw);
		if (repairedArguments) return repairedArguments;
		throw directError;
	}
}

export function normaliseJsonLikeContent(raw: unknown): Record<string, unknown> {
	if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
		return raw as Record<string, unknown>;
	}

	let text = String(raw ?? '').trim();
	if (!text) {
		return {};
	}

	// Try to parse the clean input first BEFORE mutating it with VLM repair regexes
	const firstTry = parseCandidate(text);
	if (firstTry) {
		return firstTry;
	}

	// Gemma 4 local VLM constrained decoding bracket depth bug repair:
	// Since Kwantflow schemas do not contain nested multi-dimensional arrays,
	// any sequence of consecutive closing square brackets (e.g., "] ]", "] ] ]")
	// is a local LLM generation artifact. Collapse them safely to a single "]".
	text = text.replace(/\](?:\s*\])+/g, ']');

	// Repair premature array/object closures (e.g., `]}]` or `]}` before a comma continuing parent object keys)
	text = text.replace(/[}\]]{2,}\s*,\s*"/g, '}], "');

	// 1. Strip lines that contain only a dangling double-quote (with optional comma/whitespace)
	text = text.replace(/^\s*"\s*,?\s*$/gm, '');

	// 2. Specific fix for corrupted dependency type pattern: "to": "action1"type"\n"created" -> "to": "action1",\n"type": "created"
	text = text.replace(
		/"to":\s*"([^"]+)"type"\s*[\r\n]+\s*"created"/g,
		'"to": "$1",\n"type": "created"'
	);

	// 3. Repair missing colons between key and string value, e.g. "kind"person" -> "kind": "person"
	text = text.replace(/"([a-zA-Z0-9_-]+)"\s*([a-zA-Z0-9_-]+)"(?!\s*:)/g, '"$1": "$2"');

	// 4. Repair colon present, but opening quote of value is missing, e.g. "intent":create" -> "intent": "create"
	text = text.replace(/"([a-zA-Z0-9_-]+)"\s*:\s*([a-zA-Z0-9_-]+)"/g, '"$1": "$2"');

	// 5. Repair missing starting quotes for keys in colon contexts (e.g. key": -> "key":)
	text = text.replace(/(?<!")\b([a-zA-Z0-9_]+)"\s*:/g, '"$1":');

	// 6. Repair "_id": to "to_contact_id": for relationship mappings
	text = text.replace(/"_id"\s*:/g, '"to_contact_id":');

	// 7. Generalise mapping from "from": to "fromLocalRef": and "to": to "toLocalRef": inside dependency blocks
	text = text.replace(/"from"\s*:/g, '"fromLocalRef":');
	text = text.replace(/"to"\s*:/g, '"toLocalRef":');

	// 8. Repair value-key boundaries where key is missing starting quote and there is a colon (e.g., "val"key": -> "val", "key":)
	text = text.replace(/"([a-zA-Z0-9_-]+)"([a-zA-Z0-9_-]+)"\s*:/g, '"$1", "$2":');

	// 9. Repair general value-key boundaries on same line where key is missing starting quote (e.g., "action1"type" -> "action1", "type")
	text = text.replace(/"([a-zA-Z0-9_-]+)"\s*\b([a-zA-Z0-9_]+)\b/g, '"$1", "$2"');

	// 10. Repair missing commas between key-value pairs, objects, arrays (handles inline and multiline)
	text = text.replace(
		/("|\d+|true|false|null|\]|\})\s*(\n\s*|\s+)"([a-zA-Z0-9_-]+)"\s*:/g,
		'$1,$2"$3":'
	);

	// 11. Repair missing commas between array objects (i.e. between } and {)
	text = text.replace(/}\s*[\r\n]+\s*{/g, '},\n{');

	// 12. Repair duplicated commas that local function-call decoding sometimes inserts.
	text = text.replace(/,\s*,+/g, ',').replace(/([{[])\s*,/g, '$1');

	const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
	const candidates = [text, fencedMatch?.[1]?.trim() ?? null, extractBalancedJsonObject(text)];

	for (const candidate of candidates) {
		const parsed = parseCandidate(candidate);
		if (parsed) {
			return parsed;
		}
	}

	throw new SyntaxError(
		`JSON Parse error: unable to recover a JSON object from: ${text.slice(0, 120)}`
	);
}
