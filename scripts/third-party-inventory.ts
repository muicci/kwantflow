import { createHash } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	writeFileSync
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { parse } from 'yaml';

type Package = {
	name: string;
	version: string;
	license?: string;
	repository?: string | { url?: string };
	dependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
};
type Lock = { packages: Record<string, { resolution?: { integrity?: string; tarball?: string } }> };
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'third-party');
const lock = parse(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')) as Lock;
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

function packagePath(name: string, from: string): string | undefined {
	let directory = from;
	while (true) {
		const candidate = join(directory, 'node_modules', name, 'package.json');
		if (existsSync(candidate)) return realpathSync(dirname(candidate));
		const parent = dirname(directory);
		if (parent === directory) return undefined;
		directory = parent;
	}
}

function noticeFiles(directory: string, depth = 0): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (
			entry.isFile() &&
			/^(licen[cs]e|copying|notice|copyright|authors)([._-]|$)/i.test(entry.name)
		) {
			files.push(join(directory, entry.name));
		} else if (
			entry.isDirectory() &&
			depth < 2 &&
			/^(licenses?|notices?|wasm|standard_fonts|cmaps|iccs|libheif|libheif-wasm)$/i.test(entry.name)
		) {
			files.push(...noticeFiles(join(directory, entry.name), depth + 1));
		}
	}
	return files.sort();
}

const manifest = JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8')) as {
	components: { npmPackage?: string; notices: string[] }[];
};
const overrides = new Map(
	manifest.components.filter((c) => c.npmPackage).map((c) => [c.npmPackage, c.notices])
);
const upstreamInputsPath = join(output, 'upstream-license-inputs.json');
const upstreamInputs = existsSync(upstreamInputsPath)
	? (JSON.parse(readFileSync(upstreamInputsPath, 'utf8')) as {
			component: string;
			files: { path: string; sha256: string }[];
		}[])
	: [];
for (const input of upstreamInputs) {
	for (const file of input.files) {
		if (hash(readFileSync(join(root, file.path))) !== file.sha256)
			throw new Error(`Upstream notice changed: ${file.path}`);
	}
	overrides.set(input.component, [
		...(overrides.get(input.component) ?? []),
		...input.files.map((file) => file.path)
	]);
}
const declarationsPath = join(output, 'declared-license-evidence.json');
const declarationOnlyCases = existsSync(declarationsPath)
	? (JSON.parse(readFileSync(declarationsPath, 'utf8')) as {
			component: string;
			declaredLicense: string;
			selectedLicense: string;
			declaration: { path: string; sha256: string };
			standardTerms: string;
			standardTermsSha256: string;
			status: string;
		}[])
	: [];
for (const evidence of declarationOnlyCases) {
	if (hash(readFileSync(join(root, evidence.declaration.path))) !== evidence.declaration.sha256)
		throw new Error(`License declaration changed: ${evidence.component}`);
	if (!evidence.declaredLicense.split(/\s*(?:OR|\/)\s*/).includes(evidence.selectedLicense))
		throw new Error(`Selected terms contradict license declaration: ${evidence.component}`);
	if (
		!evidence.standardTerms.endsWith(`/${evidence.selectedLicense}.txt`) ||
		hash(readFileSync(join(root, evidence.standardTerms))) !== evidence.standardTermsSha256
	)
		throw new Error(`Canonical license terms changed: ${evidence.component}`);
	overrides.set(evidence.component, [evidence.standardTerms, evidence.declaration.path]);
}
const visited = new Set<string>();
const unresolved: string[] = [];
const packages: {
	name: string;
	version: string;
	declaredLicense: string | null;
	repository: string | null;
	resolution: { integrity?: string; tarball?: string } | null;
	licenseFiles: { path: string; sha256: string }[];
}[] = [];

function visit(directory: string) {
	if (visited.has(directory)) return;
	visited.add(directory);
	const pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as Package;
	const identity = `${pkg.name}@${pkg.version}`;
	const copied: { path: string; sha256: string }[] = [];
	for (const file of noticeFiles(directory)) {
		const destination = join(
			output,
			'licenses',
			'npm',
			identity.replaceAll('/', '+'),
			relative(directory, file)
		);
		const bytes = readFileSync(file);
		mkdirSync(dirname(destination), { recursive: true });
		writeFileSync(destination, bytes);
		copied.push({ path: relative(root, destination).replaceAll('\\', '/'), sha256: hash(bytes) });
	}
	for (const notice of overrides.get(identity) ?? []) {
		copied.push({ path: notice, sha256: hash(readFileSync(join(root, notice))) });
	}
	if (!copied.length)
		unresolved.push(`No license text or explicit declaration evidence collected for ${identity}`);
	packages.push({
		name: pkg.name,
		version: pkg.version,
		declaredLicense: pkg.license ?? null,
		repository: typeof pkg.repository === 'string' ? pkg.repository : (pkg.repository?.url ?? null),
		resolution: lock.packages[identity]?.resolution ?? null,
		licenseFiles: copied
	});
	for (const name of Object.keys(pkg.dependencies ?? {}).sort()) {
		const found = packagePath(name, directory);
		if (found) visit(found);
		else unresolved.push(`Missing required package ${name} from ${identity}`);
	}
	for (const name of Object.keys(pkg.optionalDependencies ?? {}).sort()) {
		const found = packagePath(name, directory);
		if (found) visit(found);
	}
}

