import { invoke } from '@tauri-apps/api/core';
import { errorState } from './errors.svelte.js';
import { toast } from 'svelte-sonner';
import { createLogger } from '$lib/services/logger.js';
import { runStructuredUtilityTaskResult } from '$lib/services/structured-utility.js';
import {
	EMAIL_AI_CONTRACT_VERSION,
	EmailRfqClassificationSchema
} from '$lib/services/email-ai-contracts.js';
import { workspaceState } from './workspace.svelte.js';
import { normaliseEmailBodyText } from '$lib/services/email-content.js';

const log = createLogger('integrationsState');

export type IntegrationStatus = 'idle' | 'connecting' | 'connected' | 'error';

export type EmailProviderSettings = {
	googleClientId: string;
	microsoftClientId: string;
	microsoftTenant: string;
};

export type GmailSummary = {
	id: string;
	threadId: string;
	from: string;
	subject: string;
	date: string;
	snippet: string;
	isUnread: boolean;
	hasAttachments: boolean;
};

export type GmailDetail = {
	id: string;
	threadId: string;
	from: string;
	to: string;
	cc: string;
	subject: string;
	date: string;
	bodyText: string;
	bodyHtml: string | null;
	snippet: string;
	labels: string[];
	hasAttachments: boolean;
	attachmentNames: string[];
	attachmentIds: string[];
	attachmentMimeTypes: string[];
};

export type GmailListResult = {
	messages: GmailSummary[];
	nextPageToken: string | null;
	resultSizeEstimate: number;
};

export type IntegrationConnection = {
	id: string;
	workspaceId: string;
	provider: string;
	label: string;
	externalId: string | null;
	externalName: string | null;
	status: string;
	tokenExpiresAt: number | null;
	lastError: string | null;
	rfqDetectionEnabled: boolean;
	pollingInterval: 'off' | '15m' | '30m' | '1h';
	lastSyncedAt: string | null;
	consentGrantedAt: string | null;
	consentVersion: string | null;
};

export class IntegrationsState {
	/** Device-local public OAuth registration settings, configured by the user. */
	providerSettings = $state<EmailProviderSettings | null>(null);
	providerSettingsLoading = $state(false);
	providerSettingsSaving = $state(false);
	private providerSettingsGeneration = 0;
	private providerSettingsWrite: Promise<void> | null = null;

	async loadProviderSettings(): Promise<void> {
		const generation = ++this.providerSettingsGeneration;
		this.providerSettingsLoading = true;
		try {
			while (this.providerSettingsWrite) await this.providerSettingsWrite;
			if (generation !== this.providerSettingsGeneration) return;
			const settings = await invoke<EmailProviderSettings>('get_email_provider_settings');
			if (generation === this.providerSettingsGeneration) this.providerSettings = settings;
		} catch (error) {
			if (generation === this.providerSettingsGeneration) throw error;
		} finally {
			while (this.providerSettingsWrite) await this.providerSettingsWrite;
			if (generation === this.providerSettingsGeneration) this.providerSettingsLoading = false;
		}
	}

	async saveProviderSettings(settings: EmailProviderSettings): Promise<void> {
		this.providerSettingsGeneration += 1;
		this.providerSettingsLoading = false;
		this.providerSettingsSaving = true;
		const previousWrite = this.providerSettingsWrite;
		let finishWrite!: () => void;
		const write = new Promise<void>((resolve) => {
			finishWrite = resolve;
		});
		this.providerSettingsWrite = write;
		try {
			if (previousWrite) await previousWrite;
			const previous = this.providerSettings;
			const saved = await invoke<EmailProviderSettings>('set_email_provider_settings', {
				settings
			});
			this.providerSettings = saved;
			if (
				!previous ||
				previous.googleClientId !== saved.googleClientId ||
				previous.microsoftClientId !== saved.microsoftClientId ||
				previous.microsoftTenant !== saved.microsoftTenant
			) {
				await this.resetForWorkspaceChange();
				await this.hydrateIntegrations();
			}
		} finally {
			if (this.providerSettingsWrite === write) {
				this.providerSettingsWrite = null;
				this.providerSettingsSaving = false;
			}
			finishWrite();
		}
	}

	/** Per-provider connection status. */
	status = $state<Record<string, IntegrationStatus>>({});
	/** Connected accounts per provider. */
	connections = $state<IntegrationConnection[]>([]);
	/** Error message for current flow step. */
	errorMessage = $state<string | null>(null);
	/** Whether the current flow was cancelled by the user. */
	private cancelled = false;
	/** Active OAuth state (for callback validation). */
	private activeState: string | null = null;
	/** Active provider for current flow. */
	private activeProvider: string | null = null;
	/** Pending consent timestamp for the current OAuth flow. */
	private pendingConsentGrantedAt: string | null = null;
	/** Runtime-only cache of fetched email details (keyed by provider message ID). */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- runtime-only detail cache; UI updates through explicit state writes.
	private emailDetailCache = new Map<string, GmailDetail>();

	// ---------------------------------------------------------------
	// Email state (persists across panel switches)
	// ---------------------------------------------------------------

	/** The currently active provider filter for the mail panel ('google_gmail' | 'microsoft_outlook'). */
	activeMailProvider = $state<'google_gmail' | 'microsoft_outlook'>('google_gmail');

