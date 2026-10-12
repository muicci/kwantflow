import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const componentPath = join(
	process.cwd(),
	'src/lib/components/user/workspace-knowledge-settings-panel.svelte'
);

describe('workspace knowledge settings panel', () => {
	it('keeps the workspace playbook and knowledge uploads on the intake-style contract', () => {
		const source = readFileSync(componentPath, 'utf8');

		expect(source).toContain('Workspace Playbook');
		expect(source).toContain('Knowledge Files');
		expect(source).toContain('AI feedback history');
		expect(source).toContain('Saved local notes from AI draft reviews.');
		expect(source).toContain('Drop knowledge files here or click to browse');
		expect(source).toContain('WORKSPACE_AI_KNOWLEDGE_MAX_FILES');
		expect(source).toContain('WORKSPACE_AI_PLAYBOOK_MAX_CHARS');
		expect(source).toContain('WORKSPACE_AI_FEEDBACK_MAX_CHARS');
		expect(source).toContain('FieldLabelRow');
		expect(source).toContain('maxlength={WORKSPACE_AI_PLAYBOOK_MAX_CHARS}');
		expect(source).toContain('getWorkspaceAiKnowledgeUploadSummary');
		expect(source).toContain('isWorkspaceAiKnowledgeFileAllowed');
		expect(source).toContain('ChevronDownIcon');
		expect(source).toContain('ChevronRightIcon');
		expect(source).toContain('Read more');
		expect(source).toContain('Load more feedback');
		expect(source).toContain('HardDriveIcon');
		expect(source).toContain('ui-upload-dropzone');
		expect(source).toContain('ui-file-row');
		expect(source).not.toContain('Clear all');
		expect(source).not.toContain('What Future Drafts Will Use');
		expect(source).not.toContain('ui-file-note-card');
		expect(source).not.toContain('GlobalWorkerOptions.workerSrc');
	});
});
