import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('local workspace ownership', () => {
	it('keeps local profile hydration independent from authentication', () => {
		expect(source('src/lib/state/account.svelte.ts')).not.toContain('clearProfileIdentity');
		expect(source('src/lib/state/account.svelte.ts')).toContain(
			'controlDbService.getProfileIdentity()'
		);
		expect(source('src/lib/state/account.svelte.ts')).not.toContain('hosted-auth');
	});

	it('keeps the local workspace registry rooted in a durable local customer identity', () => {
		const schema = source('src-tauri/migrations-control/001_control.sql');
		expect(schema).toContain('customer_id TEXT NOT NULL REFERENCES control_customer_identity(id)');
		expect(schema).toContain('profile_id TEXT NOT NULL REFERENCES profile_identity(id)');
	});
});
