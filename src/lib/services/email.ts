export function normaliseEmailValue(value: string | null | undefined): string {
	return (value ?? '').trim().toLowerCase();
}
