#include "litert_lm_bridge.h"

#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <string>
#include <vector>
#include <memory>
#include <algorithm>

#include <conversation.h>

constexpr int kStreamInactivityTimeoutSeconds = 60;

struct StreamState {
  KfLiteRtChunkCallback callback = nullptr;
  void* user_data = nullptr;
  std::mutex mutex;
  std::condition_variable done_cv;
  bool done = false;
  bool cancelled = false;
  std::string error;
  std::chrono::steady_clock::time_point last_chunk_time;
};

struct KfLiteRtEngine {
  LiteRtLmEngine* engine = nullptr;
  LiteRtLmConversation* active_conversation = nullptr;
  LiteRtLmConversation* persistent_conversation = nullptr;
  std::string persistent_system_json;
  std::string persistent_tools_json;
  std::vector<std::shared_ptr<StreamState>> pending_streams;
  std::mutex mutex;
  LiteRtLmSamplerParams* sampler_params = nullptr;
  bool has_last_benchmark = false;
  double last_time_to_first_token_seconds = 0.0;
  int last_prefill_token_count = 0;
  int last_decode_token_count = 0;
  double last_prefill_tokens_per_second = 0.0;
  double last_decode_tokens_per_second = 0.0;
};

namespace {

char* CopyString(const char* message) {
  if (message == nullptr) {
    return nullptr;
  }
  const size_t length = std::strlen(message);
  char* copy = static_cast<char*>(std::malloc(length + 1));
  if (copy == nullptr) {
    return nullptr;
  }
  std::memcpy(copy, message, length + 1);
  return copy;
}

void SetError(char** error_out, const char* message) {
  if (error_out == nullptr) {
    return;
  }
  *error_out = CopyString(message);
}

// JsonEscape removed


void HandleStreamCallback(StreamState* state, const char* text, bool is_final,
                          const char* error_msg) {
  if (state == nullptr) return;
  std::lock_guard<std::mutex> lock(state->mutex);
  state->last_chunk_time = std::chrono::steady_clock::now();
  if (error_msg != nullptr) {
    state->error = error_msg;
  }
  if (text != nullptr && state->callback != nullptr) {
    state->callback(text, state->user_data);
  }
  if (is_final) {
    state->done = true;
    state->done_cv.notify_one();
  }
}

void RemovePendingStream(KfLiteRtEngine* engine,
                         const std::shared_ptr<StreamState>& stream) {
  std::lock_guard<std::mutex> lock(engine->mutex);
  engine->pending_streams.erase(
      std::remove(engine->pending_streams.begin(), engine->pending_streams.end(),
                  stream),
      engine->pending_streams.end());
}

void StreamCallback(void* callback_data, const LiteRtLmStreamChunk* chunk) {
  // LiteRT-LM signals completion with an empty callback message. Treat a null
  // C chunk as the terminal marker, not an error, matching the v0.16
  // Conversation callback contract.
  const char* text = chunk == nullptr ? nullptr : litert_lm_stream_chunk_get_text(chunk);
  const bool is_final = chunk == nullptr || litert_lm_stream_chunk_is_final(chunk);
  const char* error_msg = chunk == nullptr ? nullptr : litert_lm_stream_chunk_get_error(chunk);
  HandleStreamCallback(static_cast<StreamState*>(callback_data), text, is_final,
                       error_msg);
}

}  // namespace

