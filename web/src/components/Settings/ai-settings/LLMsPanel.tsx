import { MoreVerticalIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { InstanceSetting_AIProviderType } from "@/types/proto/api/v1/instance_service_pb";
import { useTranslate } from "@/utils/i18n";
import SettingGroup from "../SettingGroup";
import { SettingPanel } from "../SettingList";
import SettingTable from "../SettingTable";
import type { LocalAIProvider, LocalLLM } from "./types";

const byokNotes = ["setting.ai.byok-key-note", "setting.ai.byok-storage-note", "setting.ai.byok-model-note"] as const;

const getProviderTypeLabel = (type: InstanceSetting_AIProviderType) => {
  return InstanceSetting_AIProviderType[type] ?? "UNKNOWN";
};

type LLMsPanelProps = {
  providers: LocalAIProvider[];
  llms: LocalLLM[];
  onCreateProvider: () => void;
  onEditProvider: (provider: LocalAIProvider) => void;
  onDeleteProvider: (provider: LocalAIProvider) => void;
  onCreateLLM: () => void;
  onEditLLM: (llm: LocalLLM) => void;
  onToggleLLM: (llm: LocalLLM) => void;
  onDeleteLLM: (llm: LocalLLM) => void;
};

export const LLMsPanel = ({
  providers,
  llms,
  onCreateProvider,
  onEditProvider,
  onDeleteProvider,
  onCreateLLM,
  onEditLLM,
  onToggleLLM,
  onDeleteLLM,
}: LLMsPanelProps) => {
  const t = useTranslate();

  return (
    <>
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

      <SettingGroup
        title={t("setting.ai.integrations-title")}
        description={t("setting.ai.integrations-description")}
        actions={
          <Button onClick={onCreateProvider}>
            <PlusIcon className="w-4 h-4 mr-2" />
            {t("setting.ai.add-provider")}
          </Button>
        }
      >
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
                    <DropdownMenuItem onClick={() => onEditProvider(provider)}>{t("common.edit")}</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onDeleteProvider(provider)} className="text-destructive focus:text-destructive">
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
        title={t("setting.ai.llms-title")}
        description={t("setting.ai.llms-description")}
        showSeparator
        actions={
          <Button onClick={onCreateLLM} disabled={providers.length === 0}>
            <PlusIcon className="w-4 h-4 mr-2" />
            {t("setting.ai.add-llm")}
          </Button>
        }
      >
        <SettingTable
          columns={[
            {
              key: "title",
              header: t("common.name"),
              render: (_, llm: LocalLLM) => (
                <div className="flex flex-col gap-0.5">
                  <span className="text-foreground">{llm.title}</span>
                  <span className="font-mono text-xs text-muted-foreground">{llm.id}</span>
                </div>
              ),
            },
            {
              key: "providerId",
              header: t("setting.ai.llm-provider"),
              render: (_, llm: LocalLLM) => {
                const provider = providers.find((item) => item.id === llm.providerId);
                return <span>{provider ? provider.title || provider.id : "-"}</span>;
              },
            },
            {
              key: "model",
              header: t("setting.ai.llm-model"),
              render: (_, llm: LocalLLM) => <span className="font-mono text-xs">{llm.model}</span>,
            },
            {
              key: "enabled",
              header: t("setting.ai.llm-enabled"),
              render: (_, llm: LocalLLM) => (
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={llm.enabled}
                  onChange={() => onToggleLLM(llm)}
                  aria-label={t("setting.ai.llm-toggle-aria", { name: llm.title })}
                />
              ),
            },
            {
              key: "actions",
              header: "",
              className: "text-right",
              render: (_, llm: LocalLLM) => (
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
                    <MoreVerticalIcon className="w-4 h-auto" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" sideOffset={2}>
                    <DropdownMenuItem onClick={() => onEditLLM(llm)}>{t("common.edit")}</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onDeleteLLM(llm)} className="text-destructive focus:text-destructive">
                      {t("common.delete")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ),
            },
          ]}
          data={llms}
          emptyMessage={providers.length === 0 ? t("setting.ai.llm-empty-providers") : t("setting.ai.no-llms")}
          getRowKey={(llm) => llm.id}
        />
      </SettingGroup>
    </>
  );
};
