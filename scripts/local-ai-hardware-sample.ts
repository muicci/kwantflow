import { appendFileSync, createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { join, resolve } from 'node:path';

type Options = {
	durationSeconds: number;
	intervalMs: number;
	outDir: string;
	processName: string;
};

type PowerCapture = {
	command: string;
	completion: Promise<boolean>;
	stop: () => void;
};

const DEFAULT_OPTIONS: Options = {
	durationSeconds: 60,
	intervalMs: 1000,
	outDir: 'runs/local-ai-hardware',
	processName: 'kwantflow-app'
};

function parsePositiveInteger(value: string | undefined, fallback: number): number {
	if (!value) return fallback;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseArgs(argv: string[]): Options {
	const options = { ...DEFAULT_OPTIONS };
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		const next = argv[index + 1];
		if (arg === '--duration') {
			options.durationSeconds = parsePositiveInteger(next, options.durationSeconds);
			index += 1;
		} else if (arg === '--interval') {
			options.intervalMs = parsePositiveInteger(next, options.intervalMs);
			index += 1;
		} else if (arg === '--out') {
			options.outDir = next ? resolve(next) : options.outDir;
			index += 1;
		} else if (arg === '--process-name') {
			options.processName = next ?? options.processName;
			index += 1;
		} else if (arg === '--help') {
			printUsage();
			process.exit(0);
		}
	}
	options.outDir = resolve(options.outDir);
	return options;
}

function printUsage() {
	console.log(`Usage: pnpm local-ai:hardware -- [options]

Options:
  --duration <seconds>      Sampling duration (default: ${DEFAULT_OPTIONS.durationSeconds})
  --interval <ms>           Sampling interval (default: ${DEFAULT_OPTIONS.intervalMs})
  --out <dir>               Output directory (default: ${DEFAULT_OPTIONS.outDir})
  --process-name <name>     Process name to match (default: ${DEFAULT_OPTIONS.processName})
  --help                    Show this help

Run this while Draft with AI is active. On macOS, powermetrics requires sudo.
If sudo is not already available, the script still writes incremental process
CPU/memory samples and prints the exact powermetrics command to run separately.`);
}

function run(command: string, args: string[]) {
	return spawnSync(command, args, {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe']
	});
}

function commandExists(command: string): boolean {
	const resolver = process.platform === 'win32' ? 'where' : 'which';
	return run(resolver, [command]).status === 0;
}

function findProcessRows(processName: string): string[] {
	if (process.platform === 'win32') return [];
	const result = run('ps', ['-axo', 'pid,ppid,%cpu,%mem,command']);
	if (result.status !== 0) return [];
	return result.stdout
		.split('\n')
		.filter((line) => line.includes(processName) && !line.includes('local-ai-hardware-sample'));
}

function collectSystemProfile(): string {
	if (process.platform !== 'darwin' || !commandExists('system_profiler')) {
		return `system_profiler unavailable on ${process.platform}\n`;
	}
	const result = run('system_profiler', ['SPHardwareDataType', 'SPDisplaysDataType']);
	return [result.stdout, result.stderr].filter(Boolean).join('\n');
}

const delay = (milliseconds: number) =>
	new Promise<void>((resolveDelay) => setTimeout(resolveDelay, milliseconds));

async function collectProcessSamples(params: {
	options: Options;
	path: string;
	shouldStop: () => boolean;
}): Promise<number> {
	const { options, path, shouldStop } = params;
	writeFileSync(
		path,
		[
			'timestamp,pid,ppid,cpu_percent,mem_percent,command',
			`# durationSeconds=${options.durationSeconds} intervalMs=${options.intervalMs} processName=${options.processName}`
		].join('\n') + '\n',
		'utf8'
	);
	const sampleCount = Math.max(1, Math.ceil((options.durationSeconds * 1000) / options.intervalMs));
	let writtenRows = 0;
	for (let index = 0; index < sampleCount && !shouldStop(); index += 1) {
		const timestamp = new Date().toISOString();
		for (const row of findProcessRows(options.processName)) {
			const match = row.trim().match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+(.+)$/);
			if (!match) continue;
			appendFileSync(
				path,
				[timestamp, match[1], match[2], match[3], match[4], JSON.stringify(match[5])].join(',') +
					'\n',
				'utf8'
			);
			writtenRows += 1;
		}
		if (index < sampleCount - 1 && !shouldStop()) await delay(options.intervalMs);
	}
	return writtenRows;
}

