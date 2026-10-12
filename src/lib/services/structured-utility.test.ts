import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const { runStructuredTask } = vi.hoisted(() => ({
	runStructuredTask: vi.fn()
}));

vi.mock('$lib/services/local-ai.js', () => ({
	localAiService: { runStructuredTask }
}));

import { runStructuredUtilityTask } from './structured-utility.js';

describe('runStructuredUtilityTask', () => {
	beforeEach(() => runStructuredTask.mockReset());

	it('uses one constrained output tool with native thinking and output limits', async () => {
		runStructuredTask.mockResolvedValueOnce({
			value: { verdict: 'rfq' },
			completion: { modelId: 'gemma-4-e4b' }
		});

		const result = await runStructuredUtilityTask({
			taskName: 'classify_email_rfq',
			systemInstruction: 'Classify the email.',
			userContent: 'Subject: RFQ',
			outputSchema: z.object({ verdict: z.enum(['rfq', 'not_rfq']) }),
			enableThinking: false,
			maxOutputTokens: 128
		});

		expect(result).toEqual({ verdict: 'rfq' });
		expect(runStructuredTask).toHaveBeenCalledWith(
			expect.objectContaining({
				schemaName: 'classify_email_rfq',
				messages: [{ role: 'user', content: [{ type: 'text', text: 'Subject: RFQ' }] }],
				enableThinking: false,
				maxOutputTokens: 128,
				timeoutMs: 90_000,
				workloadClass: 'interactive',
				allowCorrection: true
			})
		);
	});

	it('retries once after invalid structured arguments', async () => {
		runStructuredTask.mockResolvedValueOnce({
			value: { verdict: 'not_rfq' },
			completion: { modelId: 'gemma-4-e4b' }
		});

		await expect(
			runStructuredUtilityTask({
				taskName: 'classify_email_rfq',
				systemInstruction: 'Classify.',
				userContent: 'Message',
				outputSchema: z.object({ verdict: z.enum(['rfq', 'not_rfq']) })
			})
		).resolves.toEqual({ verdict: 'not_rfq' });
		expect(runStructuredTask).toHaveBeenCalledTimes(1);
	});
});
