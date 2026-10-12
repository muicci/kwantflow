import { describe, expect, it } from 'vitest';
import {
	buildUniqueWorkspaceSlug,
	isWorkspaceNamePlaceholder,
	sanitiseBusinessNameCandidate,
	slugifyWorkspaceName
} from './workspace-naming.js';

describe('workspace naming helpers', () => {
	it('treats Default as an internal placeholder workspace name', () => {
		expect(isWorkspaceNamePlaceholder('Default')).toBe(true);
		expect(isWorkspaceNamePlaceholder('Workspace')).toBe(true);
		expect(isWorkspaceNamePlaceholder('Acme North')).toBe(false);
	});

	it('prevents placeholder workspace names from becoming business names', () => {
		expect(sanitiseBusinessNameCandidate('Default', 'Default')).toBe('');
		expect(sanitiseBusinessNameCandidate('Workspace', 'Workspace')).toBe('');
	});

	it('keeps real business names even when the workspace label differs', () => {
		expect(sanitiseBusinessNameCandidate('Harry PTY LTD', 'Default')).toBe('Harry PTY LTD');
	});

	it('creates consistent workspace slugs for onboarding and settings', () => {
		expect(slugifyWorkspaceName(' Acme North / Steel ')).toBe('acme-north-steel');
		expect(buildUniqueWorkspaceSlug('acme', [{ slug: 'acme' }, { slug: 'acme-2' }])).toBe('acme-3');
	});
});