function powermetricsCommand(options: Options): string {
	return (
		`sudo powermetrics -n ${Math.max(1, Math.ceil((options.durationSeconds * 1000) / options.intervalMs))} ` +
		`-i ${options.intervalMs} --samplers cpu_power,gpu_power,ane_power,tasks ` +
		'--show-process-gpu --show-process-energy'
	);
}

function startPowermetrics(options: Options, outputPath: string): PowerCapture {
	const command = powermetricsCommand(options);
	const unavailable = (message: string): PowerCapture => {
		writeFileSync(outputPath, `${message}\nRun during Draft with AI:\n${command}\n`, 'utf8');
		return { command, completion: Promise.resolve(false), stop: () => undefined };
	};
	if (process.platform !== 'darwin') {
		return unavailable(`powermetrics is macOS-only; platform=${process.platform}`);
	}
	if (!commandExists('powermetrics')) return unavailable('powermetrics not found.');
	if (run('sudo', ['-n', 'true']).status !== 0) {
		return unavailable(
			'powermetrics was not captured because sudo is unavailable non-interactively.'
		);
	}

	const stream = createWriteStream(outputPath, { flags: 'w' });
	const child: ChildProcess = spawn(
		'sudo',
		[
			'-n',
			'powermetrics',
			'-n',
			String(Math.max(1, Math.ceil((options.durationSeconds * 1000) / options.intervalMs))),
			'-i',
			String(options.intervalMs),
			'--samplers',
			'cpu_power,gpu_power,ane_power,tasks',
			'--show-process-gpu',
			'--show-process-energy'
		],
		{ stdio: ['ignore', stream, stream] }
	);
	const completion = new Promise<boolean>((resolveCompletion) => {
		let settled = false;
		const finish = (captured: boolean) => {
			if (settled) return;
			settled = true;
			stream.end();
			resolveCompletion(captured);
		};
		child.once('error', (error) => {
			appendFileSync(outputPath, `\npowermetrics failed: ${error.message}\n`, 'utf8');
			finish(false);
		});
		child.once('close', (code) => finish(code === 0));
	});
	return {
		command,
		completion,
		stop: () => {
			if (!child.killed) child.kill('SIGTERM');
		}
	};
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	mkdirSync(options.outDir, { recursive: true });
	const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
	const runDir = join(options.outDir, stamp);
	mkdirSync(runDir, { recursive: true });

	const processRows = findProcessRows(options.processName);
	writeFileSync(join(runDir, 'system-profile.txt'), collectSystemProfile(), 'utf8');
	writeFileSync(join(runDir, 'processes-before.txt'), `${processRows.join('\n')}\n`, 'utf8');

	let interruptionSignal: NodeJS.Signals | null = null;
	let stopRequested = false;
	const power = startPowermetrics(options, join(runDir, 'powermetrics.txt'));
	const handleSignal = (signal: NodeJS.Signals) => {
		interruptionSignal = signal;
		stopRequested = true;
		power.stop();
	};
	const handleSigint = () => handleSignal('SIGINT');
	const handleSigterm = () => handleSignal('SIGTERM');
	process.once('SIGINT', handleSigint);
	process.once('SIGTERM', handleSigterm);

	let processSampleRows = 0;
	let powermetricsCaptured = false;
	try {
		processSampleRows = await collectProcessSamples({
			options,
			path: join(runDir, 'process-samples.csv'),
			shouldStop: () => stopRequested
		});
		if (stopRequested) power.stop();
		powermetricsCaptured = await power.completion;
	} finally {
		process.removeListener('SIGINT', handleSigint);
		process.removeListener('SIGTERM', handleSigterm);
		writeFileSync(
			join(runDir, 'summary.json'),
			`${JSON.stringify(
				{
					createdAt: new Date().toISOString(),
					platform: process.platform,
					durationSeconds: options.durationSeconds,
					intervalMs: options.intervalMs,
					processName: options.processName,
					initialProcessCount: processRows.length,
					processSampleRows,
					interrupted: interruptionSignal !== null,
					interruptionSignal,
					powermetricsCommand: power.command,
					powermetricsCaptured,
					files: [
						'system-profile.txt',
						'processes-before.txt',
						'process-samples.csv',
						'powermetrics.txt'
					]
				},
				null,
				2
			)}\n`,
			'utf8'
		);
	}

	console.log(`Local AI hardware sample written to ${runDir}`);
	if (!powermetricsCaptured) {
		console.log('powermetrics was not captured. Run this during Draft with AI:');
		console.log(power.command);
	}
	if (processRows.length === 0) {
		console.log(`No ${options.processName} process was detected at sample start.`);
	}
	if (interruptionSignal) process.exitCode = interruptionSignal === 'SIGINT' ? 130 : 143;
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