KfLiteRtEngine* kf_litert_create_engine(const char* model_path,
                                        const char* native_lib_dir,
                                        const char* cache_dir,
                                        bool use_gpu,
                                        bool enable_speculative_decoding,
                                        int max_num_tokens,
                                        char** error_out) {
  // Suppress LiteRT-LM internal logging noise (tensor_buffer, delegate_kernel,
  // magic_number trace messages). Level 4 = ERROR only, matching Eloquent's
  // behavior of suppressing non-error output. Real errors still surface.
  // Level 1 (INFO) was generating 70K+ lines of noise per session in dev mode.
  litert_lm_set_min_log_level(kLiteRtLmLogSeverityError);

  if (model_path == nullptr || model_path[0] == '\0') {
    SetError(error_out, "model path is required");
    return nullptr;
  }

  const char* backend = use_gpu ? "gpu" : "cpu";
  LiteRtLmEngineSettings* settings = litert_lm_engine_settings_create(
      model_path, backend, backend, nullptr);
  if (settings == nullptr) {
    SetError(error_out, "LiteRT-LM failed to create engine settings");
    return nullptr;
  }

  // Configure the context window size before engine creation.
  // The model's magic number (32003 embedded in the binary) is replaced with
  // this value, so the tensors are reshaped for the runtime context length.
  // Default is 4096; we need at least 8192+ to fit system prompt + tools + history.
  if (max_num_tokens > 0) {
    litert_lm_engine_settings_set_max_num_tokens(settings, max_num_tokens);
  }

  if (native_lib_dir != nullptr && native_lib_dir[0] != '\0') {
    litert_lm_engine_settings_set_litert_dispatch_lib_dir(settings,
                                                          native_lib_dir);
  }
  if (cache_dir != nullptr && cache_dir[0] != '\0') {
    litert_lm_engine_settings_set_cache_dir(settings, cache_dir);
  }
  litert_lm_engine_settings_set_enable_speculative_decoding(settings,
                                                            enable_speculative_decoding);
  // Enable LiteRT-LM's built-in runtime metrics without imposing synthetic
  // benchmark token counts. TTFT is conversation-level; prefill/decode are
  // read from the latest recorded turn.
  litert_lm_engine_settings_set_num_prefill_tokens(settings, 0);
  litert_lm_engine_settings_set_num_decode_tokens(settings, 0);
  litert_lm_engine_settings_set_max_num_images(settings, 5);
  LiteRtLmEngine* engine = litert_lm_engine_create(settings);
  litert_lm_engine_settings_delete(settings);
  if (engine == nullptr) {
    SetError(error_out, "LiteRT-LM failed to create engine");
    return nullptr;
  }

  auto* bridge_engine = new KfLiteRtEngine;
  bridge_engine->engine = engine;
  return bridge_engine;
}

void kf_litert_destroy_engine(KfLiteRtEngine* engine) {
  if (engine == nullptr) {
    return;
  }
  {
    std::lock_guard<std::mutex> lock(engine->mutex);
    if (engine->active_conversation != nullptr) {
      litert_lm_conversation_cancel_process(engine->active_conversation);
      litert_lm_conversation_delete(engine->active_conversation);
      engine->active_conversation = nullptr;
    }
    if (engine->persistent_conversation != nullptr) {
      litert_lm_conversation_delete(engine->persistent_conversation);
      engine->persistent_conversation = nullptr;
    }
    engine->persistent_system_json.clear();
    engine->persistent_tools_json.clear();
    if (engine->sampler_params != nullptr) {
      litert_lm_sampler_params_delete(engine->sampler_params);
      engine->sampler_params = nullptr;
    }
    // Disconnect any remaining pending streams
    for (auto& stream : engine->pending_streams) {
      if (stream) {
        std::lock_guard<std::mutex> stream_lock(stream->mutex);
        stream->callback = nullptr;
        stream->user_data = nullptr;
      }
    }
  }
  litert_lm_engine_delete(engine->engine);
  delete engine;
}

