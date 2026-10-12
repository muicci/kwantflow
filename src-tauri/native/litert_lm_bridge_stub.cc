#include "litert_lm_bridge.h"

#include <cstdlib>
#include <cstring>

namespace {

char* CopyError(const char* message) {
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
  *error_out = CopyError(message);
}

}  // namespace

KfLiteRtEngine* kf_litert_create_engine(const char* model_path,
                                        const char* native_lib_dir,
                                        const char* cache_dir,
                                        bool use_gpu,
                                        bool enable_speculative_decoding,
                                        int max_num_tokens,
                                        char** error_out) {
  (void)model_path;
  (void)native_lib_dir;
  (void)cache_dir;
  (void)use_gpu;
  (void)enable_speculative_decoding;
  (void)max_num_tokens;
  SetError(error_out,
           "native LiteRT-LM bridge is not linked for this build");
  return nullptr;
}

void kf_litert_destroy_engine(KfLiteRtEngine* engine) { (void)engine; }

int kf_litert_send_message(KfLiteRtEngine* engine, const char* message_json,
                           const char* system_json, const char* tools_json,
                           const char* history_json, const char* extra_context_json,
                           int max_output_tokens,
                           int visual_token_budget,
                           bool enable_constrained_decoding,
                           KfLiteRtChunkCallback callback, void* user_data,
                           char** error_out) {
  (void)engine;
  (void)message_json;
  (void)system_json;
  (void)tools_json;
  (void)history_json;
  (void)extra_context_json;
  (void)max_output_tokens;
  (void)visual_token_budget;
  (void)enable_constrained_decoding;
  (void)callback;
  (void)user_data;
  SetError(error_out,
           "native LiteRT-LM bridge is not linked for this build");
  return -1;
}

void kf_litert_cancel(KfLiteRtEngine* engine) { (void)engine; }

int kf_litert_get_active_stream_count(KfLiteRtEngine* engine) {
  (void)engine;
  return 0;
}

int kf_litert_create_conversation(KfLiteRtEngine* engine,
                                  const char* system_json,
                                  const char* tools_json,
                                  const char* messages_json,
                                  const char* extra_context_json,
                                  char** error_out) {
  (void)engine;
  (void)system_json;
  (void)tools_json;
  (void)messages_json;
  (void)extra_context_json;
  SetError(error_out,
           "native LiteRT-LM bridge is not linked for this build");
  return -1;
}

int kf_litert_send_message_to_conversation(KfLiteRtEngine* engine,
                                           const char* message_json,
                                           int max_output_tokens,
                                           KfLiteRtChunkCallback callback,
                                           void* user_data,
                                           char** error_out) {
  (void)engine;
  (void)message_json;
  (void)max_output_tokens;
  (void)callback;
  (void)user_data;
  SetError(error_out,
           "native LiteRT-LM bridge is not linked for this build");
  return -1;
}

void kf_litert_destroy_conversation(KfLiteRtEngine* engine) { (void)engine; }

int kf_litert_get_conversation_token_count(KfLiteRtEngine* engine) {
  (void)engine;
  return -1;
}

int kf_litert_get_conversation_benchmark(KfLiteRtEngine* engine,
                                         double* time_to_first_token_seconds,
                                         int* prefill_token_count,
                                         int* decode_token_count,
                                         double* prefill_tokens_per_second,
                                         double* decode_tokens_per_second) {
  (void)engine;
  if (time_to_first_token_seconds) *time_to_first_token_seconds = 0.0;
  if (prefill_token_count) *prefill_token_count = 0;
  if (decode_token_count) *decode_token_count = 0;
  if (prefill_tokens_per_second) *prefill_tokens_per_second = 0.0;
  if (decode_tokens_per_second) *decode_tokens_per_second = 0.0;
  return -1;
}

void kf_litert_free_string(char* value) { std::free(value); }

int kf_litert_set_sampler_params(KfLiteRtEngine* engine,
                                 int sampler_type,
                                 int top_k,
                                 float top_p,
                                 float temperature,
                                 int seed) {
  (void)engine;
  (void)sampler_type;
  (void)top_k;
  (void)top_p;
  (void)temperature;
  (void)seed;
  return -1;
}

void kf_litert_clear_sampler_params(KfLiteRtEngine* engine) {
  (void)engine;
}
