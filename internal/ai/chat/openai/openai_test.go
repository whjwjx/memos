package openai_test

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
	chatopenai "github.com/usememos/memos/internal/ai/chat/openai"
)

func TestGenerate(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, http.MethodPost, r.Method)
		require.Equal(t, "/chat/completions", r.URL.Path)
		require.Equal(t, "Bearer test-key", r.Header.Get("Authorization"))
		require.Equal(t, "application/json", r.Header.Get("Content-Type"))

		var request struct {
			Model    string `json:"model"`
			Messages []struct {
				Role    string `json:"role"`
				Content string `json:"content"`
			} `json:"messages"`
			MaxCompletionTokens int      `json:"max_completion_tokens"`
			Temperature         *float32 `json:"temperature"`
		}
		require.NoError(t, json.NewDecoder(r.Body).Decode(&request))
		require.Equal(t, "gpt-4o-mini", request.Model)
		require.Len(t, request.Messages, 2)
		require.Equal(t, "system", request.Messages[0].Role)
		require.Equal(t, "be terse", request.Messages[0].Content)
		require.Equal(t, "user", request.Messages[1].Role)
		require.Equal(t, "hello", request.Messages[1].Content)
		require.Equal(t, 100, request.MaxCompletionTokens)

		w.Header().Set("Content-Type", "application/json")
		require.NoError(t, json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{
					"message":       map[string]any{"role": "assistant", "content": "hi there"},
					"finish_reason": "stop",
				},
			},
		}))
	}))
	defer server.Close()

	model, err := chatopenai.New(ai.ProviderConfig{
		Type:     ai.ProviderOpenAI,
		Endpoint: server.URL,
		APIKey:   "test-key",
	}, chat.ApplyOptions(nil))
	require.NoError(t, err)

	temp := float32(0.7)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	response, err := model.Generate(ctx, chat.Request{
		Model:       "gpt-4o-mini",
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
	_, err := chatopenai.New(ai.ProviderConfig{Type: ai.ProviderOpenAI}, chat.ApplyOptions(nil))
	require.Error(t, err)
}

func TestGenerateWithTools(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Model      string `json:"model"`
			Tools      []any  `json:"tools"`
			ToolChoice string `json:"tool_choice"`
			Messages   []struct {
				Role    string `json:"role"`
				Content string `json:"content"`
			} `json:"messages"`
		}
		require.NoError(t, json.NewDecoder(r.Body).Decode(&request))
		require.Equal(t, "gpt-4o-mini", request.Model)
		require.Len(t, request.Tools, 1)
		require.Equal(t, "auto", request.ToolChoice)

		w.Header().Set("Content-Type", "application/json")
		require.NoError(t, json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{
					"message": map[string]any{
						"role":    "assistant",
						"content": "",
						"tool_calls": []map[string]any{
							{
								"id":   "call_abc",
								"type": "function",
								"function": map[string]any{
									"name":      "search_memos",
									"arguments": `{"query":"hello"}`,
								},
							},
						},
					},
					"finish_reason": "tool_calls",
				},
			},
		}))
	}))
	defer server.Close()

	model, err := chatopenai.New(ai.ProviderConfig{
		Type:     ai.ProviderOpenAI,
		Endpoint: server.URL,
		APIKey:   "test-key",
	}, chat.ApplyOptions(nil))
	require.NoError(t, err)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	response, err := model.Generate(ctx, chat.Request{
		Model:      "gpt-4o-mini",
		ToolChoice: chat.ToolChoiceAuto,
		Tools: []chat.ToolSpec{
			{
				Name:           "search_memos",
				Description:    "Search the user's memos",
				ParametersJSON: `{"type":"object","properties":{"query":{"type":"string"}}}`,
			},
		},
		Messages: []chat.Message{
			{Role: chat.RoleUser, Content: "find my hello notes"},
		},
	})
	require.NoError(t, err)
	require.Len(t, response.ToolCalls, 1)
	require.Equal(t, "call_abc", response.ToolCalls[0].ID)
	require.Equal(t, "search_memos", response.ToolCalls[0].Name)
	require.Equal(t, `{"query":"hello"}`, response.ToolCalls[0].ArgumentsJSON)
	require.Equal(t, chat.FinishOther, response.FinishReason)
}

func TestGenerateWithToolResults(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Messages []struct {
				Role       string `json:"role"`
				Content    string `json:"content"`
				ToolCallID string `json:"tool_call_id"`
			} `json:"messages"`
		}
		require.NoError(t, json.NewDecoder(r.Body).Decode(&request))
		require.Len(t, request.Messages, 3)
		require.Equal(t, "assistant", request.Messages[0].Role)
		require.Equal(t, "tool", request.Messages[1].Role)
		require.Equal(t, "call_abc", request.Messages[1].ToolCallID)

		w.Header().Set("Content-Type", "application/json")
		require.NoError(t, json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{
					"message":       map[string]any{"role": "assistant", "content": "found 2 memos"},
					"finish_reason": "stop",
				},
			},
		}))
	}))
	defer server.Close()

	model, err := chatopenai.New(ai.ProviderConfig{
		Type:     ai.ProviderOpenAI,
		Endpoint: server.URL,
		APIKey:   "test-key",
	}, chat.ApplyOptions(nil))
	require.NoError(t, err)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	response, err := model.Generate(ctx, chat.Request{
		Model: "gpt-4o-mini",
		Messages: []chat.Message{
			{Role: chat.RoleAssistant, Content: "", ToolCalls: []chat.ToolCall{
				{ID: "call_abc", Name: "search_memos", ArgumentsJSON: `{"query":"hello"}`},
			}},
			{Role: chat.RoleTool, Content: `{"results":[]}`, ToolCallID: "call_abc", Name: "search_memos"},
			{Role: chat.RoleUser, Content: "now summarize"},
		},
	})
	require.NoError(t, err)
	require.Equal(t, "found 2 memos", response.Text)
}
