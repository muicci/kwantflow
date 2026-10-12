import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/plugin-log', () => ({
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	debug: vi.fn(),
	trace: vi.fn(),
	log: vi.fn(),
	attachConsole: vi.fn()
}));

const TOAST_SONNER_MOCK = vi.hoisted(() => ({ toast: { error: vi.fn() } }));

vi.mock('svelte-sonner', () => TOAST_SONNER_MOCK);

describe('errorState', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
	});

	it('uses a safe toast description override while preserving the raw error state', async () => {
		const { errorState } = await import('./errors.svelte');

		await errorState.catchError(
			new Error('Cost code 14 could not resolve classification system 99'),
			'Load implementation file',
			undefined,
			{
				description:
					'The implementation file could not be loaded. Check the supplied ZIP package and try again.'
			}
		);

		expect(errorState.lastError).toBe('Cost code 14 could not resolve classification system 99');
		expect(TOAST_SONNER_MOCK.toast.error).toHaveBeenCalledWith('Load implementation file', {
			description:
				'The implementation file could not be loaded. Check the supplied ZIP package and try again.',
			action: { label: 'Dismiss', onClick: expect.any(Function) }
		});
	});

	it('defaults to a friendly, non-technical description when no override is provided', async () => {
		const { errorState } = await import('./errors.svelte');

		await errorState.catchError(
			new Error('Fatal database constraint violation at cost_code foreign key check'),
			'Save estimate data'
		);

		expect(errorState.lastError).toBe(
			'Fatal database constraint violation at cost_code foreign key check'
		);
		expect(TOAST_SONNER_MOCK.toast.error).toHaveBeenCalledWith('Save estimate data', {
			description: 'Something went wrong. Please try again.',
			action: { label: 'Dismiss', onClick: expect.any(Function) }
		});
	});

	it('suppresses toast notifications entirely when silent option is set', async () => {
		const { errorState } = await import('./errors.svelte');

		await errorState.catchError(
			new Error('LiteRT engine load failure due to missing symbols'),
			'Verify Kwantflow AI',
			undefined,
			{ silent: true }
		);

		expect(errorState.lastError).toBe('LiteRT engine load failure due to missing symbols');
		expect(TOAST_SONNER_MOCK.toast.error).not.toHaveBeenCalled();
	});
});
