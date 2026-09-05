import { useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import type { InstanceSetting_AISetting } from "@/types/proto/api/v1/instance_service_pb";
import { useTranslate } from "@/utils/i18n";
import { newChatAgent } from "../aiSettingFactories";
import { deriveLLMsFromLegacy, toLocalChatAgent, toLocalProvider } from "../aiSettingMapper";
import type { AISettingPatch } from "../saveAISettingPatch";
import type { LocalChatAgent, LocalLLM } from "../types";

type SavePatch = (patch: AISettingPatch, errorContext: string) => Promise<boolean>;

export const useAIChatAgents = ({
  originalSetting,
  llms,
  llmsByID,
  savePatch,
}: {
  originalSetting: InstanceSetting_AISetting;
  llms: LocalLLM[];
  llmsByID: Map<string, LocalLLM>;
  savePatch: SavePatch;
}) => {
  const t = useTranslate();
  const [chatAgents, setChatAgents] = useState<LocalChatAgent[]>(() => {
    const initialProviders = originalSetting.providers.map(toLocalProvider);
    const initialLLMs = deriveLLMsFromLegacy(
      originalSetting.llms,
      initialProviders,
      originalSetting.chatAgents,
      originalSetting.translation,
    );
    return originalSetting.chatAgents.map((agent) => toLocalChatAgent(agent, initialLLMs, initialProviders));
  });
  const [editingChatAgent, setEditingChatAgent] = useState<LocalChatAgent | undefined>();
  const [deleteChatAgentTarget, setDeleteChatAgentTarget] = useState<LocalChatAgent | undefined>();

  useEffect(() => {
    const nextProviders = originalSetting.providers.map(toLocalProvider);
    const nextLLMs = deriveLLMsFromLegacy(originalSetting.llms, nextProviders, originalSetting.chatAgents, originalSetting.translation);
    setChatAgents(originalSetting.chatAgents.map((agent) => toLocalChatAgent(agent, nextLLMs, nextProviders)));
  }, [originalSetting.chatAgents, originalSetting.llms, originalSetting.providers, originalSetting.translation]);

  const newChatAgentWithDefaultLLM = () => {
    const llm = llms.find((item) => item.enabled) ?? llms[0];
    return {
      ...newChatAgent(),
      llmId: llm?.id ?? "",
      providerId: llm?.providerId ?? "",
      model: llm?.model ?? "",
    };
  };

  const handleCreateChatAgent = () => {
    setEditingChatAgent(newChatAgentWithDefaultLLM());
  };

  const handleCreateChatAgentFromTemplate = (template: { name: string; systemPrompt: string }) => {
    setEditingChatAgent({ ...newChatAgentWithDefaultLLM(), name: template.name, systemPrompt: template.systemPrompt });
  };

  const handleEditChatAgent = (agent: LocalChatAgent) => {
    setEditingChatAgent({ ...agent });
  };

  const handleSaveChatAgent = async (agent: LocalChatAgent) => {
    const name = agent.name.trim();
    if (!name) {
      toast.error(t("setting.ai.chat-agent-name-required"));
      return;
    }
    if (agent.enabled && !agent.llmId) {
      toast.error(t("setting.ai.chat-agent-llm-required"));
      return;
    }
    const selectedLLM = agent.llmId ? llmsByID.get(agent.llmId) : undefined;
    if (agent.llmId && !selectedLLM) {
      toast.error(t("setting.ai.chat-agent-empty-llms"));
      return;
    }
    if (agent.enabled && selectedLLM && !selectedLLM.enabled) {
      toast.error(t("setting.ai.chat-agent-llm-disabled"));
      return;
    }

    const normalizedAgent = {
      ...agent,
      name,
      providerId: selectedLLM?.providerId ?? "",
      model: selectedLLM?.model ?? "",
    };
    const exists = chatAgents.some((item) => item.id === normalizedAgent.id);
    const nextChatAgents = exists
      ? chatAgents.map((item) => (item.id === normalizedAgent.id ? normalizedAgent : item))
      : [...chatAgents, normalizedAgent];

    const ok = await savePatch({ chatAgents: nextChatAgents }, "Update chat agent");
    if (!ok) return;
    setChatAgents(nextChatAgents);
    setEditingChatAgent(undefined);
  };

  const handleToggleChatAgent = async (agent: LocalChatAgent) => {
    if (!agent.enabled && !agent.llmId) {
      toast.error(t("setting.ai.chat-agent-llm-required"));
      return;
    }
    if (!agent.enabled && agent.llmId && !llmsByID.get(agent.llmId)?.enabled) {
      toast.error(t("setting.ai.chat-agent-llm-disabled"));
      return;
    }
    const nextChatAgents = chatAgents.map((item) => (item.id === agent.id ? { ...item, enabled: !item.enabled } : item));
    const ok = await savePatch({ chatAgents: nextChatAgents }, "Toggle chat agent");
    if (!ok) return;
    setChatAgents(nextChatAgents);
  };

  const handleDeleteChatAgent = async () => {
    if (!deleteChatAgentTarget) return;
    const target = deleteChatAgentTarget;
    const nextChatAgents = chatAgents.filter((agent) => agent.id !== target.id);
    const ok = await savePatch({ chatAgents: nextChatAgents }, "Delete chat agent");
    if (!ok) return;
    setChatAgents(nextChatAgents);
    setDeleteChatAgentTarget(undefined);
  };

  return {
    chatAgents,
    setChatAgents,
    editingChatAgent,
    setEditingChatAgent,
    deleteChatAgentTarget,
    setDeleteChatAgentTarget,
    handleCreateChatAgent,
    handleCreateChatAgentFromTemplate,
    handleEditChatAgent,
    handleSaveChatAgent,
    handleToggleChatAgent,
    handleDeleteChatAgent,
  };
};
