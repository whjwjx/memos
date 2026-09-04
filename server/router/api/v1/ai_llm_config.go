package v1

import (
	"strings"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/usememos/memos/internal/ai"
	storepb "github.com/usememos/memos/proto/gen/store"
)

func (s *APIV1Service) resolveConfiguredLLM(setting *storepb.InstanceAISetting, llmID string) (ai.ProviderConfig, string, error) {
	llmID = strings.TrimSpace(llmID)
	if llmID == "" {
		return ai.ProviderConfig{}, "", status.Errorf(codes.FailedPrecondition, "LLM is not configured")
	}

	var llm *storepb.LLMConfig
	for _, item := range setting.GetLlms() {
		if item.GetId() == llmID {
			llm = item
			break
		}
	}
	if llm == nil {
		return ai.ProviderConfig{}, "", status.Errorf(codes.FailedPrecondition, "LLM %q is not configured", llmID)
	}
	if !llm.GetEnabled() {
		return ai.ProviderConfig{}, "", status.Errorf(codes.FailedPrecondition, "LLM %q is disabled", llmID)
	}

	provider := findProviderByID(setting.GetProviders(), llm.GetProviderId())
	if provider == nil || provider.GetApiKey() == "" {
		return ai.ProviderConfig{}, "", status.Errorf(codes.FailedPrecondition, "LLM provider %q is not configured", llm.GetProviderId())
	}

	modelName := strings.TrimSpace(llm.GetModel())
	if modelName == "" {
		return ai.ProviderConfig{}, "", status.Errorf(codes.FailedPrecondition, "LLM %q model is not configured", llmID)
	}
	return convertAIProviderConfigFromStore(provider), modelName, nil
}

func defaultChatModelForProvider(provider ai.ProviderConfig) (string, error) {
	modelName, err := ai.DefaultChatModel(provider.Type)
	if err != nil {
		return "", status.Errorf(codes.InvalidArgument, "%v", err)
	}
	return modelName, nil
}
