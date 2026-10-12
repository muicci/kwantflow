import { controlDbService } from '$lib/services/control-db.js';
import { dbService } from '$lib/services/db';
import type { CustomerIdentity } from '$lib/types/index.js';

const DEFAULT_CUSTOMER_IDENTITY: CustomerIdentity = {
	id: 'primary-customer',
	workspaceId: '',
	displayName: 'Workspace',
	countryCode: 'AU',
	created_at: '',
	updated_at: ''
};

class CustomerState {
	id = $state(DEFAULT_CUSTOMER_IDENTITY.id);
	workspaceId = $state(DEFAULT_CUSTOMER_IDENTITY.workspaceId);
	displayName = $state(DEFAULT_CUSTOMER_IDENTITY.displayName);
	countryCode = $state(DEFAULT_CUSTOMER_IDENTITY.countryCode);
	created_at = $state('');
	updated_at = $state('');
	isHydrated = $state(false);

	private applyCustomerIdentity(customer: CustomerIdentity): void {
		this.id = customer.id;
		this.workspaceId = customer.workspaceId;
		this.displayName = customer.displayName;
		this.countryCode = customer.countryCode;
		this.created_at = customer.created_at;
		this.updated_at = customer.updated_at;
	}

	async hydrate(options: { includeWorkspace?: boolean } = {}): Promise<void> {
		const includeWorkspace =
			(options.includeWorkspace ?? true) && dbService.getDatabasePath() !== null;
		const [customer, profile, workspace] = await Promise.all([
			controlDbService.getControlCustomerIdentity(),
			includeWorkspace ? dbService.getWorkspaceProfile() : Promise.resolve(null),
			includeWorkspace ? dbService.getWorkspaceIdentity() : Promise.resolve(null)
		]);
		this.applyCustomerIdentity({
			id: customer?.id ?? DEFAULT_CUSTOMER_IDENTITY.id,
			workspaceId: workspace?.id ?? '',
			displayName:
				profile?.displayName || customer?.displayName || DEFAULT_CUSTOMER_IDENTITY.displayName,
			countryCode: profile?.countryCode ?? DEFAULT_CUSTOMER_IDENTITY.countryCode,
			created_at: customer?.created_at ?? '',
			updated_at: customer?.updated_at ?? ''
		});
		this.isHydrated = true;
	}

	async refresh(): Promise<void> {
		await this.hydrate();
	}

	reset(): void {
		this.applyCustomerIdentity(DEFAULT_CUSTOMER_IDENTITY);
		this.isHydrated = false;
	}
}

export const customerState = new CustomerState();
