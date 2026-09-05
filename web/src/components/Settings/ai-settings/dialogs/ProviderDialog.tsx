import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InstanceSetting_AIProviderType } from "@/types/proto/api/v1/instance_service_pb";
import { useTranslate } from "@/utils/i18n";
import { getDefaultEndpointPlaceholder, newProvider, providerTypeSelectOptions } from "../aiSettingFactories";
import type { LocalAIProvider } from "../types";

type ProviderDialogProps = {
  provider?: LocalAIProvider;
  mode: "create" | "edit";
  onOpenChange: (open: boolean) => void;
  onSave: (provider: LocalAIProvider) => void;
};

export const ProviderDialog = ({ provider, mode, onOpenChange, onSave }: ProviderDialogProps) => {
  const t = useTranslate();
  const [draft, setDraft] = useState<LocalAIProvider>(() => provider ?? newProvider());

  useEffect(() => {
    const next = provider ?? newProvider();
    setDraft(next);
  }, [provider]);

  const updateDraft = (partial: Partial<LocalAIProvider>) => {
    setDraft((prev) => ({ ...prev, ...partial }));
  };

  return (
    <Dialog open={!!provider} onOpenChange={onOpenChange}>
      <DialogContent size="2xl">
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? t("setting.ai.edit-provider") : t("setting.ai.add-provider")}</DialogTitle>
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
          <Button onClick={() => onSave(draft)}>{t("common.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
