import { dbService } from '$lib/services/db';
import { controlDbService } from '$lib/services/control-db.js';
import { createLogger } from '$lib/services/logger.js';
import { getAppLocalFileUrl, isAbsoluteLocalPath, storeAccountAvatar } from '$lib/services/assets';
import type { AccountIdentity, ProfileIdentity } from '$lib/types/index.js';

const DEFAULT_ACCOUNT: AccountIdentity = {
	id: 'primary',
	accountName: '',
	accountEmail: '',
	phone: '',
	avatarPath: '',
	created_at: '',
	updated_at: ''
};

const log = createLogger('accountState');

class AccountState {
	private lastAvatarObjectUrl: string | null = null;

	id: string = $state(DEFAULT_ACCOUNT.id);
	accountName: string = $state(DEFAULT_ACCOUNT.accountName);
	accountEmail: string = $state(DEFAULT_ACCOUNT.accountEmail);
	phone: string = $state(DEFAULT_ACCOUNT.phone);
	avatarPath: string = $state(DEFAULT_ACCOUNT.avatarPath);
	avatarUrl: string = $state('');
	created_at: string = $state(DEFAULT_ACCOUNT.created_at);
	updated_at: string = $state(DEFAULT_ACCOUNT.updated_at);
	isHydrated = $state(false);

	private async syncAvatarUrl(): Promise<void> {
		if (this.lastAvatarObjectUrl) {
			URL.revokeObjectURL(this.lastAvatarObjectUrl);
			this.lastAvatarObjectUrl = null;
		}
		this.avatarUrl = this.avatarPath ? await getAppLocalFileUrl(this.avatarPath) : '';
		if (this.avatarUrl.startsWith('blob:')) {
			this.lastAvatarObjectUrl = this.avatarUrl;
		}
	}

	private applyAccount(account: AccountIdentity | null, profile?: ProfileIdentity | null): void {
		const next = account ?? DEFAULT_ACCOUNT;
		this.id = next.id;
		this.accountName = next.accountName || profile?.displayName || '';
		this.accountEmail = next.accountEmail || profile?.email || '';
		this.phone = next.phone || profile?.phone || '';
		this.avatarPath = next.avatarPath;
		this.created_at = next.created_at || profile?.created_at || '';
		this.updated_at = next.updated_at || profile?.updated_at || '';
		void this.syncAvatarUrl();
	}

	async hydrate(options: { includeWorkspaceMember?: boolean } = {}): Promise<void> {
		try {
			const hasActiveDb = dbService.getDatabasePath() !== null;
			const includeWorkspaceMember = (options.includeWorkspaceMember ?? true) && hasActiveDb;
			const [profile, member] = await Promise.all([
				controlDbService.getProfileIdentity(),
				includeWorkspaceMember
					? dbService.getPrimaryWorkspaceMember().catch(() => null)
					: Promise.resolve(null)
			]);

			this.applyAccount(null, profile);

			this.avatarPath = member?.avatarPath ?? '';
			void this.syncAvatarUrl();

			log.info('Hydrated account state', {
				hasAvatar: this.avatarPath.length > 0
			});
		} finally {
			this.isHydrated = true;
		}
	}

	async refresh(): Promise<void> {
		const hasActiveDb = dbService.getDatabasePath() !== null;
		const [profile, member] = await Promise.all([
			controlDbService.getProfileIdentity(),
			hasActiveDb ? dbService.getPrimaryWorkspaceMember().catch(() => null) : Promise.resolve(null)
		]);

		this.applyAccount(null, profile);

		this.avatarPath = member?.avatarPath ?? '';
		void this.syncAvatarUrl();

		log.info('Refreshed account state', {
			hasAvatar: this.avatarPath.length > 0
		});
	}

	async storeAvatar(sourcePath: string): Promise<string> {
		log.info('Storing account avatar', {
			accountId: this.id || DEFAULT_ACCOUNT.id,
			sourcePathType: isAbsoluteLocalPath(sourcePath) ? 'absolute' : 'relative'
		});
		const storedPath = isAbsoluteLocalPath(sourcePath)
			? await storeAccountAvatar(this.id || DEFAULT_ACCOUNT.id, sourcePath)
			: sourcePath;
		if (dbService.getDatabasePath() !== null) {
			await dbService
				.updatePrimaryWorkspaceMember({
					displayName: this.accountName,
					email: this.accountEmail,
					avatarPath: storedPath
				})
				.catch((error) =>
					log.warn('Failed to update primary workspace member during avatar store', {
						error: String(error)
					})
				);
		}
		await this.refresh();
		log.info('Stored account avatar', {
			accountId: this.id || DEFAULT_ACCOUNT.id,
			storedPath
		});
		return storedPath;
	}

	async update(
		updates: Partial<Pick<AccountIdentity, 'accountEmail' | 'phone' | 'avatarPath'>>
	): Promise<void> {
		log.info('Updating account state', {
			accountId: this.id,
			updatedFields: Object.keys(updates)
		});
		const nextAvatarPath =
			updates.avatarPath && isAbsoluteLocalPath(updates.avatarPath)
				? await this.storeAvatar(updates.avatarPath)
				: updates.avatarPath;

		const nextAccountEmail = updates.accountEmail ?? this.accountEmail;
		const nextPhone = updates.phone ?? this.phone;
		await controlDbService.upsertProfileIdentity({
			displayName: this.accountName,
			email: nextAccountEmail,
			phone: nextPhone
		});
		if (dbService.getDatabasePath() !== null) {
			await dbService
				.updatePrimaryWorkspaceMember({
					displayName: this.accountName,
					email: nextAccountEmail,
					avatarPath: nextAvatarPath ?? this.avatarPath
				})
				.catch((error) =>
					log.warn('Failed to update primary workspace member during update', {
						error: String(error)
					})
				);
		}
		await this.refresh();
	}

	reset(): void {
		this.applyAccount(null);
		this.isHydrated = false;
	}
}

export const accountState = new AccountState();
