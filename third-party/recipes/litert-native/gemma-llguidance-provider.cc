// Copyright (c) 2026 Kwantflow contributors.
// SPDX-License-Identifier: GPL-3.0-only
//
// Source implementation of LiteRT-LM v0.16.0's Gemma constraint C ABI using
// that release's public SentencePiece, LLGuidance and tool-grammar code.

#include "runtime/components/logits_processor/constrained_decoding/gemma_model_constraint_provider.h"

#include <cstdint>
#include <charconv>
#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "absl/strings/string_view.h"
#include "nlohmann/json.hpp"
#include "runtime/components/logits_processor/constrained_decoding/constraint.h"
#include "runtime/components/logits_processor/constrained_decoding/constraint_provider.h"
#include "runtime/components/logits_processor/constrained_decoding/llg_constraint_config.h"
#include "runtime/components/logits_processor/constrained_decoding/llg_constraint_provider.h"
#include "runtime/components/logits_processor/constrained_decoding/llguidance_schema_utils.h"
#include "support/tokenizer/sentencepiece_tokenizer.h"

namespace {

bool IsSpecialPiece(const sentencepiece::SentencePieceProcessor& processor,
                    int id) {
  const auto& piece = processor.IdToPiece(id);
  // SentencePiece also labels literal newline/tab tokens USER_DEFINED. They
  // remain ordinary decoded bytes. Gemma reserved symbols use <...> or [...].
  return processor.IsControl(id) || processor.IsUnknown(id) ||
         processor.IsUnused(id) ||
         (processor.model_proto().pieces(id).type() ==
              sentencepiece::ModelProto::SentencePiece::USER_DEFINED &&
          piece.size() > 1 &&
          ((piece.front() == '<' && piece.back() == '>') ||
           (piece.front() == '[' && piece.back() == ']')));
}

// LLGuidance requires decoded token bytes, not SentencePiece's storage
// spellings. Its special-token convention uses a leading 0xff marker.
class GuidanceSentencePieceTokenizer final : public litert::support::Tokenizer {
 public:
  explicit GuidanceSentencePieceTokenizer(
      std::unique_ptr<litert::support::SentencePieceTokenizer> tokenizer)
      : tokenizer_(std::move(tokenizer)) {}
  litert::support::TokenizerType GetTokenizerType() const override {
    return tokenizer_->GetTokenizerType();
  }
  absl::StatusOr<std::vector<int>> TextToTokenIds(
      absl::string_view text) override {
    return tokenizer_->TextToTokenIds(text);
  }
  absl::StatusOr<int> TokenToId(absl::string_view token) override {
    return tokenizer_->TokenToId(token);
  }
  absl::StatusOr<std::string> TokenIdsToText(
      const std::vector<int>& ids, bool skip_special_tokens) override {
    return tokenizer_->TokenIdsToText(ids, skip_special_tokens);
  }
  int GetVocabSize() const override { return tokenizer_->GetVocabSize(); }
  const sentencepiece::SentencePieceProcessor& GetProcessor() const {
    return tokenizer_->GetProcessor();
  }
  std::vector<std::string> GetTokens() const override {
    auto tokens = tokenizer_->GetTokens();
    const auto& processor = GetProcessor();
    for (int i = 0; i < tokens.size(); ++i) {
      auto& piece = tokens[i];
      if (processor.IsByte(i)) {
        unsigned byte = 0;
        const auto result =
            std::from_chars(piece.data() + 3, piece.data() + 5, byte, 16);
        if (result.ec == std::errc()) piece.assign(1, static_cast<char>(byte));
      } else if (IsSpecialPiece(processor, i)) {
        piece.insert(0, 1, static_cast<char>(0xff));
      } else {
        for (size_t pos = 0; (pos = piece.find("\xe2\x96\x81", pos)) !=
                            std::string::npos; ++pos) {
          piece.replace(pos, 3, " ");
        }
      }
    }
    return tokens;
  }
 private:
  std::unique_ptr<litert::support::SentencePieceTokenizer> tokenizer_;
};

std::string GrammarDelimiter(const GuidanceSentencePieceTokenizer& tokenizer,
                             const char* text) {
  const auto& processor = tokenizer.GetProcessor();
  const int id = processor.PieceToId(text);
  if (id >= 0 && processor.IdToPiece(id) == text &&
      IsSpecialPiece(processor, id)) {
    return "<[" + std::to_string(id) + "]>";
  }
  return nlohmann::ordered_json(text).dump();
}

std::string RegexEscape(const char* text) {
  std::string escaped;
  for (const char* p = text; *p; ++p) {
    if (std::string("\\.^$|()[]{}*+?/").find(*p) != std::string::npos)
      escaped.push_back('\\');
    if (*p == '\n') escaped += "\\n";
    else if (*p == '\r') escaped += "\\r";
    else escaped.push_back(*p);
  }
  return escaped;
}

}  // namespace

struct LiteRtLmGemmaModelConstraintProvider {
  // LLGuidance's tokenizer callback retains a pointer to tokenizer. Declare
  // the provider last so it is destroyed before the tokenizer.
  std::unique_ptr<GuidanceSentencePieceTokenizer> tokenizer;
  std::unique_ptr<litert::lm::ConstraintProvider> provider;
};

