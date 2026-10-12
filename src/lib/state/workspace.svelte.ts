import { controlDbService } from '$lib/services/control-db.js';
import { dbService } from '$lib/services/db';
import { createLogger } from '$lib/services/logger.js';
import { sanitiseBusinessNameCandidate } from '$lib/utils/workspace-naming.js';
import type {
	WorkspaceIdentity,
	WorkspaceMember,
	WorkspaceOnboardingProfile,
	WorkspaceProfile
} from '$lib/types/index.js';

const DEFAULT_WORKSPACE_IDENTITY: WorkspaceIdentity = {
	id: 'local-workspace',
	bootstrapCompletedAt: null,
	onboardingCompletedAt: null,
	onboardingVersion: 1,
	workspaceRole: 'owner',
	created_at: '',
	updated_at: ''
};

const DEFAULT_WORKSPACE_PROFILE: WorkspaceProfile = {
	workspaceId: 'local-workspace',
	displayName: 'Workspace',
	countryCode: 'AU',
	businessName: '',
	logoFilePath: '',
	aiPlaybookText: '',
	emailSignature: '',
	businessIdLabel: 'ABN',
	businessIdValue: '',
	taxIdLabel: 'GST',
	taxIdValue: '',
	taxDisplayLabel: 'GST',
	taxRatePercentage: 10,
	businessAddress: '',
	businessContactName: '',
	businessContactFirstName: '',
	businessContactLastName: '',
	businessContactEmail: '',
	businessContactPhone: '',
	businessContactPhoneE164: '',
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
	created_at: '',
	updated_at: ''
};

const DEFAULT_WORKSPACE_ONBOARDING_PROFILE: WorkspaceOnboardingProfile = {
	workspaceId: 'local-workspace',
	primaryOperatorRole: 'owner_founder',
	industry: '',
	created_at: '',
	updated_at: ''
};

const DEFAULT_WORKSPACE_MEMBER: WorkspaceMember = {
	id: 'primary-member',
	workspaceId: 'local-workspace',
	role: 'owner',
	displayName: '',
	firstName: '',
	lastName: '',
	email: '',
	avatarPath: '',
	isPrimary: true,
	joinedAt: '',
	created_at: '',
	updated_at: ''
};

const log = createLogger('workspaceState');

