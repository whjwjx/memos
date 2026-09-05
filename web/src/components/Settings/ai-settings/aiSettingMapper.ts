import { create } from "@bufbuild/protobuf";
import {
  InstanceSetting_AIProviderConfig,
  InstanceSetting_AIProviderConfigSchema,
  InstanceSetting_ChatAgentConfig,
  InstanceSetting_ChatAgentConfigSchema,
  InstanceSetting_LLMConfig,
  InstanceSetting_LLMConfigSchema,
  InstanceSetting_MemoryConfig,
  InstanceSetting_MemoryConfigSchema,
  InstanceSetting_MemoryEntry,
  InstanceSetting_MemoryEntrySchema,
  InstanceSetting_ToolConfig,
  InstanceSetting_ToolConfigSchema,
  InstanceSetting_TranslationConfig,
  InstanceSetting_TranslationConfigSchema,
} from "@/types/proto/api/v1/instance_service_pb";
import { defaultChatModelForProvider } from "./aiSettingFactories";
import { toolRegistry } from "./toolRegistry";
import type { LocalAIProvider, LocalChatAgent, LocalLLM, LocalMemory, LocalMemoryEntry, LocalTool, LocalTranslation } from "./types";

export const toLocalProvider = (provider: InstanceSetting_AIProviderConfig): LocalAIProvider => ({
  id: provider.id,
  title: provider.title,
  type: provider.type,
  endpoint: provider.endpoint,
  apiKey: "",
  apiKeySet: provider.apiKeySet,
  apiKeyHint: provider.apiKeyHint,
});

export const toProviderConfig = (provider: LocalAIProvider) =>
  create(InstanceSetting_AIProviderConfigSchema, {
    id: provider.id,
    title: provider.title.trim(),
    type: provider.type,
    endpoint: provider.endpoint.trim(),
    apiKey: provider.apiKey,
  });

export const toLocalLLM = (llm: InstanceSetting_LLMConfig): LocalLLM => ({
  id: llm.id,
  title: llm.title,
  providerId: llm.providerId,
  model: llm.model,
  enabled: llm.enabled,
});

export const toLLMConfig = (llm: LocalLLM) =>
  create(InstanceSetting_LLMConfigSchema, {
    id: llm.id,
    title: llm.title.trim(),
    providerId: llm.providerId,
    model: llm.model.trim(),
    enabled: llm.enabled,
  });

const legacyLLMKey = (providerId: string, model: string) => `${providerId}:${model}`;

export const deriveLLMsFromLegacy = (
  llms: InstanceSetting_LLMConfig[],
  providers: LocalAIProvider[],
  chatAgents: InstanceSetting_ChatAgentConfig[],
  translation: InstanceSetting_TranslationConfig | undefined,
): LocalLLM[] => {
  if (llms.length > 0) {
    return llms.map(toLocalLLM);
  }

  const providersByID = new Map(providers.map((provider) => [provider.id, provider]));
  const derived = new Map<string, LocalLLM>();
  const addLegacyLLM = (providerId: string, model: string) => {
    const provider = providersByID.get(providerId);
    if (!provider) return;
    const normalizedModel = model.trim() || defaultChatModelForProvider(provider);
    if (!normalizedModel) return;
    const key = legacyLLMKey(providerId, normalizedModel);
    if (derived.has(key)) return;
    derived.set(key, {
      id: key,
      title: normalizedModel,
      providerId,
      model: normalizedModel,
      enabled: true,
    });
  };

  for (const agent of chatAgents) {
    addLegacyLLM(agent.providerId, agent.model);
  }
  if (translation) {
    addLegacyLLM(translation.providerId, translation.model);
  }
  return Array.from(derived.values());
};

export const resolveLLMId = (
  llmId: string,
  providerId: string,
  model: string,
  llms: LocalLLM[] = [],
  providers: LocalAIProvider[] = [],
): string => {
  if (llmId) return llmId;
  const provider = providers.find((item) => item.id === providerId);
  const normalizedModel = model.trim() || defaultChatModelForProvider(provider);
  if (!providerId || !normalizedModel) return "";
  return llms.find((llm) => llm.providerId === providerId && llm.model === normalizedModel)?.id || "";
};

