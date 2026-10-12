declare module 'papaparse' {
	interface ParseError {
		message: string;
	}

	interface ParseResult<T> {
		data: T[];
		errors: ParseError[];
	}

	interface ParseConfig {
		delimiter?: string;
		skipEmptyLines?: boolean;
	}

	interface PapaStatic {
		parse<T>(input: string, config?: ParseConfig): ParseResult<T>;
	}

	const Papa: PapaStatic;
	export default Papa;
}
