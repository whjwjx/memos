package test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
)

func TestTranscribe(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	_, err := ts.Service.Transcribe(ctx, &v1pb.TranscribeRequest{
		Audio: &v1pb.TranscriptionAudio{
			Source:      &v1pb.TranscriptionAudio_Content{Content: []byte("RIFF")},
			Filename:    "voice.wav",
			ContentType: "audio/wav",
		},
	})
	require.Error(t, err)
	require.Contains(t, err.Error(), "audio transcription has been removed")
}

func TestTranslate(t *testing.T) {
	ctx := context.Background()

	t.Run("requires authentication", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		_, err := ts.Service.Translate(ctx, &v1pb.TranslateRequest{
			Text:      "hello",
			Direction: v1pb.TranslationDirection_EN_TO_ZH,
		})
		require.Error(t, err)
		require.Contains(t, err.Error(), "user not authenticated")
	})

	t.Run("returns FailedPrecondition when translation is not configured", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		user, err := ts.CreateRegularUser(ctx, "translate-empty")
		require.NoError(t, err)
		userCtx := ts.CreateUserContext(ctx, user.ID)

		_, err = ts.Service.Translate(userCtx, &v1pb.TranslateRequest{
			Text:      "hello",
			Direction: v1pb.TranslationDirection_EN_TO_ZH,
		})
		require.Error(t, err)
		require.Contains(t, err.Error(), "translation is not configured")
	})

	t.Run("translates through configured OpenAI provider and records history", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		user, err := ts.CreateRegularUser(ctx, "translate-alice")
		require.NoError(t, err)
		userCtx := ts.CreateUserContext(ctx, user.ID)

		openAIServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			require.Equal(t, http.MethodPost, r.Method)
			require.Equal(t, "/chat/completions", r.URL.Path)
			require.Equal(t, "Bearer sk-test", r.Header.Get("Authorization"))

			var request struct {
				Model    string `json:"model"`
				Messages []struct {
					Role    string `json:"role"`
					Content string `json:"content"`
				} `json:"messages"`
			}
			require.NoError(t, json.NewDecoder(r.Body).Decode(&request))
			require.Equal(t, "gpt-4o-mini", request.Model)
			require.Len(t, request.Messages, 2)
			require.Equal(t, "system", request.Messages[0].Role)
			require.Contains(t, request.Messages[0].Content, "Translate from en to zh-Hans")
			require.Equal(t, "user", request.Messages[1].Role)
			require.Contains(t, request.Messages[1].Content, "hello")

			w.Header().Set("Content-Type", "application/json")
			require.NoError(t, json.NewEncoder(w).Encode(map[string]any{
				"choices": []map[string]any{
					{
						"message":       map[string]any{"role": "assistant", "content": "你好"},
						"finish_reason": "stop",
					},
				},
			}))
		}))
		defer openAIServer.Close()

		_, err = ts.Store.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
			Key: storepb.InstanceSettingKey_AI,
			Value: &storepb.InstanceSetting_AiSetting{
				AiSetting: &storepb.InstanceAISetting{
					Providers: []*storepb.AIProviderConfig{
						{
							Id:       "openai-main",
							Title:    "OpenAI",
							Type:     storepb.AIProviderType_OPENAI,
							Endpoint: openAIServer.URL,
							ApiKey:   "sk-test",
						},
					},
					Translation: &storepb.TranslationConfig{
						Enabled:       true,
						ProviderId:    "openai-main",
						Model:         "gpt-4o-mini",
						MaxTextLength: 12,
					},
				},
			},
		})
		require.NoError(t, err)

		resp, err := ts.Service.Translate(userCtx, &v1pb.TranslateRequest{
			Text:      "hello",
			Direction: v1pb.TranslationDirection_EN_TO_ZH,
		})
		require.NoError(t, err)
		require.Equal(t, "你好", resp.GetTranslatedText())
		require.Equal(t, "en", resp.GetSourceLanguage())
		require.Equal(t, "zh-Hans", resp.GetTargetLanguage())
		require.NotNil(t, resp.GetHistory())
		require.NotEmpty(t, resp.GetHistory().GetId())

		listResp, err := ts.Service.ListTranslationHistories(userCtx, &v1pb.ListTranslationHistoriesRequest{})
		require.NoError(t, err)
		require.Len(t, listResp.GetHistories(), 1)
		require.Equal(t, "hello", listResp.GetHistories()[0].GetSourceText())
		require.Equal(t, "你好", listResp.GetHistories()[0].GetTranslatedText())

		_, err = ts.Service.DeleteTranslationHistory(userCtx, &v1pb.DeleteTranslationHistoryRequest{Id: resp.GetHistory().GetId()})
		require.NoError(t, err)
		listResp, err = ts.Service.ListTranslationHistories(userCtx, &v1pb.ListTranslationHistoriesRequest{})
		require.NoError(t, err)
		require.Empty(t, listResp.GetHistories())
	})

	t.Run("enforces configured text length", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		user, err := ts.CreateRegularUser(ctx, "translate-limit")
		require.NoError(t, err)
		userCtx := ts.CreateUserContext(ctx, user.ID)

		_, err = ts.Store.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
			Key: storepb.InstanceSettingKey_AI,
			Value: &storepb.InstanceSetting_AiSetting{
				AiSetting: &storepb.InstanceAISetting{
					Providers: []*storepb.AIProviderConfig{
						{
							Id:     "openai-main",
							Title:  "OpenAI",
							Type:   storepb.AIProviderType_OPENAI,
							ApiKey: "sk-test",
						},
					},
					Translation: &storepb.TranslationConfig{
						Enabled:       true,
						ProviderId:    "openai-main",
						Model:         "gpt-4o-mini",
						MaxTextLength: 2,
					},
				},
			},
		})
		require.NoError(t, err)

		_, err = ts.Service.Translate(userCtx, &v1pb.TranslateRequest{
			Text:      "hello",
			Direction: v1pb.TranslationDirection_EN_TO_ZH,
		})
		require.Error(t, err)
		require.Contains(t, err.Error(), "text is too long")
	})
}
