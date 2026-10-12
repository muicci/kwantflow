import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('classification system dialog state initialisation', () => {
	it('does not directly depend on live list mutations while the dialog is open', () => {
		const source = readSource(
			'src/lib/components/classification-systems/classification-system-dialog.svelte'
		);

		expect(source).toContain("import { tick, untrack } from 'svelte';");
		expect(source).toContain('let initialisedDialogKey = $state<string | null>(null);');
		expect(source).toContain('function getDialogSeedKey(): string');
		expect(source).toContain('if (initialisedDialogKey === dialogSeedKey) return;');
		expect(source).toContain('const shouldDefaultNewSystem = !system');
		expect(source).toContain('? untrack(() => classificationSystemsState.list.length === 0)');
		expect(source).toContain('is_default: shouldDefaultNewSystem');
		expect(source).toContain('function closeDialog()');
		expect(source).toContain('onclick={closeDialog}');
		expect(source).toContain('FieldLabelRow,');
		expect(source).toContain(
			'<FieldLabelRow for="classification-system-aliases" tooltip={ALIAS_FIELD_HELP_TEXT}'
		);
		expect(source).toContain('New estimates can use this classification system by default.');
		expect(source).toContain('closeDialog();');
	});
});