class WorkspaceState {
	id: string = $state(DEFAULT_WORKSPACE_IDENTITY.id);
	bootstrapCompletedAt: string | null = $state(
		DEFAULT_WORKSPACE_IDENTITY.bootstrapCompletedAt ?? null
	);
	onboardingCompletedAt: string | null = $state(
		DEFAULT_WORKSPACE_IDENTITY.onboardingCompletedAt ?? null
	);
	onboardingVersion: number = $state(DEFAULT_WORKSPACE_IDENTITY.onboardingVersion);
	workspaceRole: WorkspaceIdentity['workspaceRole'] = $state(
		DEFAULT_WORKSPACE_IDENTITY.workspaceRole ?? null
	);
	displayName: string = $state(DEFAULT_WORKSPACE_PROFILE.displayName);
	countryCode: string = $state(DEFAULT_WORKSPACE_PROFILE.countryCode);
	businessName: string = $state(DEFAULT_WORKSPACE_PROFILE.businessName);
	logoFilePath: string = $state(DEFAULT_WORKSPACE_PROFILE.logoFilePath);
	businessIdLabel: string = $state(DEFAULT_WORKSPACE_PROFILE.businessIdLabel);
	businessIdValue: string = $state(DEFAULT_WORKSPACE_PROFILE.businessIdValue);
	taxIdLabel: string = $state(DEFAULT_WORKSPACE_PROFILE.taxIdLabel);
	taxIdValue: string = $state(DEFAULT_WORKSPACE_PROFILE.taxIdValue);
	taxDisplayLabel: string = $state(DEFAULT_WORKSPACE_PROFILE.taxDisplayLabel);
	taxRatePercentage: number = $state(DEFAULT_WORKSPACE_PROFILE.taxRatePercentage);
	businessAddress: string = $state(DEFAULT_WORKSPACE_PROFILE.businessAddress);
	businessContactName: string = $state(DEFAULT_WORKSPACE_PROFILE.businessContactName);
	businessContactFirstName: string = $state(
		DEFAULT_WORKSPACE_PROFILE.businessContactFirstName ?? ''
	);
	businessContactLastName: string = $state(DEFAULT_WORKSPACE_PROFILE.businessContactLastName ?? '');
	businessContactEmail: string = $state(DEFAULT_WORKSPACE_PROFILE.businessContactEmail);
	businessContactPhone: string = $state(DEFAULT_WORKSPACE_PROFILE.businessContactPhone);
	businessContactPhoneE164: string = $state(DEFAULT_WORKSPACE_PROFILE.businessContactPhoneE164);
	businessContactPhoneCountryCode: string = $state(
		DEFAULT_WORKSPACE_PROFILE.businessContactPhoneCountryCode
	);
	currencyCode: string = $state(DEFAULT_WORKSPACE_PROFILE.currencyCode);
	currencySymbol: string = $state(DEFAULT_WORKSPACE_PROFILE.currencySymbol);
	measurementUnit: WorkspaceProfile['measurementUnit'] = $state(
		DEFAULT_WORKSPACE_PROFILE.measurementUnit
	);
	aiPlaybookText: string = $state(DEFAULT_WORKSPACE_PROFILE.aiPlaybookText);
	emailSignature: string = $state(DEFAULT_WORKSPACE_PROFILE.emailSignature);
	dateFormat: string = $state(DEFAULT_WORKSPACE_PROFILE.dateFormat);
	languageLocale: string = $state(DEFAULT_WORKSPACE_PROFILE.languageLocale);
	numberLocale: string = $state(DEFAULT_WORKSPACE_PROFILE.numberLocale);
	quotePaymentTerms: string = $state(DEFAULT_WORKSPACE_PROFILE.quotePaymentTerms);
	quoteValidityDays: number = $state(DEFAULT_WORKSPACE_PROFILE.quoteValidityDays);
	quoteDefaultInclusions: string = $state(DEFAULT_WORKSPACE_PROFILE.quoteDefaultInclusions);
	quoteDefaultExclusions: string = $state(DEFAULT_WORKSPACE_PROFILE.quoteDefaultExclusions);
	quoteDefaultTerms: string = $state(DEFAULT_WORKSPACE_PROFILE.quoteDefaultTerms);
	quoteNumberPrefix: string = $state(DEFAULT_WORKSPACE_PROFILE.quoteNumberPrefix);
	quoteNumberFormat: string = $state(DEFAULT_WORKSPACE_PROFILE.quoteNumberFormat);
	primaryOperatorRole: WorkspaceOnboardingProfile['primaryOperatorRole'] = $state(
		DEFAULT_WORKSPACE_ONBOARDING_PROFILE.primaryOperatorRole
	);
	industry: string = $state(DEFAULT_WORKSPACE_ONBOARDING_PROFILE.industry);
	memberId: string = $state(DEFAULT_WORKSPACE_MEMBER.id);
	memberRole: WorkspaceMember['role'] = $state(DEFAULT_WORKSPACE_MEMBER.role);
	memberDisplayName: string = $state(DEFAULT_WORKSPACE_MEMBER.displayName);
	memberFirstName: string = $state(DEFAULT_WORKSPACE_MEMBER.firstName ?? '');
	memberLastName: string = $state(DEFAULT_WORKSPACE_MEMBER.lastName ?? '');
	memberEmail: string = $state(DEFAULT_WORKSPACE_MEMBER.email);
	memberAvatarPath: string = $state(DEFAULT_WORKSPACE_MEMBER.avatarPath);
	created_at: string = $state('');
	updated_at: string = $state('');
	isHydrated = $state(false);

