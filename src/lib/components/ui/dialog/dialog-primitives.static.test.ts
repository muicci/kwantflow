import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dialogContentPath = join(process.cwd(), 'src/lib/components/ui/dialog/dialog-content.svelte');
const dialogOverlayPath = join(process.cwd(), 'src/lib/components/ui/dialog/dialog-overlay.svelte');
const dialogStandardFramePath = join(
	process.cwd(),
	'src/lib/components/ui/dialog/dialog-standard-frame.svelte'
);
const dialogFormFramePath = join(
	process.cwd(),
	'src/lib/components/ui/dialog/dialog-form-frame.svelte'
);
const dialogRailFramePath = join(
	process.cwd(),
	'src/lib/components/ui/dialog/dialog-rail-frame.svelte'
);
const dialogWorkflowFramePath = join(
	process.cwd(),
	'src/lib/components/ui/dialog/dialog-workflow-frame.svelte'
);
const themeCssPath = join(process.cwd(), 'src/lib/design/theme.css');
const alertDialogContentPath = join(
	process.cwd(),
	'src/lib/components/ui/alert-dialog/alert-dialog-content.svelte'
);
const alertDialogOverlayPath = join(
	process.cwd(),
	'src/lib/components/ui/alert-dialog/alert-dialog-overlay.svelte'
);

describe('dialog primitives', () => {
	it('hides closed dialog surfaces so mounted portals do not remain visible', () => {
		const dialogContent = readFileSync(dialogContentPath, 'utf8');
		const dialogOverlay = readFileSync(dialogOverlayPath, 'utf8');
		const alertDialogContent = readFileSync(alertDialogContentPath, 'utf8');
		const alertDialogOverlay = readFileSync(alertDialogOverlayPath, 'utf8');

		for (const source of [dialogContent, dialogOverlay, alertDialogContent, alertDialogOverlay]) {
			expect(source).toContain('data-[state=closed]:pointer-events-none');
			expect(source).toContain('data-[state=closed]:invisible');
			expect(source).toContain('data-[state=closed]:opacity-0');
		}
	});

	it('keeps framed dialog sizing and content width on a shared contract', () => {
		const standardFrame = readFileSync(dialogStandardFramePath, 'utf8');
		const formFrame = readFileSync(dialogFormFramePath, 'utf8');
		const railFrame = readFileSync(dialogRailFramePath, 'utf8');
		const workflowFrame = readFileSync(dialogWorkflowFramePath, 'utf8');

		for (const source of [standardFrame, formFrame, railFrame]) {
			expect(source).toContain("type DialogFrameSize = 'sm' | 'md' | 'lg';");
			expect(source).toContain("type DialogContentWidth = 'none' | 'form';");
			expect(source).toContain('ui-dialog-content-width-form');
		}

		for (const source of [standardFrame, formFrame]) {
			expect(source).toContain('ui-dialog-frame-width-lg');
		}

		expect(railFrame).toContain('ui-dialog-frame-size-lg');
		expect(standardFrame).toContain("size = 'md'");
		expect(formFrame).toContain("size = 'md'");
		expect(railFrame).toContain("size = 'md'");
		expect(railFrame).toContain(
			"class={cn('dialog-shell-rail', size ? frameSizeClass[size] : '', className)}"
		);
		expect(railFrame).toContain('class="ui-dialog-rail-sidebar shrink-0"');
		expect(workflowFrame).toContain("type DialogWorkflowSize = 'sm' | 'md' | 'lg' | 'workbench';");
		expect(workflowFrame).toContain("size = 'md'");
		expect(workflowFrame).toContain("size ? workflowFrameSizeClass[size] : ''");
		expect(workflowFrame).toContain("size === 'workbench' ? 'ui-dialog-workbench'");
	});

	it('keeps framed dialogs using the correct fixed and content-height layout contracts', () => {
		const themeCss = readFileSync(themeCssPath, 'utf8');

		expect(themeCss).toMatch(
			/\.dialog-shell-standard\s*{[^}]*display: flex;[^}]*flex-direction: column;/s
		);
		expect(themeCss).toMatch(
			/\.dialog-shell-form\s*{[^}]*display: flex;[^}]*flex-direction: column;/s
		);
		expect(themeCss).toMatch(
			/\.dialog-shell-rail\s*{[^}]*display: flex;[^}]*flex-direction: column;/s
		);
		expect(themeCss).toMatch(
			/\.dialog-shell-workflow\s*{[^}]*display: flex;[^}]*flex-direction: column;/s
		);
		expect(themeCss).toMatch(
			/\.dialog-shell-rail > \.dialog-sidebar-provider\s*{[^}]*flex: 1 1 auto;/s
		);
		expect(themeCss).toMatch(/\.ui-dialog-rail-sidebar\s*{[^}]*display: none;/s);
		expect(themeCss).toMatch(
			/@media \(min-width: 768px\)\s*{[^}]*\.ui-dialog-rail-sidebar\s*{[^}]*display: flex;/s
		);
		expect(themeCss).toMatch(/\.ui-dialog-rail-footer\s*{[^}]*margin-block-start: auto;/s);
		expect(themeCss).toMatch(
			/\.ui-dialog-frame-width-md\s*{[^}]*max-block-size: calc\(100dvh - 2rem\);/s
		);
		expect(themeCss).toMatch(/\.ui-dialog-frame-size-md\s*{[^}]*block-size:/s);
	});
});
