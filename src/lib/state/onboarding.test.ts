import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();

const controlDbServiceMock = {
	getProfileIdentity: vi.fn(),
	getControlCustomerIdentity: vi.fn(),
	getWorkspaceRegistry: vi.fn(),
	getOnboardingState: vi.fn(),
	upsertProfileIdentity: vi.fn(),
	upsertControlCustomerIdentity: vi.fn(),
	upsertOnboardingState: vi.fn(),
	getActiveWorkspaceRegistryEntry: vi.fn()
};

const dbServiceMock = {
	getDatabasePath: vi.fn(),
	adoptActiveWorkspace: vi.fn(),
	init: vi.fn(),
	buildBootstrapFoundationCommandInput: vi.fn(),
	ensureDefaultClassificationSystem: vi.fn(),
	bootstrapWorkspaceFoundation: vi.fn(),
	markWorkspaceOnboardingCompleted: vi.fn()
};

const workspaceStateMock = {
	hydrate: vi.fn(),
	refresh: vi.fn(),
	reset: vi.fn()
};

const profileStateMock = {
	refresh: vi.fn()
};

const validWorkspaceValues = {
	workspaceName: 'Acme Fabrication',
	countryCode: 'AU',
	businessName: 'Acme Fabrication',
	logoFilePath: '',
	businessContactFirstName: 'Sam',
	businessContactLastName: 'Owner',
	businessContactPhone: '',
	businessContactEmail: 'contact@acme.test',
	businessIdValue: '',
	primaryOperatorRole: 'owner_founder' as const,
	industry: ''
};

vi.mock('../services/control-db', () => ({
	controlDbService: controlDbServiceMock
}));

vi.mock('@tauri-apps/api/core', () => ({
	invoke: invokeMock
}));

vi.mock('../services/db', () => ({
	dbService: dbServiceMock
}));

vi.mock('./workspace.svelte', () => ({
	workspaceState: workspaceStateMock
}));

vi.mock('./profile.svelte', () => ({
	profileState: profileStateMock
}));

