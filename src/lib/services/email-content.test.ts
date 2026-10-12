import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
	normaliseEmailBodyText,
	parseEmailFileBytes,
	parseEmailFileContent,
	sanitiseEmailHtml
} from './email-content.js';

function readBase64Fixture(path: string): Uint8Array {
	return Buffer.from(readFileSync(path, 'utf8').replace(/\s+/g, ''), 'base64');
}

function headerName(name: string, casing: string): string {
	return casing === 'lowercase'
		? name.toLowerCase()
		: name.replace(/[a-z]/gi, (letter, index) =>
				index % 2 ? letter.toLowerCase() : letter.toUpperCase()
			);
}

describe('email content', () => {
	it('parses normalized EML headers and plain-text body', async () => {
		const parsed = await parseEmailFileContent(
			'From: tender@example.com\r\nTo: estimator@example.com\r\nSubject: RFQ 42\r\n' +
				'Date: Mon, 15 Jan 2024 10:00:00 +1100\r\nMessage-ID: <rfq-42@example.com>\r\n' +
				'Thread-Index: thread-rfq-42\r\nContent-Type: text/plain\r\n\r\n' +
				'Please quote this package.'
		);

		expect(parsed).toMatchObject({
			subject: 'RFQ 42',
			from: 'tender@example.com',
			to: 'estimator@example.com',
			messageId: '<rfq-42@example.com>',
			threadIndex: 'thread-rfq-42',
			date: '2024-01-14T23:00:00.000Z',
			htmlBody: null,
			textBody: 'Please quote this package.'
		});
	});

	it.each(['lowercase', 'mixed'])('parses %s EML header names and MIME tokens', async (casing) => {
		const values = {
			Subject: 'Synthetic quote',
			From: 'supplier@example.com',
			To: 'buyer@example.com',
			Cc: 'estimator@example.com',
			Date: 'Mon, 15 Jan 2024 10:00:00 +1100',
			'Message-ID': '<PaRt-ABC@example.com>',
			'Thread-Index': 'ThReAd-AbC',
			'Content-Type': 'TeXt/PlAiN; ChArSeT=UTF-8',
			'Content-Transfer-Encoding': 'BaSe64'
		};
		const input =
			Object.entries(values)
				.map(([name, value]) => `${headerName(name, casing)}: ${value}`)
				.join('\r\n') + '\r\n\r\nUGxlYXNlIHF1b3RlLg==';
		expect(await parseEmailFileContent(input)).toMatchObject({
			subject: 'Synthetic quote',
			from: 'supplier@example.com',
			to: 'buyer@example.com',
			cc: 'estimator@example.com',
			date: '2024-01-14T23:00:00.000Z',
			messageId: '<PaRt-ABC@example.com>',
			threadIndex: 'ThReAd-AbC',
			textBody: 'Please quote.'
		});
	});

	it.each(['lowercase', 'mixed'])(
		'preserves original %s headers and unencoded body bytes',
		async (casing) => {
			const { readEml } = await import('eml-parse-js');
			const headers = Object.fromEntries(
				Object.entries({
					Subject: 'PaRt AbC',
					Date: 'not-a-date',
					'X-Keep-Mixed': 'AbC %20; ChArSeT=Literal',
					'Content-Type': 'TeXt/PlAiN; ChArSeT=UTF-8'
				}).map(([name, value]) => [headerName(name, casing), value])
			);
			const body = 'Please QuoTE,\r\nPart ABc%20.';
			const input =
				Object.entries(headers)
					.map(([name, value]) => `${name}: ${value}`)
					.join('\r\n') + `\r\n\r\n${body}`;
			const parsed = readEml(input);
			if (parsed instanceof Error || typeof parsed === 'string') throw parsed;
			expect(parsed.headers).toEqual(headers);
			expect(parsed.text).toBe(body);
			expect(await parseEmailFileContent(input)).toMatchObject({
				subject: 'PaRt AbC',
				date: 'not-a-date',
				textBody: body
			});
		}
	);

	it.each(['lowercase', 'mixed'])(
		'parses %s nested MIME headers while preserving case-sensitive boundaries and attachment metadata',
		async (casing) => {
			const { readEml } = await import('eml-parse-js');
			const h = (name: string) => headerName(name, casing);
			const input =
				`${h('Subject')}: Synthetic quote\r\n${h('MIME-Version')}: 1.0\r\n` +
				`${h('Content-Type')}: MuLtIpArT/MiXeD; BOUNDARY="Outer-Case"\r\n\r\n` +
				`--Outer-Case\r\n${h('Content-Type')}: MuLtIpArT/AlTeRnAtIvE; BoUnDaRy="Inner-Case"\r\n\r\n` +
				`--Inner-Case\r\n${h('Content-Type')}: TeXt/PlAiN; CHARSET=UTF-8\r\n` +
				`${h('Content-Transfer-Encoding')}: BASE64\r\n\r\nUGxlYXNlIHF1b3RlLg==\r\n` +
				`--Inner-Case\r\n${h('Content-Type')}: TeXt/HtMl; ChArSeT=UTF-8\r\n` +
				`${h('Content-Transfer-Encoding')}: QuOtEd-PrInTaBlE\r\n\r\n` +
				'<p>Please=20quote.</p>\r\n\r\n--Inner-Case--\r\n' +
				`--Outer-Case\r\n${h('Content-Type')}: ApPlIcAtIoN/OcTeT-StReAm; NAME="Part%20A.step"\r\n` +
				`${h('Content-Disposition')}: INLINE; FILENAME="Part%20A.step"\r\n` +
				`${h('Content-ID')}: <PaRt-ABC>\r\n${h('Content-Transfer-Encoding')}: BASE64\r\n\r\n` +
				'YQ==\r\n\r\n--Outer-Case--';
			const parsed = readEml(input);
			if (parsed instanceof Error || typeof parsed === 'string') throw parsed;
			expect(parsed).toMatchObject({
				subject: 'Synthetic quote',
				text: 'Please quote.',
				html: '<p>Please quote.</p>\n',
				multipartAlternative: {
					'Content-Type': 'MuLtIpArT/AlTeRnAtIvE; BoUnDaRy="Inner-Case"'
				},
				attachments: [
					{
						id: '<PaRt-ABC>',
						name: 'Part%20A.step',
						inline: true,
						contentType: 'ApPlIcAtIoN/OcTeT-StReAm; NAME="Part%20A.step"',
						data64: 'YQ=='
					}
				]
			});
			expect(await parseEmailFileContent(input)).toMatchObject({
				textBody: 'Please quote.',
				htmlBody: '<p>Please quote.</p>\n',
				attachmentNames: ['Part%20A.step']
			});
		}
	);

	it('keeps a readable message and its raw date when the date header is invalid', async () => {
		const parsed = await parseEmailFileContent(
			'Subject: RFQ\r\nDate: not-a-date\r\nContent-Type: text/plain\r\n\r\nPlease quote.'
		);
		expect(parsed).toMatchObject({ subject: 'RFQ', date: 'not-a-date', textBody: 'Please quote.' });
	});

	it('defaults a message without Content-Type to plain text and preserves its original headers', async () => {
		const { readEml } = await import('eml-parse-js');
		const headers = {
			Subject: 'Synthetic plain email',
			From: 'sender@example.test',
			To: 'shop@example.test'
		};
		const body = 'Please QuoTE.\r\nPart ABc%20.';
		const input =
			Object.entries(headers)
				.map(([name, value]) => `${name}: ${value}`)
				.join('\r\n') + `\r\n\r\n${body}`;
		const parsed = readEml(input);
		if (parsed instanceof Error || typeof parsed === 'string') throw parsed;
		expect(parsed.headers).toEqual(headers);
		expect(parsed.text).toBe(body);
		expect(await parseEmailFileContent(input)).toMatchObject({
			subject: 'Synthetic plain email',
			from: 'sender@example.test',
			to: 'shop@example.test',
			textBody: body,
			attachmentNames: []
		});
	});

	it('defaults a MIME part without Content-Type to plain text', async () => {
		const parsed = await parseEmailFileContent(
			'Subject: Synthetic plain part\r\nContent-Type: multipart/mixed; boundary="Plain-Part"\r\n\r\n' +
				'--Plain-Part\r\nContent-Transfer-Encoding: base64\r\n\r\nUGxlYXNlIHF1b3RlLg==\r\n' +
				'--Plain-Part\r\nContent-Type: application/octet-stream\r\n' +
				'Content-Disposition: attachment; filename="PaRt.step"\r\n\r\na\r\n\r\n--Plain-Part--'
		);
		expect(parsed).toMatchObject({
			subject: 'Synthetic plain part',
			textBody: 'Please quote.',
			attachmentNames: ['PaRt.step']
		});
	});

	it('preserves repeated raw header names and their existing array representation', async () => {
		const { readEml } = await import('eml-parse-js');
		const parsed = readEml('X-Keep: First\r\nX-Keep: Second\r\nx-keep: Third\r\n\r\nPlease quote.');
		if (parsed instanceof Error || typeof parsed === 'string') throw parsed;
		expect(parsed.headers).toEqual({ 'X-Keep': ['First', 'Second'], 'x-keep': 'Third' });
		expect(parsed.text).toBe('Please quote.');
	});

	it('preserves an untyped plain body that begins with a header-like line', async () => {
		const body = 'Content-Type: text/html\r\nThis is literal plain text.\r\nPaRt ABc%20.';
		expect(await parseEmailFileContent(`Subject: RFQ\r\n\r\n${body}`)).toMatchObject({
			subject: 'RFQ',
			textBody: body,
			htmlBody: null,
			attachmentNames: []
		});
	});

	it.each([
		['filename="part%1.step"', 'part%1.step'],
		['filename="part%20one.step"', 'part%20one.step'],
		['filename="part one; final.step"', 'part one; final.step'],
		['filename="utf-8 drawing.step"', 'utf-8 drawing.step'],
		['filename="../../drawing.step"', '../../drawing.step'],
		["filename*=UTF-8''part%20one.step", 'part one.step'],
		["filename*=UTF-8''%E6%9D%90%E6%96%99.step", '材料.step'],
		["filename*=UTF-8''part%1.step", 'part%1.step'],
		['filename*0="quote100%"; filename*1=".pdf"', 'quote100%.pdf'],
		['filename*0="part%20"; filename*1="one.step"', 'part%20one.step'],
		['filename*0*=UTF-8\'\'quote%20; filename*1="100%.pdf"', 'quote 100%.pdf'],
		['filename*0="quote\'final\'%"; filename*1*=%20.pdf', "quote'final'% .pdf"],
		["filename*0*=UTF-8''%E6%9D; filename*1*=%90%E6%96%99.step", '材料.step']
	])('preserves attachment name semantics for %s', async (parameter, expected) => {
		const parsed = await parseEmailFileContent(
			'Subject: RFQ\r\nMIME-Version: 1.0\r\n' +
				'Content-Type: multipart/mixed; boundary="parts"\r\n\r\n' +
				'--parts\r\nContent-Type: text/plain\r\n\r\nPlease quote.\r\n' +
				'--parts\r\nContent-Type: application/octet-stream\r\n' +
				`Content-Disposition: attachment; ${parameter}\r\n` +
				'Content-Transfer-Encoding: base64\r\n\r\nYQ==\r\n--parts--'
		);
		expect(parsed.attachmentNames).toEqual([expected]);
		expect(parsed.textBody).toBe('Please quote.');
	});

	it('preserves encoded headers and a UTF-8 base64 message body', async () => {
		const parsed = await parseEmailFileContent(
			'Subject: =?UTF-8?B?UkZRIMOJ?=\r\nContent-Type: text/plain; charset=utf-8\r\n' +
				'Content-Transfer-Encoding: base64\r\n\r\n' +
				Buffer.from('材料 café').toString('base64')
		);
		expect(parsed).toMatchObject({ subject: 'RFQ É', textBody: '材料 café' });
	});

	it.each([
		['plain', 'us-ascii', 'UGxlYXNlIHF1b3RlLg==', 'Please quote.'],
		['html', 'us-ascii', 'PHA+UGxlYXNlIHF1b3RlLjwvcD4=', '<p>Please quote.</p>'],
		['plain', 'utf-8', '5p2Q5paZIGNhZsOp', '材料 café'],
		['html', 'utf-8', 'PHA+5p2Q5paZIGNhZsOpPC9wPg==', '<p>材料 café</p>'],
		['plain', 'iso-8859-1', 'Y2Fm6Q==', 'café'],
		['html', 'iso-8859-1', 'PHA+Y2Fm6TwvcD4=', '<p>café</p>'],
		['plain', 'gbk', 'ssTBz7GovNs=', '材料报价'],
		['html', 'gbk', 'PHA+ssTBz7GovNs8L3A+', '<p>材料报价</p>']
	])('decodes base64 %s using its declared %s charset', async (kind, charset, body, expected) => {
		const parsed = await parseEmailFileContent(
			`Content-Type: text/${kind}; charset=${charset}\r\n` +
				`Content-Transfer-Encoding: base64\r\n\r\n${body}`
		);
		expect(kind === 'plain' ? parsed.textBody : parsed.htmlBody).toBe(expected);
	});

	it('parses a real binary Outlook MSG fixture with recipients and body', async () => {
		const parsed = await parseEmailFileBytes(
			readBase64Fixture('tests/fixtures/email/msgreader-test1.msg.base64'),
			'rfq.msg'
		);

		expect(parsed).toMatchObject({
			subject: 'title',
			to: 'to@example.com',
			cc: 'cc@example.com',
			textBody: 'body'
		});
	});

	it('preserves attachment relationships from a real binary Outlook MSG fixture', async () => {
		const parsed = await parseEmailFileBytes(
			readBase64Fixture('tests/fixtures/email/msgreader-test2.msg.base64'),
			'attachment.msg'
		);

		expect(parsed.attachmentNames).toEqual(['A.txt']);
	});

	it('prefers plain text and falls back to readable HTML then snippet', () => {
		expect(
			normaliseEmailBodyText({
				bodyText: '  Please quote the steel package.  ',
				bodyHtml: '<p>Ignored HTML</p>',
				snippet: 'Ignored snippet'
			})
		).toBe('Please quote the steel package.');

		expect(
			normaliseEmailBodyText({
				bodyText: '',
				bodyHtml: '<p>Please quote</p><div>Delivery by Friday</div>',
				snippet: 'Ignored snippet'
			})
		).toBe('Please quote\nDelivery by Friday');

		expect(normaliseEmailBodyText({ bodyText: '', bodyHtml: null, snippet: 'RFQ attached' })).toBe(
			'RFQ attached'
		);
	});

	it('blocks active content and remote images', () => {
		const result = sanitiseEmailHtml(
			'<script>alert(1)</script><iframe src="https://tracker.example"></iframe>' +
				'<img src="https://tracker.example/pixel.gif" srcset="https://tracker.example/2x.png 2x" alt="Plan">' +
				'<img src="data:image/png;base64,abc" alt="Embedded">' +
				'<a href="javascript:alert(1)" onclick="alert(1)">Unsafe</a>' +
				'<a href="/settings">Relative</a>'
		);

		expect(result.blockedRemoteImageCount).toBe(1);
		expect(result.html).not.toContain('<script');
		expect(result.html).not.toContain('<iframe');
		expect(result.html).not.toContain('tracker.example');
		expect(result.html).not.toContain('javascript:');
		expect(result.html).not.toContain('href="/settings"');
		expect(result.html).not.toContain('onclick');
		expect(result.html).toContain('data:image/png;base64,abc');
		expect(result.html).toContain('alt="Plan"');
	});

	it('retains embedded raster images without allowing remote or active image sources', () => {
		const result = sanitiseEmailHtml(
			'<img src="https://images.example/plan.png"><img src="http://images.example/insecure.png">' +
				'<img src="//images.example/relative.png"><img src="/local.png">' +
				'<img src="data:image/svg+xml;base64,PHN2Zy8+"><img src="blob:unsafe">' +
				'<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="Embedded">'
		);

		expect(result.html).not.toContain('images.example');
		expect(result.html).not.toContain('/local.png');
		expect(result.html).not.toContain('data:image/svg');
		expect(result.html).not.toContain('blob:unsafe');
		expect(result.html).toContain('data:image/gif;base64,');
		expect(result.blockedRemoteImageCount).toBe(2);
	});

	it('extracts links from surviving sanitized content in source order and deduplicates canonical destinations', () => {
		const result = sanitiseEmailHtml(
			'<form><a href="https://removed.example.test">Removed with form</a></form>' +
				'<a href="HTTPS://EXAMPLE.test:443/quote">  First\n quote  </a>' +
				'<a href="https://example.test/quote">Repeated destination</a>' +
				'<a href="mailto:synthetic@example.test">Email</a>' +
				'<a href="http://example.test/second">Second</a>' +
				'<a href="tel:+61255550123"></a>' +
				'<a href="javascript:alert(1)">Rejected</a><a href="https://">Malformed</a>'
		);
		expect(result.links).toEqual([
			{ href: 'https://example.test/quote', label: 'First quote' },
			{ href: 'mailto:synthetic@example.test', label: 'Email' },
			{ href: 'http://example.test/second', label: 'Second' },
			{ href: 'tel:+61255550123', label: 'tel:+61255550123' }
		]);
		expect(result.html).not.toContain('href=');
		expect(result.html).not.toContain('Removed with form');
	});

	it('builds a no-referrer document with a restrictive local image CSP', async () => {
		const { buildEmailSrcdoc } = await import('./email-content.js');
		const document = buildEmailSrcdoc('<p>Body</p>', {
			foreground: 'CanvasText',
			background: 'Canvas',
			link: 'LinkText',
			border: 'GrayText'
		});
		expect(document).toContain('<meta name="referrer" content="no-referrer">');
		expect(document).toContain("default-src 'none'; img-src data: blob:;");
		expect(document).not.toContain('https:');
	});
});
