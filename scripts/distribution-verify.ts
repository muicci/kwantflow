import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type DistributionManifest } from './distribution-build.js';
import { sha256File } from './native-prepare.js';

export async function verifyDistribution(path: string): Promise<DistributionManifest> {
	const manifest = JSON.parse(
		readFileSync(join(path, 'build-manifest.json'), 'utf8')
	) as DistributionManifest;
	if (
		manifest.schemaVersion !== 1 ||
		!/^\d+\.\d+\.\d+$/.test(manifest.version) ||
		!/^[a-f0-9]{40}$/.test(manifest.sourceCommit)
	)
		throw new Error('Invalid distribution provenance.');
	if (typeof manifest.sourceDirty !== 'boolean' || manifest.installedQa !== 'pending')
		throw new Error('Invalid distribution source or QA status.');
	if (!['darwin-universal', 'windows-x86_64'].includes(manifest.platform))
		throw new Error('Unsupported distribution platform.');
	if (!['ad-hoc', 'developer-id-notarized', 'unsigned'].includes(manifest.trust))
		throw new Error('Unknown signing status.');
	if (
		manifest.platform === 'windows-x86_64'
			? manifest.trust !== 'unsigned'
			: manifest.trust === 'unsigned'
	)
		throw new Error('Signing status does not match the platform.');
	if (manifest.trust === 'developer-id-notarized' && manifest.sourceDirty)
		throw new Error('Trusted distribution cannot claim a dirty source tree.');
	if (!Array.isArray(manifest.artifacts)) throw new Error('Missing distribution artifacts.');
	if (manifest.artifacts.length !== 1)
		throw new Error('Expected one installer per platform manifest.');
	if (manifest.platform === 'windows-x86_64') {
		const receipt = manifest.runtimeReceipt;
		if (
			!receipt ||
			receipt.name !== 'windows-runtime-receipt.json' ||
			!/^[a-f0-9]{64}$/.test(receipt.sha256)
		)
			throw new Error('Missing verified Windows runtime and prerequisite receipt.');
		if ((await sha256File(join(path, receipt.name))) !== receipt.sha256)
			throw new Error('Windows runtime receipt checksum mismatch.');
		const runtime = JSON.parse(readFileSync(join(path, receipt.name), 'utf8'));
		if (
			runtime.platform !== 'windows-x86_64' ||
			runtime.installedAppTested !== false ||
			runtime.webView2?.signatureStatus !== 'Valid' ||
			!/^\d+\.\d+\.\d+\.\d+$/.test(runtime.webView2?.installerVersion ?? '') ||
			!/^[a-f0-9]{64}$/.test(runtime.webView2?.sha256 ?? '') ||
			runtime.webView2?.minimumRuntimeVersion !== '125.0.0.0'
		)
			throw new Error(
				'Windows prerequisite receipt lacks the required certified WebView2 payload.'
			);
	} else if (manifest.runtimeReceipt) {
		throw new Error('Windows runtime receipt does not match the distribution platform.');
	}
	for (const artifact of manifest.artifacts) {
		if (
			basename(artifact.name) !== artifact.name ||
			artifact.name.includes('..') ||
			!/^[a-f0-9]{64}$/.test(artifact.sha256)
		)
			throw new Error('Invalid distribution artifact name or digest.');
		const expected =
			manifest.platform === 'darwin-universal'
				? `Kwantflow_${manifest.version}_universal.dmg`
				: `Kwantflow_${manifest.version}_x64-setup.exe`;
		if (artifact.name !== expected)
			throw new Error('Installer name does not match platform and version.');
		if ((await sha256File(join(path, artifact.name))) !== artifact.sha256)
			throw new Error(`Distribution checksum mismatch: ${artifact.name}`);
	}
	const expectedChecksums = manifest.artifacts
		.map((artifact) => `${artifact.sha256}  ${artifact.name}\n`)
		.join('');
	if (readFileSync(join(path, 'SHA256SUMS'), 'utf8') !== expectedChecksums)
		throw new Error('SHA256SUMS does not match the verified installer manifest.');
	return manifest;
}

if (
	process.argv[1] &&
	existsSync(process.argv[1]) &&
	realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	if (process.argv.length !== 3)
		throw new Error('Usage: pnpm distribution:verify <dist/distribution/version/platform>');
	const manifest = await verifyDistribution(resolve(process.argv[2]));
	console.log(
		`Verified installer bytes for ${manifest.version} ${manifest.platform} (${manifest.trust}). This does not prove installed user flows or publication.`
	);
}
