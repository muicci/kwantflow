/**
 * AutoCAD TEXT and MTEXT Formatting Utilities.
 *
 * MTEXT formats use a state-based formatting syntax with control codes:
 *   \P                - Paragraph break (newline)
 *   \C<aci_color>;    - Color change (AutoCAD Color Index 1-7)
 *   \f<font>|b1|i1;   - Font family and toggle styles (bold, italic)
 *   \H<scale>x;       - Height factor multiplier
 *   \L / \l           - Underline toggle on/off
 *   { ... }           - Scoping boundaries for style groups
 */

export interface TextSpan {
	text: string;
	bold: boolean;
	italic: boolean;
	underline: boolean;
	color: string;
	heightFactor: number;
	newLine: boolean;
}

/**
 * Parses AutoCAD MTEXT formatting tags into a flat array of formatted TextSpans,
 * keeping track of style scoping scopes { ... } via a state stack.
 */
export function parseMText(raw: string): TextSpan[] {
	const spans: TextSpan[] = [];
	const stack: Array<{
		bold: boolean;
		italic: boolean;
		underline: boolean;
		color: string;
		heightFactor: number;
	}> = [];

	let current = {
		bold: false,
		italic: false,
		underline: false,
		color: '',
		heightFactor: 1
	};

	let textAcc = '';
	let i = 0;
	let pendingNewLine = false;

	const flush = () => {
		if (textAcc) {
			spans.push({
				text: textAcc,
				bold: current.bold,
				italic: current.italic,
				underline: current.underline,
				color: current.color,
				heightFactor: current.heightFactor,
				newLine: pendingNewLine
			});
			textAcc = '';
			pendingNewLine = false;
		}
	};

	while (i < raw.length) {
		const char = raw[i];

		if (char === '{') {
			flush();
			stack.push({ ...current });
			i++;
		} else if (char === '}') {
			flush();
			if (stack.length > 0) {
				current = stack.pop()!;
			}
			i++;
		} else if (char === '\\') {
			if (i + 1 >= raw.length) {
				textAcc += '\\';
				i++;
				continue;
			}
			const next = raw[i + 1];

			if (next === '\\' || next === '{' || next === '}') {
				textAcc += next;
				i += 2;
			} else if (next === 'P') {
				flush();
				pendingNewLine = true;
				i += 2;
			} else if (next === 'L') {
				flush();
				current.underline = true;
				i += 2;
			} else if (next === 'l') {
				flush();
				current.underline = false;
				i += 2;
			} else if (next === 'O' || next === 'o' || next === 'K' || next === 'k') {
				// Overstrike or strikethrough, flush and advance
				flush();
				i += 2;
			} else {
				// Search for next semicolon ending a parameterized tag (\C, \f, \H, \S, etc.)
				const semiIndex = raw.indexOf(';', i);
				if (semiIndex !== -1) {
					const content = raw.substring(i + 2, semiIndex);

					flush();

					if (next === 'C') {
						const colorIdx = parseInt(content, 10);
						current.color = mapACIColor(colorIdx);
					} else if (next === 'f') {
						if (content.includes('|b1')) {
							current.bold = true;
						} else if (content.includes('|b0')) {
							current.bold = false;
						}
						if (content.includes('|i1')) {
							current.italic = true;
						} else if (content.includes('|i0')) {
							current.italic = false;
						}
					} else if (next === 'H') {
						if (content.endsWith('x')) {
							const val = parseFloat(content);
							current.heightFactor = isNaN(val) ? 1 : val;
						} else {
							const val = parseFloat(content);
							current.heightFactor = isNaN(val) ? 1 : val;
						}
					}

					i = semiIndex + 1;
				} else {
					textAcc += '\\';
					i++;
				}
			}
		} else {
			textAcc += char;
			i++;
		}
	}

	flush();
	return spans;
}

/**
 * Maps AutoCAD Color Indexes (ACI) to standard web hex codes.
 */
function mapACIColor(idx: number): string {
	switch (idx) {
		case 1:
			return '#ff0000'; // Red
		case 2:
			return '#ffff00'; // Yellow
		case 3:
			return '#00ff00'; // Green
		case 4:
			return '#00ffff'; // Cyan
		case 5:
			return '#0000ff'; // Blue
		case 6:
			return '#ff00ff'; // Magenta
		case 7:
			return 'currentColor'; // White/Black based on theme
		case 8:
			return '#808080'; // Dark Gray
		case 9:
			return '#c0c0c0'; // Light Gray
		default:
			return 'currentColor';
	}
}

/**
 * Strips AutoCAD MTEXT and TEXT inline formatting codes (e.g., color switches \C7;,
 * font overlays \fArial;, underline toggles \L/\l, and scoping brackets {})
 * from the string to produce clean plain-text.
 * Preserves paragraph returns (\P) as standard newlines.
 */
export function cleanMTextFormatting(text: string): string {
	if (!text) return '';
	// 1. Strip standard backslash control codes with parameters (e.g. \fArial; \C7; \H2x;)
	let clean = text.replace(/\\(?:[fCHQSTWAbB])[^;]*;/g, '');
	// 2. Strip simple toggle switches (Underline, Overstrike, Strikethrough)
	clean = clean.replace(/\\(?:[LlOoKk])/g, '');
	// 3. Strip scoping braces { and }
	clean = clean.replace(/[{}]/g, '');
	// 4. Map paragraph breaks (\P) to plain newlines
	clean = clean.replace(/\\P/g, '\n');
	return clean;
}

/**
 * Parses and replaces the raw content of an SVG <text> node with styled <tspan> children
 * mapped from the embedded AutoCAD MTEXT formatting tags.
 */
export function renderMTextElement(textEl: SVGTextElement): void {
	const raw = textEl.textContent || '';
	if (!raw.includes('\\') && !raw.includes('{') && !raw.includes('}')) {
		return;
	}

	const spans = parseMText(raw);
	if (spans.length === 0) return;

	// Clear existing plain-text content
	textEl.textContent = '';

	const startX = textEl.getAttribute('x') || '0';

	for (const span of spans) {
		const tspan = textEl.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'tspan');
		tspan.textContent = span.text;

		let style = '';
		if (span.bold) style += 'font-weight: bold; ';
		if (span.italic) style += 'font-style: italic; ';
		if (span.underline) style += 'text-decoration: underline; ';
		if (span.color) style += `fill: ${span.color}; `;

		if (span.heightFactor !== 1 && !isNaN(span.heightFactor)) {
			tspan.setAttribute('font-size', `${span.heightFactor}em`);
		}

		if (style) {
			tspan.setAttribute('style', style.trim());
		}

		if (span.newLine) {
			tspan.setAttribute('dy', '1.2em');
			tspan.setAttribute('x', startX);
		}

		textEl.appendChild(tspan);
	}
}
