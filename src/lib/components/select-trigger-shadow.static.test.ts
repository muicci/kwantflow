import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { globSync } from 'glob';

function getSelectTriggerClasses(source: string): string[] {
	const matches = source.matchAll(/<Select\.Trigger\b[^>]*class="([^"]*)"/g);
	return [...matches].map((match) => match[1]);
}

describe('select trigger visual contract', () => {
	it('keeps app-facing Select.Trigger controls on the shared flat primitive contract', () => {
		const files = globSync(['src/lib/components/**/*.svelte', 'src/routes/**/*.svelte'], {
			nodir: true,
			ignore: ['src/lib/components/ui/**']
		});

		const offenders = files.flatMap((file) => {
			const source = readFileSync(file, 'utf8');
			return getSelectTriggerClasses(source)
				.filter((className) => className.includes('shadow-none'))
				.map((className) => `${file}: ${className}`);
		});

		expect(offenders).toEqual([]);
	});
});
