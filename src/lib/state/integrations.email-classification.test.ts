import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock, runStructuredUtilityTaskResultMock, openUrlMock, workspaceStateMock } =
	vi.hoisted(() => ({
		invokeMock: vi.fn(),
		runStructuredUtilityTaskResultMock: vi.fn(),
		openUrlMock: vi.fn(),
		workspaceStateMock: { id: 'workspace-1' as string | null }
	}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('$lib/services/structured-utility.js', () => ({
	runStructuredUtilityTaskResult: runStructuredUtilityTaskResultMock
}));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: openUrlMock }));
vi.mock('$lib/state/workspace.svelte.js', () => ({
	workspaceState: workspaceStateMock
}));
vi.mock('$lib/services/logger.js', () => ({
	createLogger: () => ({
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn()
	})
}));
vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn() } }));

import {
	IntegrationsState,
	type EmailProviderSettings,
	type GmailDetail,
	type GmailSummary
} from './integrations.svelte.js';

const connection = {
	id: 'connection-1',
	workspaceId: 'workspace-1',
	provider: 'google_gmail',
	label: 'mail@example.com',
	externalId: 'mail@example.com',
	externalName: 'Mail',
	status: 'active',
	tokenExpiresAt: null,
	lastError: null,
	rfqDetectionEnabled: true,
	pollingInterval: 'off' as const,
	lastSyncedAt: null,
	consentGrantedAt: null,
	consentVersion: null
};

function summary(id: string): GmailSummary {
	return {
		id,
		threadId: `thread-${id}`,
		from: 'sender@example.com',
		subject: `Subject ${id}`,
		date: '2026-06-28T10:00:00Z',
		snippet: 'Please quote this work',
		isUnread: true,
		hasAttachments: false
	};
}

function detail(id: string): GmailDetail {
	return {
		...summary(id),
		to: 'estimating@example.com',
		cc: '',
		bodyText: 'Please quote this work.',
		bodyHtml: null,
		labels: [],
		attachmentNames: [],
		attachmentIds: [],
		attachmentMimeTypes: []
	};
}

function stateWithMessages(messages: GmailSummary[]): IntegrationsState {
	const state = new IntegrationsState();
	state.connections = [connection];
	(state as unknown as { gmailCache: GmailSummary[] }).gmailCache = messages;
	vi.spyOn(state, 'openEmailMessage').mockImplementation(async (messageId) => detail(messageId));
	return state;
}

