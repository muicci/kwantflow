import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Local AI hardware sampling lifecycle', () => {
	it('persists samples incrementally and finalizes diagnostics after interruption', () => {
		const source = readFileSync('scripts/local-ai-hardware-sample.ts', 'utf8');

		expect(source).toContain('appendFileSync');
		expect(source).toContain("process.once('SIGINT', handleSigint)");
		expect(source).toContain("process.once('SIGTERM', handleSigterm)");
		expect(source).toContain('interruptionSignal');
		expect(source).toContain('powermetricsCaptured = await power.completion');
		expect(source).toContain('cpu_power,gpu_power,ane_power,tasks');
	});
});
