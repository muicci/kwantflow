import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string) =>
	readFileSync(join(process.cwd(), relativePath), 'utf8');

const readSvelteSources = (relativeDir: string): string[] => {
	const absoluteDir = join(process.cwd(), relativeDir);
	const entries = readdirSync(absoluteDir, { withFileTypes: true });
	const sources: string[] = [];

	for (const entry of entries) {
		const relativePath = join(relativeDir, entry.name);
		if (entry.isDirectory()) {
			sources.push(...readSvelteSources(relativePath));
			continue;
		}
		if (entry.isFile() && entry.name.endsWith('.svelte')) {
			sources.push(readSource(relativePath));
		}
	}

	return sources;
};

const normalizeComponentTokenKey = (dirName: string) =>
	dirName.replace(/-([a-z])/g, (_match, char: string) => char.toUpperCase());

const readUiComponentTokenKeys = () => {
	const source = JSON.parse(readSource('tokens/components.json')) as Record<string, unknown>;
	return Object.keys(source).filter((key) => !key.startsWith('$'));
};

const readUiComponentDirs = () => {
	const absoluteDir = join(process.cwd(), 'src/lib/components/ui');
	return readdirSync(absoluteDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
};

const inputTypographyOverridePattern =
	/<(Input|Textarea)\b[^>]*class="[^"]*\bsmall\b[^"]*"[^>]*\/?>/g;

describe('ui refinement markup', () => {
	it('uses RFQ wording in the project actions menu', () => {
		const source = readSource('src/lib/components/project-actions-menu.svelte');

		expect(source).toContain('Edit RFQ');
		expect(source).not.toContain('Edit Context');
	});

	it('uses the shared upload summary contract in the intake assets panel', () => {
		const source = readSource('src/lib/components/intake/assets-panel.svelte');

		expect(source).toContain('getGeneralProjectFileSummary()');
		expect(source).toContain('const uploadSummary = $derived(getGeneralProjectFileSummary())');
		expect(source).toContain('Drop project files here or click to browse');
		expect(source).toContain('<Meta>{uploadSummary}</Meta>');
		expect(source).toContain('ui-upload-dropzone');
		expect(source).toContain('ui-file-row');
	});

	it('keeps estimating pages grouped in the sidebar panel and preserves the app logo header', () => {
		const panelSource = readSource('src/lib/components/app-sidebar-pages-panel.svelte');
		const sidebarSource = readSource('src/lib/components/app-sidebar.svelte');

		expect(panelSource).toContain('<p class="eyebrow px-2">Estimating</p>');
		expect(panelSource).toContain('filteredDestinations.estimating.length > 0');
		expect(panelSource).toContain('placeholder="Search..."');
		expect(panelSource).toContain('<span>{destination.title}</span>');
		expect(sidebarSource).toContain(
			"import sidebarLogoUrl from '$lib/assets/branding/kwantflow-logo-app.svg';"
		);
		expect(sidebarSource).toContain('src={sidebarLogoUrl}');
		expect(sidebarSource).toContain('alt="Kwantflow"');
		expect(sidebarSource).toContain('class="brand-logo block h-4 w-auto shrink-0 object-contain"');
	});

	it('mounts the local Sonner wrapper in the root layout with bottom-right defaults', () => {
		const layoutSource = readSource('src/routes/+layout.svelte');
		const sonnerSource = readSource('src/lib/components/ui/sonner/sonner.svelte');
		const typographySource = readSource('src/lib/design/typography.css');

		expect(layoutSource).toContain("import { Toaster } from '$lib/components/ui/sonner/index.js';");
		expect(layoutSource).not.toContain("import { Toaster } from 'svelte-sonner';");
		expect(layoutSource).toContain('<Toaster />');
		expect(sonnerSource).toContain("position = 'bottom-right'");
		expect(sonnerSource).toContain('duration = 4000');
		expect(sonnerSource).toContain('closeButton = true');
		expect(sonnerSource).toContain('richColors = true');
		expect(sonnerSource).toContain("class: 'toast-title'");
		expect(sonnerSource).toContain("descriptionClass: 'toast-description'");
		expect(typographySource).toContain('.toast-title');
		expect(typographySource).toContain('.toast-description');
	});

	it('keeps every production ui wrapper family covered by canonical component tokens', () => {
		const componentDirs = readUiComponentDirs();
		const tokenKeys = new Set(readUiComponentTokenKeys());
		const missing = componentDirs.filter(
			(dirName) => !tokenKeys.has(normalizeComponentTokenKey(dirName))
		);

		expect(missing).toEqual([]);
	});

	it('keeps the newly covered wrapper families on shared helper classes', () => {
		const breadcrumbListSource = readSource(
			'src/lib/components/ui/breadcrumb/breadcrumb-list.svelte'
		);
		const breadcrumbLinkSource = readSource(
			'src/lib/components/ui/breadcrumb/breadcrumb-link.svelte'
		);
		const breadcrumbSeparatorSource = readSource(
			'src/lib/components/ui/breadcrumb/breadcrumb-separator.svelte'
		);
		const separatorSource = readSource('src/lib/components/ui/separator/separator.svelte');
		const skeletonSource = readSource('src/lib/components/ui/skeleton/skeleton.svelte');
		const sonnerSource = readSource('src/lib/components/ui/sonner/sonner.svelte');
		const resizableHandleSource = readSource(
			'src/lib/components/ui/resizable/resizable-handle.svelte'
		);
		const scrollAreaSource = readSource('src/lib/components/ui/scroll-area/scroll-area.svelte');

		expect(breadcrumbListSource).toContain('ui-breadcrumb-list');
		expect(breadcrumbLinkSource).toContain('ui-breadcrumb-link');
		expect(breadcrumbSeparatorSource).toContain('ui-breadcrumb-separator');
		expect(separatorSource).toContain('ui-separator');
		expect(skeletonSource).toContain('ui-skeleton');
		expect(sonnerSource).toContain('ui-toaster');
		expect(resizableHandleSource).toContain('ui-resizable-handle');
		expect(resizableHandleSource).toContain('ui-resizable-grip');
		expect(scrollAreaSource).toContain('ui-scroll-area-viewport');
	});

	it('keeps shell tab-strip and image-picker chrome on shared semantic helpers', () => {
		const tabStripSource = readSource('src/lib/components/app-shell-tab-strip.svelte');
		const imagePickerSource = readSource('src/lib/components/circular-image-picker.svelte');

		expect(tabStripSource).toContain('ui-shell-toolbar');
		expect(tabStripSource).toContain('ui-tab-shell');
		expect(tabStripSource).toContain('ui-tab-close');
		expect(imagePickerSource).toContain('ui-image-picker-fallback');
		expect(imagePickerSource).toContain('ui-image-picker-clear');
	});

	it('keeps menu, checkbox, and scrollbar wrappers on shared token-backed helpers', () => {
		const dropdownContentSource = readSource(
			'src/lib/components/ui/dropdown-menu/dropdown-menu-content.svelte'
		);
		const dropdownSubContentSource = readSource(
			'src/lib/components/ui/dropdown-menu/dropdown-menu-sub-content.svelte'
		);
		const checkboxSource = readSource('src/lib/components/ui/checkbox/checkbox.svelte');
		const scrollbarSource = readSource(
			'src/lib/components/ui/scroll-area/scroll-area-scrollbar.svelte'
		);
		const selectContentSource = readSource('src/lib/components/ui/select/select-content.svelte');
		const selectItemSource = readSource('src/lib/components/ui/select/select-item.svelte');
		const emptyMediaSource = readSource('src/lib/components/ui/empty/empty-media.svelte');
		const sidebarSource = readSource('src/lib/components/ui/sidebar/sidebar.svelte');
		const sidebarActionSource = readSource(
			'src/lib/components/ui/sidebar/sidebar-menu-action.svelte'
		);
		const sidebarGroupLabelSource = readSource(
			'src/lib/components/ui/sidebar/sidebar-group-label.svelte'
		);
		const sidebarInputSource = readSource('src/lib/components/ui/sidebar/sidebar-input.svelte');
		const sidebarInsetSource = readSource('src/lib/components/ui/sidebar/sidebar-inset.svelte');

		expect(dropdownContentSource).toContain('ui-menu-surface');
		expect(dropdownSubContentSource).toContain('ui-menu-surface');
		expect(checkboxSource).toContain('ui-checkbox-root');
		expect(scrollbarSource).toContain('ui-scrollbar-track');
		expect(scrollbarSource).toContain('ui-scrollbar-thumb');
		expect(selectContentSource).toContain('ui-select-surface');
		expect(selectItemSource).toContain('ui-select-item');
		expect(selectItemSource).toContain('ui-select-item-indicator');
		expect(emptyMediaSource).toContain('ui-empty-media-icon');
		expect(sidebarSource).toContain('ui-sidebar-shell');
		expect(sidebarSource).toContain('ui-sidebar-inner');
		expect(sidebarActionSource).toContain('ui-sidebar-action');
		expect(sidebarGroupLabelSource).toContain('ui-sidebar-group-label');
		expect(sidebarInputSource).toContain(
			"import { SearchInput } from '$lib/components/ui/input/index.js';"
		);
		expect(sidebarInputSource).toContain('data-sidebar="input"');
		expect(sidebarInputSource).toContain('inputClass="control-height-md"');
		expect(sidebarInsetSource).toContain('ui-sidebar-inset');
		const sheetTypesSource = readSource('src/lib/components/ui/sheet/types.ts');
		expect(sheetTypesSource).toContain('ui-sheet-surface');
	});

	it('keeps neutral button, badge, and alert tones on shared wrapper helpers', () => {
		const buttonTypesSource = readSource('src/lib/components/ui/button/types.ts');
		const badgeTypesSource = readSource('src/lib/components/ui/badge/types.ts');
		const alertTypesSource = readSource('src/lib/components/ui/alert/types.ts');

		expect(buttonTypesSource).toContain('ui-button-neutral');
		expect(buttonTypesSource).toContain('ui-button-outline');
		expect(badgeTypesSource).toContain('ui-badge-neutral');
		expect(badgeTypesSource).toContain('ui-badge-outline');
		expect(alertTypesSource).toContain('ui-alert-surface');
		expect(badgeTypesSource).not.toContain('text-foreground');
		expect(alertTypesSource).not.toContain('text-foreground');
	});

	it('uses the shared shell breadcrumb contract on project routes', () => {
		const source = readSource('src/routes/+layout.svelte');

		expect(source).toContain("{#if pathname.startsWith('/project/')}");
		expect(source).toContain('<Breadcrumb.Link href="/">RFQs</Breadcrumb.Link>');
		expect(source).toContain('<Breadcrumb.Page>{shellTitle}</Breadcrumb.Page>');
		expect(source).toContain('getProjectCompanyDisplayName(headerProject)');
		expect(source).toContain('getProjectRequesterDisplayName(headerProject)');
	});

	it('opens local settings without hosted support or updater surfaces', () => {
		const navSource = readSource('src/lib/components/nav-user.svelte');
		const layoutSource = readSource('src/routes/+layout.svelte');
		const settingsSource = readSource('src/lib/components/user/settings-dialog.svelte');
		expect(navSource).toContain('appState.openSettingsDialog()');
		expect(navSource).not.toContain('requestSupportReportDialog');
		expect(navSource).not.toContain('appUpdaterState');
		expect(layoutSource).toContain('<SettingsDialog bind:open={appState.isSettingsDialogOpen} />');
		expect(layoutSource).not.toContain('AppUpdateDialog');
		expect(layoutSource).not.toContain('SupportReportDialog');
		expect(settingsSource).toContain(
			'Edit the local workspace profile, user details, and workspace preferences.'
		);
		expect(settingsSource).toContain('v{APP_VERSION}');
	});

	it('removes public CSV import buttons from the catalogue tables', () => {
		const materialSource = readSource('src/lib/components/materials/material-table.svelte');
		const labourSource = readSource('src/lib/components/labour-rates/labour-rate-table.svelte');
		const equipmentSource = readSource(
			'src/lib/components/equipment-rates/equipment-rate-table.svelte'
		);

		expect(materialSource).not.toContain('Import CSV');
		expect(labourSource).not.toContain('Import CSV');
		expect(equipmentSource).not.toContain('Import CSV');
		expect(materialSource).not.toContain('CatalogueImportDialog');
		expect(labourSource).not.toContain('CatalogueImportDialog');
		expect(equipmentSource).not.toContain('CatalogueImportDialog');
	});

	it('uses a shared table footer with hidden zero-row pagination chrome', () => {
		const footerSource = readSource('src/lib/components/table-pagination-footer.svelte');
		const materialSource = readSource('src/lib/components/materials/material-table.svelte');
		const rfqSource = readSource('src/lib/components/rfqs/data-table.svelte');

		expect(footerSource).toContain('{#if totalCount > 0}');
		expect(footerSource).toContain('{selectedCount} of {totalCount} selected');
		expect(footerSource).toContain('Page {pageIndex + 1} of {pageCount}');
		expect(footerSource).toContain('whitespace-nowrap');
		expect(materialSource).toContain(
			"import TablePaginationFooter from '../table-pagination-footer.svelte';"
		);
		expect(rfqSource).toContain(
			"import TablePaginationFooter from '../table-pagination-footer.svelte';"
		);
	});

	it('keeps RFQ table column ids unique around the submission deadline and files columns', () => {
		const source = readSource('src/lib/components/rfqs/data-table.svelte');
		const dueDateAccessors = source.match(/accessorKey: 'due_date'/g) ?? [];

		expect(dueDateAccessors).toHaveLength(1);
		expect(source).toContain("id: 'assets'");
		expect(source).toContain('text: row.original.asset_count || 0');
	});

	it('right-aligns numeric count and order columns across the shared table families', () => {
		const presetSource = readSource(
			'src/lib/components/cost-component-presets/cost-component-presets-table.svelte'
		);
		const templateSource = readSource(
			'src/lib/components/estimate-templates/estimate-templates-table.svelte'
		);
		const systemsSource = readSource(
			'src/lib/components/classification-systems/classification-systems-table.svelte'
		);
		const costCodesSource = readSource(
			'src/lib/components/classification-systems/cost-codes-table.svelte'
		);
		const wbsSource = readSource('src/lib/components/wbs/wbs-table.svelte');

		expect(presetSource).toContain('<TableHeaderLabel text="Rows" align="right" />');
		expect(templateSource).toContain('<TableHeaderLabel text="Items" align="right" />');
		expect(systemsSource).toContain('<TableHeaderLabel text="Default" align="center" />');
		expect(costCodesSource).toContain('<TableHeaderLabel text="Order" align="right" />');
		expect(wbsSource).toContain('<TableHeaderLabel text="Order" align="right" />');
	});

	it('uses sentence-case shared table headers across in-app tables', () => {
		const headerLabelSource = readSource('src/lib/components/table-header-label.svelte');
		const quoteSource = readSource('src/routes/project/[id]/quote/+page.svelte');
		const materialsSource = readSource('src/lib/components/materials/material-table.svelte');
		const classificationSource = readSource(
			'src/lib/components/classification-systems/classification-systems-table.svelte'
		);
		const estimatePreviewSource = readSource(
			'src/lib/components/estimate-templates/estimate-template-preview.svelte'
		);
		const quoteHistorySource = readSource(
			'src/lib/components/quote/project-revision-history-dialog.svelte'
		);

		expect(headerLabelSource).not.toContain('label-upper');
		expect(quoteSource).toContain('<Table.Head><TableHeaderLabel text="Asset" /></Table.Head>');
		expect(materialsSource).toContain(
			'<Table.Head><TableHeaderLabel text="Material" /></Table.Head>'
		);
		expect(classificationSource).toContain(
			'<Table.Head><TableHeaderLabel text="System" /></Table.Head>'
		);
		expect(estimatePreviewSource).toContain(
			'<Table.Head><TableHeaderLabel text="Components" align="right" /></Table.Head>'
		);
		expect(quoteHistorySource).toMatch(/<TableHeaderLabel text="Line Total" align="right" \/>/);
	});

	it('centralizes sticky admin-table chrome on shared table helpers', () => {
		const tableHeaderSource = readSource('src/lib/components/ui/table/table-header.svelte');
		const tableFooterSource = readSource('src/lib/components/ui/table/table-footer.svelte');
		const estimateTemplatesSource = readSource(
			'src/lib/components/estimate-templates/estimate-templates-table.svelte'
		);
		const materialsSource = readSource('src/lib/components/materials/material-table.svelte');
		const contactsSource = readSource('src/lib/components/contacts/contact-table.svelte');

		expect(tableHeaderSource).toContain('ui-table-header-surface');
		expect(tableFooterSource).toContain('ui-table-footer-surface');
		for (const source of [estimateTemplatesSource, materialsSource, contactsSource]) {
			expect(source).toContain('ui-table-shell');
			expect(source).toContain('ui-table-shell-body');
			expect(source).toContain('ui-table-header-sticky');
			expect(source).not.toContain('sticky top-0 z-10 bg-muted');
			expect(source).not.toContain('ui-radius-lg mb-3 overflow-hidden border');
		}
		expect(contactsSource).toContain('ui-table-row-draggable');
		expect(readSource('src/lib/components/rfqs/data-table.svelte')).toContain(
			'ui-table-row-draggable'
		);
	});

	it('left-aligns RFQ badge columns for priority and status', () => {
		const tableSource = readSource('src/lib/components/rfqs/data-table.svelte');
		const priorityBadgeSource = readSource('src/lib/components/rfqs/priority-badge.svelte');
		const statusBadgeSource = readSource('src/lib/components/rfqs/status-badge.svelte');

		expect(tableSource).toContain(
			"header: () => renderComponent(TableHeaderLabel, { text: 'Priority' })"
		);
		expect(tableSource).toContain(
			"header: () => renderComponent(TableHeaderLabel, { text: 'Status' })"
		);
		expect(priorityBadgeSource).not.toContain('mx-auto');
		expect(statusBadgeSource).not.toContain('mx-auto');
	});

	it('uses shared typography in input and textarea primitives and removes compact textarea overrides', () => {
		const inputSource = readSource('src/lib/components/ui/input/input.svelte');
		const textareaSource = readSource('src/lib/components/ui/textarea/textarea.svelte');
		const intakeSource = readSource('src/lib/components/intake/context-panel.svelte');
		const contactDialogSource = readSource('src/lib/components/contacts/contact-dialog.svelte');
		const costCodeDialogSource = readSource(
			'src/lib/components/classification-systems/cost-code-dialog.svelte'
		);

		expect(inputSource).toContain('field-copy');
		expect(inputSource).toContain('ui-field-control-base');
		expect(inputSource).toContain('ui-input-control');
		expect(inputSource).toContain("type === 'number' ? 'ui-input-control-number' : ''");
		expect(textareaSource).toContain('field-copy');
		expect(textareaSource).toContain('ui-field-control-base');
		expect(textareaSource).toContain('ui-textarea-control');
		expect(intakeSource).not.toContain('class="small min-h-[100px] bg-background p-2.5"');
		expect(intakeSource).not.toContain('class="small min-h-[60px] bg-background p-2.5"');
		expect(contactDialogSource).not.toContain('class="small min-h-[120px] resize-none"');
		expect(costCodeDialogSource).not.toContain('class="small min-h-[120px] resize-none"');
	});

	it('keeps app text-entry controls free of local small typography overrides', () => {
		const appSources = [
			...readSvelteSources('src/routes'),
			...readSvelteSources('src/lib/components')
		].filter((source) => !source.includes('data-slot={dataSlot}'));

		for (const source of appSources) {
			expect(source.match(inputTypographyOverridePattern)).toBeNull();
		}
	});

	it('uses dedicated helper text under field labels instead of muted leftovers', () => {
		const typographySource = readSource('src/lib/design/typography.css');
		const designTokens = readSource('src/lib/design/README.md');
		const intakeSource = readSource('src/lib/components/intake/details-panel.svelte');

		expect(typographySource).toContain('.field-help {');
		expect(designTokens).toContain('field-help');
		expect(intakeSource).toContain('FieldHelp');
		expect(intakeSource).toContain('A new company will be created when you save this RFQ.');
		expect(intakeSource).not.toContain('class="muted px-1"');
	});

	it('uses state-owned preset and template refreshes inside the asset editor flow', () => {
		const pageSource = readSource('src/routes/project/[id]/asset/[assetId]/+page.svelte');
		const editorSource = readSource('src/lib/components/assets/asset-estimate-editor.svelte');

		expect(pageSource).toContain(
			"import { costComponentPresetsState } from '$lib/state/cost-component-presets.svelte.js';"
		);
		expect(pageSource).toContain(
			"import { estimateTemplatesState } from '$lib/state/estimate-templates.svelte.js';"
		);
		expect(pageSource).toContain('{costComponentPresets}');
		expect(pageSource).toContain('{estimateTemplates}');
		expect(editorSource).toContain(
			"import { costComponentPresetsState } from '$lib/state/cost-component-presets.svelte.js';"
		);
		expect(editorSource).toContain(
			"import { estimateTemplatesState } from '$lib/state/estimate-templates.svelte.js';"
		);
		expect(editorSource).toContain('await costComponentPresetsState.refresh();');
		expect(editorSource).toContain('await estimateTemplatesState.refresh();');
		expect(editorSource).not.toContain('await invalidateAll();');
	});

	it('keeps Project Structure naming consistent in project and estimate surfaces', () => {
		const projectStructurePageSource = readSource('src/routes/project/[id]/wbs/+page.svelte');
		const estimateEditorSource = readSource(
			'src/lib/components/assets/asset-estimate-editor.svelte'
		);
		const takeoffItemSource = readSource(
			'src/lib/components/assets/asset-estimate-takeoff-item.svelte'
		);

		expect(projectStructurePageSource).toContain('Project Structure');
		expect(estimateEditorSource).toContain('Structure Root');
		expect(estimateEditorSource).not.toContain('WBS Root');
		expect(takeoffItemSource).toContain('Project Structure');
		expect(takeoffItemSource).toContain('Project Structure (WBS)');
	});

	it('keeps Project Structure template surfaces free of inline sizing overrides and legacy WBS toast copy', () => {
		const editorDialogSource = readSource(
			'src/lib/components/wbs/project-structure-template-editor-dialog.svelte'
		);
		const previewSource = readSource(
			'src/lib/components/wbs/project-structure-template-preview.svelte'
		);
		const tableSource = readSource(
			'src/lib/components/wbs/project-structure-templates-table.svelte'
		);
		const wbsStateSource = readSource('src/lib/state/wbs.svelte.ts');

		for (const source of [editorDialogSource, previewSource, tableSource]) {
			expect(source).not.toContain('style="--sidebar-width: 12rem;"');
			expect(source).not.toContain('h-[min(');
			expect(source).not.toContain('max-w-[');
			expect(source).not.toContain('min-w-[');
			expect(source).not.toContain('min-h-[');
		}

		expect(wbsStateSource).toContain('Structure node');
		expect(wbsStateSource).toContain('Structure nodes');
		expect(wbsStateSource).not.toContain('WBS node');
		expect(wbsStateSource).not.toContain('WBS nodes');
	});

	it('normalises the Project Structure page onto the shared shell and real tabs contract', () => {
		const projectStructurePageSource = readSource('src/routes/project/[id]/wbs/+page.svelte');
		const wbsTableSource = readSource('src/lib/components/wbs/wbs-table.svelte');
		const templateTableSource = readSource(
			'src/lib/components/wbs/project-structure-templates-table.svelte'
		);
		const tabsIndexSource = readSource('src/lib/components/ui/tabs/index.ts');

		expect(projectStructurePageSource).toContain('ui-route-frame');
		expect(projectStructurePageSource).toContain('ui-page-content');
		expect(projectStructurePageSource).not.toContain('ui-page-content-relaxed');
		expect(projectStructurePageSource).toContain(
			"import * as Tabs from '$lib/components/ui/tabs/index.js';"
		);
		expect(projectStructurePageSource).toContain('<Tabs.Root');
		expect(projectStructurePageSource).toContain('<Tabs.List');
		expect(projectStructurePageSource).toContain('<Tabs.Trigger');
		expect(projectStructurePageSource).not.toContain('Start Blank');
		expect(tabsIndexSource).toContain("import Root from './tabs.svelte';");
		expect(tabsIndexSource).toContain("import List from './tabs-list.svelte';");
		expect(tabsIndexSource).toContain("import Trigger from './tabs-trigger.svelte';");
		expect(wbsTableSource).toContain('Save as Template');
		expect(wbsTableSource).toContain('Start from Template');
		expect(templateTableSource).toContain('Create Template');
	});

	it('adds compact project header actions with submission deadline, favourite, and revision history access', () => {
		const layoutSource = readSource('src/routes/+layout.svelte');
		const dialogSource = readSource(
			'src/lib/components/quote/project-revision-history-dialog.svelte'
		);

		expect(layoutSource).toContain(
			"import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';"
		);
		expect(layoutSource).toContain("import EllipsisIcon from '@lucide/svelte/icons/ellipsis';");
		expect(layoutSource).toContain("import StarIcon from '@lucide/svelte/icons/star';");
		expect(layoutSource).toContain(
			'headerProject.submission_deadline_at || headerProject.due_date'
		);
		expect(layoutSource).toContain('projectsState.toggleFavourite(headerProject.id)');
		expect(layoutSource).toContain('projectRevisionHistoryState.openForProject(headerProject.id)');
		expect(dialogSource).toContain(
			'No revisions yet. Export a PDF from Quote to record the first revision.'
		);
		expect(dialogSource).toContain(
			'Read-only commercial snapshot captured when the quote PDF was exported.'
		);
	});

	it('uses shared textarea surfaces and compact file-selection headers in the project workspace', () => {
		const source = readSource('src/routes/project/[id]/+page.svelte');

		expect(source).toContain('ui-pane-card');
		expect(source).toContain('ui-pane-card-header');
		expect(source).toContain(
			'class="ui-pane-card-header ui-route-header-sm flex items-center justify-between"'
		);
		expect(source).toContain('class="ui-pane-card-header ui-route-header-sm gap-2"');
		expect(source).toContain("import { Textarea } from '$lib/components/ui/textarea/index.js';");
		expect(source).toContain('readonly');
		expect(source).toContain('class="ui-field-readonly-md bg-background"');
		expect(source).toContain('class="ui-field-readonly-sm bg-background"');
		expect(source).toContain('assetFileCountLabel(asset)');
		expect(source).toContain(": 'Select Files'}");
		expect(source).toContain('ui-view-toggle-group');
		expect(source).toContain("import { Checkbox } from '$lib/components/ui/checkbox/index.js';");
		expect(source).toContain('ui-muted-action');
		expect(source).toContain('gap-1.5');
		expect(source).not.toContain('class="small h-8 gap-1.5"');
		expect(source).not.toContain('field-label text-foreground');
		expect(source).not.toContain('hover:text-foreground');
		expect(source).toContain('selectedReviewCount');
		expect(source).toContain("'Select Files'");
	});

	it('uses icon utilities and flatter option surfaces in the quote editor', () => {
		const source = readSource('src/routes/project/[id]/quote/+page.svelte');
		const dialogFooterSource = readSource('src/lib/components/ui/dialog/dialog-footer.svelte');

		expect(source).toContain(
			"import FormHelpTooltip from '$lib/components/form-help-tooltip.svelte';"
		);
		expect(source).toContain("{activeOption.is_default ? 'Default option' : 'Set as default'}");
		expect(source).toContain('<Textarea');
		expect(source).toContain('class="min-h-28 resize-none"');
		expect(source).toContain('ui-table-header-surface');
		expect(source).toContain('ui-table-footer-surface');
		expect(source).toContain('InputAffix');
		expect(source).toContain('ui-table-shell');
		expect(source).toContain('ui-table-shell-strong');
		expect(source).toContain('ui-empty-panel-card');
		expect(source).toContain('ui-viewer-shell');
		expect(source).toContain('<Table.Head class="w-24 min-w-24">');
		expect(source).toContain('<Table.Cell class="w-24 min-w-24 text-right">');
		expect(source).toContain('class="w-full text-right tabular-nums"');
		expect(source).toContain('<Meta class="tabular-nums">');
		expect(source).toContain('ui-pane-header-compact');
		expect(source).toContain('class="w-full"');
		expect(source).not.toContain('absolute top-1/2 right-2 -translate-y-1/2');
		expect(source).not.toContain('space-y-3 rounded-md border bg-muted/10 p-3');
		expect(source).not.toContain('class="text-foreground">No presets saved yet.</Text>');
		expect(dialogFooterSource).toContain("density?: 'default' | 'compact';");
		expect(dialogFooterSource).toContain('data-density={density}');
	});

	it('keeps the quote PDF preview on the shared flatter field and action contract', () => {
		const source = readSource('src/routes/project/[id]/quote/pdf/+page.svelte');

		expect(source).toContain('ui-pane-header ui-pane-header-between ui-pane-header-compact');
		expect(source).toContain('<h4 class="title-copy">Quote Option</h4>');
		expect(source).toContain(
			'FormHelpTooltip content="Preview and export the selected commercial option."'
		);
		expect(source).toContain('ui-pane-card');
		expect(source).toContain('ui-file-row');
		expect(source).toContain(
			'<Select.Trigger id="pdf-quote-option" size="default" class="w-full">'
		);
		expect(source).toContain("{downloading ? 'Saving…' : 'Download PDF'}");
		expect(source).toContain('<Button');
		expect(source).toContain('FileDownloadIcon');
	});

	it('keeps the shared form help tooltip from stretching label rows', () => {
		const source = readSource('src/lib/components/form-help-tooltip.svelte');

		expect(source).toContain('inline-flex shrink-0 items-center self-center leading-none');
	});

	it('persists the active viewer file per asset within the running app session', () => {
		const source = readSource('src/lib/components/assets/MultiFileViewer.svelte');

		expect(source).toContain('<script module lang="ts">');
		expect(source).toContain('ui-viewer-shell');
		expect(source).toContain('const rememberedActiveFileIds = new SvelteMap<string, string>();');
		expect(source).toContain('const fileRestoreSignature = $derived(');
		expect(source).toContain('rememberedActiveFileIds.get(asset.id)');
		expect(source).toContain('rememberedActiveFileIds.set(asset.id, activeFileId)');
	});

	it('uses the current two-row footer summary and shared save action contract in the estimate editor', () => {
		const source = readSource('src/lib/components/assets/asset-estimate-editor.svelte');

		expect(source).toContain('sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start');
		expect(source).toContain('class="ui-estimate-footer-summary min-w-0"');
		expect(source).toContain(
			'class="flex flex-wrap items-center justify-end gap-4 sm:justify-self-end"'
		);
		expect(source).toContain('class="ui-estimate-footer-total"');
		expect(source).toContain('<SectionLabel as="div" class="justify-end text-right">');
		expect(source).toContain('Total Estimate Cost');
		expect(source).toContain('variant="brand"');
		expect(source).toContain('size="sm"');
		expect(source).toContain('class="h-8 min-w-24 self-center px-4"');
		expect(source).toContain('class="title-copy text-right tabular-nums"');
		expect(source).toContain("{saving ? 'Saving...' : 'Save'}");
		expect(source).not.toContain('<Separator class="my-3" />');
	});

	it('places the safe confirmation action on the right in estimate dialogs', () => {
		const estimateSource = readSource('src/lib/components/assets/asset-estimate-editor.svelte');
		const routeSource = readSource('src/routes/project/[id]/asset/[assetId]/+page.svelte');

		expect(estimateSource).toContain(
			'class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"'
		);
		expect(routeSource).toContain('<AlertDialog.Footer>');
		expect(routeSource).toContain('Discard changes');
		expect(routeSource).toContain('<AlertDialog.Cancel variant="default" autofocus');
		expect(routeSource).toContain('Cancel');
	});

	it('uses submission deadline as the visible RFQ deadline field', () => {
		const detailsSource = readSource('src/lib/components/intake/details-panel.svelte');
		const tableSource = readSource('src/lib/components/rfqs/data-table.svelte');
		const dialogSource = readSource('src/lib/components/intake/intake-dialog.svelte');

		expect(detailsSource).toContain('Submission Deadline');
		expect(detailsSource).toContain('DatePickerField');
		expect(detailsSource).toContain('mode="datetime"');
		expect(detailsSource).not.toContain('Due Date');
		expect(detailsSource).not.toContain('Choose due date');
		expect(detailsSource).not.toContain('type="date"');
		expect(detailsSource).not.toContain('type="datetime-local"');
		expect(tableSource).toContain("text: 'Submission Deadline'");
		expect(dialogSource).toContain('deriveSubmissionDeadlineDate');
		expect(dialogSource).toContain('hydrateSubmissionDeadlineValue');
		expect(dialogSource).toContain('`${dueDate}T17:00`');
	});

	it('uses shared title-case labels for RFQ status selects', () => {
		const constantsSource = readSource('src/lib/constants/index.ts');
		const detailsSource = readSource('src/lib/components/intake/details-panel.svelte');

		expect(constantsSource).toContain(
			'export function projectStatusLabel(value: ProjectStatus): string'
		);
		expect(detailsSource).toContain('projectStatusLabel(formValues.status as ProjectStatus)');
		expect(detailsSource).toContain('{projectStatusLabel(status as ProjectStatus)}');
		expect(detailsSource).not.toContain('class="small capitalize">{status}</Select.Item>');
	});
});

describe('design system foundation contract', () => {
	it('loads the layered design files from the app entry stylesheet', () => {
		const source = readSource('src/app.css');

		expect(source).toContain("@import './lib/design/tokens.css';");
		expect(source).toContain("@import './lib/design/theme.css';");
		expect(source).toContain("@import './lib/design/typography.css';");
		expect(source).toContain("@import './lib/design/motion.css';");
		expect(source).toContain("@import './lib/design/layout.css';");
	});

	it('keeps the owned primitive layer in the repo', () => {
		const primitiveSources = readSvelteSources('src/lib/components/primitives');

		expect(primitiveSources).toHaveLength(20);
		expect(readSource('src/lib/components/primitives/cluster.svelte')).toContain(
			'data-kf-primitive="cluster"'
		);
		expect(readSource('src/lib/components/primitives/box.svelte')).toContain(
			'data-kf-primitive="box"'
		);
		expect(readSource('src/lib/components/primitives/stack.svelte')).toContain(
			'data-kf-primitive="stack"'
		);
		expect(readSource('src/lib/components/primitives/inline.svelte')).toContain(
			'data-kf-primitive="inline"'
		);
		expect(readSource('src/lib/components/primitives/surface.svelte')).toContain(
			'data-kf-primitive="surface"'
		);
		expect(readSource('src/lib/components/primitives/heading.svelte')).toContain(
			'data-kf-primitive="heading"'
		);
		expect(readSource('src/lib/components/primitives/text.svelte')).toContain(
			'data-kf-primitive="text"'
		);
		expect(readSource('src/lib/components/primitives/field-shell.svelte')).toContain(
			'data-kf-primitive="field-shell"'
		);
		expect(readSource('src/lib/components/primitives/field-error.svelte')).toContain(
			"import FieldHelp from './field-help.svelte';"
		);
	});

	it('uses table-specific semantic typography for shared table helpers', () => {
		expect(readSource('src/lib/components/table-header-label.svelte')).toContain('table-heading');
		expect(readSource('src/lib/components/table-text-cell.svelte')).toContain('table-copy');
		expect(readSource('src/lib/components/table-stack-cell.svelte')).toContain('table-copy');
		expect(readSource('src/lib/components/table-stack-cell.svelte')).toContain('table-caption');
	});

	it('applies the first golden-pattern pass to shell and table surfaces', () => {
		const sidebarSource = readSource('src/lib/components/app-sidebar.svelte');
		const rfqTableSource = readSource('src/lib/components/rfqs/data-table.svelte');

		expect(sidebarSource).toContain("import Stack from '$lib/components/primitives/stack.svelte';");
		expect(sidebarSource).not.toContain(
			"import Surface from '$lib/components/primitives/surface.svelte';"
		);
		expect(sidebarSource).toContain(
			'<Stack gap="0" class={`min-h-0 flex-1 ${nativeShellInsetClass}`.trim()}>'
		);
		expect(rfqTableSource).toContain("import { Text } from '$lib/components/primitives/index.js';");
		expect(rfqTableSource).toContain('ui-selection-toolbar');
		expect(rfqTableSource).toContain('ui-table-shell');
	});

	it('keeps the next-wave shell and table controls on shared small sizing without local height overrides', () => {
		const mobileStepTabsSource = readSource('src/lib/components/mobile-dialog-step-tabs.svelte');
		const wbsTableSource = readSource('src/lib/components/wbs/wbs-table.svelte');
		const costCodesTableSource = readSource(
			'src/lib/components/classification-systems/cost-codes-table.svelte'
		);
		const contactsTableSource = readSource('src/lib/components/contacts/contact-table.svelte');
		const rfqTableSource = readSource('src/lib/components/rfqs/data-table.svelte');
		const sidebarProjectsPanelSource = readSource(
			'src/lib/components/app-sidebar-projects-panel.svelte'
		);

		expect(mobileStepTabsSource).not.toContain('class="h-8');
		expect(wbsTableSource).toContain('size="sm"');
		expect(wbsTableSource).not.toContain('class="h-8 w-56"');
		expect(costCodesTableSource).toContain('size="sm"');
		expect(costCodesTableSource).not.toContain('class="h-8 w-56"');
		expect(contactsTableSource).not.toContain('class="h-8 gap-2"');
		expect(rfqTableSource).not.toContain('class="h-8 gap-2"');
		expect(sidebarProjectsPanelSource).not.toContain('class="h-8 w-full justify-start gap-2"');
	});

	it('keeps shell boot actions and project rename fields on shared compact sizing', () => {
		const rootLayoutSource = readSource('src/routes/+layout.svelte');
		const projectRouteSource = readSource('src/routes/project/[id]/+page.svelte');

		expect(rootLayoutSource).not.toContain('class="h-8 gap-2"');
		expect(projectRouteSource).toContain('size="sm"');
		expect(projectRouteSource).toContain('ui-review-grid-card');
		expect(projectRouteSource).toContain('ui-review-grid-card-selected');
		expect(projectRouteSource).toContain('ui-review-grid-card-inactive');
		expect(projectRouteSource).toContain('ui-review-list-row');
		expect(projectRouteSource).toContain('ui-review-list-row-inactive');
		expect(projectRouteSource).toContain('ui-asset-row');
		expect(projectRouteSource).toContain('ui-asset-thumb-button');
		expect(projectRouteSource).not.toContain(
			'class="h-8 min-w-0 flex-1 border-transparent bg-transparent px-2'
		);
	});
});
