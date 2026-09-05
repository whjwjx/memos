import type { InstanceSetting_AIProviderType } from "@/types/proto/api/v1/instance_service_pb";

export type AISettingsPanel = "overview" | "llms" | "agents" | "tools" | "translation" | "memory" | "legacy";

export type LocalAIProvider = {
  id: string;
  title: string;
  type: InstanceSetting_AIProviderType;
  endpoint: string;
  apiKey: string;
  apiKeySet: boolean;
  apiKeyHint: string;
};

export type LocalTranscription = {
  providerId: string;
  model: string;
  language: string;
  prompt: string;
};

export type LocalLLM = {
  id: string;
  title: string;
  providerId: string;
  model: string;
  enabled: boolean;
};

export type LocalChatAgent = {
  id: string;
  name: string;
  builtin: boolean;
  llmId: string;
  providerId: string;
  model: string;
  systemPrompt: string;
  enabled: boolean;
};

export type LocalAgent = {
  id: string;
  name: string;
  providerId: string;
  model: string;
  personaPrompt: string;
  systemPrompt: string;
  enabled: boolean;
  delayMinutes: number;
  maxLength: number;
};

export type LocalTagger = {
  id: string;
  name: string;
  providerId: string;
  model: string;
  prompt: string;
  enabled: boolean;
  maxTags: number;
};

export type LocalTool = {
  name: string;
  enabled: boolean;
  requiresConfirmation: boolean;
};

export type ChatAgentTemplate = {
  name: string;
  systemPrompt: string;
};

export type LocalTranslation = {
  enabled: boolean;
  llmId: string;
  providerId: string;
  model: string;
  maxTextLength: number;
};

export type LocalMemoryEntry = {
  id: string;
  content: string;
  createdBy: string;
  createdTs: bigint;
  updatedTs: bigint;
};

export type LocalMemory = {
  enabled: boolean;
  entries: LocalMemoryEntry[];
};
