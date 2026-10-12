export function buildDuplicateName(name: string, existingNames: string[]): string {
	const trimmedName = name.trim();
	const lowerNames = new Set(existingNames.map((value) => value.trim().toLowerCase()));
	const base = `Copy of ${trimmedName}`;

	if (!lowerNames.has(base.toLowerCase())) {
		return base;
	}

	let counter = 2;
	while (lowerNames.has(`${base} (${counter})`.toLowerCase())) {
		counter += 1;
	}

	return `${base} (${counter})`;
}

export function buildDuplicateCode(
	code: string | null | undefined,
	existingCodes: Array<string | null | undefined>
): string {
	const trimmedCode = code?.trim();
	if (!trimmedCode) return '';

	const lowerCodes = new Set(
		existingCodes
			.map((value) => value?.trim().toLowerCase())
			.filter((value): value is string => Boolean(value))
	);
	const base = `${trimmedCode}-COPY`;

	if (!lowerCodes.has(base.toLowerCase())) {
		return base;
	}

	let counter = 2;
	while (lowerCodes.has(`${base}-${counter}`.toLowerCase())) {
		counter += 1;
	}

	return `${base}-${counter}`;
}
