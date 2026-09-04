package v1

import (
	"context"
	"math"
	"regexp"
	"strings"

	"github.com/lithammer/shortuuid/v4"
	"github.com/pkg/errors"
	colorpb "google.golang.org/genproto/googleapis/type/color"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
)

func validateInstanceSetting(setting *v1pb.InstanceSetting) error {
	key, err := ExtractInstanceSettingKeyFromName(setting.Name)
	if err != nil {
		return err
	}
	if key != storepb.InstanceSettingKey_TAGS.String() {
		return nil
	}
	return validateInstanceTagsSetting(setting.GetTagsSetting())
}

func (s *APIV1Service) prepareInstanceAISettingForUpdate(ctx context.Context, setting *storepb.InstanceAISetting) error {
	if setting == nil {
		return errors.New("AI setting is required")
	}

	existing, err := s.Store.GetInstanceAISetting(ctx)
	if err != nil {
		return errors.Wrap(err, "failed to get existing AI setting")
	}
	existingProviders := map[string]*storepb.AIProviderConfig{}
	if existing != nil {
		for _, provider := range existing.Providers {
			if provider != nil && provider.Id != "" {
				existingProviders[provider.Id] = provider
			}
		}
	}

	seenIDs := map[string]bool{}
	providersByID := map[string]*storepb.AIProviderConfig{}
	for _, provider := range setting.Providers {
		if provider == nil {
			return errors.New("provider cannot be nil")
		}

		provider.Id = strings.TrimSpace(provider.Id)
		if provider.Id == "" {
			provider.Id = shortuuid.New()
		}
		if seenIDs[provider.Id] {
			return errors.Errorf("duplicate provider ID %q", provider.Id)
		}
		seenIDs[provider.Id] = true

		provider.Title = strings.TrimSpace(provider.Title)
		if provider.Title == "" {
			return errors.New("provider title is required")
		}
		if provider.Type != storepb.AIProviderType_OPENAI && provider.Type != storepb.AIProviderType_GEMINI {
			return errors.Errorf("provider %q has unsupported type", provider.Id)
		}

		provider.Endpoint = strings.TrimSpace(provider.Endpoint)
		if provider.Type == storepb.AIProviderType_OPENAI && provider.Endpoint == "" {
			provider.Endpoint = "https://api.openai.com/v1"
		}
		if provider.Type == storepb.AIProviderType_GEMINI && provider.Endpoint == "" {
			provider.Endpoint = "https://generativelanguage.googleapis.com/v1beta"
		}

		if provider.ApiKey == "" {
			if existingProvider, ok := existingProviders[provider.Id]; ok {
				provider.ApiKey = existingProvider.ApiKey
			}
		}
		if provider.ApiKey == "" {
			return errors.Errorf("provider %q API key is required", provider.Id)
		}
		providersByID[provider.Id] = provider
	}

	llmsByID, err := preparePersistedLLMConfigs(setting, providersByID)
	if err != nil {
		return err
	}
	if err := preparePersistedTranscriptionConfig(setting, existing); err != nil {
		return err
	}
	if err := preparePersistedAgentConfigs(setting, existing, existingProviders); err != nil {
		return err
	}
	if err := preparePersistedTaggerConfigs(setting, existingProviders); err != nil {
		return err
	}
	if err := preparePersistedChatAgentConfigs(setting, providersByID, llmsByID); err != nil {
		return err
	}
	if err := preparePersistedToolConfigs(setting); err != nil {
		return err
	}
	if err := preparePersistedTranslationConfig(setting, existing, providersByID, llmsByID); err != nil {
		return err
	}
	return nil
}

