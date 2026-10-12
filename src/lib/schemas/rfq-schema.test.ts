import { describe, expect, it } from 'vitest';

import { PriorityLevel, ProjectStatus } from '$lib/constants/index.js';
import { rfqSchema } from './index.js';

describe('rfqSchema', () => {
	it('requires a company for manual RFQ intake', () => {
		const result = rfqSchema.safeParse({
			rfq_number: 'RFQ-1001',
			company_contact_id: null,
			company_name: '',
			requester_contact_id: null,
			requester_name: '',
			project_name: '',
			due_date: '',
			source_channel: 'manual',
			source_reference: null,
			priority: PriorityLevel.Medium,
			status: ProjectStatus.Draft,
			content: '',
			note: ''
		});

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.flatten().fieldErrors.company_name).toContain('Company is required');
		}
	});

	it('defaults the hidden source channel to manual', () => {
		const result = rfqSchema.parse({
			rfq_number: 'RFQ-1002',
			company_contact_id: 'company-1',
			company_name: 'Bangkok Pty Ltd',
			requester_contact_id: null,
			requester_name: '',
			project_name: 'Bridge package',
			due_date: '',
			priority: PriorityLevel.Medium,
			status: ProjectStatus.Draft,
			content: '',
			note: ''
		});

		expect(result.source_channel).toBe('manual');
		expect(result.source_reference).toBeUndefined();
	});
});
