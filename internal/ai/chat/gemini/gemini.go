// Package gemini implements chat.Model against the Gemini generateContent
// endpoint. Used for text-generation features backed by a Gemini provider.
package gemini

import (
	"context"
	"net/url"
	"strings"

	"github.com/pkg/errors"
	"google.golang.org/genai"

	"github.com/usememos/memos/internal/ai"
	"github.com/usememos/memos/internal/ai/chat"
)

const (
	defaultEndpoint   = "https://generativelanguage.googleapis.com/v1beta"
	defaultAPIVersion = "v1beta"
	providerName      = "Gemini"
)

// Model implements chat.Model for Gemini generateContent.
type Model struct {
	client *genai.Client
}

// New constructs a Model from a provider config.
func New(cfg ai.ProviderConfig, options chat.Options) (*Model, error) {
	endpoint, err := normalizeEndpoint(cfg.Endpoint)
	if err != nil {
		return nil, err
	}
	if cfg.APIKey == "" {
		return nil, errors.Errorf("%s API key is required", providerName)
	}
	baseURL, apiVersion, err := splitEndpoint(endpoint)
	if err != nil {
		return nil, err
	}
	httpOptions := genai.HTTPOptions{BaseURL: baseURL, APIVersion: apiVersion}
	if options.HTTPClient != nil && options.HTTPClient.Timeout > 0 {
		timeout := options.HTTPClient.Timeout
		httpOptions.Timeout = &timeout
	}
	client, err := genai.NewClient(context.Background(), &genai.ClientConfig{
		APIKey:      cfg.APIKey,
		Backend:     genai.BackendGeminiAPI,
		HTTPClient:  options.HTTPClient,
		HTTPOptions: httpOptions,
	})
	if err != nil {
		return nil, errors.Wrap(err, "failed to create Gemini client")
	}
	return &Model{client: client}, nil
}

// Generate calls Gemini generateContent with the conversation as text.
func (m *Model) Generate(ctx context.Context, req chat.Request) (*chat.Response, error) {
	if strings.TrimSpace(req.Model) == "" {
		return nil, errors.New("model is required")
	}
	if len(req.Messages) == 0 && strings.TrimSpace(req.System) == "" {
		return nil, errors.New("at least one message or a system prompt is required")
	}

	var parts []*genai.Part
	if req.System != "" {
		parts = append(parts, genai.NewPartFromText(req.System))
	}
	for _, msg := range req.Messages {
		switch strings.ToLower(strings.TrimSpace(msg.Role)) {
		case chat.RoleAssistant:
			parts = append(parts, genai.NewPartFromText("ASSISTANT: "+msg.Content))
		case chat.RoleSystem:
			parts = append(parts, genai.NewPartFromText(msg.Content))
		default:
			parts = append(parts, genai.NewPartFromText("USER: "+msg.Content))
		}
	}

	cfg := &genai.GenerateContentConfig{}
	if req.Temperature != nil {
		t := *req.Temperature
		cfg.Temperature = &t
	}
	if req.MaxTokens > 0 {
		cfg.MaxOutputTokens = int32(req.MaxTokens)
	}

	resp, err := m.client.Models.GenerateContent(ctx, normalizeModelName(req.Model), []*genai.Content{
		genai.NewContentFromParts(parts, genai.RoleUser),
	}, cfg)
	if err != nil {
		return nil, errors.Wrap(err, "failed to send Gemini request")
	}

	return &chat.Response{
		Text:         strings.TrimSpace(resp.Text()),
		FinishReason: mapFinishReason(resp),
	}, nil
}

func mapFinishReason(resp *genai.GenerateContentResponse) chat.FinishReason {
	if resp == nil || len(resp.Candidates) == 0 {
		return chat.FinishOther
	}
	switch resp.Candidates[0].FinishReason {
	case genai.FinishReasonStop:
		return chat.FinishStop
	case genai.FinishReasonMaxTokens:
		return chat.FinishLength
	case genai.FinishReasonSafety,
		genai.FinishReasonRecitation,
		genai.FinishReasonProhibitedContent,
		genai.FinishReasonSPII,
		genai.FinishReasonBlocklist,
		genai.FinishReasonImageSafety,
		genai.FinishReasonImageProhibitedContent,
		genai.FinishReasonImageRecitation:
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
		return "", errors.Wrapf(err, "invalid %s endpoint", providerName)
	}
	return strings.TrimRight(endpoint, "/"), nil
}

func splitEndpoint(endpoint string) (string, string, error) {
	parsed, err := url.Parse(endpoint)
	if err != nil {
		return "", "", errors.Wrap(err, "invalid Gemini endpoint")
	}
	path := strings.TrimRight(parsed.Path, "/")
	apiVersion := defaultAPIVersion
	for _, supported := range []string{"v1alpha", "v1beta", "v1"} {
		if path == "/"+supported || strings.HasSuffix(path, "/"+supported) {
			apiVersion = supported
			parsed.Path = strings.TrimSuffix(path, "/"+supported)
			break
		}
	}
	return strings.TrimRight(parsed.String(), "/"), apiVersion, nil
}

func normalizeModelName(model string) string {
	return strings.TrimPrefix(strings.TrimSpace(model), "models/")
}
