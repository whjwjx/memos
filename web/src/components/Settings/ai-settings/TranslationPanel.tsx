import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTranslate } from "@/utils/i18n";
import SettingGroup from "../SettingGroup";
import type { LocalAIProvider, LocalLLM, LocalTranslation } from "./types";

type TranslationPanelProps = {
  llms: LocalLLM[];
  providers: LocalAIProvider[];
  translation: LocalTranslation;
  translationHasChanges: boolean;
  onChange: (next: LocalTranslation) => void;
  onSave: () => void;
};

export const TranslationPanel = ({ llms, providers, translation, translationHasChanges, onChange, onSave }: TranslationPanelProps) => {
  const t = useTranslate();

  return (
    <SettingGroup
      title={t("setting.ai.translation-title")}
      description={t("setting.ai.translation-description")}
      showSeparator
      actions={
        <Button disabled={!translationHasChanges} onClick={onSave}>
          {t("common.save")}
        </Button>
      }
    >
      <TranslationForm llms={llms} providers={providers} translation={translation} onChange={onChange} />
    </SettingGroup>
  );
};

type TranslationFormProps = {
  llms: LocalLLM[];
  providers: LocalAIProvider[];
  translation: LocalTranslation;
  onChange: (next: LocalTranslation) => void;
};

const TranslationForm = ({ llms, providers, translation, onChange }: TranslationFormProps) => {
  const t = useTranslate();
  const noLLMs = llms.length === 0;

  const llmOptions = useMemo(
    () => [
      { value: "__none__", label: t("setting.ai.translation-no-llm") },
      ...llms.map((llm) => {
        const provider = providers.find((item) => item.id === llm.providerId);
        return { value: llm.id, label: `${llm.title || llm.model} · ${provider?.title || llm.providerId}` };
      }),
    ],
    [llms, providers, t],
  );
  const referencedLLM = llms.find((item) => item.id === translation.llmId);
  const referencedProvider = referencedLLM ? providers.find((item) => item.id === referencedLLM.providerId) : undefined;

  const update = (partial: Partial<LocalTranslation>) => {
    onChange({ ...translation, ...partial });
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-3xl">
      <label className="flex items-center gap-2 sm:col-span-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={translation.enabled}
          onChange={(e) => update({ enabled: e.target.checked })}
        />
        <span>{t("setting.ai.translation-enabled")}</span>
      </label>

      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label>{t("setting.ai.translation-llm")}</Label>
        <Select
          value={translation.llmId || "__none__"}
          items={llmOptions}
          onValueChange={(value) => {
            const llm = llms.find((item) => item.id === value);
            update({
              llmId: value === "__none__" ? "" : value,
              providerId: llm?.providerId ?? "",
              model: llm?.model ?? "",
            });
          }}
          disabled={noLLMs}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {llmOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {noLLMs && <p className="text-xs text-muted-foreground">{t("setting.ai.translation-empty-llms")}</p>}
        {referencedProvider && !referencedProvider.apiKeySet && (
          <p className="text-xs text-destructive">{t("setting.ai.translation-warning-no-key")}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{t("setting.ai.translation-max-text-length")}</Label>
        <Input
          type="number"
          value={translation.maxTextLength}
          min={1}
          max={100000}
          onChange={(e) => update({ maxTextLength: Number(e.target.value) })}
          disabled={!translation.llmId}
        />
        <p className="text-xs text-muted-foreground">{t("setting.ai.translation-max-text-length-help")}</p>
      </div>
    </div>
  );
};
