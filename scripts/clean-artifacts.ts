import { realpathSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CLEAN_ARTIFACT_PATHS = [
	'.cache',
	'.pnpm-store',
	'.svelte-kit',
	'build',
	'src-tauri/target'
] as const;

const DIST_PATH = 'dist';
const DURABLE_DIST_ENTRY = 'release-state';

export type CleanArtifactsResult = {
	removedPaths: string[];
	skippedPaths: string[];
	preservedPaths: string[];
};

export const cleanArtifacts = (
	rootDir = process.cwd(),
	removePath: (targetPath: string) => void = (targetPath) => {
		rmSync(targetPath, { recursive: true, force: true });
	},
	pathExists: (targetPath: string) => boolean = existsSync,
	listDirectory: (targetPath: string) => string[] = (targetPath) => readdirSync(targetPath)
): CleanArtifactsResult => {
	const removedPaths: string[] = [];
	const skippedPaths: string[] = [];
	const preservedPaths: string[] = [];

	for (const relativePath of CLEAN_ARTIFACT_PATHS) {
		const absolutePath = resolve(rootDir, relativePath);
		if (!pathExists(absolutePath)) {
			skippedPaths.push(relativePath);
			continue;
		}

		removePath(absolutePath);
		removedPaths.push(relativePath);
	}

	const distPath = resolve(rootDir, DIST_PATH);
	if (!pathExists(distPath)) {
		skippedPaths.push(DIST_PATH);
	} else {
		for (const entry of listDirectory(distPath)) {
			if (entry === DURABLE_DIST_ENTRY) {
				preservedPaths.push(`${DIST_PATH}/${DURABLE_DIST_ENTRY}`);
				continue;
			}

			removePath(resolve(distPath, entry));
			removedPaths.push(`${DIST_PATH}/${entry}`);
		}
	}

	return { removedPaths, skippedPaths, preservedPaths };
};

const printUsage = () => {
	console.error('Usage:\n  pnpm clean:artifacts');
};

const runCli = (args: string[]) => {
	if (args.length > 0) {
		printUsage();
		process.exitCode = 1;
		return;
	}

	const result = cleanArtifacts();
	console.log('Removed local artifacts:');
	for (const relativePath of result.removedPaths) {
		console.log(`- ${relativePath}`);
	}
	for (const relativePath of result.skippedPaths) {
		console.log(`- Skipped missing path: ${relativePath}`);
	}
	for (const relativePath of result.preservedPaths) {
		console.log(`- Preserved durable release evidence: ${relativePath}`);
	}
};

if (
	process.argv[1] &&
	existsSync(process.argv[1]) &&
	realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))
) {
	try {
		runCli(process.argv.slice(2));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(message);
		process.exitCode = 1;
	}
}
