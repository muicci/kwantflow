import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import IntegrationConsentDialog from './integration-consent-dialog.svelte';

afterEach(cleanup);

describe('email connection consent accessibility', () => {
	it('describes Microsoft sending through the connected mailbox instead of a Gmail address', async () => {
		const view = render(IntegrationConsentDialog, {
			open: true,
			providerName: 'Microsoft',
			providerLogo: '/synthetic-provider.svg',
			title: 'Connect Microsoft Outlook',
			description: 'Email access communicates directly with Microsoft.',
			features: []
		});
		await view.findByRole('alertdialog', { name: 'Connect Microsoft Outlook' });
		expect(
			view.getByText(
				'Kwantflow reads RFQ emails, manages message status, and sends quotes from your connected mailbox.'
			)
		).toBeTruthy();
		expect(view.queryByText(/from your Gmail address/)).toBeNull();
	});

	it.each(['Google', 'Microsoft'])(
		'names the %s consent dialog and associates its provider explanation',
		async (providerName) => {
			const title = `Connect ${providerName} Mail`;
			const description = `Email access communicates directly with ${providerName}. RFQ processing stays on this device.`;
			const view = render(IntegrationConsentDialog, {
				open: true,
				providerName,
				providerLogo: '/synthetic-provider.svg',
				title,
				description,
				features: []
			});
			const dialog = await view.findByRole('alertdialog', { name: title });
			await waitFor(() => {
				const descriptionId = dialog.getAttribute('aria-describedby');
				expect(descriptionId).toBeTruthy();
				expect(document.getElementById(descriptionId ?? '')?.textContent?.trim()).toBe(description);
			});
		}
	);
});
