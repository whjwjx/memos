import { isEqual } from "lodash-es";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import type { InstanceSetting_AISetting } from "@/types/proto/api/v1/instance_service_pb";
import { useTranslate } from "@/utils/i18n";
import { toLocalTranslation, toTranslationConfig } from "../aiSettingMapper";
import type { AISettingPatch } from "../saveAISettingPatch";
import type { LocalAIProvider, LocalLLM, LocalTranslation } from "../types";

type SavePatch = (patch: AISettingPatch, errorContext: string) => Promise<boolean>;

export const useAITranslationSettings = ({
  originalSetting,
  providers,
  llms,
  savePatch,
}: {
  originalSetting: InstanceSetting_AISetting;
  providers: LocalAIProvider[];
  llms: LocalLLM[];
  savePatch: SavePatch;
}) => {
  const t = useTranslate();
  const [translation, setTranslation] = useState<LocalTranslation>(() => toLocalTranslation(originalSetting.translation, llms, providers));
  const lastSyncedTranslation = useRef<LocalTranslation>(toLocalTranslation(originalSetting.translation, llms, providers));

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
  const translationLLMRef = useMemo(() => llms.find((llm) => llm.id === translation.llmId), [llms, translation.llmId]);

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

  return {
    translation,
    setTranslation,
    translationHasChanges,
    handleSaveTranslation,
  };
};
