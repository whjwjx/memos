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

func TestTranslationPractice(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	user, err := ts.CreateRegularUser(ctx, "translation-practice-alice")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)

	requestCount := 0
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
		require.Equal(t, "user", request.Messages[1].Role)

		requestCount++
		var content string
		switch requestCount {
		case 1:
			require.Contains(t, request.Messages[0].Content, "Prepare a mobile-friendly English expression builder practice")
			require.Contains(t, request.Messages[1].Content, "今天想整理英语单词")
			content = `{
				"goal": "把整理英语单词这件事说清楚。",
				"basic_version": "I want to review English words today.",
				"native_version": "I want to turn today's English words into a small review practice.",
				"basic_blocks": [
					{"text": "I want to", "explanation": "表达想做某事"},
					{"text": "review English words", "explanation": "复习英语单词"},
					{"text": "today", "explanation": "时间放在句末也自然"}
				],
				"native_blocks": [
					{"text": "I want to", "explanation": "表达想做某事"},
					{"text": "turn today's English words into", "explanation": "把某物转化成某种练习"},
					{"text": "a small review practice", "explanation": "一个小复习练习"}
				],
				"extra_blocks": [
					{"text": "memorize", "explanation": "更偏死记硬背"}
				],
				"words": ["review — 复习、回顾", "practice — 练习"],
				"phrases": ["turn ... into ... — 把某事变成练习", "a small review practice — 一个轻量复习练习"],
				"patterns": ["I want to ... — 用来表达今天想做的事"],
				"thinking": ["先说 I want to，再补动作和时间。"]
			}`
		case 2:
			require.Contains(t, request.Messages[0].Content, "Review the user's English draft")
			require.Contains(t, request.Messages[1].Content, "I want to review English words today.")
			content = `{
				"passed": true,
				"summary": "这版已经表达清楚。",
				"strengths": ["主语清楚"],
				"improvements": ["可以让动词更具体"],
				"next_target": "继续保留自然语序。",
				"native_version": "I want to turn today's English words into a small review practice."
			}`
		default:
			t.Fatalf("unexpected request count %d", requestCount)
		}

		w.Header().Set("Content-Type", "application/json")
		require.NoError(t, json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{
					"message":       map[string]any{"role": "assistant", "content": content},
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
				Llms: []*storepb.LLMConfig{
					{
						Id:         "teacher-llm",
						Title:      "Teacher",
						ProviderId: "openai-main",
						Model:      "gpt-4o-mini",
						Enabled:    true,
					},
				},
				Translation: &storepb.TranslationConfig{
					Enabled:       true,
					LlmId:         "teacher-llm",
					MaxTextLength: 200,
				},
			},
		},
	})
	require.NoError(t, err)

	lessonResp, err := ts.Service.GenerateTranslationPracticeLesson(userCtx, &v1pb.GenerateTranslationPracticeLessonRequest{
		MemoContent: "今天想整理英语单词",
		Locale:      "zh-Hans",
	})
	require.NoError(t, err)
	require.Equal(t, "把整理英语单词这件事说清楚。", lessonResp.GetLesson().GetGoal())
	require.Equal(t, "I want to review English words today.", lessonResp.GetLesson().GetBasicVersion())
	require.Equal(t, "I want to turn today's English words into a small review practice.", lessonResp.GetLesson().GetNativeVersion())
	require.Len(t, lessonResp.GetLesson().GetBasicBlocks(), 3)
	require.Len(t, lessonResp.GetLesson().GetNativeBlocks(), 3)
	require.Len(t, lessonResp.GetLesson().GetOptionBlocks(), 6)
	require.Equal(t, lessonResp.GetLesson().GetBasicBlocks()[0].GetId(), lessonResp.GetLesson().GetNativeBlocks()[0].GetId())
	require.Contains(t, lessonResp.GetLesson().GetPatterns(), "I want to ... — 用来表达今天想做的事")
	require.Equal(t, "先说 I want to，再补动作和时间。", lessonResp.GetLesson().GetQuickTip())

	feedbackResp, err := ts.Service.ReviewTranslationPracticeDraft(userCtx, &v1pb.ReviewTranslationPracticeDraftRequest{
		MemoContent: "今天想整理英语单词",
		Draft:       "I want to review English words today.",
		Attempt:     1,
		Locale:      "zh-Hans",
	})
	require.NoError(t, err)
	require.True(t, feedbackResp.GetFeedback().GetPassed())
	require.Contains(t, feedbackResp.GetFeedback().GetNativeVersion(), "small review practice")
	require.Equal(t, 2, requestCount)
}