	// For Gmail cache
	private gmailCache = $state<GmailSummary[]>([]);
	private gmailNextPageToken = $state<string | null>(null);
	private gmailLastFetchAt = $state<number | null>(null);
	private gmailResultSize = $state(0);

	// For Outlook cache
	private outlookCache = $state<GmailSummary[]>([]);
	private outlookNextPageToken = $state<string | null>(null);
	private outlookLastFetchAt = $state<number | null>(null);
	private outlookResultSize = $state(0);

	// Dynamic getters and setters that delegate to the active provider
	private get emailCache(): GmailSummary[] {
		return this.activeMailProvider === 'microsoft_outlook' ? this.outlookCache : this.gmailCache;
	}

	private set emailCache(value: GmailSummary[]) {
		if (this.activeMailProvider === 'microsoft_outlook') {
			this.outlookCache = value;
		} else {
			this.gmailCache = value;
		}
	}

	get emailMessages(): GmailSummary[] {
		return this.emailCache;
	}

	get emailNextPageToken(): string | null {
		return this.activeMailProvider === 'microsoft_outlook'
			? this.outlookNextPageToken
			: this.gmailNextPageToken;
	}

	set emailNextPageToken(value: string | null) {
		if (this.activeMailProvider === 'microsoft_outlook') {
			this.outlookNextPageToken = value;
		} else {
			this.gmailNextPageToken = value;
		}
	}

	get emailLastFetchAt(): number | null {
		return this.activeMailProvider === 'microsoft_outlook'
			? this.outlookLastFetchAt
			: this.gmailLastFetchAt;
	}

	set emailLastFetchAt(value: number | null) {
		if (this.activeMailProvider === 'microsoft_outlook') {
			this.outlookLastFetchAt = value;
		} else {
			this.gmailLastFetchAt = value;
		}
	}

	get emailResultSize(): number {
		return this.activeMailProvider === 'microsoft_outlook'
			? this.outlookResultSize
			: this.gmailResultSize;
	}

	set emailResultSize(value: number) {
		if (this.activeMailProvider === 'microsoft_outlook') {
			this.outlookResultSize = value;
		} else {
			this.gmailResultSize = value;
		}
	}

	/** Whether messages are currently loading (initial fetch or load-more). */
	emailLoading = $state(false);
	/** Whether a background refresh is in progress (non-blocking). */
	emailRefreshing = $state(false);

	/** Runtime projection of durable classification rows. Key: connectionId:messageId. */
	rfqResults = $state<Record<string, 'processing' | 'yes' | 'no'>>({});
	/** Active connection preference. New connections default to enabled in SQLite. */
	mailRfqDetectionEnabled = $state(true);
	private classifying = false;
	private classificationRerunRequested = false;
	private hydratedWorkspaceId: string | null = null;
	private workspaceGeneration = 0;

	// ---------------------------------------------------------------
	// Polling interval for automatic email refresh
	// ---------------------------------------------------------------

	/** Current polling frequency. Persisted on the active workspace integration row. */
	pollingInterval = $state<'off' | '15m' | '30m' | '1h'>('off');
	/** Consecutive polling failures — used to detect broken connections. */
	private pollingFailures = 0;
	/** Reference to the active timer so we can clear/reset it. */
	private pollingTimerId: ReturnType<typeof setInterval> | null = null;
	/** Map from interval label to milliseconds. */
	private static readonly INTERVAL_MS: Record<string, number> = {
		'15m': 15 * 60 * 1000,
		'30m': 30 * 60 * 1000,
		'1h': 60 * 60 * 1000
	};

	private ensureMailboxOAuthAllowed(provider: 'google_gmail' | 'microsoft_outlook'): void {
		const clientId =
			provider === 'google_gmail'
				? this.providerSettings?.googleClientId
				: this.providerSettings?.microsoftClientId;
		if (!clientId?.trim()) {
			throw new Error(
				'Configure your own OAuth client ID in Settings before connecting a mailbox.'
			);
		}
	}

	/**
	 * Fetch inbox messages with cache-first strategy:
	 * 1. If cache is empty → fetch first 25 from Gmail API
	 * 2. If cache exists and < 5 min old → use cache immediately, do NOT re-fetch
	 * 3. If cache exists and > 5 min old → use cache immediately, then background-refresh
	 *    using `after:<ISO date>` to only fetch new messages since last fetch
	 *
	 * Pass `force: true` (e.g. from user click on Refresh) to bypass cache and fetch fresh.
	 */
	async fetchEmailMessages(force = false): Promise<void> {
		const conn = this.activeEmailConnection;
		if (!conn?.id) return;

		// Force: clear cache and reset pagination
		if (force) {
			this.emailCache = [];
			this.emailLastFetchAt = null;
			this.emailNextPageToken = null;
		}

		// Cache-first: if we have data, show it immediately and maybe background refresh
		if (this.emailCache.length > 0) {
			const fiveMinAgo = Date.now() - 5 * 60 * 1000;
			if (this.emailLastFetchAt && this.emailLastFetchAt > fiveMinAgo) {
				// Cache is fresh enough — skip refresh entirely
				log.info(
					`[mail] Using fresh cache (${this.emailCache.length} messages, ${Math.round((Date.now() - this.emailLastFetchAt) / 1000)}s old)`
				);
				this.requestEmailClassification();
				return;
			}
			// Cache is stale — refresh in background while showing cached data
			this.requestEmailClassification();
			void this.refreshEmailCache();
			return;
		}

		// No cache — fetch fresh
		this.emailLoading = true;
		const connectionId = conn.id;
		try {
			const result = await invoke<GmailListResult>('list_email_messages', {
				connectionId: conn.id,
				maxResults: 25,
				pageToken: null,
				query: conn.provider === 'microsoft_outlook' ? null : 'in:inbox'
			});
			if (this.activeEmailConnection?.id !== connectionId) {
				log.info('[mail] Aborting initial email list fetch write: connection changed mid-flight');
				return;
			}
			this.emailCache = result.messages;
			this.emailLastFetchAt = Date.now();
			this.emailNextPageToken = result.nextPageToken;
			this.emailResultSize = result.resultSizeEstimate;
			log.info(`[mail] Fetched initial: ${result.messages.length} messages`);
			toast.success(`Inbox refreshed · ${result.messages.length} messages`);
			// Trigger RFQ classification for the freshly fetched messages
			this.requestEmailClassification();
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			log.error(`[mail] Fetch: ${msg}`);
			errorState.catchError(msg, 'Fetch email list');
		} finally {
			this.emailLoading = false;
		}
	}