export const toLocalTranslation = (
  config: InstanceSetting_TranslationConfig | undefined,
  llms: LocalLLM[] = [],
  providers: LocalAIProvider[] = [],
): LocalTranslation => {
  const providerId = config?.providerId ?? "";
  const model = config?.model ?? "";

  return {
    enabled: config?.enabled ?? false,
    llmId: resolveLLMId(config?.llmId ?? "", providerId, model, llms, providers),
    providerId,
    model,
    maxTextLength: config?.maxTextLength && config.maxTextLength > 0 ? config.maxTextLength : 5000,
  };
};

export const toTranslationConfig = (translation: LocalTranslation) =>
  create(InstanceSetting_TranslationConfigSchema, {
    enabled: translation.enabled,
    llmId: translation.llmId,
    providerId: translation.providerId,
    model: translation.model.trim(),
    maxTextLength: translation.maxTextLength,
  });

export const createEmptyTranslationConfig = () => create(InstanceSetting_TranslationConfigSchema, {});

export const toLocalChatAgent = (
  agent: InstanceSetting_ChatAgentConfig,
  llms: LocalLLM[] = [],
  providers: LocalAIProvider[] = [],
): LocalChatAgent => ({
  id: agent.id,
  name: agent.name,
  builtin: agent.builtin,
  llmId: resolveLLMId(agent.llmId, agent.providerId, agent.model, llms, providers),
  providerId: agent.providerId,
  model: agent.model,
  systemPrompt: agent.systemPrompt,
  enabled: agent.enabled,
});

export const toChatAgentConfig = (agent: LocalChatAgent) =>
  create(InstanceSetting_ChatAgentConfigSchema, {
    id: agent.id,
    name: agent.name.trim(),
    builtin: agent.builtin,
    llmId: agent.llmId,
    providerId: agent.providerId,
    model: agent.model.trim(),
    systemPrompt: agent.systemPrompt,
    enabled: agent.enabled,
  });

export const toLocalTool = (name: string, tool: InstanceSetting_ToolConfig | undefined): LocalTool => {
  const def = toolRegistry.find((t) => t.name === name);
  return {
    name,
    // Tools without a persisted config are enabled by default, matching the
    // backend (applyToolConfig only overrides persisted entries).
    enabled: tool?.enabled ?? true,
    // Read-only tools never require confirmation; the toggle is locked off.
    requiresConfirmation:
      def?.confirmEditable === false ? false : (tool?.requiresConfirmation ?? def?.defaultRequiresConfirmation ?? false),
  };
};

export const toToolConfig = (tool: LocalTool) =>
  create(InstanceSetting_ToolConfigSchema, {
    enabled: tool.enabled,
    requiresConfirmation: tool.requiresConfirmation,
  });

export const toLocalMemoryEntry = (entry: InstanceSetting_MemoryEntry): LocalMemoryEntry => ({
  id: entry.id,
  content: entry.content,
  createdBy: entry.createdBy,
  createdTs: entry.createdTs,
  updatedTs: entry.updatedTs,
});

export const toLocalMemory = (memory: InstanceSetting_MemoryConfig | undefined): LocalMemory => ({
  enabled: memory?.enabled ?? false,
  entries: (memory?.entries ?? []).map(toLocalMemoryEntry),
});

export const toMemoryConfig = (memory: LocalMemory) =>
  create(InstanceSetting_MemoryConfigSchema, {
    enabled: memory.enabled,
    entries: memory.entries.map((entry) =>
      create(InstanceSetting_MemoryEntrySchema, {
        id: entry.id,
        content: entry.content.trim(),
        createdBy: entry.createdBy,
        createdTs: entry.createdTs,
        updatedTs: entry.updatedTs,
      }),
    ),
  });
