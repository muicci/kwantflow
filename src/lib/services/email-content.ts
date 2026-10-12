const DOCUMENT_TAGS = new Set([
	'a',
	'b',
	'blockquote',
	'br',
	'caption',
	'code',
	'del',
	'div',
	'em',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'hr',
	'i',
	'img',
	'li',
	'ol',
	'p',
	'pre',
	's',
	'span',
	'strong',
	'sub',
	'sup',
	'table',
	'tbody',
	'td',
	'tfoot',
	'th',
	'thead',
	'tr',
	'u',
	'ul'
]);
const BLOCKED_TAGS = new Set([
	'audio',
	'base',
	'embed',
	'form',
	'iframe',
	'input',
	'link',
	'meta',
	'object',
	'script',
	'source',
	'style',
	'svg',
	'template',
	'video'
]);
const GLOBAL_ATTRIBUTES = new Set(['alt', 'colspan', 'rowspan', 'scope', 'title']);
const TAG_ATTRIBUTES = new Map<string, Set<string>>([
	['a', new Set(['href', 'title'])],
	['img', new Set(['alt', 'src', 'title'])],
	['td', new Set(['colspan', 'rowspan'])],
	['th', new Set(['colspan', 'rowspan', 'scope'])]
]);

export type ParsedEmailFileContent = {
	subject: string;
	from: string;
	to: string;
	cc: string;
	date: string;
	messageId: string;
	threadIndex: string;
	attachmentNames: string[];
	htmlBody: string | null;
	textBody: string | null;
};

function formatEmailAddress(
	value: { name: string; email: string } | Array<{ name: string; email: string }> | null
): string {
	if (!value) return '';
	const addresses = Array.isArray(value) ? value : [value];
	return addresses
		.map((address) =>
			address.name.trim() ? `${address.name.trim()} <${address.email}>` : address.email
		)
		.join(', ');
}

export async function parseEmailFileContent(input: string): Promise<ParsedEmailFileContent> {
	const { readEml } = await import('eml-parse-js');
	const parsed = readEml(input);
	if (parsed instanceof Error || typeof parsed === 'string') {
		throw parsed instanceof Error ? parsed : new Error(parsed);
	}
	const headers = Object.fromEntries(
		Object.entries(parsed.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value])
	);
	return {
		subject: parsed.subject ?? '',
		from: formatEmailAddress(parsed.from),
		to: formatEmailAddress(parsed.to),
		cc: formatEmailAddress(parsed.cc ?? null),
		date:
			parsed.date instanceof Date && Number.isFinite(parsed.date.getTime())
				? parsed.date.toISOString()
				: String(headers.date ?? parsed.date ?? ''),
		messageId: String(headers['message-id'] ?? ''),
		threadIndex: String(headers['thread-index'] ?? ''),
		attachmentNames: (parsed.attachments ?? [])
			.map((attachment) => attachment.filename ?? attachment.name ?? '')
			.filter(Boolean),
		htmlBody: typeof parsed.html === 'string' && parsed.html.trim() ? parsed.html : null,
		textBody: typeof parsed.text === 'string' && parsed.text.trim() ? parsed.text : null
	};
}

function parseRawHeader(headers: string | undefined, name: string): string {
	if (!headers) return '';
	const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return headers.match(new RegExp(`^${escapedName}:\\s*(.+)$`, 'im'))?.[1]?.trim() ?? '';
}

function formatMsgRecipients(
	recipients: Array<{
		name?: string;
		email?: string;
		smtpAddress?: string;
		recipType?: string;
	}>,
	recipType: 'to' | 'cc'
): string {
	return recipients
		.filter((recipient) => recipient.recipType?.toLowerCase() === recipType)
		.map((recipient) => {
			const email = recipient.smtpAddress?.trim() || recipient.email?.trim() || '';
			const name = recipient.name?.trim() || '';
			if (name && email && name !== email) return `${name} <${email}>`;
			return email || name;
		})
		.filter(Boolean)
		.join(', ');
}

export async function parseOutlookMsgFileContent(
	input: Uint8Array
): Promise<ParsedEmailFileContent> {
	type MsgFileData = import('@kenjiuno/msgreader').FieldsData;
	type MsgReaderInstance = { getFileData(): MsgFileData };
	type MsgReaderConstructor = new (bytes: ArrayBuffer | DataView) => MsgReaderInstance;
	const imported = await import('@kenjiuno/msgreader');
	const defaultExport = imported.default as unknown;
	const candidate =
		typeof defaultExport === 'function'
			? defaultExport
			: (defaultExport as { default?: unknown } | null)?.default;
	if (typeof candidate !== 'function') {
		throw new Error('Outlook MSG parser did not expose its documented constructor.');
	}
	// The parser uses realm-sensitive `instanceof ArrayBuffer` checks. Copy into a
	// DataView owned by this window so Node/JSDOM Buffers and Tauri Uint8Arrays
	// cross the same documented binary boundary.
	const parserBytes = Uint8Array.from(input);
	const parsed = new (candidate as MsgReaderConstructor)(
		new DataView(parserBytes.buffer)
	).getFileData();
	if (parsed.error) throw new Error(parsed.error);
	const recipients = parsed.recipients ?? [];
	const senderEmail =
		parsed.creatorSMTPAddress?.trim() ||
		parsed.senderEmail?.trim() ||
		parsed.lastModifierSMTPAddress?.trim() ||
		'';
	const senderName = parsed.senderName?.trim() || '';
	const htmlBody =
		parsed.bodyHtml?.trim() ||
		(parsed.html ? new TextDecoder('utf-8').decode(parsed.html).trim() : '');

	return {
		subject: parsed.subject?.trim() ?? '',
		from:
			senderName && senderEmail && senderName !== senderEmail
				? `${senderName} <${senderEmail}>`
				: senderEmail || senderName,
		to: formatMsgRecipients(recipients, 'to'),
		cc: formatMsgRecipients(recipients, 'cc'),
		date: parsed.messageDeliveryTime ?? parsed.clientSubmitTime ?? parsed.creationTime ?? '',
		messageId: parseRawHeader(parsed.headers, 'Message-ID'),
		threadIndex: parseRawHeader(parsed.headers, 'Thread-Index'),
		attachmentNames: (parsed.attachments ?? [])
			.map((attachment) => {
				const name = attachment.fileName ?? attachment.fileNameShort ?? attachment.name ?? '';
				return attachment.innerMsgContent && name ? `${name} (embedded message)` : name;
			})
			.filter(Boolean),
		htmlBody: htmlBody || null,
		textBody: parsed.body?.trim() || null
	};
}

