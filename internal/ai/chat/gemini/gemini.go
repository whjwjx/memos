// Package gemini implements chat.Model against the Gemini generateContent
// endpoint. Used for text-generation features backed by a Gemini provider.
package gemini

import (
	"context"
	"encoding/json"
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

	var contents []*genai.Content
	if req.System != "" {
		contents = append(contents, genai.NewContentFromText(req.System, genai.RoleUser))
	}
	for _, msg := range req.Messages {
		switch strings.ToLower(strings.TrimSpace(msg.Role)) {
		case chat.RoleAssistant:
			// An assistant turn may carry tool calls requested in a prior step.
			if len(msg.ToolCalls) > 0 {
				parts := make([]*genai.Part, 0, len(msg.ToolCalls))
				for _, tc := range msg.ToolCalls {
					var args map[string]any
					_ = json.Unmarshal([]byte(tc.ArgumentsJSON), &args)
					parts = append(parts, genai.NewPartFromFunctionCall(tc.Name, args))
				}
				if strings.TrimSpace(msg.Content) != "" {
					parts = append(parts, genai.NewPartFromText(msg.Content))
				}
				contents = append(contents, genai.NewContentFromParts(parts, genai.RoleModel))
				continue
			}
			contents = append(contents, genai.NewContentFromText("ASSISTANT: "+msg.Content, genai.RoleModel))
		case chat.RoleTool:
			// A tool result answers a prior function call.
			var resp map[string]any
			_ = json.Unmarshal([]byte(msg.Content), &resp)
			contents = append(contents, genai.NewContentFromFunctionResponse(msg.Name, resp, genai.RoleUser))
		default:
			contents = append(contents, genai.NewContentFromText("USER: "+msg.Content, genai.RoleUser))
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
	if len(req.Tools) > 0 {
		tool := &genai.Tool{}
		for _, t := range req.Tools {
			tool.FunctionDeclarations = append(tool.FunctionDeclarations, &genai.FunctionDeclaration{
				Name:        t.Name,
				Description: t.Description,
				Parameters:  geminiSchemaFromJSON(t.ParametersJSON),
			})
		}
		cfg.Tools = []*genai.Tool{tool}
		switch strings.ToLower(strings.TrimSpace(req.ToolChoice)) {
		case chat.ToolChoiceNone:
			cfg.ToolConfig = &genai.ToolConfig{
				FunctionCallingConfig: &genai.FunctionCallingConfig{Mode: genai.FunctionCallingConfigModeNone},
			}
		case chat.ToolChoiceRequired:
			cfg.ToolConfig = &genai.ToolConfig{
				FunctionCallingConfig: &genai.FunctionCallingConfig{Mode: genai.FunctionCallingConfigModeAny},
			}
		case chat.ToolChoiceAuto:
			cfg.ToolConfig = &genai.ToolConfig{
				FunctionCallingConfig: &genai.FunctionCallingConfig{Mode: genai.FunctionCallingConfigModeAuto},
			}
		default:
			if req.ToolChoice != "" {
				cfg.ToolConfig = &genai.ToolConfig{
					FunctionCallingConfig: &genai.FunctionCallingConfig{
						Mode:                 genai.FunctionCallingConfigModeAny,
						AllowedFunctionNames: []string{req.ToolChoice},
					},
				}
			}
		}
	}

	resp, err := m.client.Models.GenerateContent(ctx, normalizeModelName(req.Model), contents, cfg)
	if err != nil {
		return nil, errors.Wrap(err, "failed to send Gemini request")
	}

	out := &chat.Response{
		Text:         strings.TrimSpace(resp.Text()),
		FinishReason: mapFinishReason(resp),
	}
	// Extract function calls from the first candidate's parts.
	if len(resp.Candidates) > 0 && resp.Candidates[0].Content != nil {
		for _, part := range resp.Candidates[0].Content.Parts {
			if part.FunctionCall == nil {
				continue
			}
			argsJSON, err := json.Marshal(part.FunctionCall.Args)
			if err != nil {
				argsJSON = []byte("{}")
			}
			out.ToolCalls = append(out.ToolCalls, chat.ToolCall{
				ID:            part.FunctionCall.ID,
				Name:          part.FunctionCall.Name,
				ArgumentsJSON: string(argsJSON),
			})
		}
	}
	return out, nil
}

// geminiSchemaFromJSON converts a JSON Schema string into a Gemini Schema.
// Gemini uses upper-cased type names (e.g. "STRING") that differ from the
// lowercase JSON Schema convention, so we map them while walking the tree.
func geminiSchemaFromJSON(raw string) *genai.Schema {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		return nil
	}
	return buildGeminiSchema(m)
}

func buildGeminiSchema(m map[string]any) *genai.Schema {
	if m == nil {
		return nil
	}
	schema := &genai.Schema{}
	if desc, ok := m["description"].(string); ok {
		schema.Description = desc
	}
	if t, ok := m["type"].(string); ok {
		schema.Type = mapJSONTypeToGemini(t)
	}
	if enum, ok := m["enum"].([]any); ok {
		for _, e := range enum {
			if s, ok := e.(string); ok {
				schema.Enum = append(schema.Enum, s)
			}
		}
	}
	if props, ok := m["properties"].(map[string]any); ok {
		schema.Properties = make(map[string]*genai.Schema, len(props))
		for name, p := range props {
			if pm, ok := p.(map[string]any); ok {
				schema.Properties[name] = buildGeminiSchema(pm)
			}
		}
	}
	if req, ok := m["required"].([]any); ok {
		for _, r := range req {
			if s, ok := r.(string); ok {
				schema.Required = append(schema.Required, s)
			}
		}
	}
	if items, ok := m["items"].(map[string]any); ok {
		schema.Items = buildGeminiSchema(items)
	}
	return schema
}

func mapJSONTypeToGemini(t string) genai.Type {
	switch strings.ToLower(t) {
	case "string":
		return genai.TypeString
	case "number":
		return genai.TypeNumber
	case "integer":
		return genai.TypeInteger
	case "boolean":
		return genai.TypeBoolean
	case "array":
		return genai.TypeArray
	case "object":
		return genai.TypeObject
	default:
		return genai.TypeUnspecified
	}
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
