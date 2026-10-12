import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const componentPath = join(process.cwd(), 'src/lib/components/searchable-multi-select.svelte');

describe('searchable multi-select component', () => {
	it('keeps the multi-select popover contract in source', () => {
		const source = readFileSync(componentPath, 'utf8');

		expect(source).toContain('<Popover.Root bind:open>');
		expect(source).toContain('role="combobox"');
		expect(source).toContain(
			"class={cn('ui-field-trigger-button w-full justify-between gap-2', buttonClass)}"
		);
		expect(source).toContain('role="listbox" aria-multiselectable="true"');
		expect(source).toContain("searchPlaceholder = 'Search options...'");
		expect(source).toContain('selectedValues = $bindable([])');
		expect(source).toContain('id?: string;');
		expect(source).toContain('{id}');
		expect(source).toContain('No matching options.');
		expect(source).toContain('ui-selector-item-check');
		expect(source).toContain('min-w-0 flex-1 truncate text-left');
		expect(source).toContain('ui-popover-anchor-width ui-popover-padding-none');
		expect(source).not.toContain('ui-popover-width-lg');
		expect(source).not.toContain('shadow-none');
	});
});
