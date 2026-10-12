import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('controlDbService', () => {
	it('exposes the machine-level profile, workspace registry, and onboarding helpers', async () => {
		const { controlDbService } = await import('./control-db');

		expect(typeof controlDbService.init).toBe('function');
		expect(typeof controlDbService.getProfileIdentity).toBe('function');
		expect(typeof controlDbService.upsertProfileIdentity).toBe('function');
		expect(typeof controlDbService.getControlCustomerIdentity).toBe('function');
		expect(typeof controlDbService.upsertControlCustomerIdentity).toBe('function');
		expect(typeof controlDbService.getWorkspaceRegistry).toBe('function');
		expect(typeof controlDbService.getWorkspaceRegistryEntry).toBe('function');
		expect(typeof controlDbService.updateWorkspaceRegistryEntry).toBe('function');
		expect(typeof controlDbService.getActiveWorkspaceRegistryEntry).toBe('function');
		expect(typeof controlDbService.getOnboardingState).toBe('function');
		expect(typeof controlDbService.upsertOnboardingState).toBe('function');
	});

	it('seeds the optional local profile before customer identity upsert', () => {
		const source = readFileSync(join(process.cwd(), 'src/lib/services/control-db.ts'), 'utf8');
		const profileSeedIndex = source.indexOf('INSERT INTO profile_identity (id, display_name)');
		const customerUpsertIndex = source.indexOf('INSERT INTO control_customer_identity');

		expect(profileSeedIndex).toBeGreaterThan(-1);
		expect(customerUpsertIndex).toBeGreaterThan(profileSeedIndex);
		expect(source).toContain('ON CONFLICT(id) DO NOTHING');
	});

	it('merges onboarding updates without wiping earlier milestones', async () => {
		const { mergeOnboardingStateSnapshot } = await import('./control-db');

		const merged = mergeOnboardingStateSnapshot(
			{
				id: 'primary-onboarding',
				currentStep: 'setup_import_optional',
				profileCompletedAt: '2026-04-23T12:00:00.000Z',
				firstWorkspaceCreatedAt: '2026-04-23T12:01:00.000Z',
				importDecidedAt: null,
				localAiDecidedAt: null,
				completedAt: null,
				activeWorkspaceId: 'workspace-1',
				created_at: '2026-04-23 12:00:00',
				updated_at: '2026-04-23 12:01:00'
			},
			{
				currentStep: 'local_ai_optional',
				importDecidedAt: '2026-04-23T12:02:00.000Z'
			}
		);

		expect(merged.currentStep).toBe('local_ai_optional');
		expect(merged.profileCompletedAt).toBe('2026-04-23T12:00:00.000Z');
		expect(merged.firstWorkspaceCreatedAt).toBe('2026-04-23T12:01:00.000Z');
		expect(merged.importDecidedAt).toBe('2026-04-23T12:02:00.000Z');
		expect(merged.activeWorkspaceId).toBe('workspace-1');
	});

	it('allows explicit null resets in onboarding updates', async () => {
		const { mergeOnboardingStateSnapshot } = await import('./control-db');

		const merged = mergeOnboardingStateSnapshot(
			{
				id: 'primary-onboarding',
				currentStep: 'ready',
				profileCompletedAt: '2026-04-23T12:00:00.000Z',
				firstWorkspaceCreatedAt: '2026-04-23T12:01:00.000Z',
				importDecidedAt: '2026-04-23T12:02:00.000Z',
				localAiDecidedAt: '2026-04-23T12:03:00.000Z',
				completedAt: '2026-04-23T12:03:00.000Z',
				activeWorkspaceId: 'workspace-1',
				created_at: '2026-04-23 12:00:00',
				updated_at: '2026-04-23 12:03:00'
			},
			{
				currentStep: 'workspace_setup',
				profileCompletedAt: null,
				firstWorkspaceCreatedAt: null,
				importDecidedAt: null,
				localAiDecidedAt: null,
				completedAt: null,
				activeWorkspaceId: null
			}
		);

		expect(merged.currentStep).toBe('workspace_setup');
		expect(merged.profileCompletedAt).toBeNull();
		expect(merged.firstWorkspaceCreatedAt).toBeNull();
		expect(merged.importDecidedAt).toBeNull();
		expect(merged.localAiDecidedAt).toBeNull();
		expect(merged.completedAt).toBeNull();
		expect(merged.activeWorkspaceId).toBeNull();
	});
});