func preparePersistedLLMConfigs(
	setting *storepb.InstanceAISetting,
	providersByID map[string]*storepb.AIProviderConfig,
) (map[string]*storepb.LLMConfig, error) {
	llmsByID := map[string]*storepb.LLMConfig{}
	for _, llm := range setting.GetLlms() {
		if llm == nil {
			return nil, errors.New("LLM cannot be nil")
		}

		llm.Id = strings.TrimSpace(llm.Id)
		if llm.Id == "" {
			llm.Id = shortuuid.New()
		}
		if _, ok := llmsByID[llm.Id]; ok {
			return nil, errors.Errorf("duplicate LLM ID %q", llm.Id)
		}

		llm.Title = strings.TrimSpace(llm.Title)
		if llm.Title == "" {
			return nil, errors.New("LLM title is required")
		}
		llm.ProviderId = strings.TrimSpace(llm.ProviderId)
		if llm.ProviderId == "" {
			return nil, errors.Errorf("LLM %q provider_id is required", llm.Id)
		}
		if _, ok := providersByID[llm.ProviderId]; !ok {
			return nil, errors.Errorf("LLM %q references unknown provider_id %q", llm.Id, llm.ProviderId)
		}

		llm.Model = strings.TrimSpace(llm.Model)
		if llm.Model == "" {
			return nil, errors.Errorf("LLM %q model is required", llm.Id)
		}
		if len(llm.Model) > maxLLMConfigModelLength {
			return nil, errors.Errorf("LLM %q model is too long; maximum length is %d characters", llm.Id, maxLLMConfigModelLength)
		}
		llmsByID[llm.Id] = llm
	}
	return llmsByID, nil
}

func preparePersistedTranslationConfig(
	setting *storepb.InstanceAISetting,
	existing *storepb.InstanceAISetting,
	providersByID map[string]*storepb.AIProviderConfig,
	llmsByID map[string]*storepb.LLMConfig,
) error {
	// Preserve existing translation config when older clients omit it during an
	// AI setting update, matching transcription and credential preservation.
	if setting.Translation == nil && existing != nil {
		setting.Translation = existing.GetTranslation()
	}
	if setting.Translation == nil {
		return nil
	}

	cfg := setting.Translation
	cfg.LlmId = strings.TrimSpace(cfg.LlmId)
	cfg.ProviderId = strings.TrimSpace(cfg.ProviderId)
	cfg.Model = strings.TrimSpace(cfg.Model)

	if cfg.Enabled && cfg.LlmId == "" && cfg.ProviderId == "" {
		return errors.New("translation llm_id is required when translation is enabled")
	}
	if cfg.LlmId != "" {
		llm, ok := llmsByID[cfg.LlmId]
		if !ok {
			return errors.Errorf("translation llm_id %q does not reference any configured LLM", cfg.LlmId)
		}
		if cfg.Enabled && !llm.GetEnabled() {
			return errors.Errorf("translation llm_id %q references a disabled LLM", cfg.LlmId)
		}
	}
	if cfg.ProviderId != "" {
		if _, ok := providersByID[cfg.ProviderId]; !ok {
			return errors.Errorf("translation provider_id %q does not reference any configured provider", cfg.ProviderId)
		}
	}
	if len(cfg.Model) > maxTranslationConfigModelLength {
		return errors.Errorf("translation model is too long; maximum length is %d characters", maxTranslationConfigModelLength)
	}
	if cfg.MaxTextLength < 0 {
		return errors.New("translation max_text_length must be >= 0")
	}
	if cfg.MaxTextLength > maxTranslationConfigMaxTextLength {
		return errors.Errorf("translation max_text_length is too large; maximum is %d characters", maxTranslationConfigMaxTextLength)
	}
	return nil
}

func preparePersistedTaggerConfigs(setting *storepb.InstanceAISetting, existingProviders map[string]*storepb.AIProviderConfig) error {
	taggerIDs := map[string]bool{}
	for _, tagger := range setting.GetTaggers() {
		if tagger == nil {
			return errors.New("tagger cannot be nil")
		}

		tagger.Id = strings.TrimSpace(tagger.Id)
		if tagger.Id == "" {
			tagger.Id = shortuuid.New()
		}
		if taggerIDs[tagger.Id] {
			return errors.Errorf("duplicate tagger ID %q", tagger.Id)
		}
		taggerIDs[tagger.Id] = true

		tagger.Name = strings.TrimSpace(tagger.Name)
		if tagger.Name == "" {
			return errors.New("tagger name is required")
		}

		tagger.ProviderId = strings.TrimSpace(tagger.ProviderId)
		if tagger.ProviderId != "" {
			if _, ok := existingProviders[tagger.ProviderId]; !ok {
				return errors.Errorf("tagger %q references unknown provider_id %q", tagger.Id, tagger.ProviderId)
			}
		}

		if tagger.MaxTags < 0 {
			return errors.Errorf("tagger %q max_tags must be >= 0", tagger.Id)
		}
	}
	return nil
}