int kf_litert_send_message(KfLiteRtEngine* engine, const char* message_json,
                           const char* system_json, const char* tools_json,
                           const char* history_json, const char* extra_context_json,
                           int max_output_tokens,
                           int visual_token_budget,
                           bool enable_constrained_decoding,
                           KfLiteRtChunkCallback callback, void* user_data,
                           char** error_out) {
  if (engine == nullptr || engine->engine == nullptr) {
    SetError(error_out, "LiteRT-LM engine is not loaded");
    return -1;
  }
  if (message_json == nullptr || message_json[0] == '\0') {
    SetError(error_out, "message_json is required");
    return -1;
  }

  // Prune completed streams
  {
    std::lock_guard<std::mutex> lock(engine->mutex);
    engine->pending_streams.erase(
        std::remove_if(engine->pending_streams.begin(),
                       engine->pending_streams.end(),
                       [](const std::shared_ptr<StreamState>& s) {
                         std::lock_guard<std::mutex> l(s->mutex);
                         return s->done || s->cancelled;
                       }),
        engine->pending_streams.end());
  }

  LiteRtLmSessionConfig* session_config = litert_lm_session_config_create();
  if (session_config != nullptr) {
    litert_lm_session_config_set_apply_prompt_template(session_config, true);
    litert_lm_session_config_set_max_output_tokens(
        session_config, max_output_tokens > 0 ? max_output_tokens : 8192);
    std::lock_guard<std::mutex> lock(engine->mutex);
    if (engine->sampler_params != nullptr) {
      litert_lm_session_config_set_sampler_params(session_config, engine->sampler_params);
    }
  }

  LiteRtLmConversationConfig* conv_config = litert_lm_conversation_config_create();
  if (conv_config != nullptr && session_config != nullptr) {
    litert_lm_conversation_config_set_session_config(conv_config, session_config);
  }

  // Configure system message, tools, and conversation history on the
  // ConversationConfig so the Jinja prompt template renders them correctly.
  if (conv_config != nullptr) {
    if (system_json != nullptr && system_json[0] != '\0') {
      litert_lm_conversation_config_set_system_message(conv_config, system_json);
    }
    if (tools_json != nullptr && tools_json[0] != '\0') {
      litert_lm_conversation_config_set_tools(conv_config, tools_json);
      // The Conversation API returns parsed calls in the callback's
      // `tool_calls` field. Do not enable the optional raw token stream,
      // which would add a second, weaker parsing contract.
      if (enable_constrained_decoding) {
        litert_lm_conversation_config_set_enable_constrained_decoding(conv_config, true);
      }
    }
    if (history_json != nullptr && history_json[0] != '\0') {
      litert_lm_conversation_config_set_messages(conv_config, history_json);
    }
    if (extra_context_json != nullptr && extra_context_json[0] != '\0') {
      litert_lm_conversation_config_set_extra_context(conv_config,
                                                       extra_context_json);
    }
    // Reclaim thinking/reasoning channel tokens from the KV cache
    // between turns to preserve context window space.
    litert_lm_conversation_config_set_filter_channel_content_from_kv_cache(conv_config, true);
  }

  LiteRtLmConversation* conversation =
      litert_lm_conversation_create(engine->engine, conv_config);

  if (conv_config != nullptr) {
    litert_lm_conversation_config_delete(conv_config);
  }
  if (session_config != nullptr) {
    litert_lm_session_config_delete(session_config);
  }

  if (conversation == nullptr) {
    SetError(error_out, "LiteRT-LM failed to create conversation");
    return -1;
  }

  auto stream_state = std::make_shared<StreamState>();
  stream_state->callback = callback;
  stream_state->user_data = user_data;
  stream_state->last_chunk_time = std::chrono::steady_clock::now();

  {
    std::lock_guard<std::mutex> lock(engine->mutex);
    engine->active_conversation = conversation;
    engine->pending_streams.push_back(stream_state);
  }

  LiteRtLmConversationOptionalArgs* optional_args = nullptr;
  if (visual_token_budget > 0 || max_output_tokens > 0) {
    optional_args = litert_lm_conversation_optional_args_create();
    if (optional_args != nullptr) {
      if (visual_token_budget > 0) {
        litert_lm_conversation_optional_args_set_visual_token_budget(
            optional_args, visual_token_budget);
      }
      if (max_output_tokens > 0) {
        litert_lm_conversation_optional_args_set_max_output_tokens(
            optional_args, max_output_tokens);
      }
    }
  }
  const int status = litert_lm_conversation_send_message_stream(
      conversation, message_json, nullptr, optional_args, StreamCallback,
      stream_state.get());
  if (optional_args != nullptr) {
    litert_lm_conversation_optional_args_delete(optional_args);
  }
  if (status != 0) {
    {
      std::lock_guard<std::mutex> lock(engine->mutex);
      engine->active_conversation = nullptr;
      engine->pending_streams.erase(
          std::remove(engine->pending_streams.begin(),
                      engine->pending_streams.end(),
                      stream_state),
          engine->pending_streams.end());
    }
    litert_lm_conversation_delete(conversation);
    SetError(error_out, "LiteRT-LM failed to start message stream");
    return status;
  }

  bool completed = false;
  bool cancelled = false;
  {
    std::unique_lock<std::mutex> lock(stream_state->mutex);
    while (!stream_state->done && !stream_state->cancelled) {
      auto now = std::chrono::steady_clock::now();
      auto elapsed = std::chrono::duration_cast<std::chrono::seconds>(now - stream_state->last_chunk_time).count();
      if (elapsed >= kStreamInactivityTimeoutSeconds) {
        break;
      }
      auto wait_time = std::chrono::seconds(kStreamInactivityTimeoutSeconds - elapsed);
      stream_state->done_cv.wait_for(lock, wait_time);
    }
    completed = stream_state->done;
    cancelled = stream_state->cancelled;
  }

  {
    std::lock_guard<std::mutex> lock(engine->mutex);
    engine->active_conversation = nullptr;
  }
  if (cancelled || !completed) {
    litert_lm_conversation_cancel_process(conversation);
  }
  if (completed && !cancelled) {
    LiteRtLmBenchmarkInfo* benchmark =
        litert_lm_conversation_get_benchmark_info(conversation);
    if (benchmark != nullptr) {
      const int prefill_turns =
          litert_lm_benchmark_info_get_num_prefill_turns(benchmark);
      const int decode_turns =
          litert_lm_benchmark_info_get_num_decode_turns(benchmark);
      std::lock_guard<std::mutex> lock(engine->mutex);
      engine->has_last_benchmark = true;
      engine->last_time_to_first_token_seconds =
          litert_lm_benchmark_info_get_time_to_first_token(benchmark);
      engine->last_prefill_token_count =
          prefill_turns > 0
              ? litert_lm_benchmark_info_get_prefill_token_count_at(
                    benchmark, prefill_turns - 1)
              : 0;
      engine->last_decode_token_count =
          decode_turns > 0
              ? litert_lm_benchmark_info_get_decode_token_count_at(
                    benchmark, decode_turns - 1)
              : 0;
      engine->last_prefill_tokens_per_second =
          prefill_turns > 0
              ? litert_lm_benchmark_info_get_prefill_tokens_per_sec_at(
                    benchmark, prefill_turns - 1)
              : 0.0;
      engine->last_decode_tokens_per_second =
          decode_turns > 0
              ? litert_lm_benchmark_info_get_decode_tokens_per_sec_at(
                    benchmark, decode_turns - 1)
              : 0.0;
      litert_lm_benchmark_info_delete(benchmark);
    }
  }
  litert_lm_conversation_delete(conversation);

  // Safety disconnect of callbacks and context pointers.
  // This ensures that any background LiteRT threads executing delayed callbacks won't try
  // to invoke the Rust callback with a pointer to a deallocated Rust stack context.
  {
    std::lock_guard<std::mutex> lock(stream_state->mutex);
    stream_state->callback = nullptr;
    stream_state->user_data = nullptr;
  }

  RemovePendingStream(engine, stream_state);

  if (cancelled) {
    SetError(error_out, "ai_failure_kind=cancelled; LiteRT-LM stream generation was cancelled by the user.");
    return -3;
  }

  if (!completed) {
    SetError(error_out, "LiteRT-LM stream generation timed out (60s inactive).");
    return -2;
  }

  if (!stream_state->error.empty()) {
    SetError(error_out, stream_state->error.c_str());
    return -1;
  }
  return 0;
}

