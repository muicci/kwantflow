import { controlDbService } from '$lib/services/control-db.js';
import type { ControlCustomerIdentity, ProfileIdentity } from '$lib/types/index.js';

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

class ProfileState {
	id: string = $state(DEFAULT_PROFILE.id);
	displayName: string = $state(DEFAULT_PROFILE.displayName);
	firstName: string = $state(DEFAULT_PROFILE.firstName ?? '');
	lastName: string = $state(DEFAULT_PROFILE.lastName ?? '');
	email: string | null = $state(DEFAULT_PROFILE.email ?? null);
	phone: string | null = $state(DEFAULT_PROFILE.phone ?? null);
	customerId: string = $state(DEFAULT_CUSTOMER.id);
	customerDisplayName: string = $state(DEFAULT_CUSTOMER.displayName);
	created_at: string = $state('');
	updated_at: string = $state('');
	isHydrated = $state(false);

	private applyProfile(profile: ProfileIdentity | null): void {
		const next = profile ?? DEFAULT_PROFILE;
		this.id = next.id;
		this.displayName = next.displayName;
		this.firstName = next.firstName ?? '';
		this.lastName = next.lastName ?? '';
		this.email = next.email ?? null;
		this.phone = next.phone ?? null;
		this.created_at = next.created_at;
		this.updated_at = next.updated_at;
	}

	private applyCustomer(customer: ControlCustomerIdentity | null): void {
		const next = customer ?? DEFAULT_CUSTOMER;
		this.customerId = next.id;
		this.customerDisplayName = next.displayName;
	}

	async hydrate(): Promise<void> {
		try {
			const [profile, customer] = await Promise.all([
				controlDbService.getProfileIdentity(),
				controlDbService.getControlCustomerIdentity()
			]);
			this.applyProfile(profile);
			this.applyCustomer(customer);
		} finally {
			this.isHydrated = true;
		}
	}

	async refresh(): Promise<void> {
		const [profile, customer] = await Promise.all([
			controlDbService.getProfileIdentity(),
			controlDbService.getControlCustomerIdentity()
		]);
		this.applyProfile(profile);
		this.applyCustomer(customer);
	}

	reset(): void {
		this.applyProfile(null);
		this.applyCustomer(null);
		this.isHydrated = false;
	}
}

export const profileState = new ProfileState();