func preparePersistedChatAgentConfigs(
	setting *storepb.InstanceAISetting,
	providersByID map[string]*storepb.AIProviderConfig,
	llmsByID map[string]*storepb.LLMConfig,
) error {
	chatAgentIDs := map[string]bool{}
	for _, chatAgent := range setting.GetChatAgents() {
		if chatAgent == nil {
			return errors.New("chat agent cannot be nil")
		}

		chatAgent.Id = strings.TrimSpace(chatAgent.Id)
		if chatAgent.Id == "" {
			chatAgent.Id = shortuuid.New()
		}
		if chatAgentIDs[chatAgent.Id] {
			return errors.Errorf("duplicate chat agent ID %q", chatAgent.Id)
		}
		chatAgentIDs[chatAgent.Id] = true

		chatAgent.Name = strings.TrimSpace(chatAgent.Name)
		if chatAgent.Name == "" {
			return errors.New("chat agent name is required")
		}

		chatAgent.LlmId = strings.TrimSpace(chatAgent.LlmId)
		chatAgent.ProviderId = strings.TrimSpace(chatAgent.ProviderId)
		if chatAgent.Enabled && chatAgent.LlmId == "" && chatAgent.ProviderId == "" {
			return errors.Errorf("chat agent %q requires llm_id when enabled", chatAgent.Id)
		}
		if chatAgent.LlmId != "" {
			llm, ok := llmsByID[chatAgent.LlmId]
			if !ok {
				return errors.Errorf("chat agent %q references unknown llm_id %q", chatAgent.Id, chatAgent.LlmId)
			}
			if chatAgent.Enabled && !llm.GetEnabled() {
				return errors.Errorf("chat agent %q references disabled llm_id %q", chatAgent.Id, chatAgent.LlmId)
			}
		}
		if chatAgent.ProviderId != "" {
			if _, ok := providersByID[chatAgent.ProviderId]; !ok {
				return errors.Errorf("chat agent %q references unknown provider_id %q", chatAgent.Id, chatAgent.ProviderId)
			}
		}

		chatAgent.Model = strings.TrimSpace(chatAgent.Model)
		chatAgent.SystemPrompt = strings.TrimSpace(chatAgent.SystemPrompt)
	}
	return nil
}

func preparePersistedToolConfigs(setting *storepb.InstanceAISetting) error {
	for name, tool := range setting.GetTools() {
		if tool == nil {
			return errors.Errorf("tool %q cannot be nil", name)
		}
	}
	return nil
}

func preparePersistedAgentConfigs(setting *storepb.InstanceAISetting, existing *storepb.InstanceAISetting, existingProviders map[string]*storepb.AIProviderConfig) error {
	agentIDs := map[string]bool{}
	for _, agent := range setting.GetAgents() {
		if agent == nil {
			return errors.New("agent cannot be nil")
		}

		agent.Id = strings.TrimSpace(agent.Id)
		if agent.Id == "" {
			agent.Id = shortuuid.New()
		}
		if agentIDs[agent.Id] {
			return errors.Errorf("duplicate agent ID %q", agent.Id)
		}
		agentIDs[agent.Id] = true

		agent.Name = strings.TrimSpace(agent.Name)
		if agent.Name == "" {
			return errors.New("agent name is required")
		}

		agent.ProviderId = strings.TrimSpace(agent.ProviderId)
		if agent.ProviderId != "" {
			if _, ok := existingProviders[agent.ProviderId]; !ok {
				return errors.Errorf("agent %q references unknown provider_id %q", agent.Id, agent.ProviderId)
			}
		}

		if agent.DelayMinutes < 0 {
			return errors.Errorf("agent %q delay_minutes must be >= 0", agent.Id)
		}
		if agent.MaxLength < 0 {
			return errors.Errorf("agent %q max_length must be >= 0", agent.Id)
		}
	}
	return nil
}