void kf_litert_cancel(KfLiteRtEngine* engine) {
  if (engine == nullptr) {
    return;
  }
  // LiteRT-LM v0.16 CancelProcess only marks the upstream task cancelled; it
  // does not invoke the callback synchronously. Keep the engine mutex held
  // while cancelling so the send thread cannot delete active_conversation
  // between taking its pointer and invoking CancelProcess. Stream callbacks
  // take only the stream mutex, so this lock order cannot recurse.
  std::lock_guard<std::mutex> lock(engine->mutex);
  if (engine->active_conversation != nullptr) {
    litert_lm_conversation_cancel_process(engine->active_conversation);
  }
  for (auto& stream : engine->pending_streams) {
    if (stream) {
      std::lock_guard<std::mutex> stream_lock(stream->mutex);
      stream->cancelled = true;
      stream->done_cv.notify_all();
    }
  }
}

int kf_litert_get_active_stream_count(KfLiteRtEngine* engine) {
  if (engine == nullptr) return 0;
  std::lock_guard<std::mutex> lock(engine->mutex);
  int count = 0;
  for (const auto& stream : engine->pending_streams) {
    if (!stream) continue;
    std::lock_guard<std::mutex> stream_lock(stream->mutex);
    if (!stream->done && !stream->cancelled) ++count;
  }
  return count;
}

