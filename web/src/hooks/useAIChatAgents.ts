import { useEffect, useMemo, useState } from "react";
import { useInstance } from "@/contexts/InstanceContext";
import { type InstanceSetting_ChatAgentConfig, InstanceSetting_Key } from "@/types/proto/api/v1/instance_service_pb";

export const useAIChatAgents = () => {
  const { aiSetting, fetchSetting } = useInstance();
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    fetchSetting(InstanceSetting_Key.AI)
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [fetchSetting]);

  const chatAgents = useMemo(
    () => aiSetting.chatAgents.filter((agent) => agent.id && agent.name),
    [aiSetting.chatAgents],
  ) as InstanceSetting_ChatAgentConfig[];
  const enabledChatAgents = useMemo(() => chatAgents.filter((agent) => agent.enabled && (agent.llmId || agent.providerId)), [chatAgents]);
  const agentNameById = useMemo(() => new Map(chatAgents.map((agent) => [agent.id, agent.name])), [chatAgents]);

  return {
    agentNameById,
    chatAgents,
    defaultAgent: enabledChatAgents[0],
    enabledChatAgents,
    isLoading,
    shouldShowAgentSelector: enabledChatAgents.length > 1,
  };
};
