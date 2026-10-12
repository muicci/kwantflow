import { cleanup, render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParsedEmailFileContent } from '$lib/services/email-content.js';
import EmailFileViewer from './email-file-viewer.svelte';

const mocks = vi.hoisted(() => ({
	readVaultFile: vi.fn(),
	parseEmailFileBytes: vi.fn(),
	logger: { error: vi.fn() }
}));

vi.mock('$lib/services/assets.js', () => ({ readVaultFile: mocks.readVaultFile }));
vi.mock('$lib/services/logger.js', () => ({ createLogger: () => mocks.logger }));
vi.mock('$lib/services/email-content.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/services/email-content.js')>()),
	parseEmailFileBytes: mocks.parseEmailFileBytes
}));
vi.mock('$lib/state/errors.svelte.js', () => ({ errorState: { catchError: vi.fn() } }));

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function email(label: string): ParsedEmailFileContent {
	return {
		subject: `Subject ${label}`,
		from: `${label}@example.test`,
		to: 'operator@example.test',
		cc: '',
		date: '',
		messageId: '',
		threadIndex: '',
		attachmentNames: [],
		htmlBody: null,
		textBody: `Body ${label}`
	};
}

async function settle() {
	await Promise.resolve();
	await tick();
}

describe('local email viewer load ownership', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.readVaultFile.mockReset().mockResolvedValue(new Uint8Array([1]));
		mocks.parseEmailFileBytes.mockReset();
	});
	afterEach(() => cleanup());

	it('ignores a previous parse after another file finishes loading', async () => {
		const previous = deferred<ParsedEmailFileContent>();
		mocks.parseEmailFileBytes
			.mockReturnValueOnce(previous.promise)
			.mockResolvedValueOnce(email('B'));
		const view = render(EmailFileViewer, { filePath: 'A.eml' });
		await waitFor(() => expect(mocks.parseEmailFileBytes).toHaveBeenCalledTimes(1));
		await view.rerender({ filePath: 'B.eml' });
		await waitFor(() => expect(view.getByText('Body B')).toBeTruthy());
		previous.resolve(email('A'));
		await settle();
		expect(view.getByText('Body B')).toBeTruthy();
		expect(view.getByText('Subject B')).toBeTruthy();
		expect(view.queryByText('Body A')).toBeNull();
	});

	it('keeps the newest A parse after A to B to A changes', async () => {
		const oldA = deferred<ParsedEmailFileContent>();
		const oldB = deferred<ParsedEmailFileContent>();
		mocks.parseEmailFileBytes
			.mockReturnValueOnce(oldA.promise)
			.mockReturnValueOnce(oldB.promise)
			.mockResolvedValueOnce(email('current A'));
		const view = render(EmailFileViewer, { filePath: 'A.msg' });
		await waitFor(() => expect(mocks.parseEmailFileBytes).toHaveBeenCalledTimes(1));
		await view.rerender({ filePath: 'B.msg' });
		await waitFor(() => expect(mocks.parseEmailFileBytes).toHaveBeenCalledTimes(2));
		await view.rerender({ filePath: 'A.msg' });
		await waitFor(() => expect(view.getByText('Body current A')).toBeTruthy());
		oldA.resolve(email('obsolete A'));
		oldB.resolve(email('obsolete B'));
		await settle();
		expect(view.getByText('Body current A')).toBeTruthy();
		expect(view.getByText('Subject current A')).toBeTruthy();
		expect(view.queryByText('Body obsolete A')).toBeNull();
		expect(view.queryByText('Body obsolete B')).toBeNull();
	});

	it('does not start a parser for an obsolete A read after A to B to A changes', async () => {
		const oldA = deferred<Uint8Array>();
		mocks.readVaultFile
			.mockReturnValueOnce(oldA.promise)
			.mockResolvedValueOnce(new Uint8Array([2]))
			.mockResolvedValueOnce(new Uint8Array([3]));
		mocks.parseEmailFileBytes.mockImplementation(async (bytes: Uint8Array) =>
			email(bytes[0] === 3 ? 'current A' : 'B')
		);
		const view = render(EmailFileViewer, { filePath: 'A.eml' });
		await waitFor(() => expect(mocks.readVaultFile).toHaveBeenCalledTimes(1));
		await view.rerender({ filePath: 'B.eml' });
		await waitFor(() => expect(view.getByText('Body B')).toBeTruthy());
		await view.rerender({ filePath: 'A.eml' });
		await waitFor(() => expect(view.getByText('Body current A')).toBeTruthy());
		oldA.resolve(new Uint8Array([1]));
		await settle();
		expect(mocks.parseEmailFileBytes).toHaveBeenCalledTimes(2);
		expect(view.getByText('Body current A')).toBeTruthy();
	});

	it('does not parse a file after unmount while its read is pending', async () => {
		const pending = deferred<Uint8Array>();
		mocks.readVaultFile.mockReturnValueOnce(pending.promise);
		const view = render(EmailFileViewer, { filePath: 'A.eml' });
		await waitFor(() => expect(mocks.readVaultFile).toHaveBeenCalledOnce());
		view.unmount();
		pending.resolve(new Uint8Array([1]));
		await settle();
		expect(mocks.parseEmailFileBytes).not.toHaveBeenCalled();
		expect(mocks.logger.error).not.toHaveBeenCalled();
	});

	it('does not report a parse failure after unmount', async () => {
		const pending = deferred<ParsedEmailFileContent>();
		mocks.parseEmailFileBytes.mockReturnValueOnce(pending.promise);
		const view = render(EmailFileViewer, { filePath: 'A.msg' });
		await waitFor(() => expect(mocks.parseEmailFileBytes).toHaveBeenCalledOnce());
		view.unmount();
		pending.reject(new Error('Synthetic malformed message'));
		await settle();
		expect(mocks.logger.error).not.toHaveBeenCalled();
	});

	it('reports a current parse failure and allows the next file to load', async () => {
		mocks.parseEmailFileBytes
			.mockRejectedValueOnce(new Error('Synthetic malformed message'))
			.mockResolvedValueOnce(email('B'));
		const view = render(EmailFileViewer, { filePath: 'A.msg' });
		await waitFor(() => expect(view.getByText('Could not read this email file.')).toBeTruthy());
		expect(mocks.logger.error).toHaveBeenCalledOnce();
		await view.rerender({ filePath: 'B.eml' });
		await waitFor(() => expect(view.getByText('Body B')).toBeTruthy());
		expect(view.queryByText('Could not read this email file.')).toBeNull();
	});
});
