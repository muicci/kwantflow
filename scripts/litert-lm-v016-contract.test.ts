import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const native = (file: string) => resolve(process.cwd(), 'src-tauri', 'native', file);

describe('LiteRT-LM v0.16 bridge contract', () => {
	it('uses the pinned v0.16 conversation and streamed callback APIs', () => {
		const header = readFileSync(native('engine.h'), 'utf8');
		const conversation = readFileSync(native('conversation.h'), 'utf8');
		expect(header).toContain('typedef struct LiteRtLmSamplerParams LiteRtLmSamplerParams;');
		expect(header).toContain('litert_lm_sampler_params_create');
		expect(header).toContain('typedef struct LiteRtLmInputData LiteRtLmInputData;');
		expect(conversation).toContain('litert_lm_conversation_config_set_tools');
		expect(conversation).toContain('litert_lm_conversation_send_message_stream');
		expect(conversation).toContain('#include "engine.h"');
		expect(conversation).not.toContain('third_party/odml/litert_lm/c/engine.h');
		expect(header).toContain('litert_lm_stream_chunk_get_text');
		expect(header).toContain('typedef void (*LiteRtLmStreamCallback)(void* callback_data,');
		expect(header).toContain('LiteRtLmStreamChunk');
	});

	it('documents why Conversation remains the production Session wrapper', () => {
		const engine = readFileSync(native('engine.h'), 'utf8');
		const conversation = readFileSync(native('conversation.h'), 'utf8');
		const bridge = readFileSync(native('litert_lm_bridge_litert.cc'), 'utf8');
		const readme = readFileSync(native('README.md'), 'utf8');

		// v0.16 has the low-level checkpoint API, but its C Session surface is
		// low-level InputData only. Keep this guard tied to the upstream ABI
		// and the production rationale so a future refactor cannot silently drop
		// Gemma's prompt, tools, reasoning, or multimodal semantics.
		expect(engine).toContain('litert_lm_session_save_checkpoint');
		expect(engine).toContain('litert_lm_session_rewind_to_checkpoint');
		expect(conversation).toContain('litert_lm_conversation_clone');
		expect(bridge).toContain('litert_lm_conversation_clone');
		expect(readme).toContain('v0.16 Session and Conversation boundary');
		expect(readme).toContain('transactional branch');
		expect(readme).toContain('Gemma 4 prompt template');
		expect(readme).toContain('CancelProcess` poisons the underlying session');
	});

	it('uses one released v0.16 callback ABI on every platform', () => {
		const bridge = readFileSync(native('litert_lm_bridge_litert.cc'), 'utf8');
		const build = readFileSync(resolve(process.cwd(), 'src-tauri', 'build.rs'), 'utf8');
		expect(bridge).toContain('#include <conversation.h>');
		expect(bridge).toContain('const LiteRtLmStreamChunk* chunk');
		expect(bridge).not.toContain('KWANTFLOW_LITERT_STREAM_CHUNK_ABI');
		expect(build).not.toContain('KWANTFLOW_LITERT_STREAM_CHUNK_ABI');
		expect(build).not.toContain('litert_lm_stream_chunk_get_text');
	});

	it('uses LiteRT-LM parsed tool calls without a second raw-token parser', () => {
		const bridge = readFileSync(native('litert_lm_bridge_litert.cc'), 'utf8');
		const rust = readFileSync(resolve(process.cwd(), 'src-tauri', 'src', 'local_ai.rs'), 'utf8');
		expect(bridge).not.toContain('set_stream_tool_calls(conv_config, true');
		expect(rust).toContain('extract_structured_tool_calls');
		expect(rust).toContain("callback message's tool_calls field");
	});

	it('does not recursively lock the persistent conversation mutex', () => {
		const bridge = readFileSync(native('litert_lm_bridge_litert.cc'), 'utf8');
		const start = bridge.indexOf('int kf_litert_send_message_to_conversation');
		const end = bridge.indexOf('void kf_litert_destroy_conversation', start);
		const body = bridge.slice(start, end);
		expect(body).not.toContain(
			'std::lock_guard<std::mutex> lock(engine->mutex);\n    std::lock_guard<std::mutex> lock(engine->mutex);'
		);
	});

	it('publishes one v0.16 runtime contract to release tooling', () => {
		const manifest = JSON.parse(
			readFileSync(resolve(process.cwd(), 'src-tauri', 'local-ai-runtime-manifest.json'), 'utf8')
		) as { litertLm: { runtimeVersion: string } };
		expect(manifest.litertLm.runtimeVersion).toBe('litert-lm-v0.16.0');
		const windowsContract = JSON.parse(
			readFileSync(
				resolve(process.cwd(), '.github', 'windows-native-runtime-contract.json'),
				'utf8'
			)
		) as { litertLm: { version: string; commit: string } };
		expect(windowsContract.litertLm).toMatchObject({
			version: 'v0.16.0',
			commit: '924e79c91542761242244e4f1651851f822e4cbb'
		});
		const inputs = JSON.parse(readFileSync(resolve(process.cwd(), 'native-inputs.json'), 'utf8'));
		expect(inputs.litertLm.macos.sha256).toBe(
			'3ae6c876abd74614b1869bfc40cb4d0b892981363564740268b1f8ac5cf895a4'
		);
		const windows = readFileSync(resolve(process.cwd(), 'scripts/native-windows.ps1'), 'utf8');
		expect(windows).toContain('conversation.h');
		const patch = readFileSync(
			resolve(process.cwd(), 'scripts/native/litert-windows-c-api.patch'),
			'utf8'
		);
		expect(patch).toContain('conversation.cc');
	});

	it('always compiles and packages the same staged runtime closure', () => {
		const build = readFileSync(resolve(process.cwd(), 'src-tauri', 'build.rs'), 'utf8');
		expect(build).toContain('let include_dir = "native";');
		expect(build).toContain('let lib_dir = "native-runtime";');
		expect(build).not.toContain('KWANTFLOW_LITERT_LM_C_INCLUDE_DIR');
		expect(build).not.toContain('KWANTFLOW_LITERT_LM_LIB_DIR');
		expect(build).toContain('conversation.h');
	});

	it('does not allow incomplete evidence coverage to become a file-cache hit', () => {
		const localAi = readFileSync(resolve(process.cwd(), 'src/lib/services/local-ai.ts'), 'utf8');
		expect(localAi).toContain(
			"EVIDENCE_UNIT_PREPARATION_VERSION = 'evidence-units-v5-complete-terminal-coverage'"
		);
		expect(localAi).toContain('hasCompleteTerminalCoverage');
	});
});
