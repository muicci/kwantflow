export type PersonNameParts = {
	firstName: string;
	lastName: string;
	displayName: string;
};

function normaliseNamePart(value: string | null | undefined): string {
	return value?.trim() ?? '';
}

export function buildPersonDisplayName(
	firstName: string | null | undefined,
	lastName: string | null | undefined
): string {
	return [normaliseNamePart(firstName), normaliseNamePart(lastName)]
		.filter(Boolean)
		.join(' ')
		.trim();
}

export function splitPersonDisplayName(displayName: string | null | undefined): PersonNameParts {
	const trimmedDisplayName = normaliseNamePart(displayName);
	if (!trimmedDisplayName) {
		return { firstName: '', lastName: '', displayName: '' };
	}

	const parts = trimmedDisplayName
		.split(/\s+/)
		.map((part) => part.trim())
		.filter(Boolean);

	if (parts.length === 0) {
		return { firstName: '', lastName: '', displayName: '' };
	}

	if (parts.length === 1) {
		return {
			firstName: parts[0] ?? '',
			lastName: '',
			displayName: parts[0] ?? ''
		};
	}

	const firstName = parts[0] ?? '';
	const lastName = parts.slice(1).join(' ');
	return {
		firstName,
		lastName,
		displayName: buildPersonDisplayName(firstName, lastName)
	};
}

export function resolvePersonNameParts(input: {
	firstName?: string | null;
	lastName?: string | null;
	displayName?: string | null;
}): PersonNameParts {
	const firstName = normaliseNamePart(input.firstName);
	const lastName = normaliseNamePart(input.lastName);
	const displayName = buildPersonDisplayName(firstName, lastName);

	if (displayName) {
		return { firstName, lastName, displayName };
	}

	return splitPersonDisplayName(input.displayName);
}
