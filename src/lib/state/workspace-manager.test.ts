import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();

const controlDbServiceMock = {
	getWorkspaceRegistry: vi.fn(),
	getWorkspaceRegistryEntry: vi.fn(),
	getActiveWorkspaceRegistryEntry: vi.fn(),
	upsertControlCustomerIdentity: vi.fn(),
	updateWorkspaceRegistryEntry: vi.fn()
};

let currentDatabasePath = 'sqlite:workspaces/workspace-1/workspace.db';

const dbServiceMock = {
	getDatabasePath: vi.fn(() => currentDatabasePath),
	adoptActiveWorkspace: vi.fn((workspaceId: string) => {
		currentDatabasePath = `sqlite:workspaces/${workspaceId}/workspace.db`;
	}),
	init: vi.fn(),
	buildBootstrapFoundationCommandInput: vi.fn(),
	ensureDefaultClassificationSystem: vi.fn(),
	bootstrapWorkspaceFoundation: vi.fn(),
	upsertCustomerIdentity: vi.fn()
};

const appStateMock = {
	boot: vi.fn()
};

const assistantStateMock = {
	resetForWorkspaceChange: vi.fn()
};

const integrationsStateMock = {
	resetForWorkspaceChange: vi.fn()
};

const profileStateMock = {
	firstName: 'Sam',
	lastName: 'Owner',
	email: 'sam@acme.test',
	phone: '+61 400 000 000'
};

const workspaceStateMock = {
	id: 'workspace-1',
	countryCode: 'AU'
};

vi.mock('$lib/services/control-db.js', () => ({
	controlDbService: controlDbServiceMock
}));

vi.mock('$lib/services/db.js', () => ({
	dbService: dbServiceMock
}));

vi.mock('@tauri-apps/api/core', () => ({
	invoke: invokeMock
}));

vi.mock('./app.svelte.js', () => ({
	appState: appStateMock
}));

vi.mock('./assistant.svelte.js', () => ({
	assistantState: assistantStateMock
}));

vi.mock('./integrations.svelte.js', () => ({
	integrationsState: integrationsStateMock
}));

vi.mock('./profile.svelte.js', () => ({
	profileState: profileStateMock
}));

vi.mock('./workspace.svelte.js', () => ({
	workspaceState: workspaceStateMock
}));

function createWorkspace(id: string, displayName: string, dbPath?: string) {
	return {
		id,
		customerId: 'primary-customer',
		displayName,
		slug: displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
		dbPath: dbPath ?? `workspaces/${id}/workspace.db`,
		vaultRootPath: `Kwantflow/workspaces/${id}/vault`,
		isDefault: id === 'workspace-1',
		lastOpenedAt: '2026-04-23T00:00:00.000Z',
		created_at: '2026-04-23T00:00:00.000Z',
		updated_at: '2026-04-23T00:00:00.000Z'
	};
}