describe('email RFQ classification lifecycle', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		invokeMock.mockImplementation(async (command: string) => {
			if (command === 'list_email_rfq_classifications') return [];
			if (command === 'save_email_rfq_classification') return undefined;
			throw new Error(`Unexpected command: ${command}`);
		});
		runStructuredUtilityTaskResultMock.mockResolvedValue({
			value: { verdict: 'rfq' },
			modelId: 'kwantflow-ai.litertlm'
		});
	});

	it('does not invoke Gemma for messages with current durable results', async () => {
		invokeMock.mockImplementation(async (command: string) => {
			if (command === 'list_email_rfq_classifications') {
				return [{ providerMessageId: 'message-1', verdict: 'not_rfq' }];
			}
			throw new Error(`Unexpected command: ${command}`);
		});
		const state = stateWithMessages([summary('message-1')]);

		await state.classifyPendingEmails();

		expect(runStructuredUtilityTaskResultMock).not.toHaveBeenCalled();
		expect(state.getRfqStatus('message-1')).toBe('no');
	});

	it('restores classifications when the in-memory message cache is still fresh', async () => {
		invokeMock.mockImplementation(async (command: string) => {
			if (command === 'list_email_rfq_classifications') {
				return [{ providerMessageId: 'message-1', verdict: 'not_rfq' }];
			}
			throw new Error(`Unexpected command: ${command}`);
		});
		const state = stateWithMessages([summary('message-1')]);
		(state as unknown as { gmailLastFetchAt: number }).gmailLastFetchAt = Date.now();

		await state.fetchEmailMessages();

		await vi.waitFor(() => expect(state.getRfqStatus('message-1')).toBe('no'));
		expect(invokeMock).not.toHaveBeenCalledWith('list_email_messages', expect.anything());
		expect(runStructuredUtilityTaskResultMock).not.toHaveBeenCalled();
	});

	it('classifies and stores one new message', async () => {
		const state = stateWithMessages([summary('message-1')]);

		await state.classifyPendingEmails();

		expect(runStructuredUtilityTaskResultMock).toHaveBeenCalledTimes(1);
		expect(invokeMock).toHaveBeenCalledWith(
			'save_email_rfq_classification',
			expect.objectContaining({
				connectionId: 'connection-1',
				providerMessageId: 'message-1',
				classifierVersion: 'email-ai-v2',
				verdict: 'rfq'
			})
		);
		expect(state.getRfqStatus('message-1')).toBe('yes');
	});

	it('uses normalised HTML when a provider returns no plain-text body', async () => {
		const state = stateWithMessages([summary('message-1')]);
		vi.mocked(state.openEmailMessage).mockResolvedValue({
			...detail('message-1'),
			bodyText: '',
			bodyHtml: '<p>Please quote the structural steel package.</p>',
			snippet: 'Short snippet'
		});

		await state.classifyPendingEmails();

		expect(runStructuredUtilityTaskResultMock).toHaveBeenCalledWith(
			expect.objectContaining({
				userContent: expect.stringContaining('Please quote the structural steel package.')
			})
		);
	});

	it('runs one follow-up pass when mail arrives during an active pass', async () => {
		let resolveFirst!: (value: { value: { verdict: 'not_rfq' }; modelId: string }) => void;
		runStructuredUtilityTaskResultMock
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						resolveFirst = resolve;
					})
			)
			.mockResolvedValue({ value: { verdict: 'rfq' }, modelId: 'kwantflow-ai.litertlm' });
		const state = stateWithMessages([summary('message-1')]);

		const firstPass = state.classifyPendingEmails();
		await vi.waitFor(() => expect(runStructuredUtilityTaskResultMock).toHaveBeenCalledTimes(1));
		(state as unknown as { gmailCache: GmailSummary[] }).gmailCache = [
			summary('message-1'),
			summary('message-2')
		];
		await state.classifyPendingEmails();
		resolveFirst({ value: { verdict: 'not_rfq' }, modelId: 'kwantflow-ai.litertlm' });
		await firstPass;

		await vi.waitFor(() => expect(runStructuredUtilityTaskResultMock).toHaveBeenCalledTimes(2));
		expect(state.getRfqStatus('message-2')).toBe('yes');
	});

	it('leaves a failed classification retryable without looping immediately', async () => {
		runStructuredUtilityTaskResultMock.mockRejectedValue(new Error('invalid output'));
		const state = stateWithMessages([summary('message-1')]);

		await state.classifyPendingEmails();
		await Promise.resolve();

		expect(runStructuredUtilityTaskResultMock).toHaveBeenCalledTimes(1);
		expect(state.getRfqStatus('message-1')).toBeUndefined();
	});

	it('stops the background pass immediately when foreground AI owns the engine', async () => {
		runStructuredUtilityTaskResultMock.mockRejectedValue(
			new Error('Kwantflow AI background workload yielded to an active foreground request.')
		);
		const state = stateWithMessages([
			summary('message-1'),
			summary('message-2'),
			summary('message-3')
		]);

		await state.classifyPendingEmails();

		expect(runStructuredUtilityTaskResultMock).toHaveBeenCalledTimes(1);
		expect(state.getRfqStatus('message-1')).toBeUndefined();
		expect(state.getRfqStatus('message-2')).toBeUndefined();
	});

	it('does not rerun after yielding when another refresh was requested during the active pass', async () => {
		let rejectFirst!: (reason: Error) => void;
		runStructuredUtilityTaskResultMock.mockImplementationOnce(
			() =>
				new Promise((_resolve, reject) => {
					rejectFirst = reject;
				})
		);
		const state = stateWithMessages([summary('message-1'), summary('message-2')]);

		const firstPass = state.classifyPendingEmails();
		await vi.waitFor(() => expect(runStructuredUtilityTaskResultMock).toHaveBeenCalledTimes(1));
		await state.classifyPendingEmails();
		rejectFirst(
			new Error('Kwantflow AI background workload yielded to an active foreground request.')
		);
		await firstPass;

		expect(runStructuredUtilityTaskResultMock).toHaveBeenCalledTimes(1);
		expect(state.getRfqStatus('message-1')).toBeUndefined();
		expect(state.getRfqStatus('message-2')).toBeUndefined();
	});
});

