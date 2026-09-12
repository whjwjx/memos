import { useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import type { InstanceSetting_AISetting } from "@/types/proto/api/v1/instance_service_pb";
import { useTranslate } from "@/utils/i18n";
import { newChatAgent } from "../aiSettingFactories";
import { toLocalChatAgent } from "../aiSettingMapper";
import type { AISettingPatch } from "../saveAISettingPatch";
import type { LocalChatAgent } from "../types";

type SavePatch = (patch: AISettingPatch, errorContext: string) => Promise<boolean>;

export const useAIChatAgents = ({ originalSetting, savePatch }: { originalSetting: InstanceSetting_AISetting; savePatch: SavePatch }) => {
  const t = useTranslate();
  const [chatAgents, setChatAgents] = useState<LocalChatAgent[]>(() => originalSetting.chatAgents.map(toLocalChatAgent));
  const [editingChatAgent, setEditingChatAgent] = useState<LocalChatAgent | undefined>();
  const [deleteChatAgentTarget, setDeleteChatAgentTarget] = useState<LocalChatAgent | undefined>();

  useEffect(() => {
    setChatAgents(originalSetting.chatAgents.map(toLocalChatAgent));
  }, [originalSetting.chatAgents]);

  const handleCreateChatAgent = () => {
    setEditingChatAgent(newChatAgent());
  };

  const handleCreateChatAgentFromTemplate = (template: { name: string; systemPrompt: string }) => {
    setEditingChatAgent({ ...newChatAgent(), name: template.name, systemPrompt: template.systemPrompt });
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

    const normalizedAgent = {
      ...agent,
      name,
      llmId: "",
      providerId: "",
      model: "",
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
