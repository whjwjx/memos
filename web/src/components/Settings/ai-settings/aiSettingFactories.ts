import { v4 as uuidv4 } from "uuid";
import { InstanceSetting_AIProviderType } from "@/types/proto/api/v1/instance_service_pb";
import type { LocalAgent, LocalAIProvider, LocalChatAgent, LocalLLM, LocalMemoryEntry, LocalTagger } from "./types";

export const providerTypeOptions = [InstanceSetting_AIProviderType.OPENAI, InstanceSetting_AIProviderType.GEMINI];

export const getProviderTypeLabel = (type: InstanceSetting_AIProviderType) => {
  return InstanceSetting_AIProviderType[type] ?? "UNKNOWN";
};

export const providerTypeSelectOptions = providerTypeOptions.map((type) => ({ value: String(type), label: getProviderTypeLabel(type) }));

export const defaultChatModelForProvider = (provider: LocalAIProvider | undefined): string => {
  if (!provider) return "";
  return provider.type === InstanceSetting_AIProviderType.GEMINI ? "gemini-2.5-flash" : "gpt-4o-mini";
};

export const getDefaultEndpointPlaceholder = (type: InstanceSetting_AIProviderType) => {
  switch (type) {
    case InstanceSetting_AIProviderType.OPENAI:
      return "https://api.openai.com/v1";
    case InstanceSetting_AIProviderType.GEMINI:
      return "https://generativelanguage.googleapis.com/v1beta";
    default:
      return "";
  }
};

export const newProvider = (): LocalAIProvider => ({
  id: uuidv4(),
  title: "",
  type: InstanceSetting_AIProviderType.OPENAI,
  endpoint: "",
  apiKey: "",
  apiKeySet: false,
  apiKeyHint: "",
});

export const newLLM = (providers: LocalAIProvider[]): LocalLLM => {
  const provider = providers[0];
  const model = defaultChatModelForProvider(provider);
  return {
    id: uuidv4(),
    title: model || "",
    providerId: provider?.id ?? "",
    model,
    enabled: true,
  };
};

export const newAgent = (): LocalAgent => ({
  id: uuidv4(),
  name: "",
  providerId: "",
  model: "",
  personaPrompt: "",
  systemPrompt: "",
  enabled: false,
  delayMinutes: 5,
  maxLength: 0,
});

export const newTagger = (): LocalTagger => ({
  id: uuidv4(),
  name: "",
  providerId: "",
  model: "",
  prompt: "",
  enabled: false,
  maxTags: 3,
});

export const newChatAgent = (): LocalChatAgent => ({
  id: uuidv4(),
  name: "",
  builtin: false,
  llmId: "",
  providerId: "",
  model: "",
  systemPrompt: "",
  enabled: false,
});

export const newMemoryEntry = (): LocalMemoryEntry => ({
  id: uuidv4(),
  content: "",
  createdBy: "",
  createdTs: 0n,
  updatedTs: 0n,
});
