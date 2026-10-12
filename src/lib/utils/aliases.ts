export function parseAliasesInput(value: string): string[] {
	return Array.from(
		new Set(
			value
				.split(/[;,\n]+/)
				.map((entry) => entry.trim().replace(/\s+/g, ' '))
				.filter((entry) => entry.length > 0)
		)
	);
}