describe('onboardingState local-first flow', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();

		controlDbServiceMock.getProfileIdentity.mockResolvedValue(null);
		controlDbServiceMock.getControlCustomerIdentity.mockResolvedValue(null);
		controlDbServiceMock.getWorkspaceRegistry.mockResolvedValue([]);
		controlDbServiceMock.getOnboardingState.mockResolvedValue(null);
		controlDbServiceMock.upsertProfileIdentity.mockResolvedValue({
			id: 'primary-profile',
			displayName: 'Sam Owner',
			firstName: 'Sam',
			lastName: 'Owner',
			email: 'sam@acme.test',
			phone: '+61 400 000 000',
			created_at: '2026-04-23T00:00:00.000Z',
			updated_at: '2026-04-23T00:00:00.000Z'
		});
		controlDbServiceMock.upsertControlCustomerIdentity.mockResolvedValue({
			id: 'primary-customer',
			profileId: 'primary-profile',
			displayName: 'Acme Fabrication',
			created_at: '2026-04-23T00:00:00.000Z',
			updated_at: '2026-04-23T00:00:00.000Z'
		});
		controlDbServiceMock.upsertOnboardingState.mockImplementation(async (updates) => ({
			id: 'primary-onboarding',
			currentStep: updates.currentStep ?? 'workspace_setup',
			profileCompletedAt: updates.profileCompletedAt ?? null,
			firstWorkspaceCreatedAt: updates.firstWorkspaceCreatedAt ?? null,
			importDecidedAt: updates.importDecidedAt ?? null,
			localAiDecidedAt: updates.localAiDecidedAt ?? null,
			completedAt: updates.completedAt ?? null,
			activeWorkspaceId: updates.activeWorkspaceId ?? null,
			created_at: '2026-04-23T00:00:00.000Z',
			updated_at: '2026-04-23T00:00:00.000Z'
		}));
		controlDbServiceMock.getActiveWorkspaceRegistryEntry.mockResolvedValue(null);
		invokeMock.mockImplementation(
			async (command: string, args: { input?: Record<string, unknown> }) => {
				if (command === 'create_workspace_command') {
					return {
						id: args.input?.workspaceId,
						customerId: args.input?.customerId,
						displayName: args.input?.displayName,
						slug: args.input?.slug,
						dbPath: `workspaces/${args.input?.workspaceId}/workspace.db`,
						vaultRootPath: `Kwantflow/workspaces/${args.input?.workspaceId}/vault`,
						isDefault: args.input?.isDefault,
						lastOpenedAt: args.input?.lastOpenedAt,
						created_at: '2026-04-23T00:00:00.000Z',
						updated_at: '2026-04-23T00:00:00.000Z'
					};
				}
				return undefined;
			}
		);
		dbServiceMock.getDatabasePath.mockReturnValue(null);
		dbServiceMock.adoptActiveWorkspace.mockImplementation((workspaceId: string) => {
			dbServiceMock.getDatabasePath.mockReturnValue(
				`sqlite:workspaces/${workspaceId}/workspace.db`
			);
		});
		dbServiceMock.init.mockResolvedValue(undefined);
		dbServiceMock.buildBootstrapFoundationCommandInput.mockImplementation((input) => ({
			workspaceId: input.workspaceId,
			displayName: input.displayName
		}));
		dbServiceMock.ensureDefaultClassificationSystem.mockResolvedValue(undefined);
		dbServiceMock.bootstrapWorkspaceFoundation.mockResolvedValue({
			workspaceIdentity: {
				id: 'workspace-acme',
				customerId: null,
				mode: 'local',
				bootstrapCompletedAt: '2026-04-23T00:00:00.000Z',
				onboardingCompletedAt: null,
				onboardingVersion: 1,
				workspaceRole: 'owner',
				workspaceLinkState: 'unlinked',
				created_at: '2026-04-23T00:00:00.000Z',
				updated_at: '2026-04-23T00:00:00.000Z'
			},
			workspaceProfile: {
				workspaceId: 'workspace-acme',
				displayName: 'Acme Fabrication',
				countryCode: 'AU',
				businessName: 'Acme Fabrication',
				logoFilePath: '',
				aiPlaybookText: '',
				businessIdLabel: 'ABN',
				businessIdValue: '12 345 678 901',
				taxIdLabel: 'GST',
				taxIdValue: '',
				taxDisplayLabel: 'GST',
				taxRatePercentage: 10,
				businessAddress: '',
				businessContactName: 'Sam Owner',
				businessContactFirstName: 'Sam',
				businessContactLastName: 'Owner',
				businessContactEmail: 'sam@acme.test',
				businessContactPhone: '+61 400 000 000',
				businessContactPhoneE164: '+61400000000',
				businessContactPhoneCountryCode: 'AU',
				currencyCode: 'AUD',
				currencySymbol: '$',
				measurementUnit: 'Metric',
				dateFormat: 'en-AU',
				languageLocale: 'en-AU',
				numberLocale: 'en-AU',
				quotePaymentTerms: 'Payment Terms: Due on receipt.',
				quoteValidityDays: 30,
				quoteDefaultInclusions: '',
				quoteDefaultExclusions: '',
				quoteDefaultTerms: '',
				quoteNumberPrefix: 'Q',
				quoteNumberFormat: '{prefix}-{yyyy}-{seq}',
				created_at: '2026-04-23T00:00:00.000Z',
				updated_at: '2026-04-23T00:00:00.000Z'
			},
			workspaceMember: {
				id: 'primary-member',
				workspaceId: 'workspace-acme',
				accountId: 'primary',
				role: 'owner',
				displayName: 'Sam Owner',
				firstName: 'Sam',
				lastName: 'Owner',
				email: 'sam@acme.test',
				avatarPath: '',
				isPrimary: true,
				joinedAt: '2026-04-23T00:00:00.000Z',
				created_at: '2026-04-23T00:00:00.000Z',
				updated_at: '2026-04-23T00:00:00.000Z'
			}
		});
		dbServiceMock.markWorkspaceOnboardingCompleted.mockResolvedValue('2026-04-23T00:00:00.000Z');
		workspaceStateMock.hydrate.mockResolvedValue(undefined);
		workspaceStateMock.refresh.mockResolvedValue(undefined);
		profileStateMock.refresh.mockResolvedValue(undefined);
	});

	it('starts at workspace setup when there is no saved local-first progress', async () => {
		const { onboardingState } = await import('./onboarding.svelte');

		await onboardingState.hydrate();

		expect(onboardingState.currentStep).toBe('workspace_setup');
		expect(onboardingState.shouldGateApp).toBe(true);
	});

	it('does not skip incomplete onboarding to ready just because a registry entry exists', async () => {
		controlDbServiceMock.getWorkspaceRegistry.mockResolvedValue([
			{
				id: 'stale-workspace',
				customerId: 'primary-customer',
				displayName: 'Stale Workspace',
				slug: 'stale-workspace',
				dbPath: 'workspaces/stale-workspace/workspace.db',
				vaultRootPath: 'Kwantflow/workspaces/stale-workspace/vault',
				isDefault: true,
				lastOpenedAt: null,
				created_at: '2026-04-23T00:00:00.000Z',
				updated_at: '2026-04-23T00:00:00.000Z'
			}
		]);
		controlDbServiceMock.getOnboardingState.mockResolvedValue({
			id: 'primary-onboarding',
			currentStep: 'ready',
			profileCompletedAt: null,
			firstWorkspaceCreatedAt: null,
			importDecidedAt: null,
			localAiDecidedAt: null,
			completedAt: null,
			activeWorkspaceId: 'stale-workspace',
			created_at: '2026-04-23T00:00:00.000Z',
			updated_at: '2026-04-23T00:00:00.000Z'
		});
		const { onboardingState } = await import('./onboarding.svelte');

		await onboardingState.hydrate();

		expect(onboardingState.currentStep).toBe('setup_import_optional');
		expect(onboardingState.shouldGateApp).toBe(true);
	});

	it('requires a workspace name before creating the first workspace', async () => {
		const { onboardingState } = await import('./onboarding.svelte');
		await onboardingState.hydrate();

		await expect(
			onboardingState.createWorkspace({
				workspaceName: '',
				countryCode: 'AU',
				businessName: 'Acme Fabrication',
				logoFilePath: '',
				businessContactFirstName: 'Sam',
				businessContactLastName: 'Owner',
				businessContactPhone: '+61 400 000 000',
				businessContactEmail: 'contact@acme.test',
				businessIdValue: '12 345 678 901',
				primaryOperatorRole: 'owner_founder',
				industry: 'Steel fabrication'
			})
		).rejects.toThrow('Workspace name is required.');
	});

	it('creates the first real workspace and advances to optional import', async () => {
		const { onboardingState } = await import('./onboarding.svelte');
		await onboardingState.hydrate();

		await onboardingState.createWorkspace({
			workspaceName: 'Acme Fabrication',
			countryCode: 'AU',
			businessName: 'Acme Fabrication',
			logoFilePath: '',
			businessContactFirstName: 'Sam',
			businessContactLastName: 'Owner',
			businessContactPhone: '+61 400 000 000',
			businessContactEmail: 'contact@acme.test',
			businessIdValue: '12 345 678 901',
			primaryOperatorRole: 'owner_founder',
			industry: 'Steel fabrication'
		});

		expect(invokeMock).toHaveBeenCalledWith(
			'create_workspace_command',
			expect.objectContaining({
				input: expect.objectContaining({
					displayName: 'Acme Fabrication',
					slug: 'acme-fabrication',
					isDefault: true
				})
			})
		);
		expect(dbServiceMock.adoptActiveWorkspace).toHaveBeenCalledWith(
			expect.stringMatching(/^acme-fabrication-[a-f0-9-]+$/)
		);
		expect(dbServiceMock.ensureDefaultClassificationSystem).toHaveBeenCalledTimes(1);
		expect(onboardingState.currentStep).toBe('setup_import_optional');
	});

	it('fails setup without creating a registry entry when native creation fails', async () => {
		const { onboardingState } = await import('./onboarding.svelte');
		await onboardingState.hydrate();
		invokeMock.mockRejectedValueOnce(
			new Error('table workspace_profile has no column named quote_payment_terms')
		);

		await expect(
			onboardingState.createWorkspace({
				workspaceName: 'Acme Fabrication',
				countryCode: 'AU',
				businessName: 'Acme Fabrication',
				logoFilePath: '',
				businessContactFirstName: 'Sam',
				businessContactLastName: 'Owner',
				businessContactPhone: '+61 400 000 000',
				businessContactEmail: 'contact@acme.test',
				businessIdValue: '12 345 678 901',
				primaryOperatorRole: 'owner_founder',
				industry: 'Steel fabrication'
			})
		).rejects.toThrow('quote_payment_terms');

		expect(dbServiceMock.adoptActiveWorkspace).not.toHaveBeenCalled();
		expect(onboardingState.currentStep).toBe('workspace_creation_failed');
	});

	it('shows a friendly setup failure message for closed-pool native failures', async () => {
		const { onboardingState } = await import('./onboarding.svelte');
		await onboardingState.hydrate();
		invokeMock.mockRejectedValueOnce(
			new Error('attempted to acquire a connection on a closed pool')
		);

		await expect(
			onboardingState.createWorkspace({
				workspaceName: 'Acme Fabrication',
				countryCode: 'AU',
				businessName: 'Acme Fabrication',
				logoFilePath: '',
				businessContactFirstName: 'Sam',
				businessContactLastName: 'Owner',
				businessContactPhone: '+61 400 000 000',
				businessContactEmail: 'contact@acme.test',
				businessIdValue: '12 345 678 901',
				primaryOperatorRole: 'owner_founder',
				industry: 'Steel fabrication'
			})
		).rejects.toThrow('closed pool');

		expect(dbServiceMock.adoptActiveWorkspace).not.toHaveBeenCalled();
		expect(onboardingState.bootstrapErrorMessage).toBe('We could not finish workspace setup.');
	});

	it('moves from optional import to optional local AI', async () => {
		const { onboardingState } = await import('./onboarding.svelte');
		await onboardingState.hydrate();
		onboardingState.currentStep = 'setup_import_optional';

		await onboardingState.completeSetupImportStep();

		expect(onboardingState.currentStep).toBe('local_ai_optional');
	});

	it.each([
		['database initialization', dbServiceMock.init],
		['classification initialization', dbServiceMock.ensureDefaultClassificationSystem],
		['workspace hydration', workspaceStateMock.hydrate],
		['progress persistence', controlDbServiceMock.upsertOnboardingState]
	])(
		'retries committed workspace setup after %s fails without creating another workspace',
		async (_stage, operation) => {
			const { onboardingState } = await import('./onboarding.svelte');
			await onboardingState.hydrate();
			operation.mockRejectedValueOnce(new Error('Synthetic post-create failure'));
			await expect(onboardingState.createWorkspace(validWorkspaceValues)).rejects.toThrow(
				'Synthetic post-create failure'
			);
			const committed = onboardingState.workspaceRegistry[0];
			expect(committed).toBeDefined();
			expect(onboardingState.activeWorkspaceId).toBe(committed.id);
			expect(onboardingState.hasPendingWorkspaceSetup).toBe(true);
			controlDbServiceMock.getWorkspaceRegistry.mockResolvedValue([committed]);
			controlDbServiceMock.getActiveWorkspaceRegistryEntry.mockResolvedValue(committed);
			await onboardingState.createWorkspace(validWorkspaceValues);
			expect(invokeMock).toHaveBeenCalledTimes(1);
			expect(onboardingState.currentStep).toBe('setup_import_optional');
			expect(onboardingState.activeWorkspaceId).toBe(committed.id);
		}
	);

	it('resumes committed setup after restart without requiring the cleared form or creating a duplicate', async () => {
		const { onboardingState } = await import('./onboarding.svelte');
		await onboardingState.hydrate();
		workspaceStateMock.hydrate.mockRejectedValueOnce(new Error('Synthetic post-create failure'));
		await expect(onboardingState.createWorkspace(validWorkspaceValues)).rejects.toThrow(
			'Synthetic post-create failure'
		);
		const committed = onboardingState.workspaceRegistry[0];
		controlDbServiceMock.getWorkspaceRegistry.mockResolvedValue([committed]);
		controlDbServiceMock.getActiveWorkspaceRegistryEntry.mockResolvedValue(committed);
		controlDbServiceMock.getOnboardingState.mockResolvedValue({
			currentStep: 'workspace_setup',
			activeWorkspaceId: committed.id
		});
		vi.resetModules();
		const restarted = (await import('./onboarding.svelte')).onboardingState;
		await restarted.hydrate();
		expect(restarted.hasPendingWorkspaceSetup).toBe(true);
		await restarted.createWorkspace(restarted.workspaceValues);
		expect(invokeMock).toHaveBeenCalledTimes(1);
		expect(restarted.currentStep).toBe('setup_import_optional');
		expect(restarted.activeWorkspaceId).toBe(committed.id);
	});

	it('stops when a committed workspace disappears from the registry instead of creating a replacement', async () => {
		const { onboardingState } = await import('./onboarding.svelte');
		onboardingState.activeWorkspaceId = 'missing-committed-workspace';
		await expect(onboardingState.createWorkspace(validWorkspaceValues)).rejects.toThrow(
			'missing from the local registry'
		);
		expect(invokeMock).not.toHaveBeenCalled();
	});

	it.each([
		['workspace completion', dbServiceMock.markWorkspaceOnboardingCompleted],
		['workspace refresh', workspaceStateMock.refresh]
	])(
		'does not persist final onboarding completion before %s succeeds',
		async (_stage, operation) => {
			const { onboardingState } = await import('./onboarding.svelte');
			onboardingState.currentStep = 'local_ai_optional';
			operation.mockRejectedValueOnce(new Error('Synthetic completion failure'));
			await expect(onboardingState.completeLocalAiStep()).rejects.toThrow(
				'Synthetic completion failure'
			);
			expect(controlDbServiceMock.upsertOnboardingState).not.toHaveBeenCalled();
			expect(onboardingState.currentStep).toBe('local_ai_optional');
			await onboardingState.completeLocalAiStep();
			expect(onboardingState.currentStep).toBe('ready');
		}
	);

	it('finishes local onboarding after the AI decision without registration', async () => {
		const { onboardingState } = await import('./onboarding.svelte');
		await onboardingState.hydrate();
		onboardingState.currentStep = 'local_ai_optional';
		await onboardingState.completeLocalAiStep();
		expect(onboardingState.currentStep).toBe('ready');
		expect(onboardingState.shouldGateApp).toBe(false);
	});
});
