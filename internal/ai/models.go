package ai

import "github.com/pkg/errors"

const (
	// DefaultOpenAIChatModel is the built-in OpenAI text-generation model.
	DefaultOpenAIChatModel = "gpt-4o-mini"
	// DefaultGeminiChatModel is the built-in Gemini text-generation model.
	DefaultGeminiChatModel = "gemini-2.5-flash"
)

// DefaultChatModel returns the built-in text-generation model for a provider.
func DefaultChatModel(providerType ProviderType) (string, error) {
	switch providerType {
	case ProviderOpenAI:
		return DefaultOpenAIChatModel, nil
	case ProviderGemini:
		return DefaultGeminiChatModel, nil
	default:
		return "", errors.Wrapf(ErrCapabilityUnsupported, "provider type %q", providerType)
	}
}
