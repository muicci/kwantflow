import { describe, expect, it } from 'vitest';

import { LocalAiStatusSchema } from './index.js';

function createStatusPayload(installState: string) {
	return {
		runtimeKind: 'litert_lm',
		runtimeVersion: 'litert-lm-v0.16.0',
		modelRepoId: 'litert-community/gemma-4-E4B-it-litert-lm',
		modelArtifactId: 'kwantflow-ai.litertlm',
		expectedDownloadBytes: 3_659_530_240,
		modelFileName: 'gemma-4-e4b/model.litertlm',
		mmprojFileName: null,
		installState,
		runtimeAvailable: true,
		modelReady: true,
		supportsImageInputs: false,
		activeDownload: null,
		lastError: null
	};
}

describe('LocalAiStatusSchema', () => {
	it('rejects the removed model_warming lifecycle state', () => {
		expect(() => LocalAiStatusSchema.parse(createStatusPayload('model_warming'))).toThrow();
	});

	it('accepts native acquisition states emitted by the Rust runtime manager', () => {
		expect(LocalAiStatusSchema.parse(createStatusPayload('installed')).installState).toBe(
			'installed'
		);
		expect(LocalAiStatusSchema.parse(createStatusPayload('loading')).installState).toBe('loading');
	});

	it('rejects unknown lifecycle states', () => {
		expect(() => LocalAiStatusSchema.parse(createStatusPayload('not_running'))).toThrow();
	});

	it('defaults persistent conversation capability flags to disabled', () => {
		const parsed = LocalAiStatusSchema.parse(createStatusPayload('ready'));

		expect(parsed.diagnostics.capabilityProbe.supportsPersistentConversation).toBe(false);
		expect(parsed.diagnostics.capabilityProbe.supportsPersistentConversationWithVision).toBe(false);
	});

	it('accepts the unverified capability source emitted before the native probe runs', () => {
		const parsed = LocalAiStatusSchema.parse({
			...createStatusPayload('ready'),
			diagnostics: {
				activeLaunchProfile: 'not_started',
				startupElapsedMs: null,
				imageProbeElapsedMs: null,
				lastCompletionElapsedMs: null,
				lastFailureClass: null,
				lastTimeoutStage: null,
				gpuAcceleration: 'unknown',
				contextSizeTokens: 32_003,
				activeStreamCount: 0,
				capabilityProbe: {
					source: 'unverified'
				}
			}
		});

		expect(parsed.diagnostics.capabilityProbe.source).toBe('unverified');
		expect(parsed.diagnostics.capabilityProbe.supportsNativeToolCalls).toBe(false);
	});
});
