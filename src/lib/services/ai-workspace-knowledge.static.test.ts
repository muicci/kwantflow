import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const servicePath = join(process.cwd(), 'src/lib/services/ai-workspace-knowledge.ts');

describe('ai workspace knowledge service', () => {
	it('keeps PDF extraction worker-free and knowledge limits explicit', () => {
		const source = readFileSync(servicePath, 'utf8');

		expect(source).toContain('WORKSPACE_AI_KNOWLEDGE_MAX_FILES = 5');
		expect(source).toContain('WORKSPACE_AI_PLAYBOOK_MAX_CHARS = 1_200');
		expect(source).toContain('WORKSPACE_AI_FEEDBACK_MAX_CHARS = 400');
		expect(source).toContain('workspace-ai-skill.md');
		expect(source).toContain('getWorkspaceAiKnowledgeUploadSummary');
		expect(source).toContain("invoke<NativePdfTextExtractionResult>('extract_pdf_text'");
		expect(source).toContain('Native PDF text extraction failed for workspace knowledge');
		expect(source).not.toContain('GlobalWorkerOptions.workerSrc');
	});
});
