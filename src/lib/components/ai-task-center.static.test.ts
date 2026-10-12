import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const componentPath = join(process.cwd(), 'src/lib/components/ai-task-centre.svelte');

describe('ai task centre status contract', () => {
	it('surfaces only shipped active statuses and no local apply stage', () => {
		const source = readFileSync(componentPath, 'utf8');

		expect(source).toContain("case 'preprocessing':");
		expect(source).toContain("case 'extracting':");
		expect(source).toContain("case 'drafting':");
		expect(source).toContain("case 'applied':");
		expect(source).not.toContain("case 'consolidating':");
		expect(source).not.toContain("case 'drafted':");
		expect(source).not.toContain('Applying result');
		expect(source).not.toContain('Consolidating evidence');
		expect(source).not.toContain("status === 'consolidating'");
		expect(source).not.toContain("status === 'drafted'");
	});

	it('keeps the trigger indicator compact without reintroducing a numeric badge', () => {
		const source = readFileSync(componentPath, 'utf8');

		expect(source).toContain('actionableTaskCount > 0');
		expect(source).toContain('size-2');
		expect(source).toContain('ui-radius-pill');
		expect(source).toContain('bg-success');
		expect(source).not.toContain("actionableTaskCount > 9 ? '9+' : actionableTaskCount");
		expect(source).not.toContain('min-w-5');
		expect(source).not.toContain('px-1.5');
		expect(source).not.toContain('shadow-sm');
	});

	it('shows task cards as title plus one compact meta line', () => {
		const source = readFileSync(componentPath, 'utf8');

		expect(source).not.toContain('entry.errorMessage');
		expect(source).toContain('{buildTaskSummary(entry)}');
	});

	it('offers a hover dismiss action for non-active tasks without deleting run history', () => {
		const source = readFileSync(componentPath, 'utf8');

		expect(source).toContain("import XIcon from '@lucide/svelte/icons/x';");
		expect(source).toContain('Remove from task list');
		expect(source).toContain('aiState.dismissTaskEntry(entry.runId)');
		expect(source).toContain('{:else}');
		expect(source).toContain('group/task hover-surface-subtle relative');
		expect(source).toContain('absolute top-2 right-2 size-7');
		expect(source).toContain('let activeTaskRunId = $state<string | null>(null);');
		expect(source).toContain("if (!currentTarget.matches(':focus-visible')) return;");
		expect(source).toContain('tabindex={activeTaskRunId === entry.runId ? 0 : -1}');
		expect(source).not.toContain('focus-visible:opacity-100');
	});

	it('uses a generic cancel action so every active AI stage reads correctly', () => {
		const source = readFileSync(componentPath, 'utf8');

		expect(source).toContain('Cancel AI');
		expect(source).not.toContain('Cancel drafting');
	});

	it('animates dismissed cards closed before removing them from the list', () => {
		const source = readFileSync(componentPath, 'utf8');

		expect(source).toContain('const DISMISS_ANIMATION_MS = 160');
		expect(source).toContain('max-h-0 -translate-y-1 opacity-0');
		expect(source).toContain('globalThis.setTimeout(() => {');
	});
});
