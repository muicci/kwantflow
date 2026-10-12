const PLACEHOLDER_REFERENCE_TERMS = new Set([
	'name',
	'test',
	'tttt',
	'placeholder',
	'sample',
	'demo',
	'temp',
	'tmp',
	'n a',
	'na',
	'untitled'
]);

function normaliseReferenceText(value: string | null | undefined): string {
	if (!value) return '';
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function compactAlpha(value: string): string {
	return value.replace(/[^a-z]/g, '');
}

function compactDigits(value: string): string {
	return value.replace(/\D/g, '');
}

export function isLowSignalReferenceText(value: string | null | undefined): boolean {
	const normalised = normaliseReferenceText(value);
	if (!normalised) return false;
	if (PLACEHOLDER_REFERENCE_TERMS.has(normalised)) return true;

	const collapsed = normalised.replace(/\s+/g, '');
	if (/^([a-z0-9])\1{2,}$/.test(collapsed)) return true;

	const alphaOnly = compactAlpha(normalised);
	if (alphaOnly.length >= 5 && !normalised.includes(' ')) {
		const uniqueAlphaCount = new Set(alphaOnly).size;
		if (uniqueAlphaCount <= 3) return true;
	}

	const digitsOnly = compactDigits(normalised);
	if (digitsOnly.length >= 5 && !normalised.includes(' ')) {
		const uniqueDigitCount = new Set(digitsOnly).size;
		if (uniqueDigitCount <= 3) return true;
	}

	if (alphaOnly.length < 6) return false;

	const vowelCount = Array.from(alphaOnly).filter((char) => 'aeiou'.includes(char)).length;
	const vowelRatio = vowelCount / alphaOnly.length;
	return vowelRatio < 0.2 && !normalised.includes(' ');
}

export function hasMeaningfulReferenceIdentity(entry: {
	code?: string | null;
	name?: string | null;
	aliases?: string[];
}): boolean {
	const hasMeaningfulName = Boolean(entry.name && !isLowSignalReferenceText(entry.name));
	const hasMeaningfulAlias = (entry.aliases ?? []).some(
		(alias) => !isLowSignalReferenceText(alias)
	);
	if (hasMeaningfulName || hasMeaningfulAlias) return true;
	if (entry.name && isLowSignalReferenceText(entry.name)) return false;
	const normalisedCode = normaliseReferenceText(entry.code);
	return Boolean(normalisedCode && /[a-z]/.test(normalisedCode));
}

export function referenceIdentityQualityScore(entry: {
	code?: string | null;
	name?: string | null;
	description?: string | null;
	aliases?: string[];
}): number {
	let score = 0;

	if (entry.aliases?.some((alias) => !isLowSignalReferenceText(alias))) {
		score += 20;
	}
	if (entry.description && !isLowSignalReferenceText(entry.description)) {
		score += 10;
	}
	if (entry.code && !isLowSignalReferenceText(entry.code)) {
		score += 8;
	}
	if (entry.name && entry.name.trim().includes(' ') && !isLowSignalReferenceText(entry.name)) {
		score += 6;
	}

	if (isLowSignalReferenceText(entry.name)) score -= 80;
	if (isLowSignalReferenceText(entry.code)) score -= 40;

	return score;
}