describe('workspaceManagerState', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();

		workspaceStateMock.id = 'workspace-1';
		const first = createWorkspace('workspace-1', 'Default Workspace');
		const second = createWorkspace('workspace-2', 'Acme Fabrication');

		controlDbServiceMock.getWorkspaceRegistry.mockResolvedValue([first, second]);
		controlDbServiceMock.getActiveWorkspaceRegistryEntry.mockResolvedValue(first);
		controlDbServiceMock.getWorkspaceRegistryEntry.mockImplementation(
			async (workspaceId: string) => {
				return [first, second].find((workspace) => workspace.id === workspaceId) ?? null;
			}
		);
		controlDbServiceMock.upsertControlCustomerIdentity.mockResolvedValue({
			id: 'primary-customer',
			profileId: 'primary-profile',
			displayName: 'Acme Fabrication',
			created_at: '2026-04-23T00:00:00.000Z',
			updated_at: '2026-04-23T00:00:00.000Z'
		});
		controlDbServiceMock.updateWorkspaceRegistryEntry.mockImplementation(
			async (workspaceId, updates) => ({
				...(workspaceId === 'workspace-1' ? first : second),
				...updates,
				id: workspaceId,
				updated_at: '2026-04-23T00:00:00.000Z'
			})
		);
		currentDatabasePath = 'sqlite:workspaces/workspace-1/workspace.db';
		dbServiceMock.adoptActiveWorkspace.mockImplementation((workspaceId: string) => {
			currentDatabasePath = `sqlite:workspaces/${workspaceId}/workspace.db`;
		});
		dbServiceMock.init.mockResolvedValue(undefined);
		dbServiceMock.buildBootstrapFoundationCommandInput.mockImplementation((input) => ({
			workspaceId: input.workspaceId,
			displayName: input.displayName
		}));
		dbServiceMock.ensureDefaultClassificationSystem.mockResolvedValue(undefined);
		dbServiceMock.bootstrapWorkspaceFoundation.mockResolvedValue(undefined);
		invokeMock.mockImplementation(
			async (
				command: string,
				args: { input?: { workspaceId?: string } & Record<string, unknown> }
			) => {
				if (command === 'create_workspace_command') {
					const workspaceId = String(args.input?.workspaceId);
					return createWorkspace(workspaceId, String(args.input?.displayName ?? 'Workspace'));
				}
				if (command === 'activate_workspace_command') {
					return (
						[first, second].find((workspace) => workspace.id === args.input?.workspaceId) ?? null
					);
				}
				if (command === 'delete_workspace_command') {
					return (
						[first, second].find((workspace) => workspace.id !== args.input?.workspaceId) ?? null
					);
				}
				return undefined;
			}
		);
		appStateMock.boot.mockResolvedValue(undefined);
		integrationsStateMock.resetForWorkspaceChange.mockResolvedValue(undefined);
	});

	it('hydrates the workspace registry and active workspace', async () => {
		const { workspaceManagerState } = await import('./workspace-manager.svelte');

		await workspaceManagerState.hydrate();

		expect(workspaceManagerState.workspaces).toHaveLength(2);
		expect(workspaceManagerState.activeWorkspaceId).toBe('workspace-1');
		expect(workspaceManagerState.canDeleteWorkspace).toBe(true);
	});

	it('requires a workspace name before creating another workspace', async () => {
		const { workspaceManagerState } = await import('./workspace-manager.svelte');
		await workspaceManagerState.hydrate();

		await expect(
			workspaceManagerState.createWorkspace({
				workspaceName: '',
				countryCode: 'AU',
				businessName: 'North Yard Fabrication',
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

	it('creates additional local workspaces', async () => {
		const { workspaceManagerState } = await import('./workspace-manager.svelte');
		await workspaceManagerState.hydrate();

		await expect(
			workspaceManagerState.createWorkspace({
				workspaceName: 'North Yard',
				countryCode: 'AU',
				businessName: 'North Yard Fabrication',
				logoFilePath: '',
				businessContactFirstName: 'Sam',
				businessContactLastName: 'Owner',
				businessContactPhone: '+61 400 000 000',
				businessContactEmail: 'contact@acme.test',
				businessIdValue: '12 345 678 901',
				primaryOperatorRole: 'owner_founder',
				industry: 'Steel fabrication'
			})
		).resolves.toBeTruthy();
		expect(invokeMock).toHaveBeenCalledWith('create_workspace_command', expect.anything());
	});

	it('marks the first local workspace as the default', async () => {
		controlDbServiceMock.getWorkspaceRegistry.mockResolvedValue([]);
		controlDbServiceMock.getActiveWorkspaceRegistryEntry.mockResolvedValue(null);
		const { workspaceManagerState } = await import('./workspace-manager.svelte');
		await workspaceManagerState.hydrate();

		await workspaceManagerState.createWorkspace({
			workspaceName: 'First Yard',
			countryCode: 'AU',
			businessName: 'First Yard Fabrication',
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
			expect.objectContaining({ input: expect.objectContaining({ isDefault: true }) })
		);
	});

	it('creates a new workspace from the onboarding-derived payload', async () => {
		const { workspaceManagerState } = await import('./workspace-manager.svelte');
		await workspaceManagerState.hydrate();

		await workspaceManagerState.createWorkspace({
			workspaceName: 'North Yard',
			countryCode: 'AU',
			businessName: 'North Yard Fabrication',
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
					displayName: 'North Yard',
					foundation: expect.objectContaining({
						displayName: 'North Yard'
					})
				})
			})
		);
		expect(dbServiceMock.ensureDefaultClassificationSystem).toHaveBeenCalledTimes(1);
		expect(appStateMock.boot).toHaveBeenCalledTimes(1);
	});

	it('leaves the active workspace unchanged when native workspace creation fails', async () => {
		const { workspaceManagerState } = await import('./workspace-manager.svelte');
		await workspaceManagerState.hydrate();
		invokeMock.mockRejectedValueOnce(new Error('workspace bootstrap failed'));

		await expect(
			workspaceManagerState.createWorkspace({
				workspaceName: 'North Yard',
				countryCode: 'AU',
				businessName: 'North Yard Fabrication',
				logoFilePath: '',
				businessContactFirstName: 'Sam',
				businessContactLastName: 'Owner',
				businessContactPhone: '+61 400 000 000',
				businessContactEmail: 'contact@acme.test',
				businessIdValue: '12 345 678 901',
				primaryOperatorRole: 'owner_founder',
				industry: 'Steel fabrication'
			})
		).rejects.toThrow('workspace bootstrap failed');

		expect(dbServiceMock.adoptActiveWorkspace).not.toHaveBeenCalled();
		expect(dbServiceMock.getDatabasePath()).toBe('sqlite:workspaces/workspace-1/workspace.db');
	});

	it('switches the active workspace through the real database boundary', async () => {
		const { workspaceManagerState } = await import('./workspace-manager.svelte');
		await workspaceManagerState.hydrate();

		await workspaceManagerState.switchWorkspace('workspace-2');

		expect(invokeMock).toHaveBeenCalledWith('activate_workspace_command', {
			input: { workspaceId: 'workspace-2' }
		});
		expect(dbServiceMock.adoptActiveWorkspace).toHaveBeenCalledWith('workspace-2');
		expect(assistantStateMock.resetForWorkspaceChange).toHaveBeenCalledTimes(1);
		expect(integrationsStateMock.resetForWorkspaceChange).toHaveBeenCalledTimes(1);
		expect(appStateMock.boot).toHaveBeenCalledTimes(1);
	});

	it('blocks deleting the final remaining workspace', async () => {
		const first = createWorkspace('workspace-1', 'Default Workspace');
		controlDbServiceMock.getWorkspaceRegistry.mockResolvedValue([first]);
		controlDbServiceMock.getActiveWorkspaceRegistryEntry.mockResolvedValue(first);
		controlDbServiceMock.getWorkspaceRegistryEntry.mockResolvedValue(first);
		const { workspaceManagerState } = await import('./workspace-manager.svelte');
		await workspaceManagerState.hydrate();

		await expect(
			workspaceManagerState.deleteWorkspace('workspace-1', 'Default Workspace')
		).rejects.toThrow('At least one workspace is required.');
	});

	it('deletes the active workspace only after switching to another workspace', async () => {
		const { workspaceManagerState } = await import('./workspace-manager.svelte');
		await workspaceManagerState.hydrate();

		await workspaceManagerState.deleteWorkspace('workspace-1', 'Default Workspace');

		expect(invokeMock).toHaveBeenCalledWith('delete_workspace_command', {
			input: { workspaceId: 'workspace-1' }
		});
		expect(dbServiceMock.adoptActiveWorkspace).toHaveBeenCalledWith('workspace-2');
		expect(appStateMock.boot).toHaveBeenCalledTimes(1);
	});
});