// ── Persistent Conversation Lifecycle ────────────────────────────

int kf_litert_create_conversation(KfLiteRtEngine* engine,
                                  const char* system_json,
                                  const char* tools_json,
                                  const char* messages_json,
                                  const char* extra_context_json,
                                  char** error_out) {
  if (engine == nullptr || engine->engine == nullptr) {
    SetError(error_out, "LiteRT-LM engine is not loaded");
    return -1;
  }

  std::lock_guard<std::mutex> lock(engine->mutex);
  if (engine->persistent_conversation != nullptr) {
    SetError(error_out, "A persistent conversation already exists");
    return -1;
  }

  LiteRtLmSessionConfig* session_config = litert_lm_session_config_create();
  if (session_config != nullptr) {
    litert_lm_session_config_set_apply_prompt_template(session_config, true);
    litert_lm_session_config_set_max_output_tokens(session_config, 8192);
    if (engine->sampler_params != nullptr) {
      litert_lm_session_config_set_sampler_params(session_config, engine->sampler_params);
    }
  }

  LiteRtLmConversationConfig* conv_config = litert_lm_conversation_config_create();
  if (conv_config != nullptr && session_config != nullptr) {
    litert_lm_conversation_config_set_session_config(conv_config, session_config);
  }

  if (conv_config != nullptr) {
    if (system_json != nullptr && system_json[0] != '\0') {
      litert_lm_conversation_config_set_system_message(conv_config, system_json);
      engine->persistent_system_json = system_json;
    }
    if (tools_json != nullptr && tools_json[0] != '\0') {
      litert_lm_conversation_config_set_tools(conv_config, tools_json);
      engine->persistent_tools_json = tools_json;
      litert_lm_conversation_config_set_enable_constrained_decoding(conv_config,
                                                                     true);
    }
    if (messages_json != nullptr && messages_json[0] != '\0') {
      litert_lm_conversation_config_set_messages(conv_config, messages_json);
    }
    if (extra_context_json != nullptr && extra_context_json[0] != '\0') {
      litert_lm_conversation_config_set_extra_context(conv_config, extra_context_json);
    }
    // Reclaim thinking/reasoning channel tokens from KV cache between turns.
    litert_lm_conversation_config_set_filter_channel_content_from_kv_cache(conv_config, true);
  }

  engine->persistent_conversation =
      litert_lm_conversation_create(engine->engine, conv_config);

  if (conv_config != nullptr) {
    litert_lm_conversation_config_delete(conv_config);
  }
  if (session_config != nullptr) {
    litert_lm_session_config_delete(session_config);
  }

  if (engine->persistent_conversation == nullptr) {
    engine->persistent_system_json.clear();
    engine->persistent_tools_json.clear();
    SetError(error_out, "LiteRT-LM failed to create persistent conversation");
    return -1;
  }
  return 0;
}