extern "C" {

LiteRtLmGemmaModelConstraintProvider*
LiteRtLmGemmaModelConstraintProvider_Create(
    const char* serialized_sp_model_proto, size_t serialized_sp_model_proto_len,
    const int** stop_token_ids, const size_t* stop_token_lengths,
    size_t num_stop_lists) {
  if (serialized_sp_model_proto == nullptr ||
      serialized_sp_model_proto_len == 0 ||
      (num_stop_lists != 0 &&
       (stop_token_ids == nullptr || stop_token_lengths == nullptr))) {
    return nullptr;
  }
  auto tokenizer_result =
      litert::support::SentencePieceTokenizer::CreateFromBuffer(
          absl::string_view(serialized_sp_model_proto,
                            serialized_sp_model_proto_len));
  if (!tokenizer_result.ok()) return nullptr;
  auto tokenizer = std::make_unique<GuidanceSentencePieceTokenizer>(
      std::move(tokenizer_result).value());
  litert::lm::LlGuidanceConfig config;
  for (size_t i = 0; i < num_stop_lists; ++i) {
    if (stop_token_lengths[i] == 1 && stop_token_ids[i] != nullptr &&
        stop_token_ids[i][0] >= 0 &&
        stop_token_ids[i][0] < tokenizer->GetVocabSize()) {
      config.eos_id = static_cast<uint32_t>(stop_token_ids[i][0]);
      break;
    }
  }
  if (!config.eos_id.has_value()) {
    const int eos = tokenizer->GetProcessor().eos_id();
    if (eos < 0 || eos >= tokenizer->GetVocabSize()) return nullptr;
    config.eos_id = static_cast<uint32_t>(eos);
  }
  auto provider_result =
      litert::lm::LlgConstraintProvider::Create(*tokenizer, config);
  if (!provider_result.ok()) return nullptr;
  return new LiteRtLmGemmaModelConstraintProvider{
      std::move(tokenizer), std::move(provider_result).value()};
}

void LiteRtLmGemmaModelConstraintProvider_Destroy(
    LiteRtLmGemmaModelConstraintProvider* provider) {
  delete provider;
}

LiteRtLmConstraint*
LiteRtLmGemmaModelConstraintProvider_CreateConstraintFromTools(
    LiteRtLmGemmaModelConstraintProvider* provider, const char* json_tools_str,
    const LiteRtLmGemmaModelConstraintOptions* options) {
  if (provider == nullptr || json_tools_str == nullptr || options == nullptr ||
      options->code_fence_start == nullptr ||
      options->code_fence_end == nullptr) {
    return nullptr;
  }
  auto tools = nlohmann::ordered_json::parse(json_tools_str, nullptr, false);
  if (tools.is_discarded() || !tools.is_array()) return nullptr;
  litert::lm::LlgConstraintsOptions grammar_options;
  switch (options->funcall_format) {
    case kLiteRtLmGemmaFuncallFormatPythonStyle:
      grammar_options.funcall_format = litert::lm::FuncallFormat::kPython;
      break;
    case kLiteRtLmGemmaFuncallFormatFcStyle:
      if (options->open_quote == nullptr || options->close_quote == nullptr ||
          options->function_response_start == nullptr) return nullptr;
      grammar_options.funcall_format = litert::lm::FuncallFormat::kFc;
      break;
    default:
      return nullptr;
  }
  switch (options->constraint_mode) {
    case kLiteRtLmGemmaConstraintModeTextAndOr:
      grammar_options.constraint_mode =
          litert::lm::LlgConstraintMode::kTextAndOrFunctionCalls;
      break;
    case kLiteRtLmGemmaConstraintModeFunctionCallOnly:
      grammar_options.constraint_mode =
          litert::lm::LlgConstraintMode::kFunctionCallsOnly;
      break;
    default:
      return nullptr;
  }
  // Match control/user-defined delimiters by token ID. Ordinary text uses
  // quoted Lark literals. Gemma3's unused Python quote fields may be null.
  grammar_options.code_fence_start =
      GrammarDelimiter(*provider->tokenizer, options->code_fence_start);
  grammar_options.code_fence_end =
      GrammarDelimiter(*provider->tokenizer, options->code_fence_end);
  if (options->funcall_format == kLiteRtLmGemmaFuncallFormatFcStyle) {
    grammar_options.open_quote =
        GrammarDelimiter(*provider->tokenizer, options->open_quote);
    grammar_options.close_quote =
        GrammarDelimiter(*provider->tokenizer, options->close_quote);
    grammar_options.function_response_start =
        GrammarDelimiter(*provider->tokenizer, options->function_response_start);
  }
  absl::StatusOr<std::string> grammar =
      tools.empty() && options->constraint_mode ==
                           kLiteRtLmGemmaConstraintModeTextAndOr
          ? "FORBIDDEN_CALL: /(.|\\n)*" +
                RegexEscape(options->code_fence_start) +
                "(.|\\n)*/\nSAFE_TEXT: /(.|\\n)*/ & ~FORBIDDEN_CALL\n"
                "start: SAFE_TEXT\n"
          : litert::lm::CreateLarkGrammarForTools(tools, grammar_options);
  if (!grammar.ok()) return nullptr;
  litert::lm::LlGuidanceConstraintArg arg{
      litert::lm::LlgConstraintType::kLark, std::move(grammar).value()};
  auto constraint = provider->provider->CreateConstraint(std::move(arg));
  if (!constraint.ok()) return nullptr;
  return reinterpret_cast<LiteRtLmConstraint*>(std::move(constraint).value().release());
}

void LiteRtLmConstraint_Destroy(LiteRtLmConstraint* constraint) {
  delete reinterpret_cast<litert::lm::Constraint*>(constraint);
}

}  // extern "C"
