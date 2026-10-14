import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type TokenLeaf = {
	$type: string;
	$value: string | number | string[] | number[];
	$description?: string;
};

type TokenNode = {
	[key: string]: TokenNode | TokenLeaf | string | string[] | undefined;
};

type TokenFileMap = {
	primitives: TokenNode;
	themes: TokenNode;
	typography: TokenNode;
	layout: TokenNode;
	components: TokenNode;
	metadata: Record<string, unknown>;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const tokensDir = path.join(repoRoot, 'tokens');
const generatedDir = path.join(repoRoot, 'src/lib/design/generated');

function readJson<T>(fileName: string): T {
	return JSON.parse(readFileSync(path.join(tokensDir, fileName), 'utf8')) as T;
}

function isTokenLeaf(value: unknown): value is TokenLeaf {
	return (
		!!value &&
		typeof value === 'object' &&
		'$type' in (value as Record<string, unknown>) &&
		'$value' in (value as Record<string, unknown>)
	);
}

function assertDescriptions(node: TokenNode, fileName: string, keyPath: string[] = []) {
	for (const [key, value] of Object.entries(node)) {
		if (key.startsWith('$')) continue;
		if (isTokenLeaf(value)) {
			if (!value.$description) {
				throw new Error(`Missing $description for ${fileName}:${[...keyPath, key].join('.')}`);
			}
			continue;
		}
		if (value && typeof value === 'object') {
			assertDescriptions(value as TokenNode, fileName, [...keyPath, key]);
		}
	}
}

function flattenTokens(node: TokenNode, prefix: string[] = [], out = new Map<string, TokenLeaf>()) {
	for (const [key, value] of Object.entries(node)) {
		if (key.startsWith('$')) continue;
		if (isTokenLeaf(value)) {
			out.set([...prefix, key].join('.'), value);
			continue;
		}
		if (value && typeof value === 'object') {
			flattenTokens(value as TokenNode, [...prefix, key], out);
		}
	}
	return out;
}

function cssVarName(tokenPath: string) {
	const parts = tokenPath.split('.');
	const [head, ...rest] = parts;
	const normalizeSegment = (segment: string) =>
		segment
			.replace(/([a-z0-9])([A-Z])/g, '$1-$2')
			.replace(/_/g, '-')
			.toLowerCase();
	const normalizedRest = rest.map(normalizeSegment).join('-');
	if (head === 'font') return `--font-${normalizedRest}`;
	if (head === 'color') return `--color-${normalizedRest}`;
	if (head === 'space') return `--space-${normalizedRest}`;
	if (head === 'radius') return `--radius-${normalizedRest}`;
	if (head === 'size') return `--size-${normalizedRest}`;
	if (head === 'duration') return `--duration-${normalizedRest}`;
	if (head === 'easing') return `--ease-${normalizedRest}`;
	return `--${parts.map(normalizeSegment).join('-')}`;
}

function themeVarName(tokenName: string) {
	return `--${tokenName.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`;
}

function replaceAliases(raw: string, primitiveMap: Map<string, TokenLeaf>) {
	return raw.replace(/\{([^}]+)\}/g, (_match, tokenPath: string) => {
		if (!primitiveMap.has(tokenPath)) {
			throw new Error(`Unknown token alias: ${tokenPath}`);
		}
		return `var(${cssVarName(tokenPath)})`;
	});
}

function formatTokenValue(value: TokenLeaf['$value'], primitiveMap: Map<string, TokenLeaf>) {
	if (Array.isArray(value)) {
		return value.map((item) => (typeof item === 'string' ? `'${item}'` : String(item))).join(', ');
	}
	if (typeof value === 'number') return String(value);
	return replaceAliases(value, primitiveMap);
}

function toConstObject(value: unknown, primitiveMap: Map<string, TokenLeaf>): unknown {
	if (Array.isArray(value)) return value;
	if (isTokenLeaf(value)) {
		return {
			type: value.$type,
			value:
				typeof value.$value === 'string'
					? replaceAliases(value.$value, primitiveMap)
					: value.$value,
			description: value.$description ?? ''
		};
	}
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>).map(([key, child]) => [
				key,
				toConstObject(child, primitiveMap)
			])
		);
	}
	return value;
}

