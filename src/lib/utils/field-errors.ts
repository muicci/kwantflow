export function getFieldErrorMessage(fieldErrors?: string[] | null): string | null {
	return fieldErrors?.find((message) => message.trim().length > 0)?.trim() ?? null;
}

export function isRequiredFieldError(fieldError?: string[] | string | null): boolean {
	const message =
		typeof fieldError === 'string' ? fieldError.trim() : getFieldErrorMessage(fieldError);
	return message ? /\bis required\b/i.test(message) : false;
}

export function getFieldInvalidTone(
	fieldErrors?: string[] | null
): 'neutral' | 'destructive' | undefined {
	const message = getFieldErrorMessage(fieldErrors);
	if (!message) return undefined;
	return isRequiredFieldError(message) ? 'neutral' : 'destructive';
}

export function getFieldErrorInputClass(fieldErrors?: string[] | null): string {
	return getFieldInvalidTone(fieldErrors) === 'destructive' ? 'border-destructive' : '';
}

export function getFieldErrorMessageClass(fieldErrors?: string[] | null): string {
	return getFieldInvalidTone(fieldErrors) === 'destructive'
		? 'field-help px-1 text-destructive'
		: 'field-help px-1';
}
