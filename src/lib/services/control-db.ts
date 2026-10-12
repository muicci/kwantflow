import { NativeDatabase } from './native-database.js';
import {
	ControlCustomerIdentityRowSchema,
	ControlCustomerIdentitySchema,
	OnboardingStateRowSchema,
	OnboardingStateSchema,
	ProfileIdentityRowSchema,
	ProfileIdentitySchema,
	WorkspaceRegistryRowSchema,
	WorkspaceRegistrySchema
} from '$lib/schemas/index.js';
import type {
	ControlCustomerIdentity,
	OnboardingStateSnapshot,
	ProfileIdentity,
	WorkspaceRegistryEntry
} from '$lib/types/index.js';
import { createLogger } from './logger.js';
import { isTauri } from '$lib/utils/env.js';
import { resolvePersonNameParts } from '$lib/utils/person-name.js';

const log = createLogger('controlDbService');

const DEFAULT_PROFILE: ProfileIdentity = {
	id: 'primary-profile',
	displayName: '',
	firstName: '',
	lastName: '',
	email: null,
	phone: null,
	created_at: '',
	updated_at: ''
};

const DEFAULT_CUSTOMER: ControlCustomerIdentity = {
	id: 'primary-customer',
	profileId: 'primary-profile',
	displayName: '',
	created_at: '',
	updated_at: ''
};

const DEFAULT_ONBOARDING_STATE: OnboardingStateSnapshot = {
	id: 'primary-onboarding',
	currentStep: 'workspace_setup',
	profileCompletedAt: null,
	firstWorkspaceCreatedAt: null,
	importDecidedAt: null,
	localAiDecidedAt: null,
	completedAt: null,
	activeWorkspaceId: null,
	created_at: '',
	updated_at: ''
};

export function mergeOnboardingStateSnapshot(
	current: OnboardingStateSnapshot | null | undefined,
	updates: Partial<Omit<OnboardingStateSnapshot, 'id' | 'created_at' | 'updated_at'>>
): OnboardingStateSnapshot {
	const base = current ?? DEFAULT_ONBOARDING_STATE;
	return {
		...base,
		currentStep: updates.currentStep ?? base.currentStep,
		profileCompletedAt:
			updates.profileCompletedAt !== undefined
				? updates.profileCompletedAt
				: (base.profileCompletedAt ?? null),
		firstWorkspaceCreatedAt:
			updates.firstWorkspaceCreatedAt !== undefined
				? updates.firstWorkspaceCreatedAt
				: (base.firstWorkspaceCreatedAt ?? null),
		importDecidedAt:
			updates.importDecidedAt !== undefined
				? updates.importDecidedAt
				: (base.importDecidedAt ?? null),
		localAiDecidedAt:
			updates.localAiDecidedAt !== undefined
				? updates.localAiDecidedAt
				: (base.localAiDecidedAt ?? null),
		completedAt:
			updates.completedAt !== undefined ? updates.completedAt : (base.completedAt ?? null),
		activeWorkspaceId:
			updates.activeWorkspaceId !== undefined
				? updates.activeWorkspaceId
				: (base.activeWorkspaceId ?? null)
	};
}

class ControlDatabaseService {
	private db: NativeDatabase | null = null;
	private initPromise: Promise<void> | null = null;

	private async withDatabase<T>(fn: (db: NativeDatabase) => Promise<T>): Promise<T> {
		await this.init();
		if (!this.db) {
			throw new Error('Control database is not initialised');
		}
		return await fn(this.db);
	}

	private mapProfileIdentity(row: unknown): ProfileIdentity {
		const parsed = ProfileIdentityRowSchema.parse(row);
		const name = resolvePersonNameParts({
			firstName: parsed.first_name,
			lastName: parsed.last_name,
			displayName: parsed.display_name
		});
		return ProfileIdentitySchema.parse({
			id: parsed.id,
			displayName: name.displayName,
			firstName: name.firstName,
			lastName: name.lastName,
			email: parsed.email,
			phone: parsed.phone,
			created_at: parsed.created_at,
			updated_at: parsed.updated_at
		});
	}

	private mapControlCustomerIdentity(row: unknown): ControlCustomerIdentity {
		const parsed = ControlCustomerIdentityRowSchema.parse(row);
		return ControlCustomerIdentitySchema.parse({
			id: parsed.id,
			profileId: parsed.profile_id,
			displayName: parsed.display_name,
			created_at: parsed.created_at,
			updated_at: parsed.updated_at
		});
	}

	private mapWorkspaceRegistryEntry(row: unknown): WorkspaceRegistryEntry {
		const parsed = WorkspaceRegistryRowSchema.parse(row);
		return WorkspaceRegistrySchema.parse({
			id: parsed.id,
			customerId: parsed.customer_id,
			displayName: parsed.display_name,
			slug: parsed.slug,
			dbPath: parsed.db_path,
			vaultRootPath: parsed.vault_root_path,
			isDefault: parsed.is_default,
			lastOpenedAt: parsed.last_opened_at,
			created_at: parsed.created_at,
			updated_at: parsed.updated_at
		});
	}

