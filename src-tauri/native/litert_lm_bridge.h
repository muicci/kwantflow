#ifndef KWANTFLOW_LITERT_LM_BRIDGE_H_
#define KWANTFLOW_LITERT_LM_BRIDGE_H_

#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct KfLiteRtEngine KfLiteRtEngine;
typedef void (*KfLiteRtChunkCallback)(const char* chunk, void* user_data);

KfLiteRtEngine* kf_litert_create_engine(const char* model_path,
                                        const char* native_lib_dir,
                                        const char* cache_dir,
                                        bool use_gpu,
                                        bool enable_speculative_decoding,
                                        int max_num_tokens,
                                        char** error_out);
void kf_litert_destroy_engine(KfLiteRtEngine* engine);

/// Creates a persistent conversation on the engine.
/// Stores system message and tools internally for reuse across turns.
/// Only one persistent conversation exists per engine at a time.
/// @return 0 on success, non-zero on failure.
int kf_litert_create_conversation(KfLiteRtEngine* engine,
                                  const char* system_json,
                                  const char* tools_json,
                                  const char* messages_json,
                                  const char* extra_context_json,
                                  char** error_out);

/// Sends a message to the existing persistent conversation.
/// The conversation accumulates history and KV cache across calls.
/// The implementation branches the v0.16 Conversation with its released
/// clone operation, commits only a completed branch, and discards a cancelled
/// branch. The v0.16 C Conversation ABI does not expose its underlying Session
/// checkpoint/rewind handle, and upstream marks a cancelled Conversation as
/// poisoned, so this branch is required for safe persistence.
/// @return 0 on success, -1 on error, -2 on timeout, -3 on cancelled.
int kf_litert_send_message_to_conversation(KfLiteRtEngine* engine,
                                           const char* message_json,
                                           int max_output_tokens,
                                           KfLiteRtChunkCallback callback,
                                           void* user_data,
                                           char** error_out);

/// Destroys the persistent conversation. Safe to call if none exists.
void kf_litert_destroy_conversation(KfLiteRtEngine* engine);

/// Returns the total token count in the conversation KV cache
/// (prefill + decode across all turns), or -1 on error.
int kf_litert_get_conversation_token_count(KfLiteRtEngine* engine);
int kf_litert_get_conversation_benchmark(KfLiteRtEngine* engine,
                                         double* time_to_first_token_seconds,
                                         int* prefill_token_count,
                                         int* decode_token_count,
                                         double* prefill_tokens_per_second,
                                         double* decode_tokens_per_second);

/// Sends a message through a full-prefill LiteRT-LM Conversation send.
/// This creates a fresh Conversation with system/tools/history, streams one
/// turn, then destroys it. This is the reliable app-managed agent path, not a
/// plain prompt-flattening path.
///
/// @param engine            The engine instance.
/// @param message_json      A single user message JSON (e.g. {"role":"user","content":"..."}).
/// @param system_json       Optional system message JSON string, or NULL.
/// @param tools_json        Optional tools JSON array string, or NULL.
/// @param history_json      Optional prior conversation messages JSON array, or NULL.
/// @param enable_constrained_decoding Enables LiteRT-LM native constrained decoding for tool calls.
/// @param callback          Streaming chunk callback.
/// @param user_data         User data pointer for the callback.
/// @param error_out         Receives error string on failure (caller must free via kf_litert_free_string).
/// @return 0 on success, non-zero on failure.
int kf_litert_send_message(KfLiteRtEngine* engine, const char* message_json,
                           const char* system_json, const char* tools_json,
                           const char* history_json, const char* extra_context_json,
                           int max_output_tokens,
                           int visual_token_budget,
                           bool enable_constrained_decoding,
                           KfLiteRtChunkCallback callback, void* user_data,
                           char** error_out);
void kf_litert_cancel(KfLiteRtEngine* engine);
int kf_litert_get_active_stream_count(KfLiteRtEngine* engine);
void kf_litert_free_string(char* value);
int kf_litert_set_sampler_params(KfLiteRtEngine* engine,
                                 int sampler_type,
                                 int top_k,
                                 float top_p,
                                 float temperature,
                                 int seed);
void kf_litert_clear_sampler_params(KfLiteRtEngine* engine);

#ifdef __cplusplus
}
#endif

#endif  // KWANTFLOW_LITERT_LM_BRIDGE_H_
