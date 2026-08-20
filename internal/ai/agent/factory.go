// Package agent provides high-level helpers for AI agents, including building a
// chat model from an instance provider configuration.
package agent

import (
	"github.com/pkg/errors"

	"github.com/usememos/memos/internal/ai"
	"github.com/usememos/memos/internal/ai/chat"
	"github.com/usememos/memos/internal/ai/chat/gemini"
	"github.com/usememos/memos/internal/ai/chat/openai"
)

// NewChatModel builds a chat.Model from a provider config, selecting the
// implementation that matches the provider type. It is the single entry point
// used by higher-level features (such as agent replies) so they do not need to
// know about individual provider packages.
func NewChatModel(cfg ai.ProviderConfig, options chat.Options) (chat.Model, error) {
	switch cfg.Type {
	case ai.ProviderOpenAI:
		return openai.New(cfg, options)
	case ai.ProviderGemini:
		return gemini.New(cfg, options)
	default:
		return nil, errors.Wrapf(ai.ErrCapabilityUnsupported, "unsupported chat provider type %q", cfg.Type)
	}
}
