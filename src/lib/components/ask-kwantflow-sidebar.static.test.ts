import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string) =>
	readFileSync(join(process.cwd(), relativePath), 'utf8');

describe('Ask Kwantflow sidebar message rendering', () => {
	it('renders sent image attachments inside the user-message branch', () => {
		const source = readSource('src/lib/components/ask-kwantflow-sidebar.svelte');
		const userBranchStart = source.indexOf("{#if message.role === 'user'}");
		const assistantBranchStart = source.indexOf('{:else}', userBranchStart);

		expect(userBranchStart).toBeGreaterThan(-1);
		expect(assistantBranchStart).toBeGreaterThan(userBranchStart);

		const userBranch = source.slice(userBranchStart, assistantBranchStart);
		expect(userBranch).toContain('message.attachments.length > 0');
		expect(userBranch).toContain('data-testid="ask-kwantflow-sent-attachments"');
		expect(userBranch).toContain('data-testid="ask-kwantflow-sent-attachment"');
	});

	it('renders one grouped atomic proposal-set surface', () => {
		const source = readSource('src/lib/components/ask-kwantflow-sidebar.svelte');
		expect(source).not.toContain('AskKwantflowProposal');
		expect(source).not.toContain('AskKwantflowApprovalDetail');
		expect(source).toContain('message.proposalSet');
		expect(source).toContain('approveProposalSet');
		expect(source).toContain('discardProposalSet');
		expect(source).not.toContain(['approve', 'Proposal('].join(''));
		expect(source).not.toContain(['discard', 'Proposal('].join(''));
		expect(source).not.toContain('propose_upsert');
	});

	it('does not render native reasoning or retain a reasoning disclosure', () => {
		const sidebarSource = readSource('src/lib/components/ask-kwantflow-sidebar.svelte');
		expect(sidebarSource).not.toContain('parseMarkdownTokens(message.thinking)');
		expect(sidebarSource).not.toContain('ui-thinking-block');
		expect(sidebarSource).not.toContain('Reasoning details');
		expect(sidebarSource).not.toContain('Reasoning…');
		expect(sidebarSource).not.toContain('THINKING_PHRASES');
		expect(sidebarSource).not.toContain('currentThinkingPhraseIndex');
	});

	it('clears native reasoning before a message is retained', () => {
		const stateSource = readSource('src/lib/state/assistant.svelte.ts');
		expect(stateSource).not.toContain('accumulatedThinking');
		expect(stateSource).not.toContain('answer.thinking');
		expect(stateSource).toContain("thinking: ''");
	});

	it('keeps synthetic working-step parsing absent', () => {
		const source = readSource('src/lib/components/ask-kwantflow-sidebar.svelte');
		expect(source).not.toContain('parseThinkingContent');
		expect(source).not.toContain('Working Steps');
		expect(source).not.toContain("trimmed.startsWith('🔧')");
	});

	it('does not render internal tool names in normal assistant replies', () => {
		const source = readSource('src/lib/components/ask-kwantflow-sidebar.svelte');
		expect(source).not.toContain("replace('records_'");
		expect(source).not.toContain("replace('_propose_upsert'");
	});
});
