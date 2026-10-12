import { describe, expect, it } from 'vitest';
import {
	getLocalAiRuntimeCapabilities,
	localAiRuntimeManifest
} from '$lib/constants/local-ai-runtime-manifest.js';
import runtimeManifest from '../../../src-tauri/local-ai-runtime-manifest.json';

describe('local AI runtime manifest', () => {
	it('defines one direct-model source of truth without server registry fields', () => {
		expect(localAiRuntimeManifest.version).toBe(2);
		expect(localAiRuntimeManifest.litertLm.modelArtifactId).toBeTruthy();
		expect('serverHost' in runtimeManifest).toBe(false);
		expect('serverPort' in runtimeManifest).toBe(false);
		expect('platformArtifacts' in runtimeManifest).toBe(false);
	});

	it('exposes capability defaults for status diagnostics', () => {
		expect(getLocalAiRuntimeCapabilities().supportsNativeToolCalls).toBe(true);
		expect(getLocalAiRuntimeCapabilities().supportsVisionInputs).toBe(true);
		expect(getLocalAiRuntimeCapabilities().supportsPersistentConversation).toBe(true);
		expect(getLocalAiRuntimeCapabilities().supportsPersistentConversationWithVision).toBe(false);
	});

	it('uses the Tauri JSON manifest directly instead of a duplicated TS manifest', () => {
		expect(localAiRuntimeManifest).toEqual(runtimeManifest);
		expect(localAiRuntimeManifest.litertLm.modelFileName).toBe('gemma-4-e4b/model.litertlm');
		expect(localAiRuntimeManifest.contextSizeTokens).toBe(32003);
	});

	it('capabilities are derived from the imported JSON manifest', () => {
		const tsLitertCaps = getLocalAiRuntimeCapabilities();

		expect(tsLitertCaps).toEqual(runtimeManifest.litertLm.capabilities);
	});
});