	/**
	 * Load next page of older messages. Always appends to the cache.
	 */
	async loadMoreEmailMessages(): Promise<void> {
		const conn = this.activeEmailConnection;
		if (!conn?.id || !this.emailNextPageToken) return;
		this.emailLoading = true;
		const connectionId = conn.id;
		try {
			const result = await invoke<GmailListResult>('list_email_messages', {
				connectionId: conn.id,
				maxResults: 25,
				pageToken: this.emailNextPageToken,
				query: conn.provider === 'microsoft_outlook' ? null : 'in:inbox'
			});
			if (this.activeEmailConnection?.id !== connectionId) {
				log.info('[mail] Aborting load more older emails write: connection changed mid-flight');
				return;
			}
			// Append to cache (avoiding duplicates from race conditions)
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local dedupe set, not component state.
			const existingIds = new Set(this.emailCache.map((m) => m.id));
			const unique = result.messages.filter((m) => !existingIds.has(m.id));
			this.emailCache = [...this.emailCache, ...unique];
			this.emailNextPageToken = result.nextPageToken;
			log.info(`[mail] Loaded more: ${unique.length} unique (total ${this.emailCache.length})`);
			// Classify newly loaded emails for RFQ detection
			this.requestEmailClassification();
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			log.error(`[mail] LoadMore: ${msg}`);
			errorState.catchError(msg, 'Load more emails');
		} finally {
			this.emailLoading = false;
		}
	}

	async openEmailMessage(messageId: string): Promise<GmailDetail | null> {
		const workspaceGeneration = this.workspaceGeneration;
		// Return cached detail if available (no reload on tab reopen)
		const cached = this.emailDetailCache.get(messageId);
		if (cached) return cached;

		const conn = this.getConnectionForMessageId(messageId);
		if (!conn?.id) return null;
		try {
			const detail = await invoke<GmailDetail>('get_email_message', {
				connectionId: conn.id,
				messageId
			});
			if (
				this.workspaceGeneration !== workspaceGeneration ||
				this.getConnectionForMessageId(messageId)?.id !== conn.id
			)
				return null;
			// Cache for future opens
			this.emailDetailCache.set(messageId, detail);
			// Mark as read locally
			this.emailCache = this.emailCache.map((m) =>
				m.id === messageId ? { ...m, isUnread: false } : m
			);
			// Mark as read on server (non-blocking)
			invoke('set_email_message_read_status', {
				connectionId: conn.id,
				messageId,
				isRead: true
			}).catch((e) => log.warn(`[mail] Mark read failed: ${e}`));
			return detail;
		} catch (e) {
			if (this.workspaceGeneration !== workspaceGeneration) return null;
			const msg = e instanceof Error ? e.message : String(e);
			log.error(`[mail] GetMsg: ${msg}`);
			errorState.catchError(msg, 'Open email');
			return null;
		}
	}

	async toggleMessageReadStatus(messageId: string, isRead: boolean): Promise<void> {
		const workspaceGeneration = this.workspaceGeneration;
		const conn = this.getConnectionForMessageId(messageId);
		if (!conn?.id) return;
		try {
			// Update locally instantly for snappy UI
			this.emailCache = this.emailCache.map((m) =>
				m.id === messageId ? { ...m, isUnread: !isRead } : m
			);

			// Update on server
			await invoke('set_email_message_read_status', {
				connectionId: conn.id,
				messageId,
				isRead
			});
		} catch (e) {
			if (this.workspaceGeneration !== workspaceGeneration) return;
			const msg = e instanceof Error ? e.message : String(e);
			log.error(`[mail] ToggleReadStatus: ${msg}`);
			errorState.catchError(msg, 'Update read status');

			// Revert local state on failure
			this.emailCache = this.emailCache.map((m) =>
				m.id === messageId ? { ...m, isUnread: isRead } : m
			);
		}
	}

	// ---------------------------------------------------------------
	// Hydration (called once on app boot)
	// ---------------------------------------------------------------

