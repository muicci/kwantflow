import { z } from 'zod';

export const GENERIC_PHONE_PATTERN = /^[+\d(][\d\s()-]{4,31}$/;

export const RequiredEmailValueSchema = z
	.string()
	.trim()
	.toLowerCase()
	.email('Enter a valid email address');

export function isValidEmailAddress(value: string | null | undefined): boolean {
	const trimmed = value?.trim() ?? '';
	return trimmed.length > 0 && RequiredEmailValueSchema.safeParse(trimmed).success;
}

export function isValidGenericPhone(value: string | null | undefined): boolean {
	const trimmed = value?.trim() ?? '';
	return trimmed.length > 0 && GENERIC_PHONE_PATTERN.test(trimmed);
}
