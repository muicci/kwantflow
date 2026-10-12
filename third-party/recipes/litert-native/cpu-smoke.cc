// SPDX-License-Identifier: GPL-3.0-only
#include "c/engine.h"
#include "c/conversation.h"
#include <cstdio>
#include <chrono>
#include <string>

bool Run(LiteRtLmEngine* engine, const char* image_path, bool tool, bool vision=false) {
  const char* kind=vision?"VISION":tool?"TOOL":"TEXT";
  auto* session=litert_lm_session_config_create();
  litert_lm_session_config_set_max_output_tokens(session,128);
  auto* sampler=litert_lm_sampler_params_create(kLiteRtLmSamplerTypeGreedy);
  litert_lm_sampler_params_set_top_k(sampler,25);
  litert_lm_sampler_params_set_top_p(sampler,0.95f);
  litert_lm_sampler_params_set_temperature(sampler,0.0f);
  litert_lm_sampler_params_set_seed(sampler,0);
  litert_lm_session_config_set_sampler_params(session,sampler);
  auto* config=litert_lm_conversation_config_create();
  litert_lm_conversation_config_set_session_config(config,session);
  litert_lm_conversation_config_set_enable_constrained_decoding(config,true);
  auto* thinking=litert_lm_thinking_config_create();
  litert_lm_thinking_config_set_enable_thinking(thinking,false);
  litert_lm_conversation_config_set_thinking_config(config,thinking);
  litert_lm_conversation_config_set_tools(config,tool ? R"([{"type":"function","function":{"name":"lookup","description":"Look up a named color. Call this function when asked.","parameters":{"type":"object","properties":{"color":{"type":"string","enum":["red","blue"]}},"required":["color"]}}}])" : "[]");
  auto* conversation=litert_lm_conversation_create(engine,config);
  litert_lm_thinking_config_delete(thinking);
  litert_lm_conversation_config_delete(config);
  litert_lm_sampler_params_delete(sampler);
  litert_lm_session_config_delete(session);
  if (!conversation) {std::fprintf(stderr,"CONVERSATION_CREATE_FAILED %s\n",kind);return false;}
  const auto start=std::chrono::steady_clock::now();
  std::printf("START_%s constrained_decoding=true\n",kind);std::fflush(stdout);
  // The caller supplies a synthetic PNG path without JSON metacharacters.
  const std::string vision_message=std::string(R"({"role":"user","content":[{"type":"text","text":"What color is the square? Reply in one word."},{"type":"image","path":")")+image_path+R"("}]})";
  auto* response=litert_lm_conversation_send_message(conversation,
    vision ? vision_message.c_str() : tool ? R"({"role":"user","content":[{"type":"text","text":"Call the lookup tool with color red. Do not explain or answer without the tool."}]})" : R"({"role":"user","content":[{"type":"text","text":"Reply with exactly the word READY."}]})",nullptr,nullptr);
  bool ok=response!=nullptr;
  if (response) {
    const std::string json=litert_lm_json_response_get_string(response);
    std::printf("%s_JSON: %s\n",kind,json.c_str());
    // Assert the known synthetic fixture contract in the returned C API JSON.
    ok=vision ? json.find("Red")!=std::string::npos || json.find("red")!=std::string::npos
       : tool ? json.find("\"tool_calls\"")!=std::string::npos && json.find("\"name\":\"lookup\"")!=std::string::npos && json.find("\"color\":\"red\"")!=std::string::npos
       : json.find("READY")!=std::string::npos;
    if (!ok) std::fprintf(stderr,"FIXTURE_CONTRACT_FAILED %s\n",kind);
    litert_lm_json_response_delete(response);
  }
  else std::fprintf(stderr,"SEND_MESSAGE_FAILED %s\n",kind);
  std::printf("ELAPSED_%s_SECONDS: %.3f\n",kind,std::chrono::duration<double>(std::chrono::steady_clock::now()-start).count());std::fflush(stdout);
  litert_lm_conversation_delete(conversation);return ok;
}
int main(int argc,char**argv) {
  if(argc!=4) {
    std::fprintf(stderr,"usage: %s MODEL SYNTHETIC_RED_PNG CACHE_DIRECTORY\n",argv[0]);
    return 2;
  }
  if(std::string(argv[2]).find_first_of("\"\\\n\r")!=std::string::npos)return 2;
  auto* settings=litert_lm_engine_settings_create(argv[1],"cpu","cpu",nullptr);
  if(!settings)return 3;
  litert_lm_engine_settings_set_num_threads(settings,4);
  litert_lm_engine_settings_set_max_num_tokens(settings,4096);
  litert_lm_engine_settings_set_cache_dir(settings,argv[3]);
  std::puts("ENGINE_CREATE_START cpu backend, CPU vision");std::fflush(stdout);
  auto* engine=litert_lm_engine_create(settings);
  litert_lm_engine_settings_delete(settings);
  if(!engine){std::fputs("ENGINE_CREATE_FAILED\n",stderr);return 4;}
  std::puts("ENGINE_CREATE_OK");std::fflush(stdout);
  bool text=Run(engine,argv[2],false);bool tool=Run(engine,argv[2],true);bool vision=Run(engine,argv[2],false,true);
  litert_lm_engine_delete(engine);return text&&tool&&vision?0:5;
}
