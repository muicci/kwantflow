import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	buildLocalAssistantHelpSectionsFromFiles,
	getLocalAssistantHelpSections
} from './local-assistant-help.js';

describe('localAssistantHelp', () => {
	it('loads the shipped help corpus with unique ids and useful coverage', () => {
		const sections = getLocalAssistantHelpSections();

		expect(sections.length).toBeGreaterThanOrEqual(18);
		expect(new Set(sections.map((section) => section.id)).size).toBe(sections.length);
		expect(sections.some((section) => section.id === 'help-onboarding')).toBe(true);
		expect(sections.some((section) => section.id === 'help-navigation')).toBe(true);
		expect(sections.some((section) => section.id === 'help-quote-revisions')).toBe(true);
		expect(sections.some((section) => section.id === 'help-file-support')).toBe(true);
		expect(sections.some((section) => section.id === 'schema-glossary')).toBe(true);
	});

	it('keeps onboarding help aligned to the local-first first-run flow', () => {
		const onboarding = getLocalAssistantHelpSections().find(
			(section) => section.id === 'help-onboarding'
		);

		expect(onboarding).toBeDefined();
		expect(onboarding?.title).toBe('First-time setup');
		expect(onboarding?.summary).toContain('local workspace');
		expect(onboarding?.text).toContain('workspace setup');
		expect(onboarding?.text).toContain('optional setup import');
		expect(onboarding?.text).toContain('optional Local AI');
		expect(onboarding?.text).toContain('RFQ home');
		expect(onboarding?.text).not.toMatch(
			/browser sign-in|sign in in the browser|hosted account|licen[cs]e key/i
		);
	});

	it('keeps the assistant placeholder broad instead of promising estimate context globally', () => {
		const widgetSource = readFileSync(
			join(process.cwd(), 'src/lib/components/ask-kwantflow-sidebar.svelte'),
			'utf8'
		);

		expect(widgetSource).toContain('Ask Kwantflow...');
		expect(widgetSource).not.toContain('Ask AI about this estimate...');
	});

	it('rejects duplicate help ids', () => {
		expect(() =>
			buildLocalAssistantHelpSectionsFromFiles({
				'a.md': `---
id: duplicate
title: One
kind: help
summary: Summary one
keywords: alpha
---

Body one.`,
				'b.md': `---
id: duplicate
title: Two
kind: help
summary: Summary two
keywords: beta
---

Body two.`
			})
		).toThrow(/Duplicate local assistant help id/);
	});

	it('rejects malformed routes and missing bodies', () => {
		expect(() =>
			buildLocalAssistantHelpSectionsFromFiles({
				'bad-route.md': `---
id: bad-route
title: Bad route
kind: help
summary: Summary
keywords: route
route: companies
---

Body.`
			})
		).toThrow(/route must start with "\/"/);

		expect(() =>
			buildLocalAssistantHelpSectionsFromFiles({
				'empty-body.md': `---
id: empty-body
title: Empty body
kind: help
summary: Summary
keywords: empty
---

`
			})
		).toThrow(/empty body/);
	});
});
