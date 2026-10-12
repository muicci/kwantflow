import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EmailHtmlViewer from './email-html-viewer.svelte';

const mocks = vi.hoisted(() => ({
	isTauri: vi.fn(),
	openUrl: vi.fn(),
	catchError: vi.fn()
}));

vi.mock('$lib/utils/env.js', () => ({ isTauri: mocks.isTauri }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: mocks.openUrl }));
vi.mock('$lib/state/errors.svelte.js', () => ({
	errorState: { catchError: mocks.catchError }
}));

describe('email preview and parent-owned external link actions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.isTauri.mockReturnValue(false);
		mocks.openUrl.mockResolvedValue(undefined);
	});

	afterEach(() => cleanup());

	it('keeps the preview script-free with remote images blocked, embedded raster images and no child navigation', () => {
		const embedded =
			'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
		const view = render(EmailHtmlViewer, {
			html: `<p>Quote information</p><img src="https://example.test/pixel.png"><img src="${embedded}" alt="Embedded drawing"><a href="https://example.test/quote">Read quote</a>`
		});
		const frame = view.container.querySelector('iframe');
		if (!frame) throw new Error('Email iframe unavailable.');
		const child = new DOMParser().parseFromString(frame.srcdoc, 'text/html');
		expect(view.getByText('Remote images are blocked for privacy.')).toBeTruthy();
		expect(view.queryByRole('button', { name: 'Load remote images' })).toBeNull();
		expect(child.body.textContent).toContain('Quote information');
		expect(child.querySelector('a[href]')).toBeNull();
		expect(frame.srcdoc).not.toContain('https://example.test/pixel.png');
		expect(child.querySelector('img[alt="Embedded drawing"]')?.getAttribute('src')).toBe(embedded);
		expect(frame.srcdoc).toContain("default-src 'none'; img-src data: blob:;");
		expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
		expect(frame.getAttribute('sandbox')).toBe('allow-same-origin');
	});

	it('opens a visible destination through the browser adapter after expanding the links', async () => {
		const view = render(EmailHtmlViewer, {
			html: '<a href="https://example.test/quote"><span>Read quote</span></a>'
		});
		await fireEvent.click(view.getByText('Links in this email'));
		await fireEvent.click(view.getByRole('button', { name: 'https://example.test/quote' }));
		await waitFor(() =>
			expect(window.open).toHaveBeenCalledWith(
				'https://example.test/quote',
				'_blank',
				'noopener,noreferrer'
			)
		);
		expect(mocks.openUrl).not.toHaveBeenCalled();
		expect(view.getByText('Read quote')).toBeTruthy();
	});

	it.each([
		'http://example.test/quote',
		'https://example.test/quote',
		'mailto:synthetic@example.test',
		'tel:+61255550123'
	])('opens the supported native destination %s without an application argument', async (href) => {
		mocks.isTauri.mockReturnValue(true);
		const view = render(EmailHtmlViewer, { html: `<a href="${href}">Open contact link</a>` });
		await fireEvent.click(view.getByText('Links in this email'));
		await fireEvent.click(view.getByRole('button', { name: href }));
		await waitFor(() => expect(mocks.openUrl).toHaveBeenCalledWith(href));
		expect(window.open).not.toHaveBeenCalled();
	});

	it.each([
		'',
		'#section',
		'/settings',
		'https://',
		'file:///tmp/private.txt',
		'javascript:alert(1)',
		'data:text/html,unsafe',
		'blob:unsafe',
		'tauri://localhost/settings',
		'ipc://localhost',
		'kwant-asset://localhost/image.png'
	])('does not expose malformed, relative or unsupported target %s', (href) => {
		mocks.isTauri.mockReturnValue(true);
		const view = render(EmailHtmlViewer, { html: `<a href="${href}">Rejected link</a>` });
		expect(view.queryByText('Links in this email')).toBeNull();
		expect(view.container.querySelector('button')).toBeNull();
		expect(view.container.querySelector('iframe')?.srcdoc).not.toContain('href=');
		expect(window.open).not.toHaveBeenCalled();
		expect(mocks.openUrl).not.toHaveBeenCalled();
	});

	it('shows the actual destination and escapes a misleading markup label', async () => {
		const view = render(EmailHtmlViewer, {
			html: '<a href="https://untrusted.example.test/quote">&lt;img src=x onerror=alert(1)&gt;</a>'
		});
		await fireEvent.click(view.getByText('Links in this email'));
		expect(view.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
		expect(view.getByRole('button', { name: 'https://untrusted.example.test/quote' })).toBeTruthy();
		expect(view.container.querySelector('details img')).toBeNull();
	});

	it('reports a native opener failure through the shared error state', async () => {
		mocks.isTauri.mockReturnValue(true);
		const failure = new Error('Synthetic provider unavailable');
		mocks.openUrl.mockRejectedValueOnce(failure);
		const view = render(EmailHtmlViewer, { html: '<a href="https://example.test/quote">Read</a>' });
		await fireEvent.click(view.getByText('Links in this email'));
		await fireEvent.click(view.getByRole('button', { name: 'https://example.test/quote' }));
		await waitFor(() =>
			expect(mocks.catchError).toHaveBeenCalledWith(failure, 'Open email link', undefined, {
				description: 'Could not open this link in your browser.'
			})
		);
		expect(window.open).not.toHaveBeenCalled();
	});

	it('reports a browser adapter failure without invoking native APIs', async () => {
		const failure = new Error('Synthetic browser unavailable');
		vi.mocked(window.open).mockImplementationOnce(() => {
			throw failure;
		});
		const view = render(EmailHtmlViewer, { html: '<a href="https://example.test/quote">Read</a>' });
		await fireEvent.click(view.getByText('Links in this email'));
		await fireEvent.click(view.getByRole('button', { name: 'https://example.test/quote' }));
		await waitFor(() =>
			expect(mocks.catchError).toHaveBeenCalledWith(
				failure,
				'Open email link',
				undefined,
				expect.any(Object)
			)
		);
		expect(mocks.openUrl).not.toHaveBeenCalled();
	});

	it('replaces destinations when the HTML changes without retaining old actions', async () => {
		mocks.isTauri.mockReturnValue(true);
		const view = render(EmailHtmlViewer, {
			html: '<a href="https://old.example.test/quote">Old</a>'
		});
		await fireEvent.click(view.getByText('Links in this email'));
		expect(view.getByRole('button', { name: 'https://old.example.test/quote' })).toBeTruthy();
		await view.rerender({ html: '<a href="https://new.example.test/quote">New</a>' });
		expect(view.queryByRole('button', { name: 'https://old.example.test/quote' })).toBeNull();
		await fireEvent.click(view.getByRole('button', { name: 'https://new.example.test/quote' }));
		await waitFor(() =>
			expect(mocks.openUrl).toHaveBeenCalledExactlyOnceWith('https://new.example.test/quote')
		);
		await view.rerender({ html: '<p>No links</p>' });
		expect(view.queryByText('Links in this email')).toBeNull();
		expect(view.container.querySelector('button')).toBeNull();
	});
});