describe('local mailbox configuration and consent', () => {
	const settings: EmailProviderSettings = {
		googleClientId: '123-synthetic.apps.googleusercontent.com',
		microsoftClientId: 'ac6bd346-e3c3-472a-a645-e21b1a375c4d',
		microsoftTenant: 'common'
	};

	beforeEach(() => {
		vi.clearAllMocks();
		workspaceStateMock.id = 'workspace-1';
		openUrlMock.mockResolvedValue(undefined);
	});

	it.each(['older first', 'newer first'])(
		'keeps the newest provider load when overlapping Settings reads finish %s',
		async (order) => {
			let finishOlder!: (value: EmailProviderSettings) => void;
			let finishNewer!: (value: EmailProviderSettings) => void;
			invokeMock
				.mockImplementationOnce(
					() => new Promise<EmailProviderSettings>((resolve) => (finishOlder = resolve))
				)
				.mockImplementationOnce(
					() => new Promise<EmailProviderSettings>((resolve) => (finishNewer = resolve))
				);
			const state = new IntegrationsState();
			const changed = { ...settings, microsoftTenant: 'organizations' };
			const older = state.loadProviderSettings();
			const newer = state.loadProviderSettings();
			if (order === 'older first') {
				finishOlder(settings);
				await older;
				expect(state.providerSettingsLoading).toBe(true);
				expect(state.providerSettings).toBeNull();
				finishNewer(changed);
				await newer;
			} else {
				finishNewer(changed);
				await newer;
				finishOlder(settings);
				await older;
			}
			expect(state.providerSettings).toEqual(changed);
			expect(state.providerSettingsLoading).toBe(false);
		}
	);

	it('ignores an obsolete provider read error without clearing the newer loading state', async () => {
		let failOlder!: (error: string) => void;
		let finishNewer!: (value: EmailProviderSettings) => void;
		invokeMock
			.mockImplementationOnce(
				() =>
					new Promise<EmailProviderSettings>((_resolve, reject) => {
						failOlder = reject;
					})
			)
			.mockImplementationOnce(
				() => new Promise<EmailProviderSettings>((resolve) => (finishNewer = resolve))
			);
		const state = new IntegrationsState();
		const older = state.loadProviderSettings();
		const newer = state.loadProviderSettings();
		failOlder('Synthetic obsolete native settings read failed.');
		await expect(older).resolves.toBeUndefined();
		expect(state.providerSettingsLoading).toBe(true);
		finishNewer(settings);
		await newer;
		expect(state.providerSettings).toEqual(settings);
	});

	it('does not overwrite a successful registration save with an earlier provider read', async () => {
		let finishRead!: (value: EmailProviderSettings) => void;
		const changed = { ...settings, microsoftTenant: 'organizations' };
		invokeMock.mockImplementation(async (command: string) => {
			if (command === 'get_email_provider_settings')
				return new Promise<EmailProviderSettings>((resolve) => (finishRead = resolve));
			if (command === 'set_email_provider_settings') return changed;
			if (command === 'restore_integrations') return [];
			throw new Error(`Unexpected command: ${command}`);
		});
		const state = new IntegrationsState();
		state.providerSettings = settings;
		const loading = state.loadProviderSettings();
		await state.saveProviderSettings(changed);
		finishRead(settings);
		await loading;
		expect(state.providerSettings).toEqual(changed);
		expect(state.providerSettingsLoading).toBe(false);
		expect(state.providerSettingsSaving).toBe(false);
	});

	it.each(['success', 'failure'] as const)(
		'waits for a pending registration write before a reopened Settings read after %s',
		async (outcome) => {
			let finishWrite!: (value: EmailProviderSettings) => void;
			let failWrite!: (error: string) => void;
			let persisted = settings;
			const changed = { ...settings, microsoftTenant: 'organizations' };
			invokeMock.mockImplementation(async (command: string) => {
				if (command === 'set_email_provider_settings') {
					persisted = await new Promise<EmailProviderSettings>((resolve, reject) => {
						finishWrite = resolve;
						failWrite = reject;
					});
					return persisted;
				}
				if (command === 'get_email_provider_settings') return persisted;
				if (command === 'restore_integrations') return [];
				throw new Error(`Unexpected command: ${command}`);
			});
			const state = new IntegrationsState();
			state.providerSettings = settings;
			const writing = state.saveProviderSettings(changed).then(
				() => undefined,
				(error: unknown) => error
			);
			const loading = state.loadProviderSettings();
			expect(invokeMock).not.toHaveBeenCalledWith('get_email_provider_settings');
			expect(state.providerSettingsLoading).toBe(true);
			expect(state.providerSettingsSaving).toBe(true);
			if (outcome === 'success') finishWrite(changed);
			else failWrite('Synthetic native settings write failed.');
			expect(await writing).toBe(
				outcome === 'success' ? undefined : 'Synthetic native settings write failed.'
			);
			await loading;
			expect(state.providerSettings).toEqual(outcome === 'success' ? changed : settings);
			expect(state.providerSettingsLoading).toBe(false);
			expect(state.providerSettingsSaving).toBe(false);
		}
	);

	it('serializes overlapping registration writes without losing either native operation', async () => {
		let finishFirst!: (value: EmailProviderSettings) => void;
		let finishSecond!: (value: EmailProviderSettings) => void;
		const changed = { ...settings, microsoftTenant: 'organizations' };
		let writeCount = 0;
		invokeMock.mockImplementation(async (command: string) => {
			if (command === 'set_email_provider_settings') {
				writeCount += 1;
				return new Promise<EmailProviderSettings>((resolve) => {
					if (writeCount === 1) finishFirst = resolve;
					else finishSecond = resolve;
				});
			}
			if (command === 'restore_integrations') return [];
			throw new Error(`Unexpected command: ${command}`);
		});
		const state = new IntegrationsState();
		const first = state.saveProviderSettings(settings);
		const second = state.saveProviderSettings(changed);
		expect(writeCount).toBe(1);
		finishFirst(settings);
		await first;
		await vi.waitFor(() => expect(writeCount).toBe(2));
		expect(state.providerSettingsSaving).toBe(true);
		finishSecond(changed);
		await second;
		expect(state.providerSettings).toEqual(changed);
		expect(state.providerSettingsSaving).toBe(false);
	});

	it('keeps fresh onboarding quiet and clears mailbox state when no workspace is active', async () => {
		workspaceStateMock.id = null;
		const state = stateWithMessages([summary('message-1')]);
		state.errorMessage = 'Old workspace error';
		await state.hydrateIntegrations();
		expect(invokeMock).not.toHaveBeenCalled();
		expect(state.connections).toEqual([]);
		expect(state.emailMessages).toEqual([]);
		expect(state.errorMessage).toBeNull();
	});

	it('connects a configured mailbox without a hosted account, workspace, or HTTP report', async () => {
		const network = vi
			.spyOn(globalThis, 'fetch')
			.mockRejectedValue(new Error('unexpected HTTP request'));
		invokeMock.mockImplementation(async (command: string) => {
			if (command === 'get_email_provider_settings') return settings;
			if (command === 'start_integration_oauth')
				return { authUrl: 'https://accounts.google.com/synthetic', state: 'synthetic', port: 1 };
			if (command === 'complete_integration_oauth') return { integration: connection };
			throw new Error(`Unexpected command: ${command}`);
		});
		const state = new IntegrationsState();
		try {
			await state.startGoogleOAuth();
			expect(state.isGoogleConnected).toBe(true);
			expect(state.activeEmailConnection?.workspaceId).toBe('workspace-1');
			expect(openUrlMock).toHaveBeenCalledOnce();
			expect(network).not.toHaveBeenCalled();
		} finally {
			network.mockRestore();
		}
	});

	it('leaves mailbox setup optional and refuses consent when the provider is unconfigured', async () => {
		invokeMock.mockResolvedValue({ ...settings, googleClientId: '' });
		const state = new IntegrationsState();
		await state.startGoogleOAuth();
		expect(state.errorMessage).toContain('Configure your own OAuth client ID');
		expect(state.status.google_gmail).toBe('error');
		expect(invokeMock).not.toHaveBeenCalledWith('start_integration_oauth', expect.anything());
		expect(openUrlMock).not.toHaveBeenCalled();
	});

	it('keeps saved setup and mailbox state when a provider settings write fails', async () => {
		const state = stateWithMessages([summary('message-1')]);
		state.providerSettings = settings;
		invokeMock.mockRejectedValue(new Error('synthetic settings write failed'));
		await expect(state.saveProviderSettings({ ...settings, googleClientId: '' })).rejects.toThrow(
			'write failed'
		);
		expect(state.providerSettings).toEqual(settings);
		expect(state.activeEmailConnection?.id).toBe(connection.id);
		expect(state.emailMessages).toHaveLength(1);
		expect(state.providerSettingsSaving).toBe(false);
	});

	it('refreshes changed registrations and keeps retired mailbox metadata for reconnect', async () => {
		const state = stateWithMessages([summary('message-1')]);
		state.providerSettings = settings;
		const changed = { ...settings, googleClientId: '' };
		invokeMock.mockImplementation(async (command: string) => {
			if (command === 'set_email_provider_settings') return changed;
			if (command === 'restore_integrations')
				return [{ ...connection, status: 'revoked', lastError: 'Reconnect this mailbox.' }];
			throw new Error(`Unexpected command: ${command}`);
		});
		await state.saveProviderSettings(changed);
		expect(state.providerSettings).toEqual(changed);
		expect(state.isGoogleConnected).toBe(false);
		expect(state.emailMessages).toEqual([]);
		expect(state.connections).toHaveLength(1);
		expect(state.connections[0].lastError).toContain('Reconnect');
	});

	it('does not attach restored connections after the active workspace changes', async () => {
		let finishRestore!: (value: (typeof connection)[]) => void;
		invokeMock.mockImplementation(
			() =>
				new Promise((resolve) => {
					finishRestore = resolve;
				})
		);
		const state = new IntegrationsState();
		const hydration = state.hydrateIntegrations();
		await state.resetForWorkspaceChange();
		finishRestore([connection]);
		await hydration;
		expect(state.connections).toEqual([]);
	});

	it('does not accept OAuth completion after cancellation', async () => {
		let finishCompletion!: (value: { integration: typeof connection }) => void;
		invokeMock.mockImplementation(async (command: string) => {
			if (command === 'get_email_provider_settings') return settings;
			if (command === 'start_integration_oauth')
				return {
					authUrl: 'https://accounts.google.com/synthetic',
					state: 'synthetic-state',
					port: 1
				};
			if (command === 'complete_integration_oauth')
				return new Promise((resolve) => {
					finishCompletion = resolve;
				});
			if (command === 'cancel_integration_oauth') return undefined;
			throw new Error(`Unexpected command: ${command}`);
		});
		const state = new IntegrationsState();
		const flow = state.startGoogleOAuth();
		await vi.waitFor(() => expect(finishCompletion).toBeDefined());
		state.cancelGoogleOAuth();
		finishCompletion({ integration: connection });
		await flow;
		expect(state.connections).toEqual([]);
		expect(state.status.google_gmail).toBe('idle');
		expect(state.errorMessage).toBeNull();
	});

	it('cancels a native flow that starts after the workspace changes', async () => {
		let finishStart!: (value: { authUrl: string; state: string; port: number }) => void;
		invokeMock.mockImplementation(async (command: string) => {
			if (command === 'get_email_provider_settings') return settings;
			if (command === 'start_integration_oauth')
				return new Promise((resolve) => {
					finishStart = resolve;
				});
			if (command === 'cancel_integration_oauth') return undefined;
			throw new Error(`Unexpected command: ${command}`);
		});
		const state = new IntegrationsState();
		const flow = state.startGoogleOAuth();
		await vi.waitFor(() => expect(finishStart).toBeDefined());
		await state.resetForWorkspaceChange();
		finishStart({ authUrl: 'https://accounts.google.com/synthetic', state: 'late-state', port: 1 });
		await flow;
		expect(invokeMock).toHaveBeenCalledWith('cancel_integration_oauth', { state: 'late-state' });
		expect(openUrlMock).not.toHaveBeenCalled();
		expect(state.connections).toEqual([]);
		expect(state.errorMessage).toBeNull();
	});

	it('discards late email details after a workspace switch without marking the message read', async () => {
		let finishDetail!: (value: GmailDetail) => void;
		invokeMock.mockImplementation(async (command: string) => {
			if (command === 'get_email_message')
				return new Promise((resolve) => {
					finishDetail = resolve;
				});
			throw new Error(`Unexpected command: ${command}`);
		});
		const state = new IntegrationsState();
		state.connections = [connection];
		(state as unknown as { gmailCache: GmailSummary[] }).gmailCache = [summary('message-1')];
		const opening = state.openEmailMessage('message-1');
		await state.resetForWorkspaceChange();
		finishDetail(detail('message-1'));
		expect(await opening).toBeNull();
		expect(state.emailMessages).toEqual([]);
		expect(invokeMock).not.toHaveBeenCalledWith('set_email_message_read_status', expect.anything());
	});

	it('does not restore durable classification results from a previous workspace', async () => {
		let finishClassifications!: (value: { providerMessageId: string; verdict: 'rfq' }[]) => void;
		invokeMock.mockImplementation(async (command: string) => {
			if (command === 'list_email_rfq_classifications')
				return new Promise((resolve) => {
					finishClassifications = resolve;
				});
			throw new Error(`Unexpected command: ${command}`);
		});
		const state = stateWithMessages([summary('message-1')]);
		const classification = state.classifyPendingEmails();
		await state.resetForWorkspaceChange();
		finishClassifications([{ providerMessageId: 'message-1', verdict: 'rfq' }]);
		await classification;
		expect(state.rfqResults).toEqual({});
		expect(runStructuredUtilityTaskResultMock).not.toHaveBeenCalled();
	});
});
