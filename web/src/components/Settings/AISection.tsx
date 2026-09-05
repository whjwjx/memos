import { useEffect, useMemo, useState } from "react";
import { toast } from "react-hot-toast";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useInstance } from "@/contexts/InstanceContext";
import { useTranslate } from "@/utils/i18n";
import { AgentsPanel } from "./ai-settings/AgentsPanel";
import { AISettingsOverviewPanel } from "./ai-settings/AISettingsOverviewPanel";
import { AISettingsTabs, type AISettingsVisiblePanel } from "./ai-settings/AISettingsTabs";
import { newLLM, newProvider } from "./ai-settings/aiSettingFactories";
import { createEmptyTranslationConfig, deriveLLMsFromLegacy, toLocalProvider } from "./ai-settings/aiSettingMapper";
import { ChatToolsPanel } from "./ai-settings/ChatToolsPanel";
import { ChatAgentDialog } from "./ai-settings/dialogs/ChatAgentDialog";
import { LLMDialog } from "./ai-settings/dialogs/LLMDialog";
import { ProviderDialog } from "./ai-settings/dialogs/ProviderDialog";
import { useAIChatAgents } from "./ai-settings/hooks/useAIChatAgents";
import { useAIMemorySettings } from "./ai-settings/hooks/useAIMemorySettings";
import { useAIToolsSettings } from "./ai-settings/hooks/useAIToolsSettings";
import { useAITranslationSettings } from "./ai-settings/hooks/useAITranslationSettings";
import { LLMsPanel } from "./ai-settings/LLMsPanel";
import { MemoryPanel } from "./ai-settings/MemoryPanel";
import { type AISettingPatch, saveAISettingPatch } from "./ai-settings/saveAISettingPatch";
import { TranslationPanel } from "./ai-settings/TranslationPanel";
import type { AISettingsPanel, ChatAgentTemplate, LocalAIProvider, LocalLLM } from "./ai-settings/types";
import SettingSection from "./SettingSection";
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
  const [editingProvider, setEditingProvider] = useState<LocalAIProvider | undefined>();
  const [deleteTarget, setDeleteTarget] = useState<LocalAIProvider | undefined>();
  const [editingLLM, setEditingLLM] = useState<LocalLLM | undefined>();
  const [deleteLLMTarget, setDeleteLLMTarget] = useState<LocalLLM | undefined>();
  const [activePanel, setActivePanel] = useState<AISettingsPanel>("overview");

  useEffect(() => {
    setProviders(originalSetting.providers.map(toLocalProvider));
  }, [originalSetting.providers]);

  useEffect(() => {
    const nextProviders = originalSetting.providers.map(toLocalProvider);
    setLlms(deriveLLMsFromLegacy(originalSetting.llms, nextProviders, originalSetting.chatAgents, originalSetting.translation));
  }, [originalSetting.llms, originalSetting.providers, originalSetting.chatAgents, originalSetting.translation]);

  const llmsByID = useMemo(() => new Map(llms.map((llm) => [llm.id, llm])), [llms]);
  const getLLMLabel = (llmId: string) => {
    const llm = llmsByID.get(llmId);
    if (!llm) return "-";
    const provider = providers.find((item) => item.id === llm.providerId);
    return `${llm.title || llm.model} · ${provider?.title || llm.providerId}`;
  };
  const savePatch = (patch: AISettingPatch, errorContext: string) =>
    saveAISettingPatch({
      errorContext,
      originalSetting,
      patch,
      saveInstanceSetting,
    });

  const { translation, setTranslation, translationHasChanges, handleSaveTranslation } = useAITranslationSettings({
    originalSetting,
    providers,
    llms,
    savePatch,
  });
  const {
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
  } = useAIChatAgents({
    originalSetting,
    llms,
    llmsByID,
    savePatch,
  });
  const { tools, handleToggleTool, handleToggleToolConfirmation } = useAIToolsSettings({ originalSetting, savePatch });
  const {
    memory,
    memoryHasChanges,
    handleToggleMemoryEnabled,
    handleAddMemoryEntry,
    handleUpdateMemoryEntry,
    handleDeleteMemoryEntry,
    handleSaveMemory,
  } = useAIMemorySettings({ originalSetting, savePatch });

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

    const persistedTranslation = originalSetting.translation;
    const nextTranslation =
      persistedTranslation && (persistedTranslation.providerId === target.id || removedLLMIds.has(persistedTranslation.llmId))
        ? createEmptyTranslationConfig()
        : persistedTranslation;

    const ok = await savePatch(
      {
        providers: nextProviders,
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

export default AISection;
