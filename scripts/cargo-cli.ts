import { spawnSync } from 'node:child_process';
import { delimiter, dirname } from 'node:path';
import process from 'node:process';

const rustupCargo = spawnSync('rustup', ['which', 'cargo'], {
	encoding: 'utf8',
	env: process.env
});
const cargoBinary =
	rustupCargo.status === 0 && rustupCargo.stdout.trim().length > 0
		? rustupCargo.stdout.trim()
		: 'cargo';

const result = spawnSync(cargoBinary, process.argv.slice(2), {
	stdio: 'inherit',
	env: {
		...process.env,
		PATH: `${dirname(cargoBinary)}${delimiter}${process.env.PATH ?? ''}`
	}
});

if (result.error) {
	throw result.error;
}

process.exit(result.status ?? 1);
