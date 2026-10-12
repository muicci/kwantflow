// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parseMText, cleanMTextFormatting, renderMTextElement } from './cad-text-utils';

describe('CAD TEXT & MTEXT Parser', () => {
	describe('cleanMTextFormatting', () => {
		it('should strip complex color, font, scoping, and line break formatting codes', () => {
			const raw = '{\\fArial|b1;Heading}\\P{\\C1;Red subtitle}';
			expect(cleanMTextFormatting(raw)).toBe('Heading\nRed subtitle');
		});

		it('should handle nested formatting strings without throwing', () => {
			const raw = '{\\C3;Green {\\H2x;Large Green}}';
			expect(cleanMTextFormatting(raw)).toBe('Green Large Green');
		});
	});

	describe('parseMText', () => {
		it('should parse basic unformatted text as a single span', () => {
			const spans = parseMText('Hello World');
			expect(spans).toHaveLength(1);
			expect(spans[0]).toEqual({
				text: 'Hello World',
				bold: false,
				italic: false,
				underline: false,
				color: '',
				heightFactor: 1,
				newLine: false
			});
		});

		it('should parse stateful colors and keep color index hex mappings', () => {
			const spans = parseMText('{\\C1;Red Text} and {\\C3;Green Text}');
			expect(spans).toHaveLength(3);

			expect(spans[0]).toMatchObject({
				text: 'Red Text',
				color: '#ff0000'
			});
			expect(spans[1]).toMatchObject({
				text: ' and ',
				color: ''
			});
			expect(spans[2]).toMatchObject({
				text: 'Green Text',
				color: '#00ff00'
			});
		});

		it('should parse nested scope scoping correctly', () => {
			const spans = parseMText('{\\C1;Red {\\C2;Yellow} Red}');
			expect(spans).toHaveLength(3);

			expect(spans[0]).toMatchObject({ text: 'Red ', color: '#ff0000' });
			expect(spans[1]).toMatchObject({ text: 'Yellow', color: '#ffff00' });
			expect(spans[2]).toMatchObject({ text: ' Red', color: '#ff0000' });
		});

		it('should parse paragraph breaks \\P as new lines on subsequent spans', () => {
			const spans = parseMText('Line 1\\PLine 2');
			expect(spans).toHaveLength(2);
			expect(spans[0]).toMatchObject({ text: 'Line 1', newLine: false });
			expect(spans[1]).toMatchObject({ text: 'Line 2', newLine: true });
		});

		it('should parse font styling tags such as bold and italic', () => {
			const spans = parseMText('{\\fTimes New Roman|b1|i1;Bold Italic}');
			expect(spans).toHaveLength(1);
			expect(spans[0]).toMatchObject({
				text: 'Bold Italic',
				bold: true,
				italic: true
			});
		});

		it('should parse height factors', () => {
			const spans = parseMText('{\\H2x;Scaled}');
			expect(spans).toHaveLength(1);
			expect(spans[0]).toMatchObject({
				text: 'Scaled',
				heightFactor: 2
			});
		});
	});

	describe('renderMTextElement', () => {
		it('should convert raw tags into real SVG tspan nodes', () => {
			const textEl = document.createElementNS(
				'http://www.w3.org/2000/svg',
				'text'
			) as SVGTextElement;
			textEl.setAttribute('x', '15');
			textEl.setAttribute('y', '30');
			textEl.textContent = '{\\fArial|b1;Title}\\P{\\C1;Subtitle}';

			renderMTextElement(textEl);

			const tspans = textEl.querySelectorAll('tspan');
			expect(tspans).toHaveLength(2);

			expect(tspans[0].textContent).toBe('Title');
			expect(tspans[0].getAttribute('style')).toContain('font-weight: bold');
			expect(tspans[0].getAttribute('dy')).toBeNull();

			expect(tspans[1].textContent).toBe('Subtitle');
			expect(tspans[1].getAttribute('style')).toContain('fill: #ff0000');
			expect(tspans[1].getAttribute('x')).toBe('15');
			expect(tspans[1].getAttribute('dy')).toBe('1.2em');
		});
	});
});