func preparePersistedTranscriptionConfig(setting *storepb.InstanceAISetting, existing *storepb.InstanceAISetting) error {
	// Preserve the previously stored transcription config when the request omits it,
	// matching the same "absence == keep" semantics used for API keys. The preserved
	// config still falls through to validation below, so a stale provider_id is
	// rejected if the same update removed or renamed its referenced provider.
	if setting.Transcription == nil && existing != nil {
		setting.Transcription = existing.GetTranscription()
	}
	if setting.Transcription == nil {
		return nil
	}

	cfg := setting.Transcription
	cfg.ProviderId = strings.TrimSpace(cfg.ProviderId)
	cfg.Model = strings.TrimSpace(cfg.Model)
	cfg.Language = strings.TrimSpace(cfg.Language)
	cfg.Prompt = strings.TrimSpace(cfg.Prompt)

	if cfg.ProviderId != "" {
		referenced := false
		for _, provider := range setting.Providers {
			if provider != nil && provider.Id == cfg.ProviderId {
				referenced = true
				break
			}
		}
		if !referenced {
			return errors.Errorf("transcription provider_id %q does not reference any configured provider", cfg.ProviderId)
		}
	}

	if len(cfg.Model) > maxTranscriptionConfigModelLength {
		return errors.Errorf("transcription model is too long; maximum length is %d characters", maxTranscriptionConfigModelLength)
	}
	if len(cfg.Language) > maxTranscriptionConfigLanguageLength {
		return errors.Errorf("transcription language is too long; maximum length is %d characters", maxTranscriptionConfigLanguageLength)
	}
	if len(cfg.Prompt) > maxTranscriptionConfigPromptLength {
		return errors.Errorf("transcription prompt is too long; maximum length is %d characters", maxTranscriptionConfigPromptLength)
	}
	return nil
}

func maskAPIKey(apiKey string) string {
	if apiKey == "" {
		return ""
	}
	if len(apiKey) <= 8 {
		return "..."
	}
	prefixLength := min(4, len(apiKey))
	return apiKey[:prefixLength] + "..." + apiKey[len(apiKey)-4:]
}

func validateInstanceTagsSetting(setting *v1pb.InstanceSetting_TagsSetting) error {
	if setting == nil {
		return errors.New("tags setting is required")
	}
	for tag, metadata := range setting.Tags {
		if strings.TrimSpace(tag) == "" {
			return errors.New("tag key cannot be empty")
		}
		if _, err := regexp.Compile(tag); err != nil {
			return errors.Errorf("tag key %q is not a valid regex pattern: %v", tag, err)
		}
		if metadata == nil {
			return errors.Errorf("tag metadata is required for %q", tag)
		}
		if metadata.GetBackgroundColor() != nil {
			if err := validateInstanceColor(metadata.GetBackgroundColor()); err != nil {
				return errors.Wrapf(err, "background_color for %q", tag)
			}
		}
	}
	return nil
}

func validateInstanceColor(color *colorpb.Color) error {
	if err := validateInstanceColorComponent("red", color.GetRed()); err != nil {
		return err
	}
	if err := validateInstanceColorComponent("green", color.GetGreen()); err != nil {
		return err
	}
	if err := validateInstanceColorComponent("blue", color.GetBlue()); err != nil {
		return err
	}
	if alpha := color.GetAlpha(); alpha != nil {
		if err := validateInstanceColorComponent("alpha", alpha.GetValue()); err != nil {
			return err
		}
	}
	return nil
}

func validateInstanceColorComponent(name string, value float32) error {
	if math.IsNaN(float64(value)) || math.IsInf(float64(value), 0) {
		return errors.Errorf("%s must be a finite number", name)
	}
	if value < 0 || value > 1 {
		return errors.Errorf("%s must be between 0 and 1", name)
	}
	return nil
}
