import { create } from "@bufbuild/protobuf";
import { useEffect, useMemo, useState } from "react";
import { toast } from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { aiServiceClient } from "@/connect";
import { TestAIProviderRequestSchema } from "@/types/proto/api/v1/ai_service_pb";
import { useTranslate } from "@/utils/i18n";
import { defaultChatModelForProvider, newLLM } from "../aiSettingFactories";
import type { LocalAIProvider, LocalLLM } from "../types";

type LLMDialogProps = {
  llm?: LocalLLM;
  mode: "create" | "edit";
  providers: LocalAIProvider[];
  onOpenChange: (open: boolean) => void;
  onSave: (llm: LocalLLM) => void;
};

export const LLMDialog = ({ llm, mode, providers, onOpenChange, onSave }: LLMDialogProps) => {
  const t = useTranslate();
  const [draft, setDraft] = useState<LocalLLM>(() => llm ?? newLLM(providers));
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    setDraft(llm ?? newLLM(providers));
  }, [llm, providers]);

  const updateDraft = (partial: Partial<LocalLLM>) => {
    setDraft((prev) => ({ ...prev, ...partial }));
  };

  const providerOptions = useMemo(
    () => [
      { value: "__none__", label: t("setting.ai.llm-no-provider") },
      ...providers.map((provider) => ({ value: provider.id, label: provider.title || provider.id })),
    ],
    [providers, t],
  );
  const referencedProvider = providers.find((provider) => provider.id === draft.providerId);
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

  const handleProviderChange = (value: string) => {
    const providerId = value === "__none__" ? "" : value;
    const provider = providers.find((item) => item.id === providerId);
    updateDraft({ providerId, model: draft.model || defaultChatModelForProvider(provider) });
  };

  return (
    <Dialog open={!!llm} onOpenChange={onOpenChange}>
      <DialogContent size="2xl">
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? t("setting.ai.edit-llm") : t("setting.ai.add-llm")}</DialogTitle>
          <DialogDescription>{t("setting.ai.llm-dialog-description")}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>{t("setting.ai.llm-title")}</Label>
            <Input value={draft.title} onChange={(e) => updateDraft({ title: e.target.value })} placeholder="gpt-4o-mini" />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t("setting.ai.llm-provider")}</Label>
            <Select
              value={draft.providerId || "__none__"}
              items={providerOptions}
              onValueChange={handleProviderChange}
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
            {providers.length === 0 && <p className="text-xs text-muted-foreground">{t("setting.ai.llm-empty-providers")}</p>}
          </div>

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>{t("setting.ai.llm-model")}</Label>
            <Input
              value={draft.model}
              onChange={(e) => updateDraft({ model: e.target.value })}
              placeholder={defaultChatModelForProvider(referencedProvider)}
              disabled={!draft.providerId}
              maxLength={256}
            />
            <p className="text-xs text-muted-foreground">{t("setting.ai.llm-model-help")}</p>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={draft.enabled}
              onChange={(e) => updateDraft({ enabled: e.target.checked })}
            />
            <span>{t("setting.ai.llm-enabled")}</span>
          </label>

          {referencedProvider && !hasApiKey && (
            <p className="text-xs text-destructive sm:col-span-2">{t("setting.ai.llm-warning-no-key")}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={!canTest || testing} onClick={handleTest}>
            {testing ? t("setting.ai.test-provider-testing") : t("setting.ai.test-provider")}
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => onSave(draft)}>{t("common.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
