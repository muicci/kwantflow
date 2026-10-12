import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LocalAiSetupCard from './local-ai-setup-card.svelte';

const mocks = vi.hoisted(() => ({
	downloadModel: vi.fn(),
	catchError: vi.fn()
}));

vi.mock('$lib/state/ai.svelte.js', () => ({
	aiState: {
		localAiStatus: {
			installState: 'not_downloaded',
			modelReady: false,
			lastError: null,
			expectedDownloadBytes: 3_659_530_240,
			activeDownload: null
		},
		downloadLocalAiModel: mocks.downloadModel
	}
}));
vi.mock('$lib/state/errors.svelte.js', () => ({ errorState: { catchError: mocks.catchError } }));

describe('local AI setup download failure', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.catchError.mockResolvedValue(undefined);
	});
	afterEach(cleanup);

	it.each([false, true])('shows a failed background download with compact=%s', async (compact) => {
		const failure = new Error('Download command rejected');
		mocks.downloadModel.mockRejectedValue(failure);
		const view = render(LocalAiSetupCard, { compact });
		const download = view.getByRole('button', {
			name: compact ? 'Download' : 'Download Kwantflow AI'
		});

		await fireEvent.click(download);
		await waitFor(() =>
			expect(mocks.catchError).toHaveBeenCalledWith(failure, 'Download Kwantflow AI')
		);
		expect((download as HTMLButtonElement).disabled).toBe(false);
		await fireEvent.click(download);
		await waitFor(() => expect(mocks.downloadModel).toHaveBeenCalledTimes(2));
	});
});