const app = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Package;
// These development declarations also contribute client runtime or base CSS
// to the bundled desktop app. Their actual notices must accompany the binary.
const clientFrameworks = ['svelte', '@sveltejs/kit', 'tailwindcss'];
for (const name of [
	...new Set([...Object.keys(app.dependencies ?? {}), ...clientFrameworks])
].sort()) {
	const found = packagePath(name, root);
	if (found) visit(found);
	else unresolved.push(`Missing required app package ${name}`);
}
packages.sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));

// Cargo.lock is the authority for exact versions. Source license metadata and
// actual notices are copied only from matching cached crates. Uncached target
// crates remain explicit gaps, never guessed from a similarly named version.
const cargoLock = readFileSync(join(root, 'src-tauri/Cargo.lock'), 'utf8');
const cargoRegistry = join(
	process.env.CARGO_HOME ?? join(process.env.HOME ?? '', '.cargo'),
	'registry/src'
);
const cargoRoots = existsSync(cargoRegistry)
	? readdirSync(cargoRegistry).map((name) => join(cargoRegistry, name))
	: [];
const crates: {
	name: string;
	version: string;
	checksum: string | null;
	declaredLicense: string | null;
	licenseFiles: { path: string; sha256: string }[];
}[] = [];
for (const block of cargoLock.split('[[package]]').slice(1)) {
	if (!/^source = "registry\+/m.test(block)) continue;
	const name = /^name = "([^"]+)"/m.exec(block)?.[1];
	const version = /^version = "([^"]+)"/m.exec(block)?.[1];
	if (!name || !version) throw new Error('Malformed Cargo.lock package');
	const directory = cargoRoots.map((base) => join(base, `${name}-${version}`)).find(existsSync);
	const copied: { path: string; sha256: string }[] = [];
	let declaredLicense: string | null = null;
	if (directory) {
		const metadata = readFileSync(join(directory, 'Cargo.toml'), 'utf8');
		declaredLicense = /^license = "([^"]+)"/m.exec(metadata)?.[1] ?? null;
		for (const file of noticeFiles(directory)) {
			const destination = join(
				output,
				'licenses',
				'cargo',
				`${name}-${version}`,
				relative(directory, file)
			);
			const bytes = readFileSync(file);
			mkdirSync(dirname(destination), { recursive: true });
			writeFileSync(destination, bytes);
			copied.push({ path: relative(root, destination).replaceAll('\\', '/'), sha256: hash(bytes) });
		}
	}
	for (const notice of overrides.get(`Cargo:${name}@${version}`) ?? []) {
		copied.push({ path: notice, sha256: hash(readFileSync(join(root, notice))) });
	}
	if (!copied.length)
		unresolved.push(
			`No license text or explicit declaration evidence collected for Cargo ${name}-${version}${directory ? '' : ' (source not cached)'}`
		);
	crates.push({
		name,
		version,
		checksum: /^checksum = "([^"]+)"/m.exec(block)?.[1] ?? null,
		declaredLicense,
		licenseFiles: copied
	});
}
crates.sort((a, b) => `${a.name}-${a.version}`.localeCompare(`${b.name}-${b.version}`));
const inventory = {
	schemaVersion: 1,
	scope:
		'Installed npm production dependency closure, Svelte/Kit client runtime and Tailwind base CSS packages with their dependencies, and all registry crates in Cargo.lock; excludes other npm development tools, native binary internals and absent platform optional npm dependencies. Actual upstream notice texts are copied. Packages omitting full texts are explicitly distinguished in declarationOnlyCases, with unchanged metadata and canonical SPDX terms, never invented copyright holders. This is not a legal compatibility decision or complete binary SBOM.',
	pnpmLockSha256: hash(readFileSync(join(root, 'pnpm-lock.yaml'))),
	cargoLockSha256: hash(readFileSync(join(root, 'src-tauri/Cargo.lock'))),
	packages,
	crates,
	declarationOnlyCases,
	unresolved: [...new Set(unresolved)].sort()
};
const inventoryPath = join(output, 'dependency-inventory.json');
writeFileSync(
	inventoryPath,
	await format(JSON.stringify(inventory), {
		...((await resolveConfig(inventoryPath)) ?? {}),
		filepath: inventoryPath
	})
);
console.log(
	`Collected ${packages.length} npm packages and ${crates.length} registry crates; ${inventory.unresolved.length} explicit notice/declaration gaps.`
);
if (process.argv.includes('--strict') && inventory.unresolved.length) {
	console.error(inventory.unresolved.join('\n'));
	process.exitCode = 1;
}
