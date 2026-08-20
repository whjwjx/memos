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
		require.Len(t, request.Contents, 1)
		require.Len(t, request.Contents[0].Parts, 2)
		require.Equal(t, "be terse", request.Contents[0].Parts[0].Text)
		require.Equal(t, "USER: hello", request.Contents[0].Parts[1].Text)
		require.Equal(t, json.Number("100"), request.GenerationConfig["maxOutputTokens"])
		require.Equal(t, json.Number("0.7"), request.GenerationConfig["temperature"])

		w.Header().Set("Content-Type", "application/json")
		require.NoError(t, json.NewEncoder(w).Encode(map[string]any{
			"candidates": []map[string]any{
				{
					"content":       map[string]any{"parts": []map[string]any{{"text": "hi there"}}},
					"finishReason":  "STOP",
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