	async hydrateIntegrations(): Promise<void> {
		if (!workspaceState.id) {
			await this.resetForWorkspaceChange();
			return;
		}
		if (this.hydratedWorkspaceId !== workspaceState.id) {
			this.clearWorkspaceRuntimeState();
			this.hydratedWorkspaceId = workspaceState.id;
		}
		const workspaceGeneration = this.workspaceGeneration;
		try {
			const restored = await invoke<IntegrationConnection[]>('restore_integrations');
			if (this.workspaceGeneration !== workspaceGeneration) return;
			this.connections = restored.map((c) => ({
				...c,
				consentGrantedAt: c.consentGrantedAt ?? null,
				consentVersion: c.consentVersion ?? null
			}));
			if (restored.length > 0) {
				log.info('[integrations] Restored connections:', restored.length);
			}
			this.adjustActiveMailProviderAfterChange();
		} catch (error) {
			if (this.workspaceGeneration !== workspaceGeneration) return;
			this.errorMessage = error instanceof Error ? error.message : String(error);
			log.warn('[integrations] Could not restore mailbox connections');
		}
		this.applyActiveConnectionSettings();
	}

	private clearWorkspaceRuntimeState(): void {
		this.workspaceGeneration += 1;
		this.stopPollingTimer();
		this.connections = [];
		this.status = {};
		this.errorMessage = null;
		this.gmailCache = [];
		this.gmailNextPageToken = null;
		this.gmailLastFetchAt = null;
		this.gmailResultSize = 0;
		this.outlookCache = [];
		this.outlookNextPageToken = null;
		this.outlookLastFetchAt = null;
		this.outlookResultSize = 0;
		this.emailDetailCache.clear();
		this.rfqResults = {};
		this.mailRfqDetectionEnabled = true;
		this.pollingInterval = 'off';
		this.pollingFailures = 0;
		this.classificationRerunRequested = false;
	}

	async resetForWorkspaceChange(): Promise<void> {
		const state = this.activeState;
		this.cancelled = true;
		this.activeState = null;
		this.activeProvider = null;
		this.pendingConsentGrantedAt = null;
		this.hydratedWorkspaceId = null;
		this.clearWorkspaceRuntimeState();
		if (state) {
			await invoke('cancel_integration_oauth', { state }).catch((error) =>
				log.warn(`[oauth] Native workspace-switch cancellation cleanup failed: ${error}`)
			);
		}
	}

	// ---------------------------------------------------------------
	// Login / OAuth flow
	// ---------------------------------------------------------------

	/**
	 * Start the Google Gmail OAuth flow.
	 *
	 * 1. Calls Rust command to start localhost server + PKCE
	 * 2. Opens browser for user auth
	 * 3. Polls for callback completion
	 */
	async startGoogleOAuth(): Promise<void> {
		if (this.activeProvider || this.providerSettingsSaving) return;
		const workspaceGeneration = this.workspaceGeneration;
		try {
			this.cancelled = false;
			await this.loadProviderSettings();
			if (this.cancelled || this.workspaceGeneration !== workspaceGeneration) return;
			this.ensureMailboxOAuthAllowed('google_gmail');

			this.status['google_gmail'] = 'connecting';
			this.errorMessage = null;
			this.activeProvider = 'google_gmail';
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- serialized OAuth consent timestamp, not reactive date state.
			this.pendingConsentGrantedAt = new Date().toISOString();

			// Start the OAuth flow — Rust opens a localhost server + returns auth URL
			const { authUrl, state } = await invoke<{
				authUrl: string;
				state: string;
				port: number;
			}>('start_integration_oauth', { provider: 'google_gmail' });
			if (this.cancelled || this.workspaceGeneration !== workspaceGeneration) {
				await invoke('cancel_integration_oauth', { state });
				return;
			}

			this.activeState = state;

			// Open the auth URL in the system browser
			const { openUrl } = await import('@tauri-apps/plugin-opener');
			await openUrl(authUrl);

			// Poll for the callback to complete
			await this.pollOAuthCallback('google_gmail', state);
		} catch (error) {
			if (this.cancelled || this.workspaceGeneration !== workspaceGeneration) return;
			if (this.activeState)
				await invoke('cancel_integration_oauth', { state: this.activeState }).catch(
					() => undefined
				);
			const message = error instanceof Error ? error.message : String(error);
			log.error('[oauth] Failed to start:', message);
			this.errorMessage = message;
			this.status['google_gmail'] = 'error';
			this.activeState = null;
			this.activeProvider = null;
			this.pendingConsentGrantedAt = null;
		}
	}

	/**
	 * Cancel the current OAuth flow. Stops polling, resets state.
	 */
	cancelGoogleOAuth(): void {
		const state = this.activeState;
		this.cancelled = true;
		this.pendingConsentGrantedAt = null;
		this.status['google_gmail'] = 'idle';
		this.errorMessage = null;
		this.activeState = null;
		this.activeProvider = null;
		if (state) {
			invoke('cancel_integration_oauth', { state }).catch((error) =>
				log.warn(`[oauth] Native cancellation cleanup failed: ${error}`)
			);
		}
	}

	cancelMicrosoftOAuth(): void {
		const state = this.activeState;
		this.cancelled = true;
		this.pendingConsentGrantedAt = null;
		this.status['microsoft_outlook'] = 'idle';
		this.errorMessage = null;
		this.activeState = null;
		this.activeProvider = null;
		if (state) {
			invoke('cancel_integration_oauth', { state }).catch((error) =>
				log.warn(`[oauth] Native cancellation cleanup failed: ${error}`)
			);
		}
	}

