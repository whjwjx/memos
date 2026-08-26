package gemini_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/internal/ai"
	"github.com/usememos/memos/internal/ai/chat"
	chatgemini "github.com/usememos/memos/internal/ai/chat/gemini"
)

func TestGenerate(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, http.MethodPost, r.Method)
		require.Equal(t, "/v1beta/models/gemini-2.5-flash:generateContent", r.URL.Path)
		require.Equal(t, "test-key", r.Header.Get("x-goog-api-key"))
		require.Equal(t, "application/json", r.Header.Get("Content-Type"))

		var request struct {
			Contents []struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"contents"`
			GenerationConfig map[string]json.Number `json:"generationConfig"`
		}
		require.NoError(t, json.NewDecoder(r.Body).Decode(&request))
		require.Len(t, request.Contents, 2)
		require.Len(t, request.Contents[0].Parts, 1)
		require.Equal(t, "be terse", request.Contents[0].Parts[0].Text)
		require.Len(t, request.Contents[1].Parts, 1)
		require.Equal(t, "USER: hello", request.Contents[1].Parts[0].Text)
		require.Equal(t, json.Number("100"), request.GenerationConfig["maxOutputTokens"])
		require.Equal(t, json.Number("0.7"), request.GenerationConfig["temperature"])

		w.Header().Set("Content-Type", "application/json")
		require.NoError(t, json.NewEncoder(w).Encode(map[string]any{
			"candidates": []map[string]any{
				{
					"content":      map[string]any{"parts": []map[string]any{{"text": "hi there"}}},
					"finishReason": "STOP",
				},
			},
		}))
	}))
	defer server.Close()

	model, err := chatgemini.New(ai.ProviderConfig{
		Type:     ai.ProviderGemini,
		Endpoint: server.URL,
		APIKey:   "test-key",
	}, chat.ApplyOptions(nil))
	require.NoError(t, err)

	temp := float32(0.7)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	response, err := model.Generate(ctx, chat.Request{
		Model:       "gemini-2.5-flash",
		System:      "be terse",
		Temperature: &temp,
		MaxTokens:   100,
		Messages: []chat.Message{
			{Role: chat.RoleUser, Content: "hello"},
		},
	})
	require.NoError(t, err)
	require.Equal(t, "hi there", response.Text)
	require.Equal(t, chat.FinishStop, response.FinishReason)
}

func TestNewRequiresAPIKey(t *testing.T) {
	t.Parallel()
	_, err := chatgemini.New(ai.ProviderConfig{Type: ai.ProviderGemini}, chat.ApplyOptions(nil))
	require.Error(t, err)
}

func TestGenerateWithTools(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Contents   []any `json:"contents"`
			Tools      []any `json:"tools"`
			ToolConfig any   `json:"toolConfig"`
		}
		require.NoError(t, json.NewDecoder(r.Body).Decode(&request))
		require.Len(t, request.Tools, 1)
		tool, ok := request.Tools[0].(map[string]any)
		require.True(t, ok)
		fns, ok := tool["functionDeclarations"].([]any)
		require.True(t, ok)
		require.Len(t, fns, 1)
		require.Equal(t, "search_memos", fns[0].(map[string]any)["name"])
		require.NotNil(t, request.ToolConfig)

		w.Header().Set("Content-Type", "application/json")
		require.NoError(t, json.NewEncoder(w).Encode(map[string]any{
			"candidates": []map[string]any{
				{
					"content": map[string]any{
						"parts": []map[string]any{
							{
								"functionCall": map[string]any{
									"id":   "call_1",
									"name": "search_memos",
									"args": map[string]any{"query": "hello"},
								},
							},
						},
					},
					"finishReason": "STOP",
				},
			},
		}))
	}))
	defer server.Close()

	model, err := chatgemini.New(ai.ProviderConfig{
		Type:     ai.ProviderGemini,
		Endpoint: server.URL,
		APIKey:   "test-key",
	}, chat.ApplyOptions(nil))
	require.NoError(t, err)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	response, err := model.Generate(ctx, chat.Request{
		Model:      "gemini-2.5-flash",
		ToolChoice: chat.ToolChoiceAuto,
		Tools: []chat.ToolSpec{
			{
				Name:           "search_memos",
				Description:    "Search memos",
				ParametersJSON: `{"type":"object","properties":{"query":{"type":"string"}}}`,
			},
		},
		Messages: []chat.Message{
			{Role: chat.RoleUser, Content: "find my hello notes"},
		},
	})
	require.NoError(t, err)
	require.Len(t, response.ToolCalls, 1)
	require.Equal(t, "call_1", response.ToolCalls[0].ID)
	require.Equal(t, "search_memos", response.ToolCalls[0].Name)
	require.Contains(t, response.ToolCalls[0].ArgumentsJSON, "hello")
}

func TestGenerateWithToolResults(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Contents []struct {
				Role  string `json:"role"`
				Parts []struct {
					FunctionResponse map[string]any `json:"functionResponse"`
					Text             string         `json:"text"`
				} `json:"parts"`
			} `json:"contents"`
		}
		require.NoError(t, json.NewDecoder(r.Body).Decode(&request))
		require.Len(t, request.Contents, 2)
		require.Equal(t, "model", request.Contents[0].Role)
		require.Equal(t, "user", request.Contents[1].Role)
		require.NotNil(t, request.Contents[1].Parts[0].FunctionResponse)

		w.Header().Set("Content-Type", "application/json")
		require.NoError(t, json.NewEncoder(w).Encode(map[string]any{
			"candidates": []map[string]any{
				{
					"content":      map[string]any{"parts": []map[string]any{{"text": "found 2 memos"}}},
					"finishReason": "STOP",
				},
			},
		}))
	}))
	defer server.Close()

	model, err := chatgemini.New(ai.ProviderConfig{
		Type:     ai.ProviderGemini,
		Endpoint: server.URL,
		APIKey:   "test-key",
	}, chat.ApplyOptions(nil))
	require.NoError(t, err)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	response, err := model.Generate(ctx, chat.Request{
		Model: "gemini-2.5-flash",
		Messages: []chat.Message{
			{Role: chat.RoleAssistant, Content: "", ToolCalls: []chat.ToolCall{
				{ID: "call_1", Name: "search_memos", ArgumentsJSON: `{"query":"hello"}`},
			}},
			{Role: chat.RoleTool, Content: `{"results":[]}`, ToolCallID: "call_1", Name: "search_memos"},
		},
	})
	require.NoError(t, err)
	require.Equal(t, "found 2 memos", response.Text)
}
