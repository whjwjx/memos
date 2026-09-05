import { create } from "@bufbuild/protobuf";
import { isEqual } from "lodash-es";
import { MoreVerticalIcon, PlusIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { aiServiceClient } from "@/connect";
import { useInstance } from "@/contexts/InstanceContext";
import { TestAIProviderRequestSchema } from "@/types/proto/api/v1/ai_service_pb";
import { InstanceSetting_AIProviderType } from "@/types/proto/api/v1/instance_service_pb";
import { useTranslate } from "@/utils/i18n";
import { AgentsPanel } from "./ai-settings/AgentsPanel";
import { AISettingsOverviewPanel } from "./ai-settings/AISettingsOverviewPanel";
import { AISettingsTabs, type AISettingsVisiblePanel } from "./ai-settings/AISettingsTabs";
import { newAgent, newChatAgent, newLLM, newMemoryEntry, newProvider, newTagger } from "./ai-settings/aiSettingFactories";
import {
  createEmptyTranscriptionConfig,
  createEmptyTranslationConfig,
  deriveLLMsFromLegacy,
  toLocalAgent,
  toLocalChatAgent,
  toLocalMemory,
  toLocalProvider,
  toLocalTagger,
  toLocalTool,
  toLocalTranscription,
  toLocalTranslation,
  toTranscriptionConfig,
  toTranslationConfig,
} from "./ai-settings/aiSettingMapper";
import { ChatToolsPanel } from "./ai-settings/ChatToolsPanel";
import { ChatAgentDialog } from "./ai-settings/dialogs/ChatAgentDialog";
import { LLMDialog } from "./ai-settings/dialogs/LLMDialog";
import { ProviderDialog } from "./ai-settings/dialogs/ProviderDialog";
import { LLMsPanel } from "./ai-settings/LLMsPanel";
import { MemoryPanel } from "./ai-settings/MemoryPanel";
import { type AISettingPatch, saveAISettingPatch } from "./ai-settings/saveAISettingPatch";
import { TranslationPanel } from "./ai-settings/TranslationPanel";
import { toolRegistry } from "./ai-settings/toolRegistry";
import type {
  AISettingsPanel,
  ChatAgentTemplate,
  LocalAgent,
  LocalAIProvider,
  LocalChatAgent,
  LocalLLM,
  LocalMemory,
  LocalTagger,
  LocalTool,
  LocalTranscription,
  LocalTranslation,
} from "./ai-settings/types";
import SettingGroup from "./SettingGroup";
import SettingSection from "./SettingSection";
import SettingTable from "./SettingTable";
import useInstanceSettingUpdater from "./useInstanceSettingUpdater";

const AISection = () => {
  const t = useTranslate();
  const saveInstanceSetting = useInstanceSettingUpdater();
  const { aiSetting: originalSetting } = useInstance();

  // Built-in conversational assistant templates. Admin clicks "add from template"
  // to seed a ChatAgentConfig draft; the resulting entry is indistinguishable from
  // a user-created one (builtin is informational for the multi-preset selector in a
  // later stage).
  const chatAgentTemplates: ChatAgentTemplate[] = [
    {
      name: t("setting.ai.agent-template-general"),
      systemPrompt: t("setting.ai.agent-template-general-prompt"),
    },
    {
      name: t("setting.ai.agent-template-requirements"),
      systemPrompt: t("setting.ai.agent-template-requirements-prompt"),
    },
  ];
  const [providers, setProviders] = useState<LocalAIProvider[]>(() => originalSetting.providers.map(toLocalProvider));
  const [llms, setLlms] = useState<LocalLLM[]>(() => {
    const initialProviders = originalSetting.providers.map(toLocalProvider);
    return deriveLLMsFromLegacy(originalSetting.llms, initialProviders, originalSetting.chatAgents, originalSetting.translation);
  });
  const [transcription, setTranscription] = useState<LocalTranscription>(() => toLocalTranscription(originalSetting.transcription));
  const [translation, setTranslation] = useState<LocalTranslation>(() => {
    const initialProviders = originalSetting.providers.map(toLocalProvider);
    const initialLLMs = deriveLLMsFromLegacy(
      originalSetting.llms,
      initialProviders,
      originalSetting.chatAgents,
      originalSetting.translation,
    );
    return toLocalTranslation(originalSetting.translation, initialLLMs, initialProviders);
  });
  const [agents, setAgents] = useState<LocalAgent[]>(() => originalSetting.agents.map(toLocalAgent));
  const [taggers, setTaggers] = useState<LocalTagger[]>(() => originalSetting.taggers.map(toLocalTagger));
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
  const [tools, setTools] = useState<LocalTool[]>(() =>
    toolRegistry.map((tool) => toLocalTool(tool.name, originalSetting.tools[tool.name])),
  );
  const [memory, setMemory] = useState<LocalMemory>(() => toLocalMemory(originalSetting.memory));
  const [editingProvider, setEditingProvider] = useState<LocalAIProvider | undefined>();
  const [deleteTarget, setDeleteTarget] = useState<LocalAIProvider | undefined>();
  const [editingLLM, setEditingLLM] = useState<LocalLLM | undefined>();
  const [deleteLLMTarget, setDeleteLLMTarget] = useState<LocalLLM | undefined>();
  const [editingAgent, setEditingAgent] = useState<LocalAgent | undefined>();
  const [deleteAgentTarget, setDeleteAgentTarget] = useState<LocalAgent | undefined>();
  const [editingTagger, setEditingTagger] = useState<LocalTagger | undefined>();
  const [deleteTaggerTarget, setDeleteTaggerTarget] = useState<LocalTagger | undefined>();
  const [activePanel, setActivePanel] = useState<AISettingsPanel>("overview");

  useEffect(() => {
    setProviders(originalSetting.providers.map(toLocalProvider));
  }, [originalSetting.providers]);

  useEffect(() => {
    const nextProviders = originalSetting.providers.map(toLocalProvider);
    setLlms(deriveLLMsFromLegacy(originalSetting.llms, nextProviders, originalSetting.chatAgents, originalSetting.translation));
  }, [originalSetting.llms, originalSetting.providers, originalSetting.chatAgents, originalSetting.translation]);

  useEffect(() => {
    setAgents(originalSetting.agents.map(toLocalAgent));
  }, [originalSetting.agents]);

  useEffect(() => {
    setTaggers(originalSetting.taggers.map(toLocalTagger));
  }, [originalSetting.taggers]);

  useEffect(() => {
    const nextProviders = originalSetting.providers.map(toLocalProvider);
    const nextLLMs = deriveLLMsFromLegacy(originalSetting.llms, nextProviders, originalSetting.chatAgents, originalSetting.translation);
    setChatAgents(originalSetting.chatAgents.map((agent) => toLocalChatAgent(agent, nextLLMs, nextProviders)));
  }, [originalSetting.chatAgents, originalSetting.llms, originalSetting.providers, originalSetting.translation]);

  useEffect(() => {
    setTools(toolRegistry.map((tool) => toLocalTool(tool.name, originalSetting.tools[tool.name])));
  }, [originalSetting.tools]);

  // Only re-sync the memory draft when the server-side content actually changes
  // (mirrors the transcription draft pattern above).
  const lastSyncedMemory = useRef<LocalMemory>(toLocalMemory(originalSetting.memory));
  useEffect(() => {
    const next = toLocalMemory(originalSetting.memory);
    if (!isEqual(lastSyncedMemory.current, next)) {
      setMemory(next);
      lastSyncedMemory.current = next;
    }
  }, [originalSetting.memory]);

  const originalMemory = useMemo(() => toLocalMemory(originalSetting.memory), [originalSetting.memory]);
  const memoryHasChanges = !isEqual(memory, originalMemory);

  // Only re-sync the transcription draft when the server-side content actually
  // changes — not on every originalSetting identity change. This prevents
  // provider-side saves (which keep transcription unchanged on the server) from
  // wiping an in-progress transcription draft.
  const lastSyncedTranscription = useRef<LocalTranscription>(toLocalTranscription(originalSetting.transcription));
  useEffect(() => {
    const next = toLocalTranscription(originalSetting.transcription);
    if (!isEqual(lastSyncedTranscription.current, next)) {
      setTranscription(next);
      lastSyncedTranscription.current = next;
    }
  }, [originalSetting.transcription]);

  const originalTranscription = useMemo(() => toLocalTranscription(originalSetting.transcription), [originalSetting.transcription]);
  const transcriptionHasChanges = !isEqual(transcription, originalTranscription);

  const transcriptionProviderRef = useMemo(
    () => providers.find((provider) => provider.id === transcription.providerId),
    [providers, transcription.providerId],
  );

  const lastSyncedTranslation = useRef<LocalTranslation>(toLocalTranslation(originalSetting.translation));
  useEffect(() => {
    const next = toLocalTranslation(originalSetting.translation, llms, providers);
    if (!isEqual(lastSyncedTranslation.current, next)) {
      setTranslation(next);
      lastSyncedTranslation.current = next;
    }
  }, [originalSetting.translation, llms, providers]);

  const originalTranslation = useMemo(
    () => toLocalTranslation(originalSetting.translation, llms, providers),
    [originalSetting.translation, llms, providers],
  );
  const translationHasChanges = !isEqual(translation, originalTranslation);

  const llmsByID = useMemo(() => new Map(llms.map((llm) => [llm.id, llm])), [llms]);
  const getLLMLabel = (llmId: string) => {
    const llm = llmsByID.get(llmId);
    if (!llm) return "-";
    const provider = providers.find((item) => item.id === llm.providerId);
    return `${llm.title || llm.model} · ${provider?.title || llm.providerId}`;
  };
  const translationLLMRef = useMemo(() => llms.find((llm) => llm.id === translation.llmId), [llms, translation.llmId]);

  const savePatch = (patch: AISettingPatch, errorContext: string) =>
    saveAISettingPatch({
      errorContext,
      originalSetting,
      patch,
      saveInstanceSetting,
    });

  const handleCreateProvider = () => {
    setEditingProvider(newProvider());
  };

  const handleEditProvider = (provider: LocalAIProvider) => {
    setEditingProvider({ ...provider, apiKey: "" });
  };

  const handleSaveProvider = async (provider: LocalAIProvider) => {
    const title = provider.title.trim();
    const endpoint = provider.endpoint.trim();

    if (!title) {
      toast.error(t("setting.ai.provider-title-required"));
      return;
    }
    if (!provider.apiKeySet && !provider.apiKey.trim()) {
      toast.error(t("setting.ai.api-key-required"));
      return;
    }

    const normalizedProvider = { ...provider, title, endpoint };
    const exists = providers.some((item) => item.id === normalizedProvider.id);
    const nextProviders = exists
      ? providers.map((item) => (item.id === normalizedProvider.id ? normalizedProvider : item))
      : [...providers, normalizedProvider];

    const ok = await savePatch({ providers: nextProviders }, "Update AI provider");
    if (!ok) return;
    setProviders(nextProviders);
    setEditingProvider(undefined);
  };

  const handleDeleteProvider = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    const nextProviders = providers.filter((provider) => provider.id !== target.id);
    const removedLLMIds = new Set(llms.filter((llm) => llm.providerId === target.id).map((llm) => llm.id));
    const nextLLMs = llms.filter((llm) => llm.providerId !== target.id);
    const nextChatAgents = chatAgents.map((agent) =>
      agent.providerId === target.id || removedLLMIds.has(agent.llmId)
        ? { ...agent, enabled: false, llmId: "", providerId: "", model: "" }
        : agent,
    );

    // If the persisted transcription references the deleted provider, the
    // server would reject the save (provider_id must reference an existing
    // provider). Send a cleared transcription in that case.
    const persistedTranscription = originalSetting.transcription;
    const nextTranscription =
      persistedTranscription && persistedTranscription.providerId === target.id ? createEmptyTranscriptionConfig() : persistedTranscription;
    const persistedTranslation = originalSetting.translation;
    const nextTranslation =
      persistedTranslation && (persistedTranslation.providerId === target.id || removedLLMIds.has(persistedTranslation.llmId))
        ? createEmptyTranslationConfig()
        : persistedTranslation;

    const ok = await savePatch(
      {
        providers: nextProviders,
        transcription: nextTranscription,
        chatAgents: nextChatAgents,
        translation: nextTranslation,
        llms: nextLLMs,
      },
      "Delete AI provider",
    );
    if (!ok) return;
    setProviders(nextProviders);
    setLlms(nextLLMs);
    setChatAgents(nextChatAgents);
    if (transcription.providerId === target.id) {
      setTranscription((prev) => ({ ...prev, providerId: "" }));
    }
    if (translation.providerId === target.id || removedLLMIds.has(translation.llmId)) {
      setTranslation((prev) => ({ ...prev, enabled: false, llmId: "", providerId: "", model: "" }));
    }
    setDeleteTarget(undefined);
  };

  const handleCreateLLM = () => {
    setEditingLLM(newLLM(providers));
  };

  const handleEditLLM = (llm: LocalLLM) => {
    setEditingLLM({ ...llm });
  };

  const handleSaveLLM = async (llm: LocalLLM) => {
    const title = llm.title.trim();
    const model = llm.model.trim();
    if (!title) {
      toast.error(t("setting.ai.llm-title-required"));
      return;
    }
    if (!llm.providerId) {
      toast.error(t("setting.ai.llm-provider-required"));
      return;
    }
    if (!providers.some((provider) => provider.id === llm.providerId)) {
      toast.error(t("setting.ai.llm-provider-missing"));
      return;
    }
    if (!model) {
      toast.error(t("setting.ai.llm-model-required"));
      return;
    }

    const normalizedLLM = { ...llm, title, model };
    const exists = llms.some((item) => item.id === normalizedLLM.id);
    const nextLLMs = exists ? llms.map((item) => (item.id === normalizedLLM.id ? normalizedLLM : item)) : [...llms, normalizedLLM];

    const ok = await savePatch({ llms: nextLLMs }, "Update LLM");
    if (!ok) return;
    setLlms(nextLLMs);
    setEditingLLM(undefined);
  };

  const handleToggleLLM = async (llm: LocalLLM) => {
    if (
      llm.enabled &&
      (chatAgents.some((agent) => agent.enabled && agent.llmId === llm.id) || (translation.enabled && translation.llmId === llm.id))
    ) {
      toast.error(t("setting.ai.llm-in-use"));
      return;
    }

    const nextLLMs = llms.map((item) => (item.id === llm.id ? { ...item, enabled: !item.enabled } : item));
    const ok = await savePatch({ llms: nextLLMs }, "Toggle LLM");
    if (!ok) return;
    setLlms(nextLLMs);
  };

  const handleDeleteLLM = async () => {
    if (!deleteLLMTarget) return;
    const target = deleteLLMTarget;
    const nextLLMs = llms.filter((llm) => llm.id !== target.id);
    const nextChatAgents = chatAgents.map((agent) =>
      agent.llmId === target.id ? { ...agent, enabled: false, llmId: "", providerId: "", model: "" } : agent,
    );
    const persistedTranslation = originalSetting.translation;
    const nextTranslation =
      persistedTranslation &&
      (persistedTranslation.llmId === target.id ||
        (persistedTranslation.providerId === target.providerId && persistedTranslation.model === target.model))
        ? createEmptyTranslationConfig()
        : persistedTranslation;

    const ok = await savePatch({ chatAgents: nextChatAgents, translation: nextTranslation, llms: nextLLMs }, "Delete LLM");
    if (!ok) return;
    setLlms(nextLLMs);
    setChatAgents(nextChatAgents);
    if (translation.llmId === target.id) {
      setTranslation((prev) => ({ ...prev, enabled: false, llmId: "", providerId: "", model: "" }));
    }
    setDeleteLLMTarget(undefined);
  };

  const handleSaveTranscription = async () => {
    if (transcription.providerId && !transcriptionProviderRef) {
      toast.error(t("setting.ai.transcription-empty-providers"));
      return;
    }
    await savePatch({ transcription: toTranscriptionConfig(transcription) }, "Update transcription");
  };

  const handleSaveTranslation = async () => {
    if (translation.enabled && !translation.llmId) {
      toast.error(t("setting.ai.translation-llm-required"));
      return;
    }
    if (translation.llmId && !translationLLMRef) {
      toast.error(t("setting.ai.translation-empty-llms"));
      return;
    }
    if (translation.enabled && translationLLMRef && !translationLLMRef.enabled) {
      toast.error(t("setting.ai.translation-llm-disabled"));
      return;
    }
    const normalized = {
      ...translation,
      providerId: translationLLMRef?.providerId ?? "",
      model: translationLLMRef?.model ?? "",
      maxTextLength: Math.min(100000, Math.max(1, Math.trunc(translation.maxTextLength || 5000))),
    };
    const ok = await savePatch({ translation: toTranslationConfig(normalized) }, "Update translation");
    if (!ok) return;
    setTranslation(normalized);
    lastSyncedTranslation.current = normalized;
  };

  const handleCreateAgent = () => {
    setEditingAgent(newAgent());
  };

  const handleEditAgent = (agent: LocalAgent) => {
    setEditingAgent({ ...agent });
  };

  const handleSaveAgent = async (agent: LocalAgent) => {
    const name = agent.name.trim();
    const enabled = agent.enabled;

    if (!name) {
      toast.error(t("setting.ai.agent-name-required"));
      return;
    }
    if (enabled && !agent.providerId) {
      toast.error(t("setting.ai.agent-provider-required"));
      return;
    }

    const normalizedAgent = { ...agent, name };
    const exists = agents.some((item) => item.id === normalizedAgent.id);
    const nextAgents = exists
      ? agents.map((item) => (item.id === normalizedAgent.id ? normalizedAgent : item))
      : [...agents, normalizedAgent];

    const ok = await savePatch({ agents: nextAgents }, "Update AI agent");
    if (!ok) return;
    setAgents(nextAgents);
    setEditingAgent(undefined);
  };

  const handleToggleAgent = async (agent: LocalAgent) => {
    const nextAgents = agents.map((item) => (item.id === agent.id ? { ...item, enabled: !item.enabled } : item));
    const ok = await savePatch({ agents: nextAgents }, "Toggle AI agent");
    if (!ok) return;
    setAgents(nextAgents);
  };

  const handleDeleteAgent = async () => {
    if (!deleteAgentTarget) return;
    const target = deleteAgentTarget;
    const nextAgents = agents.filter((agent) => agent.id !== target.id);
    const ok = await savePatch({ agents: nextAgents }, "Delete AI agent");
    if (!ok) return;
    setAgents(nextAgents);
    setDeleteAgentTarget(undefined);
  };

  const handleCreateTagger = () => {
    setEditingTagger(newTagger());
  };

  const handleEditTagger = (tagger: LocalTagger) => {
    setEditingTagger({ ...tagger });
  };

  const handleSaveTagger = async (tagger: LocalTagger) => {
    const name = tagger.name.trim();
    const enabled = tagger.enabled;

    if (!name) {
      toast.error(t("setting.ai.tagger-name-required"));
      return;
    }
    if (enabled && !tagger.providerId) {
      toast.error(t("setting.ai.tagger-provider-required"));
      return;
    }

    const normalizedTagger = { ...tagger, name };
    const exists = taggers.some((item) => item.id === normalizedTagger.id);
    const nextTaggers = exists
      ? taggers.map((item) => (item.id === normalizedTagger.id ? normalizedTagger : item))
      : [...taggers, normalizedTagger];

    const ok = await savePatch({ taggers: nextTaggers }, "Update AI tagger");
    if (!ok) return;
    setTaggers(nextTaggers);
    setEditingTagger(undefined);
  };

  const handleToggleTagger = async (tagger: LocalTagger) => {
    const nextTaggers = taggers.map((item) => (item.id === tagger.id ? { ...item, enabled: !item.enabled } : item));
    const ok = await savePatch({ taggers: nextTaggers }, "Toggle AI tagger");
    if (!ok) return;
    setTaggers(nextTaggers);
  };

  const handleDeleteTagger = async () => {
    if (!deleteTaggerTarget) return;
    const target = deleteTaggerTarget;
    const nextTaggers = taggers.filter((tagger) => tagger.id !== target.id);
    const ok = await savePatch({ taggers: nextTaggers }, "Delete AI tagger");
    if (!ok) return;
    setTaggers(nextTaggers);
    setDeleteTaggerTarget(undefined);
  };

  const [editingChatAgent, setEditingChatAgent] = useState<LocalChatAgent | undefined>();
  const [deleteChatAgentTarget, setDeleteChatAgentTarget] = useState<LocalChatAgent | undefined>();

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

  const handleToggleTool = async (tool: LocalTool) => {
    const nextTools = tools.map((item) => (item.name === tool.name ? { ...item, enabled: !item.enabled } : item));
    const ok = await savePatch({ tools: nextTools }, "Toggle chat tool");
    if (!ok) return;
    setTools(nextTools);
  };

  const handleToggleToolConfirmation = async (tool: LocalTool) => {
    const nextTools = tools.map((item) => (item.name === tool.name ? { ...item, requiresConfirmation: !item.requiresConfirmation } : item));
    const ok = await savePatch({ tools: nextTools }, "Toggle chat tool confirmation");
    if (!ok) return;
    setTools(nextTools);
  };

  const handleToggleMemoryEnabled = () => {
    setMemory((prev) => ({ ...prev, enabled: !prev.enabled }));
  };

  const handleAddMemoryEntry = () => {
    setMemory((prev) => ({ ...prev, entries: [...prev.entries, newMemoryEntry()] }));
  };

  const handleUpdateMemoryEntry = (id: string, content: string) => {
    setMemory((prev) => ({
      ...prev,
      entries: prev.entries.map((entry) => (entry.id === id ? { ...entry, content } : entry)),
    }));
  };

  const handleDeleteMemoryEntry = (id: string) => {
    setMemory((prev) => ({ ...prev, entries: prev.entries.filter((entry) => entry.id !== id) }));
  };

  const handleSaveMemory = async () => {
    const ok = await savePatch({ memory }, "Update memory");
    if (!ok) return;
    lastSyncedMemory.current = memory;
  };

  const visiblePanels: { key: AISettingsVisiblePanel; label: string }[] = [
    { key: "overview", label: t("setting.ai.overview-tab") },
    { key: "llms", label: t("setting.ai.llms-tab") },
    { key: "agents", label: t("setting.ai.agents-tab") },
    { key: "tools", label: t("setting.ai.tools-tab") },
    { key: "translation", label: t("setting.ai.translation-tab") },
    { key: "memory", label: t("setting.ai.memory-tab") },
  ];
  const enabledLLMCount = llms.filter((llm) => llm.enabled).length;
  const enabledChatAgentCount = chatAgents.filter((agent) => agent.enabled).length;
  const enabledToolCount = tools.filter((tool) => tool.enabled).length;
  const showLegacyPanels = activePanel === "legacy";

  return (
    <SettingSection title={t("setting.ai.label")}>
      <AISettingsTabs activePanel={activePanel} panels={visiblePanels} onSelect={setActivePanel} />

      {activePanel === "overview" && (
        <AISettingsOverviewPanel
          enabledChatAgentCount={enabledChatAgentCount}
          enabledLLMCount={enabledLLMCount}
          enabledToolCount={enabledToolCount}
          llmCount={llms.length}
          memoryEnabled={memory.enabled}
          memoryEntryCount={memory.entries.length}
          translationEnabled={translation.enabled}
          translationLLMLabel={translation.llmId ? getLLMLabel(translation.llmId) : t("setting.ai.translation-no-llm")}
        />
      )}

      {activePanel === "llms" && (
        <LLMsPanel
          providers={providers}
          llms={llms}
          onCreateProvider={handleCreateProvider}
          onEditProvider={handleEditProvider}
          onDeleteProvider={setDeleteTarget}
          onCreateLLM={handleCreateLLM}
          onEditLLM={handleEditLLM}
          onToggleLLM={handleToggleLLM}
          onDeleteLLM={setDeleteLLMTarget}
        />
      )}

      {showLegacyPanels && (
        <SettingGroup
          title={t("setting.ai.transcription-title")}
          description={t("setting.ai.transcription-description")}
          showSeparator
          actions={
            <Button disabled={!transcriptionHasChanges} onClick={handleSaveTranscription}>
              {t("common.save")}
            </Button>
          }
        >
          <TranscriptionForm
            providers={providers}
            transcription={transcription}
            onChange={setTranscription}
            referencedProvider={transcriptionProviderRef}
          />
        </SettingGroup>
      )}

      {activePanel === "translation" && (
        <TranslationPanel
          llms={llms}
          providers={providers}
          translation={translation}
          translationHasChanges={translationHasChanges}
          onChange={setTranslation}
          onSave={handleSaveTranslation}
        />
      )}

      {showLegacyPanels && (
        <SettingGroup
          title={t("setting.ai.agents-title")}
          description={t("setting.ai.agents-description")}
          showSeparator
          actions={
            <Button onClick={handleCreateAgent}>
              <PlusIcon className="w-4 h-4 mr-2" />
              {t("setting.ai.add-agent")}
            </Button>
          }
        >
          <SettingTable
            columns={[
              {
                key: "name",
                header: t("common.name"),
                render: (_, agent: LocalAgent) => (
                  <div className="flex flex-col gap-0.5">
                    <span className="text-foreground">{agent.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{agent.id}</span>
                  </div>
                ),
              },
              {
                key: "providerId",
                header: t("setting.ai.agent-provider"),
                render: (_, agent: LocalAgent) => {
                  const provider = providers.find((item) => item.id === agent.providerId);
                  return <span>{provider ? provider.title || provider.id : "-"}</span>;
                },
              },
              {
                key: "enabled",
                header: t("setting.ai.agent-enabled"),
                render: (_, agent: LocalAgent) => (
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={agent.enabled}
                    onChange={() => handleToggleAgent(agent)}
                    aria-label={t("setting.ai.agent-toggle-aria", { name: agent.name })}
                  />
                ),
              },
              {
                key: "actions",
                header: "",
                className: "text-right",
                render: (_, agent: LocalAgent) => (
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
                      <MoreVerticalIcon className="w-4 h-auto" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" sideOffset={2}>
                      <DropdownMenuItem onClick={() => handleEditAgent(agent)}>{t("common.edit")}</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setDeleteAgentTarget(agent)} className="text-destructive focus:text-destructive">
                        {t("common.delete")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ),
              },
            ]}
            data={agents}
            emptyMessage={t("setting.ai.no-agents")}
            getRowKey={(agent) => agent.id}
          />
        </SettingGroup>
      )}

      {showLegacyPanels && (
        <SettingGroup
          title={t("setting.ai.taggers-title")}
          description={t("setting.ai.taggers-description")}
          showSeparator
          actions={
            <Button onClick={handleCreateTagger}>
              <PlusIcon className="w-4 h-4 mr-2" />
              {t("setting.ai.add-tagger")}
            </Button>
          }
        >
          <SettingTable
            columns={[
              {
                key: "name",
                header: t("common.name"),
                render: (_, tagger: LocalTagger) => (
                  <div className="flex flex-col gap-0.5">
                    <span className="text-foreground">{tagger.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{tagger.id}</span>
                  </div>
                ),
              },
              {
                key: "providerId",
                header: t("setting.ai.tagger-provider"),
                render: (_, tagger: LocalTagger) => {
                  const provider = providers.find((item) => item.id === tagger.providerId);
                  return <span>{provider ? provider.title || provider.id : "-"}</span>;
                },
              },
              {
                key: "enabled",
                header: t("setting.ai.tagger-enabled"),
                render: (_, tagger: LocalTagger) => (
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={tagger.enabled}
                    onChange={() => handleToggleTagger(tagger)}
                    aria-label={t("setting.ai.tagger-toggle-aria", { name: tagger.name })}
                  />
                ),
              },
              {
                key: "actions",
                header: "",
                className: "text-right",
                render: (_, tagger: LocalTagger) => (
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
                      <MoreVerticalIcon className="w-4 h-auto" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" sideOffset={2}>
                      <DropdownMenuItem onClick={() => handleEditTagger(tagger)}>{t("common.edit")}</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setDeleteTaggerTarget(tagger)} className="text-destructive focus:text-destructive">
                        {t("common.delete")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ),
              },
            ]}
            data={taggers}
            emptyMessage={t("setting.ai.no-taggers")}
            getRowKey={(tagger) => tagger.id}
          />
        </SettingGroup>
      )}

      {activePanel === "agents" && (
        <AgentsPanel
          agents={chatAgents}
          templates={chatAgentTemplates}
          getLLMLabel={getLLMLabel}
          onCreateAgent={handleCreateChatAgent}
          onCreateAgentFromTemplate={handleCreateChatAgentFromTemplate}
          onEditAgent={handleEditChatAgent}
          onToggleAgent={handleToggleChatAgent}
          onDeleteAgent={setDeleteChatAgentTarget}
        />
      )}

      {activePanel === "tools" && (
        <ChatToolsPanel tools={tools} onToggleTool={handleToggleTool} onToggleToolConfirmation={handleToggleToolConfirmation} />
      )}

      {activePanel === "memory" && (
        <MemoryPanel
          memory={memory}
          memoryHasChanges={memoryHasChanges}
          onToggleEnabled={handleToggleMemoryEnabled}
          onAddEntry={handleAddMemoryEntry}
          onUpdateEntry={handleUpdateMemoryEntry}
          onDeleteEntry={handleDeleteMemoryEntry}
          onSave={handleSaveMemory}
        />
      )}

      <ProviderDialog
        provider={editingProvider}
        mode={editingProvider && providers.some((provider) => provider.id === editingProvider.id) ? "edit" : "create"}
        onOpenChange={(open) => !open && setEditingProvider(undefined)}
        onSave={handleSaveProvider}
      />

      <LLMDialog
        llm={editingLLM}
        mode={editingLLM && llms.some((llm) => llm.id === editingLLM.id) ? "edit" : "create"}
        providers={providers}
        onOpenChange={(open) => !open && setEditingLLM(undefined)}
        onSave={handleSaveLLM}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(undefined)}
        title={deleteTarget ? t("setting.ai.delete-provider", { title: deleteTarget.title }) : ""}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        onConfirm={handleDeleteProvider}
        confirmVariant="destructive"
      />

      <ConfirmDialog
        open={!!deleteLLMTarget}
        onOpenChange={(open) => !open && setDeleteLLMTarget(undefined)}
        title={deleteLLMTarget ? t("setting.ai.delete-llm", { title: deleteLLMTarget.title }) : ""}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        onConfirm={handleDeleteLLM}
        confirmVariant="destructive"
      />

      <AIAgentDialog
        agent={editingAgent}
        providers={providers}
        onOpenChange={(open) => !open && setEditingAgent(undefined)}
        onSave={handleSaveAgent}
      />

      <ConfirmDialog
        open={!!deleteAgentTarget}
        onOpenChange={(open) => !open && setDeleteAgentTarget(undefined)}
        title={deleteAgentTarget ? t("setting.ai.delete-agent", { name: deleteAgentTarget.name }) : ""}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        onConfirm={handleDeleteAgent}
        confirmVariant="destructive"
      />

      <AITaggerDialog
        tagger={editingTagger}
        providers={providers}
        onOpenChange={(open) => !open && setEditingTagger(undefined)}
        onSave={handleSaveTagger}
      />

      <ConfirmDialog
        open={!!deleteTaggerTarget}
        onOpenChange={(open) => !open && setDeleteTaggerTarget(undefined)}
        title={deleteTaggerTarget ? t("setting.ai.delete-tagger", { name: deleteTaggerTarget.name }) : ""}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        onConfirm={handleDeleteTagger}
        confirmVariant="destructive"
      />

      <ChatAgentDialog
        agent={editingChatAgent}
        mode={editingChatAgent && chatAgents.some((agent) => agent.id === editingChatAgent.id) ? "edit" : "create"}
        llms={llms}
        providers={providers}
        onOpenChange={(open) => !open && setEditingChatAgent(undefined)}
        onSave={handleSaveChatAgent}
      />

      <ConfirmDialog
        open={!!deleteChatAgentTarget}
        onOpenChange={(open) => !open && setDeleteChatAgentTarget(undefined)}
        title={deleteChatAgentTarget ? t("setting.ai.delete-chat-agent", { name: deleteChatAgentTarget.name }) : ""}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        onConfirm={handleDeleteChatAgent}
        confirmVariant="destructive"
      />
    </SettingSection>
  );
};

interface TranscriptionFormProps {
  providers: LocalAIProvider[];
  transcription: LocalTranscription;
  referencedProvider: LocalAIProvider | undefined;
  onChange: (next: LocalTranscription) => void;
}

const TranscriptionForm = ({ providers, transcription, referencedProvider, onChange }: TranscriptionFormProps) => {
  const t = useTranslate();
  const noProviders = providers.length === 0;

  const providerOptions = useMemo(
    () => [
      { value: "__none__", label: t("setting.ai.transcription-no-provider") },
      ...providers.map((provider) => ({ value: provider.id, label: provider.title || provider.id })),
    ],
    [providers, t],
  );

  const update = (partial: Partial<LocalTranscription>) => {
    onChange({ ...transcription, ...partial });
  };

  const placeholderForProvider = (provider: LocalAIProvider | undefined) => {
    if (!provider) return "";
    return provider.type === InstanceSetting_AIProviderType.GEMINI
      ? t("setting.ai.transcription-model-placeholder-gemini")
      : t("setting.ai.transcription-model-placeholder-openai");
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-3xl">
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label>{t("setting.ai.transcription-provider")}</Label>
        <Select
          value={transcription.providerId || "__none__"}
          items={providerOptions}
          onValueChange={(value) => update({ providerId: value === "__none__" ? "" : value })}
          disabled={noProviders}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {providerOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {noProviders && <p className="text-xs text-muted-foreground">{t("setting.ai.transcription-empty-providers")}</p>}
        {referencedProvider && !referencedProvider.apiKeySet && (
          <p className="text-xs text-destructive">{t("setting.ai.transcription-warning-no-key")}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label>{t("setting.ai.transcription-model")}</Label>
        <Input
          value={transcription.model}
          onChange={(e) => update({ model: e.target.value })}
          placeholder={placeholderForProvider(referencedProvider)}
          disabled={!transcription.providerId}
          maxLength={256}
        />
        <p className="text-xs text-muted-foreground">{t("setting.ai.transcription-model-help")}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{t("setting.ai.transcription-language")}</Label>
        <Input
          value={transcription.language}
          onChange={(e) => update({ language: e.target.value })}
          placeholder={t("setting.ai.transcription-language-placeholder")}
          disabled={!transcription.providerId}
          maxLength={32}
        />
        <p className="text-xs text-muted-foreground">{t("setting.ai.transcription-language-help")}</p>
      </div>

      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label>{t("setting.ai.transcription-prompt")}</Label>
        <Textarea
          value={transcription.prompt}
          onChange={(e) => update({ prompt: e.target.value })}
          placeholder={t("setting.ai.transcription-prompt-placeholder")}
          rows={3}
          disabled={!transcription.providerId}
          maxLength={4096}
        />
        <p className="text-xs text-muted-foreground">{t("setting.ai.transcription-prompt-help")}</p>
      </div>
    </div>
  );
};

interface AIAgentDialogProps {
  agent?: LocalAgent;
  providers: LocalAIProvider[];
  onOpenChange: (open: boolean) => void;
  onSave: (agent: LocalAgent) => void;
}

const AIAgentDialog = ({ agent, providers, onOpenChange, onSave }: AIAgentDialogProps) => {
  const t = useTranslate();
  const [draft, setDraft] = useState<LocalAgent>(() => agent ?? newAgent());
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    setDraft(agent ?? newAgent());
  }, [agent]);

  const updateDraft = (partial: Partial<LocalAgent>) => {
    setDraft((prev) => ({ ...prev, ...partial }));
  };

  const providerOptions = useMemo(
    () => [
      { value: "__none__", label: t("setting.ai.agent-no-provider") },
      ...providers.map((provider) => ({ value: provider.id, label: provider.title || provider.id })),
    ],
    [providers, t],
  );

  const handleSave = () => {
    onSave(draft);
  };

  const referencedProvider = providers.find((item) => item.id === draft.providerId);
  const hasApiKey = !!referencedProvider && (referencedProvider.apiKeySet || referencedProvider.apiKey.trim() !== "");
  const canTest = !!draft.providerId && draft.model.trim() !== "" && hasApiKey;

  const handleTest = async () => {
    if (!canTest) return;
    setTesting(true);
    try {
      const response = await aiServiceClient.testAIProvider(
        create(TestAIProviderRequestSchema, {
          providerId: draft.providerId,
          model: draft.model.trim(),
        }),
      );
      if (response.ok) {
        toast.success(t("setting.ai.test-provider-success", { reply: response.reply || "ok" }));
      } else {
        toast.error(t("setting.ai.test-provider-failed", { error: response.error || "unknown" }));
      }
    } catch (err) {
      toast.error(t("setting.ai.test-provider-failed", { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setTesting(false);
    }
  };

  const placeholderForProvider = (provider: LocalAIProvider | undefined) => {
    if (!provider) return "";
    return provider.type === InstanceSetting_AIProviderType.GEMINI
      ? t("setting.ai.transcription-model-placeholder-gemini")
      : t("setting.ai.transcription-model-placeholder-openai");
  };

  return (
    <Dialog open={!!agent} onOpenChange={onOpenChange}>
      <DialogContent size="2xl">
        <DialogHeader>
          <DialogTitle>{t("setting.ai.edit-agent")}</DialogTitle>
          <DialogDescription>{t("setting.ai.agent-dialog-description")}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>{t("setting.ai.agent-name")}</Label>
            <Input
              value={draft.name}
              onChange={(e) => updateDraft({ name: e.target.value })}
              placeholder={t("setting.ai.agent-name-placeholder")}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t("setting.ai.agent-provider")}</Label>
            <Select
              value={draft.providerId || "__none__"}
              items={providerOptions}
              onValueChange={(value) => updateDraft({ providerId: value === "__none__" ? "" : value })}
              disabled={providers.length === 0}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {providerOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {providers.length === 0 && <p className="text-xs text-muted-foreground">{t("setting.ai.agent-empty-providers")}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t("setting.ai.agent-model")}</Label>
            <Input
              value={draft.model}
              onChange={(e) => updateDraft({ model: e.target.value })}
              placeholder={placeholderForProvider(referencedProvider)}
              disabled={!draft.providerId}
              maxLength={256}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t("setting.ai.agent-delay")}</Label>
            <Input
              type="number"
              min={0}
              value={draft.delayMinutes}
              onChange={(e) => updateDraft({ delayMinutes: Number(e.target.value) || 0 })}
            />
            <p className="text-xs text-muted-foreground">{t("setting.ai.agent-delay-help")}</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t("setting.ai.agent-max-length")}</Label>
            <Input
              type="number"
              min={0}
              value={draft.maxLength}
              onChange={(e) => updateDraft({ maxLength: Number(e.target.value) || 0 })}
            />
            <p className="text-xs text-muted-foreground">{t("setting.ai.agent-max-length-help")}</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t("setting.ai.agent-enabled")}</Label>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={draft.enabled}
                onChange={(e) => updateDraft({ enabled: e.target.checked })}
              />
              <span className="text-xs text-muted-foreground">{t("setting.ai.agent-enabled-help")}</span>
            </div>
          </div>

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>{t("setting.ai.agent-persona")}</Label>
            <Textarea
              value={draft.personaPrompt}
              onChange={(e) => updateDraft({ personaPrompt: e.target.value })}
              placeholder={t("setting.ai.agent-persona-placeholder")}
              rows={3}
              maxLength={4096}
            />
          </div>

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>{t("setting.ai.agent-system")}</Label>
            <Textarea
              value={draft.systemPrompt}
              onChange={(e) => updateDraft({ systemPrompt: e.target.value })}
              placeholder={t("setting.ai.agent-system-placeholder")}
              rows={3}
              maxLength={4096}
            />
            <p className="text-xs text-muted-foreground">{t("setting.ai.agent-system-help")}</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button variant="outline" onClick={handleTest} disabled={!canTest || testing}>
            {testing ? t("setting.ai.test-provider-testing") : t("setting.ai.test-agent")}
          </Button>
          <Button onClick={handleSave}>{t("common.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

interface AITaggerDialogProps {
  tagger?: LocalTagger;
  providers: LocalAIProvider[];
  onOpenChange: (open: boolean) => void;
  onSave: (tagger: LocalTagger) => void;
}

const AITaggerDialog = ({ tagger, providers, onOpenChange, onSave }: AITaggerDialogProps) => {
  const t = useTranslate();
  const [draft, setDraft] = useState<LocalTagger>(() => tagger ?? newTagger());

  useEffect(() => {
    setDraft(tagger ?? newTagger());
  }, [tagger]);

  const updateDraft = (partial: Partial<LocalTagger>) => {
    setDraft((prev) => ({ ...prev, ...partial }));
  };

  const providerOptions = useMemo(
    () => [
      { value: "__none__", label: t("setting.ai.tagger-no-provider") },
      ...providers.map((provider) => ({ value: provider.id, label: provider.title || provider.id })),
    ],
    [providers, t],
  );

  const placeholderForProvider = (provider: LocalAIProvider | undefined) => {
    if (!provider) return "";
    return provider.type === InstanceSetting_AIProviderType.GEMINI
      ? t("setting.ai.transcription-model-placeholder-gemini")
      : t("setting.ai.transcription-model-placeholder-openai");
  };

  const handleSave = () => {
    onSave(draft);
  };

  return (
    <Dialog open={!!tagger} onOpenChange={onOpenChange}>
      <DialogContent size="2xl">
        <DialogHeader>
          <DialogTitle>{t("setting.ai.edit-tagger")}</DialogTitle>
          <DialogDescription>{t("setting.ai.tagger-dialog-description")}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>{t("setting.ai.tagger-name")}</Label>
            <Input
              value={draft.name}
              onChange={(e) => updateDraft({ name: e.target.value })}
              placeholder={t("setting.ai.tagger-name-placeholder")}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t("setting.ai.tagger-provider")}</Label>
            <Select
              value={draft.providerId || "__none__"}
              items={providerOptions}
              onValueChange={(value) => updateDraft({ providerId: value === "__none__" ? "" : value })}
              disabled={providers.length === 0}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {providerOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {providers.length === 0 && <p className="text-xs text-muted-foreground">{t("setting.ai.tagger-empty-providers")}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t("setting.ai.tagger-model")}</Label>
            <Input
              value={draft.model}
              onChange={(e) => updateDraft({ model: e.target.value })}
              placeholder={placeholderForProvider(providers.find((item) => item.id === draft.providerId))}
              disabled={!draft.providerId}
              maxLength={256}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t("setting.ai.tagger-max-tags")}</Label>
            <Input type="number" min={0} value={draft.maxTags} onChange={(e) => updateDraft({ maxTags: Number(e.target.value) || 0 })} />
            <p className="text-xs text-muted-foreground">{t("setting.ai.tagger-max-tags-help")}</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t("setting.ai.tagger-enabled")}</Label>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={draft.enabled}
                onChange={(e) => updateDraft({ enabled: e.target.checked })}
              />
              <span className="text-xs text-muted-foreground">{t("setting.ai.tagger-enabled-help")}</span>
            </div>
          </div>

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>{t("setting.ai.tagger-prompt")}</Label>
            <Textarea
              value={draft.prompt}
              onChange={(e) => updateDraft({ prompt: e.target.value })}
              placeholder={t("setting.ai.tagger-prompt-placeholder")}
              rows={6}
              maxLength={4096}
            />
            <p className="text-xs text-muted-foreground">{t("setting.ai.tagger-prompt-help")}</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSave}>{t("common.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AISection;
