import { create } from "@bufbuild/protobuf";
import { isEqual } from "lodash-es";
import { MoreVerticalIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { v4 as uuidv4 } from "uuid";
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
import {
  InstanceSetting_AgentConfig,
  InstanceSetting_AgentConfigSchema,
  InstanceSetting_AIProviderConfig,
  InstanceSetting_AIProviderConfigSchema,
  InstanceSetting_AIProviderType,
  InstanceSetting_AISettingSchema,
  InstanceSetting_ChatAgentConfig,
  InstanceSetting_ChatAgentConfigSchema,
  InstanceSetting_Key,
  InstanceSetting_MemoryConfig,
  InstanceSetting_MemoryConfigSchema,
  InstanceSetting_MemoryEntry,
  InstanceSetting_MemoryEntrySchema,
  InstanceSetting_TaggerConfig,
  InstanceSetting_TaggerConfigSchema,
  InstanceSetting_ToolConfig,
  InstanceSetting_ToolConfigSchema,
  InstanceSetting_TranscriptionConfig,
  InstanceSetting_TranscriptionConfigSchema,
  InstanceSettingSchema,
} from "@/types/proto/api/v1/instance_service_pb";
import { useTranslate } from "@/utils/i18n";
import SettingGroup from "./SettingGroup";
import { SettingPanel } from "./SettingList";
import SettingSection from "./SettingSection";
import SettingTable from "./SettingTable";
import useInstanceSettingUpdater, { buildInstanceSettingName } from "./useInstanceSettingUpdater";

type LocalAIProvider = {
  id: string;
  title: string;
  type: InstanceSetting_AIProviderType;
  endpoint: string;
  apiKey: string;
  apiKeySet: boolean;
  apiKeyHint: string;
};

type LocalTranscription = {
  providerId: string;
  model: string;
  language: string;
  prompt: string;
};

const providerTypeOptions = [InstanceSetting_AIProviderType.OPENAI, InstanceSetting_AIProviderType.GEMINI];

const byokNotes = ["setting.ai.byok-key-note", "setting.ai.byok-storage-note", "setting.ai.byok-model-note"] as const;

const getProviderTypeLabel = (type: InstanceSetting_AIProviderType) => {
  return InstanceSetting_AIProviderType[type] ?? "UNKNOWN";
};

const providerTypeSelectOptions = providerTypeOptions.map((type) => ({ value: String(type), label: getProviderTypeLabel(type) }));

const toLocalProvider = (provider: InstanceSetting_AIProviderConfig): LocalAIProvider => ({
  id: provider.id,
  title: provider.title,
  type: provider.type,
  endpoint: provider.endpoint,
  apiKey: "",
  apiKeySet: provider.apiKeySet,
  apiKeyHint: provider.apiKeyHint,
});

const toLocalTranscription = (config: InstanceSetting_TranscriptionConfig | undefined): LocalTranscription => ({
  providerId: config?.providerId ?? "",
  model: config?.model ?? "",
  language: config?.language ?? "",
  prompt: config?.prompt ?? "",
});

const newProvider = (): LocalAIProvider => ({
  id: uuidv4(),
  title: "",
  type: InstanceSetting_AIProviderType.OPENAI,
  endpoint: "",
  apiKey: "",
  apiKeySet: false,
  apiKeyHint: "",
});

type LocalAgent = {
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

const toLocalAgent = (agent: InstanceSetting_AgentConfig): LocalAgent => ({
  id: agent.id,
  name: agent.name,
  providerId: agent.providerId,
  model: agent.model,
  personaPrompt: agent.personaPrompt,
  systemPrompt: agent.systemPrompt,
  enabled: agent.enabled,
  delayMinutes: agent.delayMinutes,
  maxLength: agent.maxLength,
});

const newAgent = (): LocalAgent => ({
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

const toAgentConfig = (agent: LocalAgent) =>
  create(InstanceSetting_AgentConfigSchema, {
    id: agent.id,
    name: agent.name.trim(),
    providerId: agent.providerId,
    model: agent.model.trim(),
    personaPrompt: agent.personaPrompt,
    systemPrompt: agent.systemPrompt,
    enabled: agent.enabled,
    delayMinutes: agent.delayMinutes,
    maxLength: agent.maxLength,
  });

type LocalTagger = {
  id: string;
  name: string;
  providerId: string;
  model: string;
  prompt: string;
  enabled: boolean;
  maxTags: number;
};

const toLocalTagger = (tagger: InstanceSetting_TaggerConfig): LocalTagger => ({
  id: tagger.id,
  name: tagger.name,
  providerId: tagger.providerId,
  model: tagger.model,
  prompt: tagger.prompt,
  enabled: tagger.enabled,
  maxTags: tagger.maxTags,
});

const newTagger = (): LocalTagger => ({
  id: uuidv4(),
  name: "",
  providerId: "",
  model: "",
  prompt: "",
  enabled: false,
  maxTags: 3,
});

const toTaggerConfig = (tagger: LocalTagger) =>
  create(InstanceSetting_TaggerConfigSchema, {
    id: tagger.id,
    name: tagger.name.trim(),
    providerId: tagger.providerId,
    model: tagger.model.trim(),
    prompt: tagger.prompt,
    enabled: tagger.enabled,
    maxTags: tagger.maxTags,
  });

// Static registry of the conversational assistant's built-in tools. The tool set
// is fixed server-side; admin may only toggle enable and mark confirmation. Keys
// must match internal/ai/tools registry names. `description` is an i18n key
// resolved with t() at render time.
// Mirrors the tools actually registered by the backend (internal/ai/tools
// NewRegistry). Only tools present here can be toggled. All tools default to
// enabled, and mutating ones (create_memo, update_memo, tag_memo,
// batch_update_memos, delete_memo, auto_tag, agent_reply, manage_settings,
// query_db) default to requiring confirmation, while
// read-only/query tools (search_memos, get_memo, get_comments, get_logs) never require
// it.
// confirmEditable=false marks tools whose confirmation is fixed: read-only
// tools never require confirmation, so the toggle is disabled in the UI.
const toolRegistry: {
  name: string;
  descriptionKey: string;
  adminOnly: boolean;
  defaultRequiresConfirmation: boolean;
  confirmEditable?: boolean;
}[] = [
  {
    name: "search_memos",
    descriptionKey: "setting.ai.tool-search-memos",
    adminOnly: false,
    defaultRequiresConfirmation: false,
    confirmEditable: false,
  },
  {
    name: "get_memo",
    descriptionKey: "setting.ai.tool-get-memo",
    adminOnly: false,
    defaultRequiresConfirmation: false,
    confirmEditable: false,
  },
  {
    name: "get_comments",
    descriptionKey: "setting.ai.tool-get-comments",
    adminOnly: false,
    defaultRequiresConfirmation: false,
    confirmEditable: false,
  },
  { name: "create_memo", descriptionKey: "setting.ai.tool-create-memo", adminOnly: false, defaultRequiresConfirmation: true },
  { name: "update_memo", descriptionKey: "setting.ai.tool-update-memo", adminOnly: false, defaultRequiresConfirmation: true },
  { name: "tag_memo", descriptionKey: "setting.ai.tool-tag-memo", adminOnly: false, defaultRequiresConfirmation: true },
  { name: "batch_update_memos", descriptionKey: "setting.ai.tool-batch-update-memos", adminOnly: false, defaultRequiresConfirmation: true },
  { name: "manage_settings", descriptionKey: "setting.ai.tool-manage-settings", adminOnly: false, defaultRequiresConfirmation: true },
  { name: "auto_tag", descriptionKey: "setting.ai.tool-auto-tag", adminOnly: false, defaultRequiresConfirmation: true },
  { name: "agent_reply", descriptionKey: "setting.ai.tool-agent-reply", adminOnly: false, defaultRequiresConfirmation: true },
  { name: "delete_memo", descriptionKey: "setting.ai.tool-delete-memo", adminOnly: false, defaultRequiresConfirmation: true },
  {
    name: "get_logs",
    descriptionKey: "setting.ai.tool-get-logs",
    adminOnly: true,
    defaultRequiresConfirmation: false,
    confirmEditable: false,
  },
  { name: "query_db", descriptionKey: "setting.ai.tool-query-db", adminOnly: true, defaultRequiresConfirmation: true },
  { name: "manage_memory", descriptionKey: "setting.ai.tool-manage-memory", adminOnly: true, defaultRequiresConfirmation: true },
];

type LocalChatAgent = {
  id: string;
  name: string;
  builtin: boolean;
  providerId: string;
  model: string;
  systemPrompt: string;
  enabled: boolean;
};

const toLocalChatAgent = (agent: InstanceSetting_ChatAgentConfig): LocalChatAgent => ({
  id: agent.id,
  name: agent.name,
  builtin: agent.builtin,
  providerId: agent.providerId,
  model: agent.model,
  systemPrompt: agent.systemPrompt,
  enabled: agent.enabled,
});

const newChatAgent = (): LocalChatAgent => ({
  id: uuidv4(),
  name: "",
  builtin: false,
  providerId: "",
  model: "",
  systemPrompt: "",
  enabled: false,
});

const toChatAgentConfig = (agent: LocalChatAgent) =>
  create(InstanceSetting_ChatAgentConfigSchema, {
    id: agent.id,
    name: agent.name.trim(),
    builtin: agent.builtin,
    providerId: agent.providerId,
    model: agent.model.trim(),
    systemPrompt: agent.systemPrompt,
    enabled: agent.enabled,
  });

type LocalTool = {
  name: string;
  enabled: boolean;
  requiresConfirmation: boolean;
};

const toLocalTool = (name: string, tool: InstanceSetting_ToolConfig | undefined): LocalTool => {
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

const toToolConfig = (tool: LocalTool) =>
  create(InstanceSetting_ToolConfigSchema, {
    enabled: tool.enabled,
    requiresConfirmation: tool.requiresConfirmation,
  });

type LocalMemoryEntry = {
  id: string;
  content: string;
  createdBy: string;
  createdTs: bigint;
  updatedTs: bigint;
};

type LocalMemory = {
  enabled: boolean;
  entries: LocalMemoryEntry[];
};

const toLocalMemoryEntry = (entry: InstanceSetting_MemoryEntry): LocalMemoryEntry => ({
  id: entry.id,
  content: entry.content,
  createdBy: entry.createdBy,
  createdTs: entry.createdTs,
  updatedTs: entry.updatedTs,
});

const toLocalMemory = (memory: InstanceSetting_MemoryConfig | undefined): LocalMemory => ({
  enabled: memory?.enabled ?? false,
  entries: (memory?.entries ?? []).map(toLocalMemoryEntry),
});

const newMemoryEntry = (): LocalMemoryEntry => ({
  id: uuidv4(),
  content: "",
  createdBy: "",
  createdTs: 0n,
  updatedTs: 0n,
});

const toMemoryConfig = (memory: LocalMemory) =>
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

const toProviderConfig = (provider: LocalAIProvider) =>
  create(InstanceSetting_AIProviderConfigSchema, {
    id: provider.id,
    title: provider.title.trim(),
    type: provider.type,
    endpoint: provider.endpoint.trim(),
    apiKey: provider.apiKey,
  });

const toTranscriptionConfig = (transcription: LocalTranscription) =>
  create(InstanceSetting_TranscriptionConfigSchema, {
    providerId: transcription.providerId,
    model: transcription.model.trim(),
    language: transcription.language.trim(),
    prompt: transcription.prompt,
  });

const AISection = () => {
  const t = useTranslate();
  const saveInstanceSetting = useInstanceSettingUpdater();
  const { aiSetting: originalSetting } = useInstance();

  // Built-in conversational assistant templates. Admin clicks "add from template"
  // to seed a ChatAgentConfig draft; the resulting entry is indistinguishable from
  // a user-created one (builtin is informational for the multi-preset selector in a
  // later stage).
  const chatAgentTemplates: { name: string; systemPrompt: string }[] = [
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
  const [transcription, setTranscription] = useState<LocalTranscription>(() => toLocalTranscription(originalSetting.transcription));
  const [agents, setAgents] = useState<LocalAgent[]>(() => originalSetting.agents.map(toLocalAgent));
  const [taggers, setTaggers] = useState<LocalTagger[]>(() => originalSetting.taggers.map(toLocalTagger));
  const [chatAgents, setChatAgents] = useState<LocalChatAgent[]>(() => originalSetting.chatAgents.map(toLocalChatAgent));
  const [tools, setTools] = useState<LocalTool[]>(() =>
    toolRegistry.map((tool) => toLocalTool(tool.name, originalSetting.tools[tool.name])),
  );
  const [memory, setMemory] = useState<LocalMemory>(() => toLocalMemory(originalSetting.memory));
  const [editingProvider, setEditingProvider] = useState<LocalAIProvider | undefined>();
  const [deleteTarget, setDeleteTarget] = useState<LocalAIProvider | undefined>();
  const [editingAgent, setEditingAgent] = useState<LocalAgent | undefined>();
  const [deleteAgentTarget, setDeleteAgentTarget] = useState<LocalAgent | undefined>();
  const [editingTagger, setEditingTagger] = useState<LocalTagger | undefined>();
  const [deleteTaggerTarget, setDeleteTaggerTarget] = useState<LocalTagger | undefined>();

  useEffect(() => {
    setProviders(originalSetting.providers.map(toLocalProvider));
  }, [originalSetting.providers]);

  useEffect(() => {
    setAgents(originalSetting.agents.map(toLocalAgent));
  }, [originalSetting.agents]);

  useEffect(() => {
    setTaggers(originalSetting.taggers.map(toLocalTagger));
  }, [originalSetting.taggers]);

  useEffect(() => {
    setChatAgents(originalSetting.chatAgents.map(toLocalChatAgent));
  }, [originalSetting.chatAgents]);

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

  // Persists the AI setting using a specific providers list, transcription
  // value, agents list, taggers list, chat agents list, and tools map.
  // Provider/transcription/agent operations pass the current chat agents and
  // tools so an in-progress draft is never accidentally committed.
  const persistAISetting = async (
    nextProviders: LocalAIProvider[],
    nextTranscription: InstanceSetting_TranscriptionConfig | undefined,
    nextAgents: LocalAgent[],
    nextTaggers: LocalTagger[],
    nextChatAgents: LocalChatAgent[],
    nextTools: LocalTool[],
    errorContext: string,
    nextMemory: LocalMemory = memory,
  ) => {
    const nextToolMap: Record<string, InstanceSetting_ToolConfig> = {};
    for (const tool of nextTools) {
      nextToolMap[tool.name] = toToolConfig(tool);
    }
    return saveInstanceSetting({
      key: InstanceSetting_Key.AI,
      setting: create(InstanceSettingSchema, {
        name: buildInstanceSettingName(InstanceSetting_Key.AI),
        value: {
          case: "aiSetting",
          value: create(InstanceSetting_AISettingSchema, {
            providers: nextProviders.map(toProviderConfig),
            transcription: nextTranscription,
            agents: nextAgents.map(toAgentConfig),
            taggers: nextTaggers.map(toTaggerConfig),
            chatAgents: nextChatAgents.map(toChatAgentConfig),
            tools: nextToolMap,
            memory: toMemoryConfig(nextMemory),
          }),
        },
      }),
      errorContext,
    });
  };

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

    const ok = await persistAISetting(
      nextProviders,
      originalSetting.transcription,
      agents,
      taggers,
      chatAgents,
      tools,
      "Update AI provider",
    );
    if (!ok) return;
    setProviders(nextProviders);
    setEditingProvider(undefined);
  };

  const handleDeleteProvider = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    const nextProviders = providers.filter((provider) => provider.id !== target.id);

    // If the persisted transcription references the deleted provider, the
    // server would reject the save (provider_id must reference an existing
    // provider). Send a cleared transcription in that case.
    const persistedTranscription = originalSetting.transcription;
    const nextTranscription =
      persistedTranscription && persistedTranscription.providerId === target.id
        ? create(InstanceSetting_TranscriptionConfigSchema, {})
        : persistedTranscription;

    const ok = await persistAISetting(nextProviders, nextTranscription, agents, taggers, chatAgents, tools, "Delete AI provider");
    if (!ok) return;
    setProviders(nextProviders);
    if (transcription.providerId === target.id) {
      setTranscription((prev) => ({ ...prev, providerId: "" }));
    }
    setDeleteTarget(undefined);
  };

  const handleSaveTranscription = async () => {
    if (transcription.providerId && !transcriptionProviderRef) {
      toast.error(t("setting.ai.transcription-empty-providers"));
      return;
    }
    await persistAISetting(providers, toTranscriptionConfig(transcription), agents, taggers, chatAgents, tools, "Update transcription");
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

    const ok = await persistAISetting(providers, originalSetting.transcription, nextAgents, taggers, chatAgents, tools, "Update AI agent");
    if (!ok) return;
    setAgents(nextAgents);
    setEditingAgent(undefined);
  };

  const handleToggleAgent = async (agent: LocalAgent) => {
    const nextAgents = agents.map((item) => (item.id === agent.id ? { ...item, enabled: !item.enabled } : item));
    const ok = await persistAISetting(providers, originalSetting.transcription, nextAgents, taggers, chatAgents, tools, "Toggle AI agent");
    if (!ok) return;
    setAgents(nextAgents);
  };

  const handleDeleteAgent = async () => {
    if (!deleteAgentTarget) return;
    const target = deleteAgentTarget;
    const nextAgents = agents.filter((agent) => agent.id !== target.id);
    const ok = await persistAISetting(providers, originalSetting.transcription, nextAgents, taggers, chatAgents, tools, "Delete AI agent");
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

    const ok = await persistAISetting(providers, originalSetting.transcription, agents, nextTaggers, chatAgents, tools, "Update AI tagger");
    if (!ok) return;
    setTaggers(nextTaggers);
    setEditingTagger(undefined);
  };

  const handleToggleTagger = async (tagger: LocalTagger) => {
    const nextTaggers = taggers.map((item) => (item.id === tagger.id ? { ...item, enabled: !item.enabled } : item));
    const ok = await persistAISetting(providers, originalSetting.transcription, agents, nextTaggers, chatAgents, tools, "Toggle AI tagger");
    if (!ok) return;
    setTaggers(nextTaggers);
  };

  const handleDeleteTagger = async () => {
    if (!deleteTaggerTarget) return;
    const target = deleteTaggerTarget;
    const nextTaggers = taggers.filter((tagger) => tagger.id !== target.id);
    const ok = await persistAISetting(providers, originalSetting.transcription, agents, nextTaggers, chatAgents, tools, "Delete AI tagger");
    if (!ok) return;
    setTaggers(nextTaggers);
    setDeleteTaggerTarget(undefined);
  };

  const [editingChatAgent, setEditingChatAgent] = useState<LocalChatAgent | undefined>();
  const [deleteChatAgentTarget, setDeleteChatAgentTarget] = useState<LocalChatAgent | undefined>();

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
    if (agent.enabled && !agent.providerId) {
      toast.error(t("setting.ai.chat-agent-provider-required"));
      return;
    }

    const normalizedAgent = { ...agent, name };
    const exists = chatAgents.some((item) => item.id === normalizedAgent.id);
    const nextChatAgents = exists
      ? chatAgents.map((item) => (item.id === normalizedAgent.id ? normalizedAgent : item))
      : [...chatAgents, normalizedAgent];

    const ok = await persistAISetting(
      providers,
      originalSetting.transcription,
      agents,
      taggers,
      nextChatAgents,
      tools,
      "Update chat agent",
    );
    if (!ok) return;
    setChatAgents(nextChatAgents);
    setEditingChatAgent(undefined);
  };

  const handleToggleChatAgent = async (agent: LocalChatAgent) => {
    const nextChatAgents = chatAgents.map((item) => (item.id === agent.id ? { ...item, enabled: !item.enabled } : item));
    const ok = await persistAISetting(
      providers,
      originalSetting.transcription,
      agents,
      taggers,
      nextChatAgents,
      tools,
      "Toggle chat agent",
    );
    if (!ok) return;
    setChatAgents(nextChatAgents);
  };

  const handleDeleteChatAgent = async () => {
    if (!deleteChatAgentTarget) return;
    const target = deleteChatAgentTarget;
    const nextChatAgents = chatAgents.filter((agent) => agent.id !== target.id);
    const ok = await persistAISetting(
      providers,
      originalSetting.transcription,
      agents,
      taggers,
      nextChatAgents,
      tools,
      "Delete chat agent",
    );
    if (!ok) return;
    setChatAgents(nextChatAgents);
    setDeleteChatAgentTarget(undefined);
  };

  const handleToggleTool = async (tool: LocalTool) => {
    const nextTools = tools.map((item) => (item.name === tool.name ? { ...item, enabled: !item.enabled } : item));
    const ok = await persistAISetting(providers, originalSetting.transcription, agents, taggers, chatAgents, nextTools, "Toggle chat tool");
    if (!ok) return;
    setTools(nextTools);
  };

  const handleToggleToolConfirmation = async (tool: LocalTool) => {
    const nextTools = tools.map((item) => (item.name === tool.name ? { ...item, requiresConfirmation: !item.requiresConfirmation } : item));
    const ok = await persistAISetting(
      providers,
      originalSetting.transcription,
      agents,
      taggers,
      chatAgents,
      nextTools,
      "Toggle chat tool confirmation",
    );
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
    const ok = await persistAISetting(
      providers,
      originalSetting.transcription,
      agents,
      taggers,
      chatAgents,
      tools,
      "Update memory",
      memory,
    );
    if (!ok) return;
    lastSyncedMemory.current = memory;
  };

  return (
    <SettingSection
      title={t("setting.ai.label")}
      actions={
        <Button onClick={handleCreateProvider}>
          <PlusIcon className="w-4 h-4 mr-2" />
          {t("setting.ai.add-provider")}
        </Button>
      }
    >
      <SettingPanel className="bg-muted/30 px-4 py-3">
        <div className="flex max-w-3xl flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-border bg-background px-2 py-0.5 text-xs font-medium text-foreground">
              {t("setting.ai.byok-label")}
            </span>
            <h4 className="text-sm font-semibold text-foreground">{t("setting.ai.byok-title")}</h4>
          </div>
          <p className="text-sm text-muted-foreground">{t("setting.ai.byok-description")}</p>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {byokNotes.map((note) => (
              <li key={note} className="flex gap-2">
                <span className="mt-2 size-1 rounded-full bg-muted-foreground/60" aria-hidden />
                <span>{t(note)}</span>
              </li>
            ))}
          </ul>
        </div>
      </SettingPanel>

      <SettingGroup title={t("setting.ai.integrations-title")} description={t("setting.ai.integrations-description")}>
        <SettingTable
          columns={[
            {
              key: "title",
              header: t("common.name"),
              render: (_, provider: LocalAIProvider) => (
                <div className="flex flex-col gap-0.5">
                  <span className="text-foreground">{provider.title}</span>
                  <span className="font-mono text-xs text-muted-foreground">{provider.id}</span>
                </div>
              ),
            },
            {
              key: "type",
              header: t("setting.ai.provider-type"),
              render: (_, provider: LocalAIProvider) => <span>{getProviderTypeLabel(provider.type)}</span>,
            },
            {
              key: "endpoint",
              header: t("setting.ai.endpoint"),
              render: (_, provider: LocalAIProvider) => (
                <span className="font-mono text-xs">{provider.endpoint || t("setting.ai.default-endpoint")}</span>
              ),
            },
            {
              key: "apiKeySet",
              header: t("setting.ai.api-key"),
              render: (_, provider: LocalAIProvider) => (
                <span className="font-mono text-xs">{provider.apiKeySet ? provider.apiKeyHint || t("setting.ai.configured") : "-"}</span>
              ),
            },
            {
              key: "actions",
              header: "",
              className: "text-right",
              render: (_, provider: LocalAIProvider) => (
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
                    <MoreVerticalIcon className="w-4 h-auto" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" sideOffset={2}>
                    <DropdownMenuItem onClick={() => handleEditProvider(provider)}>{t("common.edit")}</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setDeleteTarget(provider)} className="text-destructive focus:text-destructive">
                      {t("common.delete")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ),
            },
          ]}
          data={providers}
          emptyMessage={t("setting.ai.no-providers")}
          getRowKey={(provider) => provider.id}
        />
      </SettingGroup>

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

      <SettingGroup
        title={t("setting.ai.chat-agents-title")}
        description={t("setting.ai.chat-agents-description")}
        showSeparator
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {chatAgentTemplates.map((template) => (
              <Button key={template.name} variant="outline" onClick={() => handleCreateChatAgentFromTemplate(template)}>
                <PlusIcon className="w-4 h-4 mr-2" />
                {template.name}
              </Button>
            ))}
            <Button onClick={handleCreateChatAgent}>
              <PlusIcon className="w-4 h-4 mr-2" />
              {t("setting.ai.add-chat-agent")}
            </Button>
          </div>
        }
      >
        <SettingTable
          columns={[
            {
              key: "name",
              header: t("common.name"),
              render: (_, agent: LocalChatAgent) => (
                <div className="flex flex-col gap-0.5">
                  <span className="text-foreground">{agent.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{agent.id}</span>
                </div>
              ),
            },
            {
              key: "providerId",
              header: t("setting.ai.chat-agent-provider"),
              render: (_, agent: LocalChatAgent) => {
                const provider = providers.find((item) => item.id === agent.providerId);
                return <span>{provider ? provider.title || provider.id : "-"}</span>;
              },
            },
            {
              key: "enabled",
              header: t("setting.ai.chat-agent-enabled"),
              render: (_, agent: LocalChatAgent) => (
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={agent.enabled}
                  onChange={() => handleToggleChatAgent(agent)}
                  aria-label={t("setting.ai.chat-agent-toggle-aria", { name: agent.name })}
                />
              ),
            },
            {
              key: "actions",
              header: "",
              className: "text-right",
              render: (_, agent: LocalChatAgent) => (
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
                    <MoreVerticalIcon className="w-4 h-auto" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" sideOffset={2}>
                    <DropdownMenuItem onClick={() => handleEditChatAgent(agent)}>{t("common.edit")}</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setDeleteChatAgentTarget(agent)} className="text-destructive focus:text-destructive">
                      {t("common.delete")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ),
            },
          ]}
          data={chatAgents}
          emptyMessage={t("setting.ai.no-chat-agents")}
          getRowKey={(agent) => agent.id}
        />
      </SettingGroup>

      <SettingGroup title={t("setting.ai.chat-tools-title")} description={t("setting.ai.chat-tools-description")} showSeparator>
        <SettingTable
          columns={[
            {
              key: "name",
              header: t("common.name"),
              render: (_, tool: LocalTool) => {
                const meta = toolRegistry.find((item) => item.name === tool.name);
                return (
                  <div className="flex flex-col gap-0.5">
                    <span className="text-foreground">{tool.name}</span>
                    {meta && <span className="text-xs text-muted-foreground">{t(meta.descriptionKey as Parameters<typeof t>[0])}</span>}
                  </div>
                );
              },
            },
            {
              key: "scope",
              header: t("setting.ai.chat-tool-scope"),
              render: (_, tool: LocalTool) => {
                const meta = toolRegistry.find((item) => item.name === tool.name);
                return <span>{meta?.adminOnly ? t("setting.ai.chat-tool-admin") : t("setting.ai.chat-tool-user")}</span>;
              },
            },
            {
              key: "enabled",
              header: t("setting.ai.chat-tool-enabled"),
              render: (_, tool: LocalTool) => (
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={tool.enabled}
                  onChange={() => handleToggleTool(tool)}
                  aria-label={t("setting.ai.chat-tool-toggle-aria", { name: tool.name })}
                />
              ),
            },
            {
              key: "requiresConfirmation",
              header: t("setting.ai.chat-tool-confirm"),
              render: (_, tool: LocalTool) => {
                const meta = toolRegistry.find((item) => item.name === tool.name);
                const locked = meta?.confirmEditable === false;
                return (
                  <input
                    type="checkbox"
                    className="size-4 accent-primary disabled:cursor-not-allowed disabled:opacity-40"
                    checked={locked ? false : tool.requiresConfirmation}
                    disabled={locked}
                    onChange={() => handleToggleToolConfirmation(tool)}
                    aria-label={t("setting.ai.chat-tool-confirm-toggle-aria", { name: tool.name })}
                  />
                );
              },
            },
          ]}
          data={tools}
          emptyMessage={t("setting.ai.no-chat-tools")}
          getRowKey={(tool) => tool.name}
        />
      </SettingGroup>

      <SettingGroup
        title={t("setting.ai.memory-title")}
        description={t("setting.ai.memory-description")}
        showSeparator
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={handleAddMemoryEntry}>
              <PlusIcon className="w-4 h-4 mr-2" />
              {t("setting.ai.memory-add-entry")}
            </Button>
            <Button disabled={!memoryHasChanges} onClick={handleSaveMemory}>
              {t("common.save")}
            </Button>
          </div>
        }
      >
        <div className="flex items-center gap-2 mb-3">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={memory.enabled}
            onChange={handleToggleMemoryEnabled}
            aria-label={t("setting.ai.memory-enabled-label")}
          />
          <span className="text-sm">{t("setting.ai.memory-enabled-label")}</span>
        </div>
        <SettingTable
          columns={[
            {
              key: "content",
              header: t("setting.ai.memory-entry-content"),
              render: (_, entry: LocalMemoryEntry) => (
                <Input
                  value={entry.content}
                  onChange={(e) => handleUpdateMemoryEntry(entry.id, e.target.value)}
                  placeholder={t("setting.ai.memory-entry-placeholder")}
                />
              ),
            },
            {
              key: "createdBy",
              header: t("setting.ai.memory-entry-created-by"),
              render: (_, entry: LocalMemoryEntry) => <span className="text-xs text-muted-foreground">{entry.createdBy || "-"}</span>,
            },
            {
              key: "actions",
              header: "",
              className: "text-right",
              render: (_, entry: LocalMemoryEntry) => (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDeleteMemoryEntry(entry.id)}
                  aria-label={t("setting.ai.memory-entry-delete-aria")}
                >
                  <Trash2Icon className="w-4 h-auto" />
                </Button>
              ),
            },
          ]}
          data={memory.entries}
          emptyMessage={t("setting.ai.memory-no-entries")}
          getRowKey={(entry) => entry.id}
        />
      </SettingGroup>

      <AIProviderDialog
        provider={editingProvider}
        onOpenChange={(open) => !open && setEditingProvider(undefined)}
        onSave={handleSaveProvider}
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

interface AIProviderDialogProps {
  provider?: LocalAIProvider;
  onOpenChange: (open: boolean) => void;
  onSave: (provider: LocalAIProvider) => void;
}

const AIProviderDialog = ({ provider, onOpenChange, onSave }: AIProviderDialogProps) => {
  const t = useTranslate();
  const [draft, setDraft] = useState<LocalAIProvider>(() => provider ?? newProvider());

  useEffect(() => {
    const next = provider ?? newProvider();
    setDraft(next);
  }, [provider]);

  const updateDraft = (partial: Partial<LocalAIProvider>) => {
    setDraft((prev) => ({ ...prev, ...partial }));
  };

  const handleSave = () => {
    onSave(draft);
  };

  return (
    <Dialog open={!!provider} onOpenChange={onOpenChange}>
      <DialogContent size="2xl">
        <DialogHeader>
          <DialogTitle>{provider?.apiKeySet ? t("setting.ai.edit-provider") : t("setting.ai.add-provider")}</DialogTitle>
          <DialogDescription>{t("setting.ai.dialog-description")}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>{t("setting.ai.provider-title")}</Label>
            <Input value={draft.title} onChange={(e) => updateDraft({ title: e.target.value })} placeholder="OpenAI" />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t("setting.ai.provider-type")}</Label>
            <Select
              value={String(draft.type)}
              items={providerTypeSelectOptions}
              onValueChange={(value) => updateDraft({ type: Number(value) as InstanceSetting_AIProviderType })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {providerTypeSelectOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>{t("setting.ai.endpoint")}</Label>
            <Input
              value={draft.endpoint}
              onChange={(e) => updateDraft({ endpoint: e.target.value })}
              placeholder={getDefaultEndpointPlaceholder(draft.type)}
            />
            <p className="text-xs text-muted-foreground">{t("setting.ai.endpoint-hint")}</p>
          </div>

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>{t("setting.ai.api-key")}</Label>
            <Input
              type="password"
              value={draft.apiKey}
              onChange={(e) => updateDraft({ apiKey: e.target.value })}
              placeholder={draft.apiKeySet ? t("setting.ai.keep-api-key") : ""}
            />
            {draft.apiKeySet && (
              <p className="text-xs text-muted-foreground">{t("setting.ai.current-key", { key: draft.apiKeyHint || "-" })}</p>
            )}
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

const getDefaultEndpointPlaceholder = (type: InstanceSetting_AIProviderType) => {
  switch (type) {
    case InstanceSetting_AIProviderType.OPENAI:
      return "https://api.openai.com/v1";
    case InstanceSetting_AIProviderType.GEMINI:
      return "https://generativelanguage.googleapis.com/v1beta";
    default:
      return "";
  }
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

interface ChatAgentDialogProps {
  agent?: LocalChatAgent;
  providers: LocalAIProvider[];
  onOpenChange: (open: boolean) => void;
  onSave: (agent: LocalChatAgent) => void;
}

const ChatAgentDialog = ({ agent, providers, onOpenChange, onSave }: ChatAgentDialogProps) => {
  const t = useTranslate();
  const [draft, setDraft] = useState<LocalChatAgent>(() => agent ?? newChatAgent());

  useEffect(() => {
    setDraft(agent ?? newChatAgent());
  }, [agent]);

  const updateDraft = (partial: Partial<LocalChatAgent>) => {
    setDraft((prev) => ({ ...prev, ...partial }));
  };

  const providerOptions = useMemo(
    () => [
      { value: "__none__", label: t("setting.ai.chat-agent-no-provider") },
      ...providers.map((provider) => ({ value: provider.id, label: provider.title || provider.id })),
    ],
    [providers, t],
  );

  const referencedProvider = providers.find((item) => item.id === draft.providerId);
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
    <Dialog open={!!agent} onOpenChange={onOpenChange}>
      <DialogContent size="2xl">
        <DialogHeader>
          <DialogTitle>{t("setting.ai.edit-chat-agent")}</DialogTitle>
          <DialogDescription>{t("setting.ai.chat-agent-dialog-description")}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>{t("setting.ai.chat-agent-name")}</Label>
            <Input
              value={draft.name}
              onChange={(e) => updateDraft({ name: e.target.value })}
              placeholder={t("setting.ai.chat-agent-name-placeholder")}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t("setting.ai.chat-agent-provider")}</Label>
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
            {providers.length === 0 && <p className="text-xs text-muted-foreground">{t("setting.ai.chat-agent-empty-providers")}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t("setting.ai.chat-agent-model")}</Label>
            <Input
              value={draft.model}
              onChange={(e) => updateDraft({ model: e.target.value })}
              placeholder={placeholderForProvider(referencedProvider)}
              disabled={!draft.providerId}
              maxLength={256}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t("setting.ai.chat-agent-enabled")}</Label>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={draft.enabled}
                onChange={(e) => updateDraft({ enabled: e.target.checked })}
              />
              <span className="text-xs text-muted-foreground">{t("setting.ai.chat-agent-enabled-help")}</span>
            </div>
          </div>

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>{t("setting.ai.chat-agent-system")}</Label>
            <Textarea
              value={draft.systemPrompt}
              onChange={(e) => updateDraft({ systemPrompt: e.target.value })}
              placeholder={t("setting.ai.chat-agent-system-placeholder")}
              rows={5}
              maxLength={4096}
            />
            <p className="text-xs text-muted-foreground">{t("setting.ai.chat-agent-system-help")}</p>
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
