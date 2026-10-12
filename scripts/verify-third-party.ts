import { createHash } from 'node:crypto';
import {
	realpathSync,
	closeSync,
	existsSync,
	openSync,
	readFileSync,
	readdirSync,
	readSync
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type HashedFile = { path: string; sha256: string };
type Manifest = {
	applicationLicense: string;
	components: { artifacts: HashedFile[]; notices: string[]; sourceArchives: string[] }[];
	sourceArchives: HashedFile[];
	distributionReview: { ready: boolean; unresolved: string[] };
};
type Inventory = {
	pnpmLockSha256: string;
	cargoLockSha256: string;
	unresolved: string[];
	packages: { licenseFiles: HashedFile[] }[];
	crates: { licenseFiles: HashedFile[] }[];
};
const digest = (file: string) => {
	const hash = createHash('sha256');
	const descriptor = openSync(file, 'r');
	const buffer = Buffer.alloc(1024 * 1024);
	try {
		let count: number;
		while ((count = readSync(descriptor, buffer, 0, buffer.length, null)) > 0)
			hash.update(buffer.subarray(0, count));
		return hash.digest('hex');
	} finally {
		closeSync(descriptor);
	}
};

export function verifyThirdParty(root: string): { errors: string[]; releaseBlockers: string[] } {
	const errors: string[] = [];
	const manifest = JSON.parse(
		readFileSync(join(root, 'third-party/manifest.json'), 'utf8')
	) as Manifest;
	const inventory = JSON.parse(
		readFileSync(join(root, 'third-party/dependency-inventory.json'), 'utf8')
	) as Inventory;
	const nativeManifest = JSON.parse(
		readFileSync(join(root, 'third-party/native-source-manifest.json'), 'utf8')
	) as {
		sourceArchives: (HashedFile & { notices: HashedFile[] })[];
		officialNoticeAssets: HashedFile[];
		officialAppleNoticeInventory: HashedFile[];
		sourceChanges?: HashedFile[];
		supplementalNoticeFiles?: HashedFile[];
		verificationReceipts?: HashedFile[];
		distributionReview: { ready: boolean; unresolved: string[] };
	};
	const checkFile = (file: HashedFile) => {
		if (!existsSync(join(root, file.path))) errors.push(`Missing compliance file: ${file.path}`);
		else if (digest(join(root, file.path)) !== file.sha256)
			errors.push(`Compliance hash mismatch: ${file.path}`);
	};
	if (manifest.applicationLicense !== 'GPL-3.0-only')
		errors.push('Application license must be GPL-3.0-only.');
	if (!readFileSync(join(root, 'LICENSE'), 'utf8').includes('Version 3, 29 June 2007'))
		errors.push('Missing full GPL version 3 text.');
	if (
		!readFileSync(join(root, 'third-party/licenses/kwantflow-prior-mit.txt'), 'utf8').includes(
			'Copyright (c) 2026 Caliper'
		)
	)
		errors.push('Earlier Caliper MIT attribution missing.');
	for (const source of manifest.sourceArchives) checkFile(source);
	for (const source of nativeManifest.sourceArchives) {
		checkFile(source);
		for (const notice of source.notices) checkFile(notice);
	}
	for (const notice of [
		...nativeManifest.officialNoticeAssets,
		...nativeManifest.officialAppleNoticeInventory,
		...(nativeManifest.sourceChanges ?? []),
		...(nativeManifest.supplementalNoticeFiles ?? []),
		...(nativeManifest.verificationReceipts ?? [])
	])
		checkFile(notice);
	const declarations = JSON.parse(
		readFileSync(join(root, 'third-party/declared-license-evidence.json'), 'utf8')
	) as {
		component: string;
		declaredLicense: string;
		selectedLicense: string;
		declaration: HashedFile;
		standardTerms: string;
		standardTermsSha256: string;
	}[];
	for (const evidence of declarations) {
		checkFile(evidence.declaration);
		checkFile({ path: evidence.standardTerms, sha256: evidence.standardTermsSha256 });
		if (
			!evidence.declaredLicense.split(/\s*(?:OR|\/)\s*/).includes(evidence.selectedLicense) ||
			!evidence.standardTerms.endsWith(`/${evidence.selectedLicense}.txt`)
		)
			errors.push(`Canonical terms contradict declared license: ${evidence.component}`);
	}
	for (const component of manifest.components) {
		for (const artifact of component.artifacts) checkFile(artifact);
		for (const notice of component.notices)
			if (!existsSync(join(root, notice))) errors.push(`Missing notice: ${notice}`);
		for (const source of component.sourceArchives)
			if (!manifest.sourceArchives.some((item) => item.path === source))
				errors.push(`Unpinned source archive: ${source}`);
	}
	for (const component of [...inventory.packages, ...inventory.crates])
		for (const notice of component.licenseFiles) checkFile(notice);
	if (digest(join(root, 'pnpm-lock.yaml')) !== inventory.pnpmLockSha256)
		errors.push('pnpm lockfile changed; regenerate dependency inventory.');
	if (digest(join(root, 'src-tauri/Cargo.lock')) !== inventory.cargoLockSha256)
		errors.push('Cargo lockfile changed; regenerate dependency inventory.');
	const fonts = JSON.parse(
		readFileSync(join(root, 'static/cad-data/fonts/fonts.json'), 'utf8')
	) as { file: string }[];
	const approvedFonts = new Set(
		manifest.components
			.flatMap((component) => component.artifacts.map((item) => item.path))
			.filter((path) => path.startsWith('static/cad-data/fonts/'))
			.map((path) => path.split('/').at(-1))
	);
	for (const font of fonts)
		if (!approvedFonts.has(font.file)) errors.push(`Unapproved font in mapping: ${font.file}`);
	for (const name of readdirSync(join(root, 'static/cad-data/fonts')))
		if (name !== 'fonts.json' && !approvedFonts.has(name))
			errors.push(`Unapproved bundled font file: ${name}`);
	const parser = readFileSync(join(root, 'static/workers/libredwg-parser-worker.js'), 'utf8');
	const expectedWasm = digest(join(root, 'static/wasm/libredwg-web.wasm'));
	const marker = 'data:application/wasm;base64,';
	const start = parser.indexOf(marker);
	const end = start < 0 ? -1 : parser.indexOf('"', start + marker.length);
	const embedded =
		start < 0 || end < 0
			? undefined
			: Buffer.from(parser.slice(start + marker.length, end), 'base64');
	if (!embedded || createHash('sha256').update(embedded).digest('hex') !== expectedWasm)
		errors.push('DWG worker contains a different parser WASM.');
	if (digest(join(root, 'static/workers/libredwg-web.wasm')) !== expectedWasm)
		errors.push('Standalone DWG WASM copies disagree.');
	return {
		errors,
		releaseBlockers: [
			...inventory.unresolved,
			...manifest.distributionReview.unresolved,
			...nativeManifest.distributionReview.unresolved,
			...(nativeManifest.distributionReview.ready
				? []
				: ['Native source distribution review has not been completed.']),
			...(manifest.distributionReview.ready ? [] : ['Distribution review has not been completed.'])
		]
	};
}

if (
	process.argv[1] &&
	existsSync(process.argv[1]) &&
	realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))
) {
	const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
	const result = verifyThirdParty(root);
	const failures = process.argv.includes('--distribution')
		? [...result.errors, ...result.releaseBlockers]
		: result.errors;
	if (failures.length) {
		console.error(failures.join('\n'));
		process.exitCode = 1;
	} else {
		console.log(
			`Compliance hashes and pinned sources verified. ${result.releaseBlockers.length} release review requirements remain.`
		);
	}
}