	/**
	 * Poll for OAuth callback completion.
	 * Rust stores the code when the localhost callback fires.
	 * We poll `complete_integration_oauth` — it returns once the code is available.
	 */
	private async pollOAuthCallback(
		provider: 'google_gmail' | 'microsoft_outlook',
		state: string
	): Promise<void> {
		const workspaceGeneration = this.workspaceGeneration;
		const timeoutMs = 3 * 60 * 1000; // 3 minutes
		const pollIntervalMs = 2000; // 2 seconds
		const startedAt = Date.now();

		while (Date.now() - startedAt < timeoutMs) {
			// Check for user cancellation before each poll
			if (
				this.cancelled ||
				this.activeState !== state ||
				this.workspaceGeneration !== workspaceGeneration
			) {
				log.info('[oauth] Flow cancelled by user');
				return;
			}
			try {
				const result = await invoke<{
					integration: {
						id: string;
						workspaceId: string;
						provider: string;
						label: string;
						externalId: string | null;
						externalName: string | null;
						status: string;
						tokenExpiresAt: number | null;
						lastError: string | null;
						rfqDetectionEnabled: boolean;
						pollingInterval: 'off' | '15m' | '30m' | '1h';
						lastSyncedAt: string | null;
					};
				}>('complete_integration_oauth', { provider, state });
				if (
					this.cancelled ||
					this.activeState !== state ||
					this.workspaceGeneration !== workspaceGeneration
				)
					return;

				// Save connection info
				const connection: IntegrationConnection = {
					id: result.integration.id,
					workspaceId: result.integration.workspaceId,
					provider: result.integration.provider,
					label: result.integration.label,
					externalId: result.integration.externalId,
					externalName: result.integration.externalName,
					status: result.integration.status,
					tokenExpiresAt: result.integration.tokenExpiresAt,
					lastError: result.integration.lastError,
					rfqDetectionEnabled: result.integration.rfqDetectionEnabled,
					pollingInterval: result.integration.pollingInterval,
					lastSyncedAt: result.integration.lastSyncedAt,
					consentGrantedAt: this.pendingConsentGrantedAt,
					consentVersion: '1.0'
				};
				this.pendingConsentGrantedAt = null;

				const replacedConnections = this.connections.filter(
					(entry) => entry.provider === provider && entry.id !== connection.id
				);
				for (const replaced of replacedConnections) {
					if (this.cancelled || this.workspaceGeneration !== workspaceGeneration) return;
					await invoke('revoke_integration', {
						integrationId: replaced.id,
						provider: replaced.provider
					}).catch((error) =>
						log.warn(`[oauth] Failed to clean up replaced mailbox ${replaced.id}: ${error}`)
					);
				}
				if (
					this.cancelled ||
					this.activeState !== state ||
					this.workspaceGeneration !== workspaceGeneration
				)
					return;

				this.connections = [
					...this.connections.filter((entry) => entry.provider !== provider),
					connection
				];
				this.activeMailProvider = provider;
				this.emailCache = [];
				this.emailLastFetchAt = null;
				this.emailNextPageToken = null;
				this.emailDetailCache.clear();
				this.rfqResults = {};
				this.applyActiveConnectionSettings();

				this.status[provider] = 'connected';
				this.activeState = null;
				this.activeProvider = null;

				// Start polling timer if user has a saved interval
				if (this.pollingInterval !== 'off') {
					this.startPollingTimer();
				}

				log.info('[oauth] Connected:', result.integration.label);
				return;
			} catch (error) {
				if (
					this.cancelled ||
					this.activeState !== state ||
					this.workspaceGeneration !== workspaceGeneration
				)
					return;
				const message = error instanceof Error ? error.message : String(error);

				// "No OAuth callback received" means the user hasn't finished auth yet
				if (message.includes('No OAuth callback received')) {
					await sleep(pollIntervalMs);
					continue;
				}

				// Session expired or other terminal error
				log.error('[oauth] Callback error:', message);
				this.errorMessage = message;
				this.status[provider] = 'error';
				this.activeState = null;
				this.activeProvider = null;
				this.pendingConsentGrantedAt = null;
				this.cancelled = false;
				return;
			}
		}

		// Timeout — the user closed the browser tab or never completed the flow
		await invoke('cancel_integration_oauth', { state }).catch((error) =>
			log.warn(`[oauth] Native timeout cleanup failed: ${error}`)
		);
		if (
			this.cancelled ||
			this.activeState !== state ||
			this.workspaceGeneration !== workspaceGeneration
		)
			return;
		this.errorMessage = 'Sign-in window closed. Retry connecting your mailbox.';
		this.status[provider] = 'error';
		this.activeState = null;
		this.activeProvider = null;
		this.pendingConsentGrantedAt = null;
	}

	// ---------------------------------------------------------------
	// Disconnect
	// ---------------------------------------------------------------

	async disconnectGoogle(connectionId: string): Promise<void> {
		try {
			await invoke('revoke_integration', {
				integrationId: connectionId,
				provider: 'google_gmail'
			});

			this.connections = this.connections.filter((c) => c.id !== connectionId);
			this.adjustActiveMailProviderAfterChange();
			this.status['google_gmail'] = 'idle';
			this.stopPollingTimer();
			this.pollingInterval = 'off';

			log.info('[oauth] Disconnected:', connectionId);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			log.error('[oauth] Disconnect failed:', message);
			errorState.catchError(message, 'Disconnect Google');
		}
	}

