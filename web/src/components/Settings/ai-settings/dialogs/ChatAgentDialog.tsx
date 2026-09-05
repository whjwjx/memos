import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useTranslate } from "@/utils/i18n";
import { newChatAgent } from "../aiSettingFactories";
import type { LocalAIProvider, LocalChatAgent, LocalLLM } from "../types";

type ChatAgentDialogProps = {
  agent?: LocalChatAgent;
  mode: "create" | "edit";
  llms: LocalLLM[];
  providers: LocalAIProvider[];
  onOpenChange: (open: boolean) => void;
  onSave: (agent: LocalChatAgent) => void;
};

export const ChatAgentDialog = ({ agent, mode, llms, providers, onOpenChange, onSave }: ChatAgentDialogProps) => {
  const t = useTranslate();
  const [draft, setDraft] = useState<LocalChatAgent>(() => agent ?? newChatAgent());

  useEffect(() => {
    setDraft(agent ?? newChatAgent());
  }, [agent]);

  const updateDraft = (partial: Partial<LocalChatAgent>) => {
    setDraft((prev) => ({ ...prev, ...partial }));
  };

  const llmOptions = useMemo(
    () => [
      { value: "__none__", label: t("setting.ai.chat-agent-no-llm") },
      ...llms.map((llm) => {
        const provider = providers.find((item) => item.id === llm.providerId);
        return { value: llm.id, label: `${llm.title || llm.model} · ${provider?.title || llm.providerId}` };
      }),
    ],
    [llms, providers, t],
  );

  return (
    <Dialog open={!!agent} onOpenChange={onOpenChange}>
      <DialogContent size="2xl">
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? t("setting.ai.edit-chat-agent") : t("setting.ai.add-chat-agent")}</DialogTitle>
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
            <Label>{t("setting.ai.chat-agent-llm")}</Label>
            <Select
              value={draft.llmId || "__none__"}
              items={llmOptions}
              onValueChange={(value) => {
                const llm = llms.find((item) => item.id === value);
                updateDraft({
                  llmId: value === "__none__" ? "" : value,
                  providerId: llm?.providerId ?? "",
                  model: llm?.model ?? "",
                });
              }}
              disabled={llms.length === 0}
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
            {llms.length === 0 && <p className="text-xs text-muted-foreground">{t("setting.ai.chat-agent-empty-llms")}</p>}
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
          <Button onClick={() => onSave(draft)}>{t("common.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
