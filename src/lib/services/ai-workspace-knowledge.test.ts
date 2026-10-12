import { describe, expect, it } from 'vitest';
import { GENERAL_PROJECT_FILE_UPLOAD_EXTENSIONS } from '$lib/constants/index.js';
import {
	getWorkspaceAiKnowledgeUploadExtensions,
	getWorkspaceAiKnowledgeUploadSummary,
	getWorkspaceAiSkillFilePath,
	isWorkspaceAiKnowledgeFileAllowed
} from './ai-workspace-knowledge.js';

describe('workspace AI knowledge file support', () => {
	it('derives upload extensions from the shared project file support registry', () => {
		const extensions = getWorkspaceAiKnowledgeUploadExtensions();
		const derived = GENERAL_PROJECT_FILE_UPLOAD_EXTENSIONS.filter((extension) =>
			isWorkspaceAiKnowledgeFileAllowed(`file.${extension}`)
		);

		expect(extensions).toEqual(derived);
		expect(extensions).toEqual(['pdf', 'txt', 'csv', 'md', 'log', 'json', 'xml', 'docx', 'xlsx']);
		expect(extensions).not.toContain('png');
		expect(extensions).not.toContain('doc');
		expect(extensions).not.toContain('pptx');
	});

	it('derives the upload summary from the same extension contract', () => {
		expect(getWorkspaceAiKnowledgeUploadSummary()).toBe(
			'PDF, TXT, CSV, Markdown, LOG, JSON, XML, DOCX, and XLSX'
		);
	});

	it('constructs the correct path for workspace AI skill files', () => {
		const workspaceId = 'test-workspace-id';
		const expectedPath = `account/workspace-ai-knowledge/${workspaceId}/workspace-ai-skill.md`;
		expect(getWorkspaceAiSkillFilePath(workspaceId)).toBe(expectedPath);
	});
});