	async startMicrosoftOAuth(): Promise<void> {
		if (this.activeProvider || this.providerSettingsSaving) return;
		const workspaceGeneration = this.workspaceGeneration;
		try {
			this.cancelled = false;
			await this.loadProviderSettings();
			if (this.cancelled || this.workspaceGeneration !== workspaceGeneration) return;
			this.ensureMailboxOAuthAllowed('microsoft_outlook');

			this.status['microsoft_outlook'] = 'connecting';
			this.errorMessage = null;
			this.activeProvider = 'microsoft_outlook';
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- serialized OAuth consent timestamp, not reactive date state.
			this.pendingConsentGrantedAt = new Date().toISOString();

			const { authUrl, state } = await invoke<{
				authUrl: string;
				state: string;
				port: number;
			}>('start_integration_oauth', { provider: 'microsoft_outlook' });
			if (this.cancelled || this.workspaceGeneration !== workspaceGeneration) {
				await invoke('cancel_integration_oauth', { state });
				return;
			}

			this.activeState = state;

			const { openUrl } = await import('@tauri-apps/plugin-opener');
			await openUrl(authUrl);

			await this.pollOAuthCallback('microsoft_outlook', state);
		} catch (error) {
			if (this.cancelled || this.workspaceGeneration !== workspaceGeneration) return;
			if (this.activeState)
				await invoke('cancel_integration_oauth', { state: this.activeState }).catch(
					() => undefined
				);
			const message = error instanceof Error ? error.message : String(error);
			log.error('[oauth] Failed to start MS:', message);
			this.errorMessage = message;
			this.status['microsoft_outlook'] = 'error';
			this.activeState = null;
			this.activeProvider = null;
			this.pendingConsentGrantedAt = null;
		}
	}

	async disconnectMicrosoft(connectionId: string): Promise<void> {
		try {
			await invoke('revoke_integration', {
				integrationId: connectionId,
				provider: 'microsoft_outlook'
			});

			this.connections = this.connections.filter((c) => c.id !== connectionId);
			this.adjustActiveMailProviderAfterChange();
			this.status['microsoft_outlook'] = 'idle';
			this.stopPollingTimer();
			this.pollingInterval = 'off';

			log.info('[oauth] Disconnected MS:', connectionId);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			log.error('[oauth] Disconnect MS failed:', message);
			errorState.catchError(message, 'Disconnect Microsoft');
		}
	}

	// ---------------------------------------------------------------
	// Polling interval management
	// ---------------------------------------------------------------

	private adjustActiveMailProviderAfterChange(): void {
		const hasGmail = this.connections.some(
			(c) => c.provider === 'google_gmail' && (c.status === 'active' || c.status === 'expired')
		);
		const hasOutlook = this.connections.some(
			(c) => c.provider === 'microsoft_outlook' && (c.status === 'active' || c.status === 'expired')
		);
		if (!hasGmail && hasOutlook) {
			this.activeMailProvider = 'microsoft_outlook';
		} else if (hasGmail && !hasOutlook) {
			this.activeMailProvider = 'google_gmail';
		}
	}

	/**
	 * Load active connection preferences from SQLite and start the timer when enabled.
	 * if a Gmail connection exists.
	 */
	private applyActiveConnectionSettings(): void {
		const connection = this.activeEmailConnection;
		this.mailRfqDetectionEnabled = connection?.rfqDetectionEnabled ?? true;
		this.pollingInterval = connection?.pollingInterval ?? 'off';
		if (this.pollingInterval !== 'off') this.startPollingTimer();
	}

	/**
	 * Set the polling interval, persist to SQLite, and restart the timer.
	 * Returns true if the value changed.
	 */
	async setPollingInterval(value: 'off' | '15m' | '30m' | '1h'): Promise<boolean> {
		if (this.pollingInterval === value) return false;

		this.stopPollingTimer();
		this.pollingInterval = value;

		const connection = this.activeEmailConnection;
		if (!connection) return false;
		const updated = await invoke<IntegrationConnection>('update_email_connection_settings', {
			connectionId: connection.id,
			pollingInterval: value,
			rfqDetectionEnabled: null
		});
		this.connections = this.connections.map((entry) => (entry.id === updated.id ? updated : entry));

		if (
			value !== 'off' &&
			(this.connectedGoogle || this.connectedMicrosoft || this.anyEmailConnection)
		) {
			this.startPollingTimer();
			log.info(`[mail] Polling every ${value}`);
		}

		return true;
	}

	/** Start the polling timer at the current interval. */
	private startPollingTimer(): void {
		this.stopPollingTimer();
		const ms = IntegrationsState.INTERVAL_MS[this.pollingInterval];
		if (!ms) return;

		this.pollingTimerId = setInterval(() => {
			// Non-blocking background refresh — silent on failure
			this.refreshEmailCache().catch(() => {});
		}, ms);
		log.info(`[mail] Polling timer started (${this.pollingInterval})`);
	}

	/** Stop the polling timer if running. */
	private stopPollingTimer(): void {
		if (this.pollingTimerId !== null) {
			clearInterval(this.pollingTimerId);
			this.pollingTimerId = null;
		}
	}