function writeGeneratedFiles(files: TokenFileMap) {
	const primitiveMap = flattenTokens(files.primitives);
	const typographyMap = flattenTokens(files.typography);
	const layoutMap = flattenTokens(files.layout);
	const componentMap = flattenTokens(files.components);
	const primitiveLines = Array.from(primitiveMap.entries()).map(
		([tokenPath, token]) =>
			`\t${cssVarName(tokenPath)}: ${formatTokenValue(token.$value, primitiveMap)};`
	);
	const typographyLines = Array.from(typographyMap.entries()).map(
		([tokenPath, token]) =>
			`\t${cssVarName(tokenPath)}: ${formatTokenValue(token.$value, primitiveMap)};`
	);
	const layoutLines = Array.from(layoutMap.entries()).map(
		([tokenPath, token]) =>
			`\t${cssVarName(tokenPath)}: ${formatTokenValue(token.$value, primitiveMap)};`
	);
	const componentLines = Array.from(componentMap.entries()).map(
		([tokenPath, token]) =>
			`\t${cssVarName(tokenPath)}: ${formatTokenValue(token.$value, primitiveMap)};`
	);

	const themes = files.themes as Record<string, Record<string, TokenLeaf>>;
	const lightLines = Object.entries(themes.light).map(
		([tokenName, token]) =>
			`\t\t${themeVarName(tokenName)}: ${formatTokenValue(token.$value, primitiveMap)};`
	);
	const darkLines = Object.entries(themes.dark).map(
		([tokenName, token]) =>
			`\t\t${themeVarName(tokenName)}: ${formatTokenValue(token.$value, primitiveMap)};`
	);

	const primitivesCss = `/* Generated from tokens/primitives.json. Do not edit by hand. */\n@theme inline {\n${primitiveLines.join('\n')}\n}\n`;
	const typographyCss = `/* Generated from tokens/typography.json. Do not edit by hand. */\n@theme inline {\n${typographyLines.join('\n')}\n}\n`;
	const layoutCss = `/* Generated from tokens/layout.json. Do not edit by hand. */\n@theme inline {\n${layoutLines.join('\n')}\n}\n`;
	const componentsCss = `/* Generated from tokens/components.json. Do not edit by hand. */\n@theme inline {\n${componentLines.join('\n')}\n}\n`;
	const modesCss = `/* Generated from tokens/themes.json. Do not edit by hand. */\n@layer base {\n\t:root {\n${lightLines.join('\n')}\n\t}\n\n\t.dark {\n${darkLines.join('\n')}\n\t}\n}\n`;
	const registryTs = `/* Generated from tokens/*.json. Do not edit by hand. */\nexport const designPrimitives = ${JSON.stringify(toConstObject(files.primitives, primitiveMap), null, 2)} as const;\n\nexport const designThemes = ${JSON.stringify(toConstObject(files.themes, primitiveMap), null, 2)} as const;\n\nexport const designTypography = ${JSON.stringify(toConstObject(files.typography, primitiveMap), null, 2)} as const;\n\nexport const designLayout = ${JSON.stringify(toConstObject(files.layout, primitiveMap), null, 2)} as const;\n\nexport const designComponents = ${JSON.stringify(toConstObject(files.components, primitiveMap), null, 2)} as const;\n\nexport const designTokenMetadata = ${JSON.stringify(files.metadata, null, 2)} as const;\n`;

	writeFileSync(path.join(generatedDir, 'primitives.css'), primitivesCss);
	writeFileSync(path.join(generatedDir, 'typography.css'), typographyCss);
	writeFileSync(path.join(generatedDir, 'layout.css'), layoutCss);
	writeFileSync(path.join(generatedDir, 'components.css'), componentsCss);
	writeFileSync(path.join(generatedDir, 'modes.css'), modesCss);
	const registryPath = path.join(generatedDir, 'registry.ts');
	writeFileSync(registryPath, registryTs);
	// Run prettier through Node rather than the `pnpm` shim: execFileSync cannot spawn
	// `pnpm.cmd` on Windows without a shell.
	const prettierBin = createRequire(import.meta.url).resolve('prettier/bin/prettier.cjs');
	execFileSync(process.execPath, [prettierBin, '--write', generatedDir], {
		cwd: repoRoot,
		stdio: 'ignore'
	});
}

function verifyGeneratedFiles() {
	execFileSync('git', ['diff', '--exit-code', '--', 'src/lib/design/generated'], {
		cwd: repoRoot,
		stdio: 'inherit'
	});
}

function loadTokenFiles(): TokenFileMap {
	const primitives = readJson<TokenNode>('primitives.json');
	const themes = readJson<TokenNode>('themes.json');
	const typography = readJson<TokenNode>('typography.json');
	const layout = readJson<TokenNode>('layout.json');
	const components = readJson<TokenNode>('components.json');
	const metadata = readJson<Record<string, unknown>>('metadata.json');
	assertDescriptions(primitives, 'primitives.json');
	assertDescriptions(themes, 'themes.json');
	assertDescriptions(typography, 'typography.json');
	assertDescriptions(layout, 'layout.json');
	assertDescriptions(components, 'components.json');
	return { primitives, themes, typography, layout, components, metadata };
}

function main() {
	const command = process.argv[2] ?? 'build';
	mkdirSync(generatedDir, { recursive: true });
	const files = loadTokenFiles();
	if (command === 'lint') return;
	writeGeneratedFiles(files);
	if (command === 'verify') {
		verifyGeneratedFiles();
	}
}

main();
