import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const routeSource = readFileSync('src/routes/preview/email/[messageId]/+page.svelte', 'utf8');
const fileViewerSource = readFileSync('src/lib/components/assets/email-file-viewer.svelte', 'utf8');

describe('shared email HTML viewer', () => {
	it('is used by mailbox and local email previews', () => {
		expect(routeSource).toContain(
			"import EmailHtmlViewer from '$lib/components/email-html-viewer.svelte'"
		);
		expect(fileViewerSource).toContain(
			"import EmailHtmlViewer from '$lib/components/email-html-viewer.svelte'"
		);
		expect(routeSource).not.toContain('sanitiseForIframe');
		expect(fileViewerSource).not.toContain('srcdoc={htmlBody}');
	});
});