int kf_litert_send_message_to_conversation(KfLiteRtEngine* engine,
                                           const char* message_json,
                                           int max_output_tokens,
                                           KfLiteRtChunkCallback callback,
                                           void* user_data,
                                           char** error_out) {
  if (engine == nullptr || engine->engine == nullptr) {
    SetError(error_out, "LiteRT-LM engine is not loaded");
    return -1;
  }
  if (message_json == nullptr || message_json[0] == '\0') {
    SetError(error_out, "message_json is required");
    return -1;
  }

  // Prune completed streams
  {
    std::lock_guard<std::mutex> lock(engine->mutex);
    engine->pending_streams.erase(
        std::remove_if(engine->pending_streams.begin(),
                       engine->pending_streams.end(),
                       [](const std::shared_ptr<StreamState>& s) {
                         std::lock_guard<std::mutex> l(s->mutex);
                         return s->done || s->cancelled;
                       }),
        engine->pending_streams.end());
  }

  // Branch the persistent Conversation for cancellation safety. LiteRT-LM
  // v0.16 exposes Session checkpoint/rewind only on the low-level C Session
  // API, while Gemma 4's tools, reasoning, role/history rendering, and
  // multimodal preprocessing live in Conversation. The C Conversation API
  // does not expose its underlying Session, so clone is the only released ABI
  // transaction primitive: a cancelled branch is discarded and a completed
  // branch is committed below.
  LiteRtLmConversation* conversation = nullptr;
  {
    std::lock_guard<std::mutex> lock(engine->mutex);
    if (engine->persistent_conversation == nullptr) {
      SetError(error_out, "No persistent conversation exists");
      return -1;
    }
    conversation = litert_lm_conversation_clone(engine->persistent_conversation);
  }

  if (conversation == nullptr) {
    SetError(error_out, "LiteRT-LM failed to clone persistent conversation");
    return -1;
  }

  auto stream_state = std::make_shared<StreamState>();
  stream_state->callback = callback;
  stream_state->user_data = user_data;
  stream_state->last_chunk_time = std::chrono::steady_clock::now();

  {
    std::lock_guard<std::mutex> lock(engine->mutex);
    engine->active_conversation = conversation;
    engine->pending_streams.push_back(stream_state);
  }

  LiteRtLmConversationOptionalArgs* optional_args = nullptr;
  if (max_output_tokens > 0) {
    optional_args = litert_lm_conversation_optional_args_create();
    if (optional_args != nullptr) {
      litert_lm_conversation_optional_args_set_max_output_tokens(
          optional_args, max_output_tokens);
    }
  }
  const int status = litert_lm_conversation_send_message_stream(
      conversation, message_json, nullptr, optional_args, StreamCallback,
      stream_state.get());
  if (optional_args != nullptr) {
    litert_lm_conversation_optional_args_delete(optional_args);
  }
  if (status != 0) {
    {
      std::lock_guard<std::mutex> lock(engine->mutex);
      engine->active_conversation = nullptr;
      engine->pending_streams.erase(
          std::remove(engine->pending_streams.begin(),
                      engine->pending_streams.end(),
                      stream_state),
          engine->pending_streams.end());
    }
    litert_lm_conversation_delete(conversation);
    SetError(error_out, "LiteRT-LM failed to start message stream");
    return status;
  }

  bool completed = false;
  bool cancelled = false;
  {
    std::unique_lock<std::mutex> lock(stream_state->mutex);
    while (!stream_state->done && !stream_state->cancelled) {
      auto now = std::chrono::steady_clock::now();
      auto elapsed = std::chrono::duration_cast<std::chrono::seconds>(
                         now - stream_state->last_chunk_time)
                         .count();
      if (elapsed >= kStreamInactivityTimeoutSeconds) {
        break;
      }
      auto wait_time = std::chrono::seconds(kStreamInactivityTimeoutSeconds - elapsed);
      stream_state->done_cv.wait_for(lock, wait_time);
    }
    completed = stream_state->done;
    cancelled = stream_state->cancelled;
  }

  {
    std::lock_guard<std::mutex> lock(engine->mutex);
    engine->active_conversation = nullptr;
  }

  // Safety disconnect callbacks
  {
    std::lock_guard<std::mutex> lock(stream_state->mutex);
    stream_state->callback = nullptr;
    stream_state->user_data = nullptr;
  }

  RemovePendingStream(engine, stream_state);

  if (cancelled) {
    litert_lm_conversation_cancel_process(conversation);
    litert_lm_conversation_delete(conversation);
    SetError(error_out,
             "ai_failure_kind=cancelled; LiteRT-LM stream generation was "
             "cancelled by the user.");
    return -3;
  }

  if (!completed) {
    litert_lm_conversation_cancel_process(conversation);
    litert_lm_conversation_delete(conversation);
    SetError(error_out, "LiteRT-LM stream generation timed out (60s inactive).");
    return -2;
  }

  if (!stream_state->error.empty()) {
    litert_lm_conversation_delete(conversation);
    SetError(error_out, stream_state->error.c_str());
    return -1;
  }

  // Stream completed successfully: commit the transactional branch by
  // replacing the previous persistent Conversation.
  {
    std::lock_guard<std::mutex> lock(engine->mutex);
    if (engine->persistent_conversation != nullptr) {
      litert_lm_conversation_delete(engine->persistent_conversation);
    }
    engine->persistent_conversation = conversation;
  }
  return 0;
}

void kf_litert_destroy_conversation(KfLiteRtEngine* engine) {
  if (engine == nullptr) {
    return;
  }
  std::lock_guard<std::mutex> lock(engine->mutex);
  if (engine->persistent_conversation != nullptr) {
    litert_lm_conversation_delete(engine->persistent_conversation);
    engine->persistent_conversation = nullptr;
  }
  engine->persistent_system_json.clear();
  engine->persistent_tools_json.clear();
}

