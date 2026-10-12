import { describe, expect, it } from 'vitest';

import { workspaceFeatureContracts } from '$lib/constants/workspace-feature-contract.js';
import { workspaceRecordDefinitions } from '$lib/constants/workspace-records.js';

describe('workspace companies-first metadata', () => {
	it('exposes the contacts feature as the Companies workspace surface', () => {
		expect(workspaceRecordDefinitions.contacts.entityLabel).toBe('Companies');
		expect(workspaceRecordDefinitions.contacts.emptyTitle).toBe('No Companies Yet');
		expect(workspaceRecordDefinitions.contacts.createLabel).toBe('Create Company');
		expect(workspaceRecordDefinitions.contacts.importSupport).toEqual({
			kind: 'setup_import',
			targetTableId: 'contacts',
			importLabel: 'Import Companies'
		});
	});

	it('describes the contacts table contract with company-first wording', () => {
		const contract = workspaceFeatureContracts.find((item) => item.key === 'contacts');

		expect(contract?.entityLabel).toBe('Companies');
	});
});
