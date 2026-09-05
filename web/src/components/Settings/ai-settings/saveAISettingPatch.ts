import { create } from "@bufbuild/protobuf";
import {
  InstanceSetting,
  InstanceSetting_AISetting,
  InstanceSetting_AISettingSchema,
  InstanceSetting_Key,
  InstanceSetting_TranslationConfig,
  InstanceSettingSchema,
} from "@/types/proto/api/v1/instance_service_pb";
import { buildInstanceSettingName } from "../useInstanceSettingUpdater";
import {
  createEmptyTranscriptionConfig,
  toChatAgentConfig,
  toLLMConfig,
  toMemoryConfig,
  toProviderConfig,
  toToolConfig,
} from "./aiSettingMapper";
import type { LocalAIProvider, LocalChatAgent, LocalLLM, LocalMemory, LocalTool } from "./types";

type SaveInstanceSetting = (options: { key: InstanceSetting_Key; setting: InstanceSetting; errorContext: string }) => Promise<boolean>;

export type AISettingPatch = {
  providers?: LocalAIProvider[];
  chatAgents?: LocalChatAgent[];
  tools?: LocalTool[];
  memory?: LocalMemory;
  translation?: InstanceSetting_TranslationConfig | undefined;
  llms?: LocalLLM[];
};

export const saveAISettingPatch = ({
  errorContext,
  originalSetting,
  patch,
  saveInstanceSetting,
}: {
  errorContext: string;
  originalSetting: InstanceSetting_AISetting;
  patch: AISettingPatch;
  saveInstanceSetting: SaveInstanceSetting;
}) => {
  const nextToolMap =
    patch.tools === undefined
      ? originalSetting.tools
      : patch.tools.reduce<Record<string, ReturnType<typeof toToolConfig>>>(
          (acc, tool) => {
            acc[tool.name] = toToolConfig(tool);
            return acc;
          },
          { ...originalSetting.tools },
        );

  return saveInstanceSetting({
    key: InstanceSetting_Key.AI,
    setting: create(InstanceSettingSchema, {
      name: buildInstanceSettingName(InstanceSetting_Key.AI),
      value: {
        case: "aiSetting",
        value: create(InstanceSetting_AISettingSchema, {
          providers: patch.providers?.map(toProviderConfig) ?? originalSetting.providers,
          transcription: createEmptyTranscriptionConfig(),
          agents: [],
          taggers: [],
          chatAgents: patch.chatAgents?.map(toChatAgentConfig) ?? originalSetting.chatAgents,
          tools: nextToolMap,
          memory: patch.memory ? toMemoryConfig(patch.memory) : originalSetting.memory,
          translation: patch.translation ?? originalSetting.translation,
          llms: patch.llms?.map(toLLMConfig) ?? originalSetting.llms,
        }),
      },
    }),
    errorContext,
  });
};