	needsBootstrap: boolean = $derived(!this.bootstrapCompletedAt);
	needsOnboardingCompletion: boolean = $derived(!this.onboardingCompletedAt);
	needsProfileCompletion: boolean = $derived(!this.displayName.trim());

	private applyWorkspaceIdentity(workspace: WorkspaceIdentity | null): void {
		const next = workspace ?? DEFAULT_WORKSPACE_IDENTITY;
		this.id = next.id;
		this.bootstrapCompletedAt = next.bootstrapCompletedAt ?? null;
		this.onboardingCompletedAt = next.onboardingCompletedAt ?? null;
		this.onboardingVersion = next.onboardingVersion;
		this.workspaceRole = next.workspaceRole ?? null;
		this.created_at = next.created_at;
		this.updated_at = next.updated_at;
	}

	private applyWorkspaceProfile(profile: WorkspaceProfile | null): void {
		const next = profile ?? DEFAULT_WORKSPACE_PROFILE;
		this.displayName = next.displayName;
		this.countryCode = next.countryCode;
		this.businessName = sanitiseBusinessNameCandidate(next.businessName, next.displayName);
		this.logoFilePath = next.logoFilePath;
		this.aiPlaybookText = next.aiPlaybookText;
		this.emailSignature = next.emailSignature;
		this.businessIdLabel = next.businessIdLabel;
		this.businessIdValue = next.businessIdValue;
		this.taxIdLabel = next.taxIdLabel;
		this.taxIdValue = next.taxIdValue;
		this.taxDisplayLabel = next.taxDisplayLabel;
		this.taxRatePercentage = next.taxRatePercentage;
		this.businessAddress = next.businessAddress;
		this.businessContactName = next.businessContactName;
		this.businessContactFirstName = next.businessContactFirstName ?? '';
		this.businessContactLastName = next.businessContactLastName ?? '';
		this.businessContactEmail = next.businessContactEmail;
		this.businessContactPhone = next.businessContactPhone;
		this.businessContactPhoneE164 = next.businessContactPhoneE164;
		this.businessContactPhoneCountryCode = next.businessContactPhoneCountryCode;
		this.currencyCode = next.currencyCode;
		this.currencySymbol = next.currencySymbol;
		this.measurementUnit = next.measurementUnit;
		this.dateFormat = next.dateFormat;
		this.languageLocale = next.languageLocale;
		this.numberLocale = next.numberLocale;
		this.quotePaymentTerms = next.quotePaymentTerms;
		this.quoteValidityDays = next.quoteValidityDays;
		this.quoteDefaultInclusions = next.quoteDefaultInclusions;
		this.quoteDefaultExclusions = next.quoteDefaultExclusions;
		this.quoteDefaultTerms = next.quoteDefaultTerms;
		this.quoteNumberPrefix = next.quoteNumberPrefix;
		this.quoteNumberFormat = next.quoteNumberFormat;
		this.created_at = next.created_at || this.created_at;
		this.updated_at = next.updated_at || this.updated_at;
	}

	private applyWorkspaceOnboardingProfile(profile: WorkspaceOnboardingProfile | null): void {
		const next = profile ?? DEFAULT_WORKSPACE_ONBOARDING_PROFILE;
		this.primaryOperatorRole = next.primaryOperatorRole;
		this.industry = next.industry;
	}

	private applyWorkspaceMember(member: WorkspaceMember | null): void {
		const next = member ?? DEFAULT_WORKSPACE_MEMBER;
		this.memberId = next.id;
		this.memberRole = next.role;
		this.memberDisplayName = next.displayName;
		this.memberFirstName = next.firstName ?? '';
		this.memberLastName = next.lastName ?? '';
		this.memberEmail = next.email;
		this.memberAvatarPath = next.avatarPath;
	}

