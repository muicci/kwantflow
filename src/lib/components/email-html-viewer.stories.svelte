<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, spyOn, waitFor } from 'storybook/test';
	import EmailHtmlViewer from './email-html-viewer.svelte';

	const embedded = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
	const { Story } = defineMeta({
		title: 'Product/Email preview',
		component: EmailHtmlViewer
	});
</script>

<Story
	name="Offline images and safe links"
	args={{
		html:
			'<p>Synthetic quote information</p><img src="https://synthetic.example.test/pixel.png">' +
			`<img src="${embedded}" alt="Embedded drawing">` +
			'<a href="https://synthetic.example.test/quote"><span>Read quote</span></a>',
		class: 'h-80 w-full'
	}}
	play={async ({ canvasElement }) => {
		expect('__TAURI_INTERNALS__' in window).toBe(false);
		const frame = canvasElement.querySelector('iframe');
		if (!frame) throw new Error('Email iframe unavailable.');
		await waitFor(() => {
			expect(frame.contentDocument?.readyState).toBe('complete');
			expect(frame.contentDocument?.body.textContent).toContain('Synthetic quote information');
			expect(
				frame.contentDocument?.querySelector<HTMLImageElement>('img[alt="Embedded drawing"]')
					?.naturalWidth
			).toBe(1);
		});
		expect(canvasElement.textContent).toContain('Remote images are blocked for privacy.');
		expect(frame.contentDocument?.querySelector('a[href]')).toBeNull();
		expect(frame.srcdoc).not.toContain('https://synthetic.example.test/pixel.png');
		expect(frame.getAttribute('sandbox')).toBe('allow-same-origin');
		expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
		expect(frame.srcdoc).toContain("default-src 'none'; img-src data: blob:;");

		const summary = canvasElement.querySelector('summary');
		if (!summary) throw new Error('Email links control unavailable.');
		expect(summary.textContent).toBe('Links in this email');
		summary.click();
		const action = canvasElement.querySelector('details button');
		if (!(action instanceof HTMLButtonElement)) throw new Error('Email link action unavailable.');
		expect(action.textContent?.trim()).toBe('https://synthetic.example.test/quote');
		expect(action.ownerDocument).toBe(canvasElement.ownerDocument);
		const open = spyOn(window, 'open').mockReturnValue(null);
		try {
			action.click();
			await waitFor(() =>
				expect(open).toHaveBeenCalledWith(
					'https://synthetic.example.test/quote',
					'_blank',
					'noopener,noreferrer'
				)
			);
		} finally {
			open.mockRestore();
		}
	}}
/>
