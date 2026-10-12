import {
	AsYouType,
	parsePhoneNumberFromString,
	type CountryCode,
	type PhoneNumber
} from 'libphonenumber-js';

import { getWorkspaceCountryProfile } from '$lib/constants/index.js';

function normalisePhoneCountryCode(countryCode: string | null | undefined): string {
	const trimmed = countryCode?.trim().toUpperCase() ?? '';
	return /^[A-Z]{2}$/.test(trimmed) ? trimmed : 'AU';
}

function getPhoneFormatterCountry(countryCode: string | null | undefined): CountryCode {
	return getWorkspaceCountryProfile(normalisePhoneCountryCode(countryCode)).code as CountryCode;
}

function parsePhone(value: string, countryCode: string | null | undefined): PhoneNumber | null {
	try {
		return parsePhoneNumberFromString(value, getPhoneFormatterCountry(countryCode)) ?? null;
	} catch {
		return null;
	}
}

export function formatPhoneDraft(
	value: string | null | undefined,
	countryCode: string | null | undefined
): string {
	const trimmed = value?.trim() ?? '';
	if (!trimmed) return '';

	try {
		const formatted = new AsYouType(getPhoneFormatterCountry(countryCode)).input(trimmed);
		return formatted || trimmed;
	} catch {
		return trimmed;
	}
}

export function normalisePhoneValue(
	value: string | null | undefined,
	countryCode: string | null | undefined
): {
	displayPhone: string;
	e164: string;
	phoneCountryCode: string;
} {
	const normalizedCountryCode = normalisePhoneCountryCode(countryCode);
	const displayPhone = formatPhoneDraft(value, normalizedCountryCode);
	if (!displayPhone) {
		return {
			displayPhone: '',
			e164: '',
			phoneCountryCode: normalizedCountryCode
		};
	}

	const parsed = parsePhone(displayPhone, normalizedCountryCode);
	return {
		displayPhone,
		e164: parsed?.isValid() ? parsed.number : '',
		phoneCountryCode: parsed?.country ?? normalizedCountryCode
	};
}
