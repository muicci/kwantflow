import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string) =>
	readFileSync(join(process.cwd(), relativePath), 'utf8');

describe('shell viewport scroll lock', () => {
	it('locks the document/root chain and keeps major list pages inside the shell height', () => {
		const appHtml = readSource('src/app.html');
		const appCss = readSource('src/app.css');
		const sidebarProvider = readSource('src/lib/components/ui/sidebar/sidebar-provider.svelte');
		const sidebarInset = readSource('src/lib/components/ui/sidebar/sidebar-inset.svelte');
		const homeRoute = readSource('src/routes/+page.svelte');
		const companiesRoute = readSource('src/routes/companies/+page.svelte');
		const materialsRoute = readSource('src/routes/materials/+page.svelte');
		const labourRatesRoute = readSource('src/routes/labour-rates/+page.svelte');
		const equipmentRatesRoute = readSource('src/routes/equipment-rates/+page.svelte');
		const costPresetsRoute = readSource('src/routes/cost-presets/+page.svelte');
		const estimateTemplatesRoute = readSource('src/routes/estimate-templates/+page.svelte');
		const classificationSystemsRoute = readSource('src/routes/classification-systems/+page.svelte');
		const rootLayout = readSource('src/routes/+layout.svelte');

		expect(appHtml).toContain('<div id="app-shell-root">%sveltekit.body%</div>');
		expect(appCss).toContain('html,');
		expect(appCss).toContain('#app-shell-root {');
		expect(appCss).toContain('overflow: hidden;');
		expect(appCss).toContain('min-height: 100dvh;');
		expect(sidebarProvider).toContain('flex h-full min-h-0 w-full overflow-hidden');
		expect(sidebarInset).toContain('ui-sidebar-inset');
		expect(rootLayout).toContain('ui-detached-shell');
		expect(rootLayout).toContain('ui-boot-shell');

		for (const routeSource of [
			homeRoute,
			companiesRoute,
			materialsRoute,
			labourRatesRoute,
			equipmentRatesRoute,
			costPresetsRoute,
			estimateTemplatesRoute,
			classificationSystemsRoute
		]) {
			expect(routeSource).toContain('class="ui-route-frame"');
			expect(routeSource).toContain('class="ui-page-content"');
		}
	});
});
