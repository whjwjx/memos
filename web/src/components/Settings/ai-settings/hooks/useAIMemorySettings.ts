import { isEqual } from "lodash-es";
import { useEffect, useMemo, useRef, useState } from "react";
import type { InstanceSetting_AISetting } from "@/types/proto/api/v1/instance_service_pb";
import { newMemoryEntry } from "../aiSettingFactories";
import { toLocalMemory } from "../aiSettingMapper";
import type { AISettingPatch } from "../saveAISettingPatch";
import type { LocalMemory } from "../types";

type SavePatch = (patch: AISettingPatch, errorContext: string) => Promise<boolean>;

export const useAIMemorySettings = ({
  originalSetting,
  savePatch,
}: {
  originalSetting: InstanceSetting_AISetting;
  savePatch: SavePatch;
}) => {
  const [memory, setMemory] = useState<LocalMemory>(() => toLocalMemory(originalSetting.memory));
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

  return {
    memory,
    memoryHasChanges,
    handleToggleMemoryEnabled,
    handleAddMemoryEntry,
    handleUpdateMemoryEntry,
    handleDeleteMemoryEntry,
    handleSaveMemory,
  };
};
