import { useEffect, useMemo, useState } from "react";
import { useInstance } from "@/contexts/InstanceContext";
import {
  type InstanceSetting_ChatAgentConfig,
  InstanceSetting_Key,
  type InstanceSetting_LLMConfig,
} from "@/types/proto/api/v1/instance_service_pb";

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
  const llms = useMemo(
    () => aiSetting.llms.filter((llm) => llm.id && llm.title && llm.providerId && llm.model),
    [aiSetting.llms],
  ) as InstanceSetting_LLMConfig[];
  const enabledLLMs = useMemo(() => llms.filter((llm) => llm.enabled), [llms]);
  const enabledChatAgents = useMemo(
    () => chatAgents.filter((agent) => agent.enabled && (enabledLLMs.length > 0 || agent.llmId || agent.providerId)),
    [chatAgents, enabledLLMs.length],
  );
  const agentNameById = useMemo(() => new Map(chatAgents.map((agent) => [agent.id, agent.name])), [chatAgents]);
  const llmNameById = useMemo(() => new Map(llms.map((llm) => [llm.id, llm.title || llm.model])), [llms]);

  return {
    agentNameById,
    chatAgents,
    defaultAgent: enabledChatAgents[0],
    defaultLLM: enabledLLMs[0],
    enabledChatAgents,
    enabledLLMs,
    isLoading,
    llmNameById,
    llms,
    shouldShowAgentSelector: enabledChatAgents.length > 1,
    shouldShowLLMSelector: enabledLLMs.length > 1,
  };
};
