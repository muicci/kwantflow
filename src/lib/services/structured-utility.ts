import { type ZodType } from 'zod';
import { localAiService, type LocalAiWorkloadClass } from '$lib/services/local-ai.js';

const STRUCTURED_UTILITY_TIMEOUT_MS = 90_000;

type StructuredUtilityTask<T> = {
	taskName: string;
	systemInstruction: string;
	userContent: string;
	outputSchema: ZodType<T>;
	enableThinking?: boolean;
	maxOutputTokens?: number;
	timeoutMs?: number;
	workloadClass?: LocalAiWorkloadClass;
};

export type StructuredUtilityResult<T> = { value: T; modelId: string };

/** Thin feature adapter for isolated structured tasks. */
export async function runStructuredUtilityTask<T>(task: StructuredUtilityTask<T>): Promise<T> {
	return (await runStructuredUtilityTaskResult(task)).value;
}

export async function runStructuredUtilityTaskResult<T>(
	task: StructuredUtilityTask<T>
): Promise<StructuredUtilityResult<T>> {
	const result = await localAiService.runStructuredTask({
		schemaName: task.taskName,
		schema: task.outputSchema,
		systemInstruction: task.systemInstruction,
		messages: [{ role: 'user', content: [{ type: 'text', text: task.userContent }] }],
		enableThinking: task.enableThinking ?? false,
		maxOutputTokens: task.maxOutputTokens ?? 1024,
		timeoutMs: task.timeoutMs ?? STRUCTURED_UTILITY_TIMEOUT_MS,
		workloadClass: task.workloadClass ?? 'interactive',
		allowCorrection: true
	});
	return { value: result.value, modelId: result.completion.modelId };
}