export async function parseEmailFileBytes(
	input: Uint8Array,
	filePathOrName: string
): Promise<ParsedEmailFileContent> {
	return filePathOrName.toLowerCase().endsWith('.msg')
		? parseOutlookMsgFileContent(input)
		: parseEmailFileContent(new TextDecoder('utf-8').decode(input));
}

function unwrap(element: Element): void {
	const parent = element.parentNode;
	if (!parent) {
		element.remove();
		return;
	}
	while (element.firstChild) parent.insertBefore(element.firstChild, element);
	parent.removeChild(element);
}

function isSafeLink(value: string): boolean {
	try {
		const protocol = new URL(value).protocol;
		return ['http:', 'https:', 'mailto:', 'tel:'].includes(protocol);
	} catch {
		return false;
	}
}

function isEmbeddedImage(value: string): boolean {
	return /^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(value.trim());
}

export function normaliseEmailBodyText(input: {
	bodyText: string;
	bodyHtml: string | null;
	snippet: string;
}): string {
	const plainText = input.bodyText.trim();
	if (plainText) return plainText;

	if (input.bodyHtml?.trim()) {
		const document = new DOMParser().parseFromString(input.bodyHtml, 'text/html');
		for (const blocked of document.body.querySelectorAll('script,style,template')) blocked.remove();
		for (const lineBreak of document.body.querySelectorAll('br')) {
			lineBreak.replaceWith(document.createTextNode('\n'));
		}
		for (const block of document.body.querySelectorAll(
			'p,li,tr,h1,h2,h3,h4,h5,h6,blockquote,pre,div,caption'
		)) {
			block.append(document.createTextNode('\n'));
		}
		const htmlText = (document.body.textContent ?? '')
			.split('\n')
			.map((line) => line.replace(/\s+/g, ' ').trim())
			.filter(Boolean)
			.join('\n')
			.trim();
		if (htmlText) return htmlText;
	}

	return input.snippet.trim();
}

export function sanitiseEmailHtml(input: string): {
	html: string;
	blockedRemoteImageCount: number;
	links: Array<{ href: string; label: string }>;
} {
	const document = new DOMParser().parseFromString(input, 'text/html');
	let blockedRemoteImageCount = 0;
	const elements = Array.from(document.body.querySelectorAll('*')).reverse();

	for (const element of elements) {
		const tagName = element.tagName.toLowerCase();
		if (!DOCUMENT_TAGS.has(tagName)) {
			if (BLOCKED_TAGS.has(tagName)) element.remove();
			else unwrap(element);
			continue;
		}

		for (const attribute of [...element.attributes]) {
			const name = attribute.name.toLowerCase();
			const value = attribute.value.trim();
			const allowedForTag = TAG_ATTRIBUTES.get(tagName);
			if (
				name.startsWith('on') ||
				name === 'style' ||
				name === 'srcset' ||
				(!GLOBAL_ATTRIBUTES.has(name) && !allowedForTag?.has(name))
			) {
				element.removeAttribute(attribute.name);
				continue;
			}

			if (tagName === 'a' && name === 'href' && !isSafeLink(value)) {
				element.removeAttribute(attribute.name);
				continue;
			}

			if (tagName === 'img' && name === 'src') {
				if (!isEmbeddedImage(value)) {
					if (/^https?:/i.test(value)) blockedRemoteImageCount += 1;
					element.removeAttribute(attribute.name);
				}
			}
		}
	}

	const links: Array<{ href: string; label: string }> = [];
	const destinations = new Set<string>();
	for (const anchor of document.body.querySelectorAll('a[href]')) {
		const href = new URL(anchor.getAttribute('href') ?? '').toString();
		if (!destinations.has(href)) {
			destinations.add(href);
			links.push({ href, label: anchor.textContent?.replace(/\s+/g, ' ').trim() || href });
		}
		anchor.removeAttribute('href');
	}

	return { html: document.body.innerHTML, blockedRemoteImageCount, links };
}

export function buildEmailSrcdoc(
	bodyHtml: string,
	options: {
		foreground: string;
		background: string;
		link: string;
		border: string;
	}
): string {
	return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline';">
<style>
body { box-sizing: border-box; margin: 16px; overflow-wrap: break-word; color: ${options.foreground}; background: ${options.background}; font: 14px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
img { max-width: 100%; height: auto; }
a { color: ${options.link}; }
table { max-width: 100%; border-color: ${options.border}; }
</style>
</head>
<body>${bodyHtml}</body>
</html>`;
}