	async hydrate(): Promise<void> {
		try {
			const [identity, profile, onboardingProfile, member] = await Promise.all([
				dbService.getWorkspaceIdentity(),
				dbService.getWorkspaceProfile(),
				dbService.getWorkspaceOnboardingProfile(),
				dbService.getPrimaryWorkspaceMember()
			]);
			this.applyWorkspaceIdentity(identity);
			this.applyWorkspaceProfile(profile);
			this.applyWorkspaceOnboardingProfile(onboardingProfile);
			this.applyWorkspaceMember(member);
			log.info('Hydrated workspace state', {
				workspaceId: this.id
			});
		} finally {
			this.isHydrated = true;
		}
	}

	async refresh(): Promise<void> {
		const [identity, profile, onboardingProfile, member] = await Promise.all([
			dbService.getWorkspaceIdentity(),
			dbService.getWorkspaceProfile(),
			dbService.getWorkspaceOnboardingProfile(),
			dbService.getPrimaryWorkspaceMember()
		]);
		this.applyWorkspaceIdentity(identity);
		this.applyWorkspaceProfile(profile);
		this.applyWorkspaceOnboardingProfile(onboardingProfile);
		this.applyWorkspaceMember(member);
		log.info('Refreshed workspace state', {
			workspaceId: this.id
		});
	}

	async updateProfile(
		updates: Partial<
			Pick<
				WorkspaceProfile,
				| 'displayName'
				| 'countryCode'
				| 'businessName'
				| 'logoFilePath'
				| 'businessIdValue'
				| 'taxIdValue'
				| 'businessAddress'
				| 'businessContactName'
				| 'businessContactFirstName'
				| 'businessContactLastName'
				| 'businessContactEmail'
				| 'businessContactPhone'
				| 'taxRatePercentage'
				| 'quotePaymentTerms'
				| 'quoteValidityDays'
				| 'quoteDefaultInclusions'
				| 'quoteDefaultExclusions'
				| 'quoteDefaultTerms'
				| 'quoteNumberPrefix'
				| 'quoteNumberFormat'
				| 'emailSignature'
			>
		>
	): Promise<void> {
		log.info('Updating workspace profile', {
			workspaceId: this.id,
			updatedFields: Object.keys(updates)
		});
		await dbService.updateWorkspaceProfile(updates);
		const nextDisplayName = updates.displayName?.trim();
		if (nextDisplayName && nextDisplayName !== this.displayName) {
			const nextSlug = nextDisplayName
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, '-')
				.replace(/^-+|-+$/g, '')
				.slice(0, 40);
			await controlDbService.updateWorkspaceRegistryEntry(this.id, {
				displayName: nextDisplayName,
				slug: nextSlug || this.id
			});
		}
		await this.refresh();
	}

	async updateOnboardingProfile(
		updates: Partial<Pick<WorkspaceOnboardingProfile, 'primaryOperatorRole' | 'industry'>>
	): Promise<void> {
		log.info('Updating workspace onboarding profile', {
			workspaceId: this.id,
			updatedFields: Object.keys(updates)
		});
		await dbService.updateWorkspaceOnboardingProfile(updates);
		await this.refresh();
	}

	async updateDefaults(
		updates: Partial<
			Pick<
				WorkspaceProfile,
				| 'currencyCode'
				| 'currencySymbol'
				| 'measurementUnit'
				| 'dateFormat'
				| 'languageLocale'
				| 'numberLocale'
				| 'taxRatePercentage'
				| 'quotePaymentTerms'
				| 'quoteValidityDays'
				| 'quoteDefaultInclusions'
				| 'quoteDefaultExclusions'
				| 'quoteDefaultTerms'
				| 'quoteNumberPrefix'
				| 'quoteNumberFormat'
			>
		>
	): Promise<void> {
		log.info('Updating workspace defaults', {
			workspaceId: this.id,
			updatedFields: Object.keys(updates)
		});
		await dbService.updateWorkspaceProfile(updates);
		await this.refresh();
	}

	reset(): void {
		this.applyWorkspaceIdentity(null);
		this.applyWorkspaceProfile(null);
		this.applyWorkspaceOnboardingProfile(null);
		this.applyWorkspaceMember(null);
		this.isHydrated = false;
	}
}

export const workspaceState = new WorkspaceState();
