import { useEffect, useState } from "react";
import type { InstanceSetting_AISetting } from "@/types/proto/api/v1/instance_service_pb";
import { toLocalTool } from "../aiSettingMapper";
import type { AISettingPatch } from "../saveAISettingPatch";
import { toolRegistry } from "../toolRegistry";
import type { LocalTool } from "../types";

type SavePatch = (patch: AISettingPatch, errorContext: string) => Promise<boolean>;

export const useAIToolsSettings = ({
  originalSetting,
  savePatch,
}: {
  originalSetting: InstanceSetting_AISetting;
  savePatch: SavePatch;
}) => {
  const [tools, setTools] = useState<LocalTool[]>(() =>
    toolRegistry.map((tool) => toLocalTool(tool.name, originalSetting.tools[tool.name])),
  );

  useEffect(() => {
    setTools(toolRegistry.map((tool) => toLocalTool(tool.name, originalSetting.tools[tool.name])));
  }, [originalSetting.tools]);

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

  return {
    tools,
    handleToggleTool,
    handleToggleToolConfirmation,
  };
};