	private mapOnboardingState(row: unknown): OnboardingStateSnapshot {
		const parsed = OnboardingStateRowSchema.parse(row);
		return OnboardingStateSchema.parse({
			id: parsed.id,
			currentStep: parsed.current_step,
			profileCompletedAt: parsed.profile_completed_at,
			firstWorkspaceCreatedAt: parsed.first_workspace_created_at,
			importDecidedAt: parsed.import_decided_at,
			localAiDecidedAt: parsed.local_ai_decided_at,
			completedAt: parsed.completed_at,
			activeWorkspaceId: parsed.active_workspace_id,
			created_at: parsed.created_at,
			updated_at: parsed.updated_at
		});
	}

	async init(): Promise<void> {
		if (this.db) return;
		if (this.initPromise) return await this.initPromise;
		if (!isTauri()) return;

		this.initPromise = (async () => {
			this.db = new NativeDatabase('control');
			log.info('Control database initialised.');
		})();

		try {
			await this.initPromise;
		} finally {
			this.initPromise = null;
		}
	}

	async getProfileIdentity(): Promise<ProfileIdentity | null> {
		if (!isTauri()) return null;
		return await this.withDatabase(async (db) => {
			const rows = await db.select<Array<Record<string, unknown>>>(
				'SELECT * FROM profile_identity WHERE id = $1 LIMIT 1',
				['primary-profile']
			);
			return rows[0] ? this.mapProfileIdentity(rows[0]) : null;
		});
	}

	async upsertProfileIdentity(
		updates: Partial<
			Pick<ProfileIdentity, 'displayName' | 'firstName' | 'lastName' | 'email' | 'phone'>
		>
	): Promise<ProfileIdentity> {
		const name = resolvePersonNameParts({
			firstName: updates.firstName,
			lastName: updates.lastName,
			displayName: updates.displayName
		});
		if (!isTauri()) {
			return {
				...DEFAULT_PROFILE,
				...updates,
				displayName: name.displayName,
				firstName: name.firstName,
				lastName: name.lastName,
				email: updates.email ?? DEFAULT_PROFILE.email,
				phone: updates.phone ?? DEFAULT_PROFILE.phone
			};
		}

		return await this.withDatabase(async (db) => {
			await db.execute(
				`INSERT INTO profile_identity (id, display_name, first_name, last_name, email, phone)
				 VALUES ($1, $2, $3, $4, $5, $6)
				 ON CONFLICT(id) DO UPDATE SET
					display_name = excluded.display_name,
					first_name = excluded.first_name,
					last_name = excluded.last_name,
					email = excluded.email,
					phone = excluded.phone,
					updated_at = CURRENT_TIMESTAMP`,
				[
					'primary-profile',
					name.displayName,
					name.firstName,
					name.lastName,
					updates.email ?? null,
					updates.phone ?? null
				]
			);

			const profile = await this.getProfileIdentity();
			if (!profile) throw new Error('Profile identity missing after update.');
			return profile;
		});
	}

	async getControlCustomerIdentity(): Promise<ControlCustomerIdentity | null> {
		if (!isTauri()) return null;
		return await this.withDatabase(async (db) => {
			const rows = await db.select<Array<Record<string, unknown>>>(
				'SELECT * FROM control_customer_identity WHERE id = $1 LIMIT 1',
				['primary-customer']
			);
			return rows[0] ? this.mapControlCustomerIdentity(rows[0]) : null;
		});
	}

	async upsertControlCustomerIdentity(
		updates: Partial<Pick<ControlCustomerIdentity, 'displayName'>>
	): Promise<ControlCustomerIdentity> {
		if (!isTauri()) {
			return {
				...DEFAULT_CUSTOMER,
				...updates,
				displayName: updates.displayName ?? DEFAULT_CUSTOMER.displayName
			};
		}

		return await this.withDatabase(async (db) => {
			await db.execute(
				`INSERT INTO profile_identity (id, display_name)
				 VALUES ($1, $2)
				 ON CONFLICT(id) DO NOTHING`,
				['primary-profile', '']
			);

			await db.execute(
				`INSERT INTO control_customer_identity (id, profile_id, display_name)
				 VALUES ($1, $2, $3)
				 ON CONFLICT(id) DO UPDATE SET
					profile_id = excluded.profile_id,
					display_name = excluded.display_name,
					updated_at = CURRENT_TIMESTAMP`,
				['primary-customer', 'primary-profile', updates.displayName ?? DEFAULT_CUSTOMER.displayName]
			);

			const customer = await this.getControlCustomerIdentity();
			if (!customer) throw new Error('Control customer identity missing after update.');
			return customer;
		});
	}