	/**
	 * Refresh email cache on demand (called from user-triggered refresh or polling timer).
	 * Silently handles failures since background refresh is non-critical.
	 */
	private async refreshEmailCache(): Promise<void> {
		if (this.emailRefreshing) return;
		const conn = this.activeEmailConnection;
		if (!conn?.id) return;
		this.emailRefreshing = true;
		try {
			const connectionId = conn.id;
			const result = await invoke<GmailListResult>('synchronize_email_messages', {
				connectionId: conn.id,
				maxResults: 25
			});

			if (this.activeEmailConnection?.id !== connectionId) {
				log.info(
					'[mail] Aborting background email cache refresh write: connection changed mid-flight'
				);
				return;
			}

			// Success — reset failure counter
			this.pollingFailures = 0;

			if (result.messages.length > 0) {
				// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local dedupe set, not component state.
				const existingIds = new Set(this.emailCache.map((m) => m.id));
				const newMsgs = result.messages.filter((m) => !existingIds.has(m.id));
				if (newMsgs.length > 0) {
					this.emailCache = [...newMsgs, ...this.emailCache];
					if (this.emailCache.length > 500) {
						this.emailCache = this.emailCache.slice(0, 500);
					}
					log.info(
						`[mail] Poll refresh: ${newMsgs.length} new messages (total ${this.emailCache.length})`
					);
				} else {
					log.info(`[mail] Poll refresh: no new messages`);
					toast.success('Inbox refreshed');
				}
				this.emailNextPageToken = result.nextPageToken;
			}
			this.requestEmailClassification();
			this.emailLastFetchAt = Date.now();
		} catch (e) {
			this.pollingFailures++;
			const message = e instanceof Error ? e.message : String(e);
			log.warn(`[mail] Poll refresh failed (${this.pollingFailures}): ${message}`);

			// After 3 consecutive failures, mark the connection as broken so the user sees an error
			if (this.pollingFailures >= 3) {
				this.stopPollingTimer();
				this.errorMessage = `${conn.provider === 'microsoft_outlook' ? 'Outlook' : 'Gmail'} connection lost. Check your account access or reconnect.`;
				this.status[conn.provider] = 'error';
				log.warn('[mail] Polling stopped after 3 consecutive failures');
			}
		} finally {
			this.emailRefreshing = false;
		}
	}

	// ---------------------------------------------------------------
	// Email RFQ classification
	// ---------------------------------------------------------------
	private requestEmailClassification(): void {
		void this.classifyPendingEmails().catch((error) =>
			log.warn(
				`[mail] RFQ classification could not start: ${error instanceof Error ? error.message : String(error)}`
			)
		);
	}

	/**
	 * Classify pending unclassified emails using Kwantflow AI.
	 * Runs one email at a time to avoid hammering the LLM.
	 * Called automatically after fetchEmailMessages() when Kwantflow AI is ready.
	 */
	async classifyPendingEmails(): Promise<void> {
		if (!this.mailRfqDetectionEnabled) return;
		if (this.classifying) {
			this.classificationRerunRequested = true;
			return;
		}

		this.classifying = true;
		try {
			do {
				this.classificationRerunRequested = false;
				await this.classifyPendingEmailPass();
			} while (this.classificationRerunRequested);
		} finally {
			this.classifying = false;
		}
	}

	private async classifyPendingEmailPass(): Promise<void> {
		const workspaceGeneration = this.workspaceGeneration;
		const connection = this.activeEmailConnection;
		if (!connection) return;
		const stored = await invoke<Array<{ providerMessageId: string; verdict: 'rfq' | 'not_rfq' }>>(
			'list_email_rfq_classifications',
			{
				connectionId: connection.id,
				classifierVersion: EMAIL_AI_CONTRACT_VERSION
			}
		);
		if (
			this.workspaceGeneration !== workspaceGeneration ||
			this.activeEmailConnection?.id !== connection.id
		)
			return;
		for (const result of stored) {
			this.rfqResults[this.classificationKey(connection.id, result.providerMessageId)] =
				result.verdict === 'rfq' ? 'yes' : 'no';
		}
		this.rfqResults = { ...this.rfqResults };

		const pending = this.emailMessages
			.filter((message) => !this.getRfqStatus(message.id, connection.id))
			.slice(0, 5);
		log.debug('[mail] RFQ classification state', {
			connectionId: connection.id,
			classifierVersion: EMAIL_AI_CONTRACT_VERSION,
			loadedCount: this.emailMessages.length,
			storedCount: stored.length,
			pendingCount: pending.length
		});
		if (pending.length === 0) return;

		log.info(`[mail] Classifying ${pending.length} emails for RFQ detection`);
		for (const msg of pending) {
			if (
				this.workspaceGeneration !== workspaceGeneration ||
				this.activeEmailConnection?.id !== connection.id
			) {
				break;
			}
			const key = this.classificationKey(connection.id, msg.id);
			this.rfqResults[key] = 'processing';
			this.rfqResults = { ...this.rfqResults };

			try {
				const detail = await this.openEmailMessage(msg.id);
				if (!detail) throw new Error('Full email body could not be loaded');
				const result = await classifyEmailRfq(detail);
				if (this.workspaceGeneration !== workspaceGeneration) break;
				await invoke('save_email_rfq_classification', {
					connectionId: connection.id,
					providerMessageId: msg.id,
					classifierVersion: EMAIL_AI_CONTRACT_VERSION,
					verdict: result.value.verdict,
					modelId: result.modelId
				});
				if (
					this.workspaceGeneration !== workspaceGeneration ||
					this.activeEmailConnection?.id !== connection.id
				)
					break;
				this.rfqResults = {
					...this.rfqResults,
					[key]: result.value.verdict === 'rfq' ? 'yes' : 'no'
				};
			} catch (error) {
				if (this.workspaceGeneration !== workspaceGeneration) break;
				delete this.rfqResults[key];
				this.rfqResults = { ...this.rfqResults };
				const message = error instanceof Error ? error.message : String(error);
				log.warn(`[mail] RFQ classification remains retryable for ${key}: ${message}`);
				if (
					message.includes('background workload yielded to an active foreground request') ||
					message.includes('completion was cancelled')
				) {
					this.classificationRerunRequested = false;
					break;
				}
			}
		}
	}

