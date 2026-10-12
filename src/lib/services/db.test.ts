import { describe, it, expect, beforeEach, vi } from 'vitest';
import { dbService, classifyDatabaseInitializationError } from '$lib/services/db';
import { MOCK_PROJECTS } from '$lib/mocks/projects';

// Mock isTauri to return false — these tests verify mock-mode contract
vi.mock('$lib/utils/env', () => ({
	isTauri: () => false
}));

// In Vitest (non-Tauri), dbService always falls back to mock mode.
// We test the mock-mode behaviour here to ensure the contract is stable.
describe('dbService (mock mode)', () => {
	beforeEach(() => {
		// Reset internal DB state between tests
		(dbService as unknown as Record<string, unknown>)['db'] = null;
	});

	describe('getProjects()', () => {
		it('returns all MOCK_PROJECTS when not in Tauri', async () => {
			const result = await dbService.getProjects();
			expect(result).toHaveLength(MOCK_PROJECTS.length);
			expect(result[0]).toMatchObject({ id: expect.any(String), rfq_number: expect.any(String) });
		});
	});

	describe('getRecentProjects()', () => {
		it('returns sliced mock data respecting the limit', async () => {
			const result = await dbService.getRecentProjects(2);
			expect(result).toHaveLength(2);
		});

		it('returns all mocks when limit exceeds mock count', async () => {
			const result = await dbService.getRecentProjects(100);
			expect(result.length).toBeLessThanOrEqual(MOCK_PROJECTS.length);
		});
	});

	describe('getProjectById()', () => {
		it('returns the matching mock project', async () => {
			const target = MOCK_PROJECTS[0];
			const result = await dbService.getProjectById(target.id);
			expect(result?.id).toBe(target.id);
		});

		it('returns null for an unknown id', async () => {
			const result = await dbService.getProjectById('does-not-exist');
			expect(result).toBeNull();
		});
	});

	describe('workspace foundation helpers', () => {
		it('returns a default local workspace identity in mock mode', async () => {
			const workspace = await dbService.getWorkspaceIdentity();

			expect(workspace).toMatchObject({
				id: 'local-workspace',
				bootstrapCompletedAt: null
			});
		});

		it('bootstraps a workspace foundation with the provided workspace id in mock mode', async () => {
			const bootstrap = await dbService.bootstrapWorkspaceFoundation({
				workspaceId: 'workspace-acme',
				displayName: 'Acme Fabrication',
				countryCode: 'AU',
				businessName: 'Acme Fabrication',
				logoFilePath: '',
				businessContactFirstName: 'Sam',
				businessContactLastName: 'Owner',
				businessContactEmail: 'sam@acme.test',
				businessContactPhone: '+61 400 000 000',
				businessIdValue: '12 345 678 901',
				primaryOperatorRole: 'owner_founder',
				industry: ''
			});

			expect(bootstrap.workspaceIdentity).toMatchObject({
				id: 'workspace-acme'
			});
			expect(bootstrap.workspaceProfile).toMatchObject({
				workspaceId: 'workspace-acme',
				displayName: 'Acme Fabrication',
				businessName: 'Acme Fabrication',
				businessContactName: 'Sam Owner',
				businessContactFirstName: 'Sam',
				businessContactLastName: 'Owner'
			});
			expect(bootstrap.workspaceMember).toMatchObject({
				workspaceId: 'workspace-acme',
				role: 'owner',
				displayName: 'Sam Owner',
				firstName: 'Sam',
				lastName: 'Owner'
			});
		});
	});

	describe('database contract errors', () => {
		it('classifies newer-database errors as update-required blocks', () => {
			const result = classifyDatabaseInitializationError(
				new Error('Unsupported workspace database schema version 3; expected 2.')
			);

			expect(result.kind).toBe('update_required');
			expect(result.message).toContain('newer Kwantflow build');
		});
	});
});
