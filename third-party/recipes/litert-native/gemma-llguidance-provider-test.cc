// Copyright (c) 2026 Kwantflow contributors.
// SPDX-License-Identifier: GPL-3.0-only

#include "runtime/components/logits_processor/constrained_decoding/gemma_model_constraint_provider.h"
#include <cstdlib>
#include <fstream>
#include <iterator>
#include <memory>
#include <string>
#include <vector>
#include "gtest/gtest.h"
#include "runtime/components/logits_processor/constrained_decoding/constraint.h"
#include "support/tokenizer/sentencepiece_tokenizer.h"

namespace {

class OpenGemmaProviderTest : public testing::Test {
 protected:
  void SetUp() override {
    const char* runfiles = std::getenv("TEST_SRCDIR");
    ASSERT_NE(runfiles, nullptr);
    std::ifstream model(std::string(runfiles) +
        "/litert_lm/support/tokenizer/testdata/gemma3_sentencepiece.model",
        std::ios::binary);
    ASSERT_TRUE(model.good());
    std::string bytes((std::istreambuf_iterator<char>(model)),
                       std::istreambuf_iterator<char>());
    auto tokenizer =
        litert::support::SentencePieceTokenizer::CreateFromBuffer(bytes);
    ASSERT_TRUE(tokenizer.ok());
    tokenizer_ = std::move(tokenizer).value();
    eos_ = tokenizer_->GetProcessor().eos_id();
    const int* stop = &eos_;
    const size_t length = 1;
    provider_.reset(LiteRtLmGemmaModelConstraintProvider_Create(
        bytes.data(), bytes.size(), &stop, &length, 1));
    ASSERT_NE(provider_, nullptr);
  }
  std::unique_ptr<litert::lm::Constraint> MakeConstraint(
      const LiteRtLmGemmaModelConstraintOptions& options,
      const char* tools = R"([{"name":"lookup","parameters":{"type":"object","properties":{"color":{"type":"string","enum":["red","blue"]}},"required":["color"]}}])") {
    return std::unique_ptr<litert::lm::Constraint>(
        reinterpret_cast<litert::lm::Constraint*>(
            LiteRtLmGemmaModelConstraintProvider_CreateConstraintFromTools(
                provider_.get(), tools, &options)));
  }
  bool Accepts(litert::lm::Constraint& constraint, const std::string& text) {
    auto ids = tokenizer_->TextToTokenIds(text);
    if (!ids.ok()) return false;
    auto state = constraint.Start();
    for (int token : *ids) {
      auto mask = constraint.ComputeBitmap(*state);
      if (!mask.ok() || !(*mask)->Get(token)) return false;
      auto next = constraint.ComputeNext(*state, token);
      if (!next.ok()) return false;
      state = std::move(next).value();
    }
    auto mask = constraint.ComputeBitmap(*state);
    return mask.ok() && (*mask)->Get(eos_);
  }
  std::unique_ptr<litert::support::SentencePieceTokenizer> tokenizer_;
  std::unique_ptr<LiteRtLmGemmaModelConstraintProvider,
      decltype(&LiteRtLmGemmaModelConstraintProvider_Destroy)> provider_{
          nullptr, LiteRtLmGemmaModelConstraintProvider_Destroy};
  int eos_ = -1;
};

TEST_F(OpenGemmaProviderTest, FcUsesActualSentencePieceBytesAndToolSchema) {
  const LiteRtLmGemmaModelConstraintOptions options{
      kLiteRtLmGemmaFuncallFormatFcStyle,
      kLiteRtLmGemmaConstraintModeFunctionCallOnly,
      "<start_function_call>", "<end_function_call>", "<escape>",
      "<escape>", "<start_function_response>"};
  auto constraint = MakeConstraint(options);
  ASSERT_NE(constraint, nullptr);
  EXPECT_TRUE(Accepts(*constraint,
      "<start_function_call>call:lookup{color:<escape>red<escape>}"
      "<end_function_call><start_function_response>"));
  EXPECT_FALSE(Accepts(*constraint,
      "<start_function_call>call:missing{color:<escape>red<escape>}"
      "<end_function_call><start_function_response>"));
  EXPECT_FALSE(Accepts(*constraint,
      "<start_function_call>call:lookup{color:<escape>green<escape>}"
      "<end_function_call><start_function_response>"));
  EXPECT_FALSE(Accepts(*constraint,
      "<start_function_call>call:lookup{}"
      "<end_function_call><start_function_response>"));
}

TEST_F(OpenGemmaProviderTest, FcUsesReservedSpecialTokenIds) {
  auto model = std::make_unique<sentencepiece::ModelProto>(
      tokenizer_->GetProcessor().model_proto());
  const std::vector<std::string> delimiters{
      "<start_function_call>", "<end_function_call>", "<escape>",
      "<start_function_response>"};
  size_t renamed = 0;
  for (int id = 0; id < model->pieces_size() && renamed < delimiters.size(); ++id) {
    auto* piece = model->mutable_pieces(id);
    if (piece->type() == sentencepiece::ModelProto::SentencePiece::USER_DEFINED &&
        piece->piece().starts_with("<unused")) {
      piece->set_piece(delimiters[renamed++]);
    }
  }
  ASSERT_EQ(renamed, delimiters.size());
  const std::string bytes = model->SerializeAsString();
  auto tokenizer =
      litert::support::SentencePieceTokenizer::CreateFromProto(std::move(model));
  ASSERT_TRUE(tokenizer.ok());
  tokenizer_ = std::move(tokenizer).value();
  const int* stop = &eos_;
  const size_t length = 1;
  provider_.reset(LiteRtLmGemmaModelConstraintProvider_Create(
      bytes.data(), bytes.size(), &stop, &length, 1));
  ASSERT_NE(provider_, nullptr);
  const LiteRtLmGemmaModelConstraintOptions options{
      kLiteRtLmGemmaFuncallFormatFcStyle,
      kLiteRtLmGemmaConstraintModeTextAndOr,
      "<start_function_call>", "<end_function_call>", "<escape>",
      "<escape>", "<start_function_response>"};
  auto constraint = MakeConstraint(options);
  ASSERT_NE(constraint, nullptr);
  EXPECT_TRUE(Accepts(*constraint, "ordinary text"));
  EXPECT_TRUE(Accepts(*constraint,
      "<start_function_call>call:lookup{color:<escape>red<escape>}"
      "<end_function_call><start_function_response>"));
  EXPECT_FALSE(Accepts(*constraint,
      "<start_function_call>call:lookup{color:<escape>green<escape>}"
      "<end_function_call><start_function_response>"));
}

TEST_F(OpenGemmaProviderTest, PythonAcceptsGemma3NullUnusedOptions) {
  const LiteRtLmGemmaModelConstraintOptions options{
      kLiteRtLmGemmaFuncallFormatPythonStyle,
      kLiteRtLmGemmaConstraintModeFunctionCallOnly,
      "```tool_code\n", "\n```", nullptr, nullptr, nullptr};
  auto constraint = MakeConstraint(options);
  ASSERT_NE(constraint, nullptr);
  EXPECT_TRUE(Accepts(*constraint, "```tool_code\nlookup(color='red')\n```"));
  EXPECT_FALSE(Accepts(*constraint, "```tool_code\nlookup(color='green')\n```"));
}

TEST_F(OpenGemmaProviderTest, EmptyToolsAllowTextButExcludeCallFence) {
  const LiteRtLmGemmaModelConstraintOptions options{
      kLiteRtLmGemmaFuncallFormatFcStyle,
      kLiteRtLmGemmaConstraintModeTextAndOr,
      "<start_function_call>", "<end_function_call>", "<escape>",
      "<escape>", "<start_function_response>"};
  auto constraint = MakeConstraint(options, "[]");
  ASSERT_NE(constraint, nullptr);
  EXPECT_TRUE(Accepts(*constraint, "ordinary text"));
  EXPECT_FALSE(Accepts(*constraint, "<start_function_call>call:lookup{}"));
}

TEST_F(OpenGemmaProviderTest, BadInputsFailWithoutCreatingAConstraint) {
  const LiteRtLmGemmaModelConstraintOptions options{
      kLiteRtLmGemmaFuncallFormatFcStyle,
      kLiteRtLmGemmaConstraintModeFunctionCallOnly,
      "<start_function_call>", "<end_function_call>", nullptr,
      nullptr, nullptr};
  EXPECT_EQ(MakeConstraint(options), nullptr);
  EXPECT_EQ(LiteRtLmGemmaModelConstraintProvider_Create(nullptr, 0,
                                                       nullptr, nullptr, 0),
            nullptr);
}

}  // namespace
