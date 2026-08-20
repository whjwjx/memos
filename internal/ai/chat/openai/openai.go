// Package openai implements chat.Model against the OpenAI chat completions
// endpoint (and any compatible third-party endpoint such as OpenRouter,
// Groq, or a self-hosted vLLM / Ollama OpenAI-compatible server).
package openai

import (
	"context"
	"net/url"
	"strings"

	openaisdk "github.com/openai/openai-go/v3"
	openaioption "github.com/openai/openai-go/v3/option"
	"github.com/pkg/errors"

	"github.com/usememos/memos/internal/ai"
	"github.com/usememos/memos/internal/ai/chat"
)

const defaultEndpoint = "https://api.openai.com/v1"

// Model implements chat.Model for OpenAI-compatible chat endpoints.
type Model struct {
	client openaisdk.Client
}

// New constructs a Model from a provider config.
func New(cfg ai.ProviderConfig, options chat.Options) (*Model, error) {
	endpoint, err := normalizeEndpoint(cfg.Endpoint)
	if err != nil {
		return nil, err
	}
	if cfg.APIKey == "" {
		return nil, errors.New("OpenAI API key is required")
	}
	return &Model{
		client: openaisdk.NewClient(
			openaioption.WithAPIKey(cfg.APIKey),
			openaioption.WithBaseURL(endpoint),
			openaioption.WithHTTPClient(options.HTTPClient),
		),
	}, nil
}

// Generate sends the conversation to the chat completions endpoint.
func (m *Model) Generate(ctx context.Context, req chat.Request) (*chat.Response, error) {
	if strings.TrimSpace(req.Model) == "" {
		return nil, errors.New("model is required")
	}
	if len(req.Messages) == 0 && strings.TrimSpace(req.System) == "" {
		return nil, errors.New("at least one message or a system prompt is required")
	}

	params := openaisdk.ChatCompletionNewParams{
		Model: openaisdk.ChatModel(req.Model),
	}
	if req.System != "" {
		params.Messages = append(params.Messages, openaisdk.SystemMessage(req.System))
	}
	for _, msg := range req.Messages {
		switch strings.ToLower(strings.TrimSpace(msg.Role)) {
		case chat.RoleAssistant:
			params.Messages = append(params.Messages, openaisdk.AssistantMessage(msg.Content))
		case chat.RoleSystem:
			params.Messages = append(params.Messages, openaisdk.SystemMessage(msg.Content))
		default:
			params.Messages = append(params.Messages, openaisdk.UserMessage(msg.Content))
		}
	}
	if req.Temperature != nil {
		params.Temperature = openaisdk.Float(float64(*req.Temperature))
	}
	if req.MaxTokens > 0 {
		params.MaxCompletionTokens = openaisdk.Int(int64(req.MaxTokens))
	}

	resp, err := m.client.Chat.Completions.New(ctx, params)
	if err != nil {
		return nil, errors.Wrap(err, "failed to send OpenAI chat request")
	}
	if len(resp.Choices) == 0 {
		return nil, errors.New("OpenAI chat request returned no choices")
	}
	return &chat.Response{
		Text:         strings.TrimSpace(resp.Choices[0].Message.Content),
		FinishReason: mapFinishReason(resp.Choices[0].FinishReason),
	}, nil
}

func mapFinishReason(reason string) chat.FinishReason {
	switch reason {
	case "stop":
		return chat.FinishStop
	case "length":
		return chat.FinishLength
	case "content_filter":
		return chat.FinishSafety
	default:
		return chat.FinishOther
	}
}

func normalizeEndpoint(endpoint string) (string, error) {
	endpoint = strings.TrimSpace(endpoint)
	if endpoint == "" {
		endpoint = defaultEndpoint
	}
	if _, err := url.ParseRequestURI(endpoint); err != nil {
		return "", errors.Wrap(err, "invalid OpenAI endpoint")
	}
	return strings.TrimRight(endpoint, "/"), nil
}
