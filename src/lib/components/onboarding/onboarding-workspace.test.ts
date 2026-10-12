import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OnboardingWorkspace from './onboarding-workspace.svelte';

const mocks = vi.hoisted(() => ({
	createWorkspace: vi.fn(),
	completeSetupImportStep: vi.fn(),
	completeLocalAiStep: vi.fn(),
	catchError: vi.fn(),
	onboardingState: {
		currentStep: 'setup_import_optional',
		hasPendingWorkspaceSetup: false,
		bootstrapErrorMessage: null as string | null,
		workspaceValues: {
			workspaceName: 'Local workspace',
			countryCode: 'AU',
			businessName: '',
			logoFilePath: '',
			businessContactFirstName: '',
			businessContactLastName: '',
			businessContactPhone: '',
			businessContactEmail: '',
			businessIdValue: '',
			primaryOperatorRole: 'owner_founder',
			industry: ''
		}
	}
}));

vi.mock('$lib/state/onboarding.svelte.js', () => ({
	onboardingState: {
		get currentStep() {
			return mocks.onboardingState.currentStep;
		},
		get workspaceValues() {
			return mocks.onboardingState.workspaceValues;
		},
		get hasPendingWorkspaceSetup() {
			return mocks.onboardingState.hasPendingWorkspaceSetup;
		},
		get bootstrapErrorMessage() {
			return mocks.onboardingState.bootstrapErrorMessage;
		},
		createWorkspace: mocks.createWorkspace,
		completeSetupImportStep: mocks.completeSetupImportStep,
		completeLocalAiStep: mocks.completeLocalAiStep
	}
}));
vi.mock('$lib/state/errors.svelte.js', () => ({ errorState: { catchError: mocks.catchError } }));
vi.mock('$lib/components/user/setup-import-dialog.svelte', async () => ({
	default: (await import('./test-onboarding-import-dialog.svelte')).default
}));
vi.mock('$lib/components/local-ai-setup-card.svelte', async () => ({
	default: (await import('./test-onboarding-import-dialog.svelte')).default
}));

function deferred() {
	let resolve!: () => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<void>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

describe('onboarding failure recovery', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.createWorkspace.mockReset().mockResolvedValue(undefined);
		mocks.completeSetupImportStep.mockReset().mockResolvedValue(undefined);
		mocks.completeLocalAiStep.mockReset().mockResolvedValue(undefined);
		mocks.catchError.mockResolvedValue(undefined);
		mocks.onboardingState.currentStep = 'setup_import_optional';
		mocks.onboardingState.hasPendingWorkspaceSetup = false;
		mocks.onboardingState.bootstrapErrorMessage = null;
		mocks.onboardingState.workspaceValues.workspaceName = 'Local workspace';
	});

	afterEach(cleanup);

	it.each(['workspace_setup', 'workspace_creation_failed'])(
		'retries an existing workspace in %s without requiring its creation form',
		async (currentStep) => {
			mocks.onboardingState.currentStep = currentStep;
			mocks.onboardingState.hasPendingWorkspaceSetup = true;
			mocks.onboardingState.bootstrapErrorMessage = 'Cannot initialize workspace';
			mocks.onboardingState.workspaceValues.workspaceName = '';
			const setup = deferred();
			mocks.createWorkspace.mockReturnValueOnce(setup.promise);
			const view = render(OnboardingWorkspace);
			expect(view.getByText('Cannot initialize workspace')).toBeTruthy();
			expect(view.queryByRole('textbox', { name: 'Workspace name' })).toBeNull();
			await fireEvent.click(view.getByRole('button', { name: 'Retry workspace setup' }));
			expect(mocks.createWorkspace).toHaveBeenCalledWith(mocks.onboardingState.workspaceValues);
			expect(
				(view.getByRole('button', { name: 'Finishing setup...' }) as HTMLButtonElement).disabled
			).toBe(true);
			setup.reject(new Error('Cannot initialize workspace'));
			await waitFor(() =>
				expect(
					(view.getByRole('button', { name: 'Retry workspace setup' }) as HTMLButtonElement)
						.disabled
				).toBe(false)
			);
			await fireEvent.click(view.getByRole('button', { name: 'Retry workspace setup' }));
			await waitFor(() => expect(mocks.createWorkspace).toHaveBeenCalledTimes(2));
		}
	);

	it('reports failed import skipping and leaves the action available for retry', async () => {
		const error = new Error('Cannot save setup progress');
		mocks.completeSetupImportStep.mockRejectedValueOnce(error);
		const view = render(OnboardingWorkspace);
		const skip = view.getByRole('button', { name: 'Skip for now' });
		await fireEvent.click(skip);
		await waitFor(() =>
			expect(mocks.catchError).toHaveBeenCalledWith(error, 'Continue workspace setup')
		);
		await waitFor(() => expect((skip as HTMLButtonElement).disabled).toBe(false));
		await fireEvent.click(skip);
		await waitFor(() => expect(mocks.completeSetupImportStep).toHaveBeenCalledTimes(2));
	});

	it('reports failed AI step completion and leaves Continue available for retry', async () => {
		mocks.onboardingState.currentStep = 'local_ai_optional';
		const error = new Error('Cannot finish setup');
		mocks.completeLocalAiStep.mockRejectedValueOnce(error);
		const view = render(OnboardingWorkspace);
		const next = view.getByRole('button', { name: 'Continue' });
		await fireEvent.click(next);
		await waitFor(() =>
			expect(mocks.catchError).toHaveBeenCalledWith(error, 'Finish workspace setup')
		);
		await waitFor(() => expect((next as HTMLButtonElement).disabled).toBe(false));
		await fireEvent.click(next);
		await waitFor(() => expect(mocks.completeLocalAiStep).toHaveBeenCalledTimes(2));
	});

	it('keeps imported setup open until progress saves and preserves it after a failure', async () => {
		const progress = deferred();
		const error = new Error('Cannot save imported setup progress');
		mocks.completeSetupImportStep.mockReturnValueOnce(progress.promise);
		const view = render(OnboardingWorkspace);
		await fireEvent.click(view.getByRole('button', { name: 'Import data' }));
		await fireEvent.click(view.getByRole('button', { name: 'Finish test import' }));
		expect(view.getByRole('button', { name: 'Finish test import' })).toBeTruthy();
		expect((view.getByRole('button', { name: 'Finishing...' }) as HTMLButtonElement).disabled).toBe(
			true
		);
		progress.reject(error);
		await waitFor(() =>
			expect(mocks.catchError).toHaveBeenCalledWith(error, 'Continue workspace setup')
		);
		expect(view.getByRole('button', { name: 'Finish test import' })).toBeTruthy();
		await waitFor(() =>
			expect(
				(view.getByRole('button', { name: 'Skip for now' }) as HTMLButtonElement).disabled
			).toBe(false)
		);
		await fireEvent.click(view.getByRole('button', { name: 'Finish test import' }));
		await waitFor(() =>
			expect(view.queryByRole('button', { name: 'Finish test import' })).toBeNull()
		);
		expect(mocks.completeSetupImportStep).toHaveBeenCalledTimes(2);
	});
});
