export type FieldErrors = Record<string, string[] | undefined>;

export function findFirstErrorField<T extends string>(
	fieldOrder: readonly T[],
	errors: FieldErrors
): T | null {
	for (const field of fieldOrder) {
		if (errors[field]?.length) {
			return field;
		}
	}

	return null;
}
