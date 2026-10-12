import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourcePath = resolve(process.cwd(), 'src-tauri/src/integrations/mod.rs');
const statePath = resolve(process.cwd(), 'src/lib/state/integrations.svelte.ts');
const workspaceRuntimePath = resolve(process.cwd(), 'src-tauri/src/db/workspace.rs');

function readSource(): string {
	return readFileSync(sourcePath, 'utf8');
}

describe('email integration OAuth native contract', () => {
	it('requires user-owned desktop OAuth registrations without founder or secret fallbacks', () => {
		const source = readSource();

		expect(source).toContain('get_email_provider_settings');
		expect(source).toContain('set_email_provider_settings');
		expect(source).not.toContain('GOOGLE_CLIENT_ID');
		expect(source).not.toContain('MICROSOFT_CLIENT_ID');
		expect(source).not.toContain('std::env::var');
		expect(source).not.toContain('GOOGLE_OAUTH_CLIENT_ID');
		expect(source).not.toContain('GOOGLE_OAUTH_CLIENT_SECRET');
		expect(source).not.toContain('client_secret');
		expect(source).toContain('code_challenge_method=S256');
		expect(source).toContain('access_type=offline');
	});

	it('stores provider tokens behind real native credential protection', () => {
		const source = readSource();

		expect(source).toContain('KEYCHAIN_SERVICE');
		expect(source).toContain('set_generic_password');
		expect(source).toContain('get_generic_password');
		expect(source).toContain('delete_generic_password');
		expect(source).toContain('workspace_integrations');
		expect(source).toContain('delete_workspace_token_bundles');
		const workspaceRuntime = readFileSync(workspaceRuntimePath, 'utf8');
		expect(workspaceRuntime).toContain('Read workspace credentials before delete');
		expect(workspaceRuntime).toContain('delete_workspace_token_bundles(&app, &integration_ids)');
		const secureStore = readFileSync(
			resolve(process.cwd(), 'src-tauri/src/secure_store.rs'),
			'utf8'
		);
		expect(secureStore).toContain('passwords::set_generic_password');
		expect(secureStore).toContain('CryptProtectData');
		expect(secureStore).toContain('CryptUnprotectData');
		expect(secureStore).not.toContain('BASE64_STANDARD');
	});

	it('disconnects locally without revoking provider consent or other workspace grants', () => {
		const source = readSource();
		const disconnect = source.slice(
			source.indexOf('pub async fn revoke_integration('),
			source.indexOf('pub async fn list_email_messages(')
		);
		expect(disconnect).toContain('delete_token_bundle(&app, &integration_id)?');
		expect(disconnect).toContain("UPDATE workspace_integrations SET status = 'revoked'");
		expect(disconnect).not.toContain('reqwest');
		expect(disconnect).not.toContain('provider_config(');
		expect(disconnect).not.toContain('load_token_bundle(');
	});

	it('keeps mailbox isolation independent of hosted accounts and commercial plans', () => {
		const state = readFileSync(statePath, 'utf8');

		expect(state).not.toContain('cloudWorkspaceId');
		expect(state).not.toContain('hostedAuthSessionService');
		expect(state).not.toContain('/api/mailbox-');
		expect(state).not.toContain('emailIntegrationLimit');
		expect(state).toContain('resetForWorkspaceChange');
		expect(state).toContain('this.workspaceGeneration !== workspaceGeneration');
	});
});