int kf_litert_get_conversation_token_count(KfLiteRtEngine* engine) {
  if (engine == nullptr) {
    return -1;
  }
  std::lock_guard<std::mutex> lock(engine->mutex);
  if (engine->persistent_conversation == nullptr) {
    return -1;
  }
  return litert_lm_conversation_get_token_count(
      engine->persistent_conversation);
}

int kf_litert_get_conversation_benchmark(KfLiteRtEngine* engine,
                                         double* time_to_first_token_seconds,
                                         int* prefill_token_count,
                                         int* decode_token_count,
                                         double* prefill_tokens_per_second,
                                         double* decode_tokens_per_second) {
  if (engine == nullptr || time_to_first_token_seconds == nullptr ||
      prefill_token_count == nullptr || decode_token_count == nullptr ||
      prefill_tokens_per_second == nullptr || decode_tokens_per_second == nullptr) {
    return -1;
  }
  std::lock_guard<std::mutex> lock(engine->mutex);
  if (engine->persistent_conversation == nullptr) {
    if (!engine->has_last_benchmark) return -1;
    *time_to_first_token_seconds = engine->last_time_to_first_token_seconds;
    *prefill_token_count = engine->last_prefill_token_count;
    *decode_token_count = engine->last_decode_token_count;
    *prefill_tokens_per_second = engine->last_prefill_tokens_per_second;
    *decode_tokens_per_second = engine->last_decode_tokens_per_second;
    return 0;
  }
  LiteRtLmBenchmarkInfo* benchmark =
      litert_lm_conversation_get_benchmark_info(engine->persistent_conversation);
  if (benchmark == nullptr) {
    return -1;
  }
  *time_to_first_token_seconds =
      litert_lm_benchmark_info_get_time_to_first_token(benchmark);
  const int prefill_turns =
      litert_lm_benchmark_info_get_num_prefill_turns(benchmark);
  const int decode_turns =
      litert_lm_benchmark_info_get_num_decode_turns(benchmark);
  *prefill_token_count =
      prefill_turns > 0
          ? litert_lm_benchmark_info_get_prefill_token_count_at(
                benchmark, prefill_turns - 1)
          : 0;
  *decode_token_count =
      decode_turns > 0
          ? litert_lm_benchmark_info_get_decode_token_count_at(
                benchmark, decode_turns - 1)
          : 0;
  *prefill_tokens_per_second =
      prefill_turns > 0
          ? litert_lm_benchmark_info_get_prefill_tokens_per_sec_at(
                benchmark, prefill_turns - 1)
          : 0.0;
  *decode_tokens_per_second =
      decode_turns > 0
          ? litert_lm_benchmark_info_get_decode_tokens_per_sec_at(
                benchmark, decode_turns - 1)
          : 0.0;
  litert_lm_benchmark_info_delete(benchmark);
  return 0;
}

void kf_litert_free_string(char* value) { std::free(value); }

int kf_litert_set_sampler_params(KfLiteRtEngine* engine,
                                 int sampler_type,
                                 int top_k,
                                 float top_p,
                                 float temperature,
                                 int seed) {
  if (engine == nullptr) return -1;
  std::lock_guard<std::mutex> lock(engine->mutex);
  if (engine->sampler_params != nullptr) {
    litert_lm_sampler_params_delete(engine->sampler_params);
  }
  engine->sampler_params = litert_lm_sampler_params_create(
      static_cast<LiteRtLmSamplerType>(sampler_type));
  if (engine->sampler_params == nullptr) return -1;
  litert_lm_sampler_params_set_top_k(engine->sampler_params, top_k);
  litert_lm_sampler_params_set_top_p(engine->sampler_params, top_p);
  litert_lm_sampler_params_set_temperature(engine->sampler_params, temperature);
  litert_lm_sampler_params_set_seed(engine->sampler_params, seed);
  return 0;
}

void kf_litert_clear_sampler_params(KfLiteRtEngine* engine) {
  if (engine == nullptr) return;
  std::lock_guard<std::mutex> lock(engine->mutex);
  if (engine->sampler_params != nullptr) {
    litert_lm_sampler_params_delete(engine->sampler_params);
    engine->sampler_params = nullptr;
  }
}