	async getWorkspaceRegistry(): Promise<WorkspaceRegistryEntry[]> {
		if (!isTauri()) return [];
		return await this.withDatabase(async (db) => {
			const rows = await db.select<Array<Record<string, unknown>>>(
				'SELECT * FROM workspace_registry ORDER BY is_default DESC, created_at ASC'
			);
			return rows.map((row) => this.mapWorkspaceRegistryEntry(row));
		});
	}

	async getWorkspaceRegistryEntry(workspaceId: string): Promise<WorkspaceRegistryEntry | null> {
		if (!isTauri()) return null;
		return await this.withDatabase(async (db) => {
			const rows = await db.select<Array<Record<string, unknown>>>(
				'SELECT * FROM workspace_registry WHERE id = $1 LIMIT 1',
				[workspaceId]
			);
			return rows[0] ? this.mapWorkspaceRegistryEntry(rows[0]) : null;
		});
	}

	async updateWorkspaceRegistryEntry(
		workspaceId: string,
		updates: Partial<Pick<WorkspaceRegistryEntry, 'displayName' | 'slug'>>
	): Promise<WorkspaceRegistryEntry> {
		const current = await this.getWorkspaceRegistryEntry(workspaceId);
		if (!current) {
			throw new Error('Workspace registry entry not found.');
		}

		return await this.withDatabase(async (db) => {
			await db.execute(
				`UPDATE workspace_registry
				 SET display_name = $1, slug = $2, updated_at = CURRENT_TIMESTAMP
				 WHERE id = $3`,
				[updates.displayName ?? current.displayName, updates.slug ?? current.slug, workspaceId]
			);
			const updated = await this.getWorkspaceRegistryEntry(workspaceId);
			if (!updated) throw new Error('Workspace registry entry missing after update.');
			return updated;
		});
	}

	async getOnboardingState(): Promise<OnboardingStateSnapshot | null> {
		if (!isTauri()) return null;
		return await this.withDatabase(async (db) => {
			const rows = await db.select<Array<Record<string, unknown>>>(
				'SELECT * FROM onboarding_state WHERE id = $1 LIMIT 1',
				['primary-onboarding']
			);
			return rows[0] ? this.mapOnboardingState(rows[0]) : null;
		});
	}

	async upsertOnboardingState(
		updates: Partial<Omit<OnboardingStateSnapshot, 'id' | 'created_at' | 'updated_at'>>
	): Promise<OnboardingStateSnapshot> {
		if (!isTauri()) {
			return {
				...DEFAULT_ONBOARDING_STATE,
				...updates,
				currentStep: updates.currentStep ?? DEFAULT_ONBOARDING_STATE.currentStep
			};
		}

		return await this.withDatabase(async (db) => {
			const mergedState = mergeOnboardingStateSnapshot(await this.getOnboardingState(), updates);
			await db.execute(
				`INSERT INTO onboarding_state (
					id,
					current_step,
					profile_completed_at,
					first_workspace_created_at,
					import_decided_at,
					local_ai_decided_at,
					completed_at,
					active_workspace_id
				) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
				ON CONFLICT(id) DO UPDATE SET
					current_step = excluded.current_step,
					profile_completed_at = excluded.profile_completed_at,
					first_workspace_created_at = excluded.first_workspace_created_at,
					import_decided_at = excluded.import_decided_at,
					local_ai_decided_at = excluded.local_ai_decided_at,
					completed_at = excluded.completed_at,
					active_workspace_id = excluded.active_workspace_id,
					updated_at = CURRENT_TIMESTAMP`,
				[
					'primary-onboarding',
					mergedState.currentStep,
					mergedState.profileCompletedAt ?? null,
					mergedState.firstWorkspaceCreatedAt ?? null,
					mergedState.importDecidedAt ?? null,
					mergedState.localAiDecidedAt ?? null,
					mergedState.completedAt ?? null,
					mergedState.activeWorkspaceId ?? null
				]
			);

			const state = await this.getOnboardingState();
			if (!state) throw new Error('Onboarding state missing after update.');
			return state;
		});
	}

	async getActiveWorkspaceRegistryEntry(): Promise<WorkspaceRegistryEntry | null> {
		const [onboarding, registry] = await Promise.all([
			this.getOnboardingState(),
			this.getWorkspaceRegistry()
		]);
		if (registry.length === 0) return null;

		if (onboarding?.activeWorkspaceId) {
			const active = registry.find((entry) => entry.id === onboarding.activeWorkspaceId);
			if (active) return active;
		}

		return registry.find((entry) => entry.isDefault) ?? registry[0] ?? null;
	}
}

export const controlDbService = new ControlDatabaseService();