	private classificationKey(connectionId: string, messageId: string): string {
		return `${connectionId}:${messageId}`;
	}

	getRfqStatus(
		messageId: string,
		connectionId = this.activeEmailConnection?.id
	): 'processing' | 'yes' | 'no' | undefined {
		return connectionId
			? this.rfqResults[this.classificationKey(connectionId, messageId)]
			: undefined;
	}

	async setMailRfqDetectionEnabled(enabled: boolean): Promise<void> {
		const connection = this.activeEmailConnection;
		if (!connection) return;
		const updated = await invoke<IntegrationConnection>('update_email_connection_settings', {
			connectionId: connection.id,
			rfqDetectionEnabled: enabled,
			pollingInterval: null
		});
		this.connections = this.connections.map((entry) => (entry.id === updated.id ? updated : entry));
		this.mailRfqDetectionEnabled = enabled;
		if (enabled) {
			this.requestEmailClassification();
		}
	}

	// ---------------------------------------------------------------
	// Queries
	// ---------------------------------------------------------------

	/** Any Email connection regardless of status — needed so polling can refresh expired tokens. */
	get anyEmailConnection(): IntegrationConnection | undefined {
		return this.connections.find(
			(c) =>
				(c.provider === 'google_gmail' || c.provider === 'microsoft_outlook') &&
				(c.status === 'active' || c.status === 'expired')
		);
	}

	get activeEmailConnection(): IntegrationConnection | undefined {
		return this.connections.find(
			(c) =>
				c.provider === this.activeMailProvider && (c.status === 'active' || c.status === 'expired')
		);
	}

	getConnectionForMessageId(messageId: string): IntegrationConnection | undefined {
		let provider: 'google_gmail' | 'microsoft_outlook' | null = null;
		if (this.gmailCache.some((m) => m.id === messageId)) {
			provider = 'google_gmail';
		} else if (this.outlookCache.some((m) => m.id === messageId)) {
			provider = 'microsoft_outlook';
		} else {
			if (messageId.length === 16 && /^[0-9a-fA-F]+$/.test(messageId)) {
				provider = 'google_gmail';
			} else {
				provider = 'microsoft_outlook';
			}
		}
		return this.connections.find(
			(c) => c.provider === provider && (c.status === 'active' || c.status === 'expired')
		);
	}

	get isEmailConnected(): boolean {
		return !!(this.connectedGoogle || this.connectedMicrosoft);
	}

	/** Any Google Gmail connection regardless of status — needed so polling can refresh expired tokens. */
	get anyGmailConnection(): IntegrationConnection | undefined {
		return this.connections.find(
			(c) => c.provider === 'google_gmail' && (c.status === 'active' || c.status === 'expired')
		);
	}

	get connectedGoogle(): IntegrationConnection | undefined {
		// Include expired tokens — the Rust backend refreshes them on demand
		return this.connections.find(
			(c) => c.provider === 'google_gmail' && (c.status === 'active' || c.status === 'expired')
		);
	}

	get isGoogleConnected(): boolean {
		return !!this.connectedGoogle;
	}

	get connectedMicrosoft(): IntegrationConnection | undefined {
		return this.connections.find(
			(c) => c.provider === 'microsoft_outlook' && (c.status === 'active' || c.status === 'expired')
		);
	}

	get isMicrosoftConnected(): boolean {
		return !!this.connectedMicrosoft;
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Use Kwantflow AI to classify whether an email is RFQ-related.
 * Returns true if the email appears to be an RFQ/quote/tender request.
 */
async function classifyEmailRfq(msg: GmailDetail) {
	const bodyText = normaliseEmailBodyText(msg).slice(0, 8000);
	return runStructuredUtilityTaskResult({
		taskName: 'classify_email_rfq',
		systemInstruction:
			'Classify an estimating-business email. Return rfq only for a direct request to quote, tender, price, or estimate specific work. Return not_rfq for newsletters, automated opportunity digests, marketing, receipts, alerts, and unrelated mail.',
		userContent: [
			`From: ${msg.from}`,
			`To: ${msg.to}`,
			`Cc: ${msg.cc}`,
			`Received: ${msg.date}`,
			`Subject: ${msg.subject || '(no subject)'}`,
			'',
			'Body:',
			bodyText
		].join('\n'),
		outputSchema: EmailRfqClassificationSchema,
		enableThinking: false,
		maxOutputTokens: 96,
		workloadClass: 'background'
	});
}

export const integrationsState = new IntegrationsState();
