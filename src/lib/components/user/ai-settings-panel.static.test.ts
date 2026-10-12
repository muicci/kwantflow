import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const componentPath = join(process.cwd(), 'src/lib/components/user/ai-settings-panel.svelte');
const localAiSetupCardPath = join(process.cwd(), 'src/lib/components/local-ai-setup-card.svelte');
const aiToggleControlsPath = join(
	process.cwd(),
	'src/lib/components/user/ai-toggle-controls.svelte'
);

describe('ai settings panel', () => {
	it('keeps settings focused on Local AI setup without Cloud or runtime switch controls', () => {
		const source = `${readFileSync(componentPath, 'utf8')}\n${readFileSync(localAiSetupCardPath, 'utf8')}\n${readFileSync(aiToggleControlsPath, 'utf8')}`;

		expect(source).toContain('Agent');
		expect(source).toContain('Kwantflow AI prepares draft estimates on this device.');
		expect(readFileSync(componentPath, 'utf8')).not.toContain(
			'Download once, then draft estimates on this device.'
		);
		expect(source).toContain(
			'one-time download. Internet needed for setup; use offline afterward.'
		);
		expect(source).toContain('Badge');
		expect(source).toContain('Kwantflow AI');
		expect(source).toContain('Download Kwantflow AI');
		expect(source).toContain('Remove Kwantflow AI');
		expect(source).toContain('Agent');
		expect(source).not.toContain('Upgrade annually');
		expect(source).not.toContain('Restore subscription');
		expect(source).toContain('Kwantflow AI');
		expect(source).toContain('formatDownloadSize(');
		expect(source).toContain('Cancel');
		expect(source).toContain('compact?: boolean');
		expect(source).toContain("compact ? 'Download' : 'Download Kwantflow AI'");
		expect(source).toContain(
			'one-time download. Internet needed for setup; use offline afterward.'
		);
		expect(source).toContain(
			'{#if !compact}\n\t\t\t\t\t<Badge variant={statusVariant}>{statusText}</Badge>\n\t\t\t\t{/if}'
		);
		expect(source).toContain('expectedDownloadBytes');
		expect(source).toContain('Downloaded on this device');
		expect(source).toContain('canCancelLocalAiDownload');
		expect(source).toContain('Ready for local estimate drafts and local help.');
		expect(source).toContain('Check Kwantflow AI install');
		expect(source).toContain('await aiState.verifyLocalAiInstall();');
		expect(source).not.toContain('ensureLocalAiReady');
		expect(source).not.toContain('without exposing model controls');
		expect(source).toContain("import { Switch } from '$lib/components/ui/switch/index.js';");
		expect(source).toContain('<Switch');
	});
});
