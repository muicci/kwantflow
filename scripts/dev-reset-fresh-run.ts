import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DEV_APP_IDENTIFIER = 'com.kwantflow.desktop.dev';

async function main(): Promise<void> {
	if (process.argv.slice(2).length > 0) {
		throw new Error('This reset applies only to the disposable development profile.');
	}
	const home = homedir();
	const targets =
		process.platform === 'darwin'
			? [
					join(home, 'Library', 'Application Support', DEV_APP_IDENTIFIER),
					join(home, 'Library', 'WebKit', DEV_APP_IDENTIFIER),
					join(home, 'Library', 'Caches', DEV_APP_IDENTIFIER),
					join(home, 'Library', 'Logs', DEV_APP_IDENTIFIER),
					join(home, 'Library', 'Preferences', `${DEV_APP_IDENTIFIER}.plist`)
				]
			: process.platform === 'win32'
				? [
						join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), DEV_APP_IDENTIFIER),
						join(process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), DEV_APP_IDENTIFIER)
					]
				: [];
	if (!targets.length) throw new Error(`Unsupported development platform: ${process.platform}`);
	for (const target of targets) {
		console.log(`Removing disposable development state: ${target}`);
		await rm(target, { force: true, recursive: true });
	}
	console.log(
		'Development profile reset complete. Documents, credentials, and installed app data were preserved.'
	);
}

void main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
