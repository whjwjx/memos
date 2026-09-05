import { MoreVerticalIcon, PlusIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useTranslate } from "@/utils/i18n";
import SettingGroup from "../SettingGroup";
import SettingTable from "../SettingTable";
import type { ChatAgentTemplate, LocalChatAgent } from "./types";

type AgentsPanelProps = {
  agents: LocalChatAgent[];
  templates: ChatAgentTemplate[];
  getLLMLabel: (llmId: string) => string;
  onCreateAgent: () => void;
  onCreateAgentFromTemplate: (template: ChatAgentTemplate) => void;
  onEditAgent: (agent: LocalChatAgent) => void;
  onToggleAgent: (agent: LocalChatAgent) => void;
  onDeleteAgent: (agent: LocalChatAgent) => void;
};

export const AgentsPanel = ({
  agents,
  templates,
  getLLMLabel,
  onCreateAgent,
  onCreateAgentFromTemplate,
  onEditAgent,
  onToggleAgent,
  onDeleteAgent,
}: AgentsPanelProps) => {
  const t = useTranslate();

  return (
    <SettingGroup
      title={t("setting.ai.chat-agents-title")}
      description={t("setting.ai.chat-agents-description")}
      showSeparator
      actions={
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
          {templates.map((template) => (
            <Button
              key={template.name}
              variant="outline"
              className="justify-start sm:justify-center"
              onClick={() => onCreateAgentFromTemplate(template)}
            >
              <PlusIcon className="w-4 h-4 mr-2" />
              {template.name}
            </Button>
          ))}
          <Button className="justify-start sm:justify-center" onClick={onCreateAgent}>
            <PlusIcon className="w-4 h-4 mr-2" />
            {t("setting.ai.add-chat-agent")}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-2 md:hidden">
        {agents.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            {t("setting.ai.no-chat-agents")}
          </div>
        ) : (
          agents.map((agent) => (
            <div key={agent.id} className="rounded-lg border border-border bg-background px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">{agent.name}</span>
                    <Badge variant={agent.enabled ? "default" : "secondary"} shape="pill">
                      {agent.enabled ? t("setting.ai.overview-status-enabled") : t("setting.ai.overview-status-disabled")}
                    </Badge>
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">{agent.llmId ? getLLMLabel(agent.llmId) : "-"}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={agent.enabled}
                    onChange={() => onToggleAgent(agent)}
                    aria-label={t("setting.ai.chat-agent-toggle-aria", { name: agent.name })}
                  />
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="size-8 p-0" />}>
                      <MoreVerticalIcon className="w-4 h-auto" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" sideOffset={2}>
                      <DropdownMenuItem onClick={() => onEditAgent(agent)}>{t("common.edit")}</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onDeleteAgent(agent)} className="text-destructive focus:text-destructive">
                        {t("common.delete")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
      <SettingTable
        className="hidden md:block"
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
            key: "llmId",
            header: t("setting.ai.chat-agent-llm"),
            render: (_, agent: LocalChatAgent) => <span>{agent.llmId ? getLLMLabel(agent.llmId) : "-"}</span>,
          },
          {
            key: "enabled",
            header: t("setting.ai.chat-agent-enabled"),
            render: (_, agent: LocalChatAgent) => (
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={agent.enabled}
                onChange={() => onToggleAgent(agent)}
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
                  <DropdownMenuItem onClick={() => onEditAgent(agent)}>{t("common.edit")}</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onDeleteAgent(agent)} className="text-destructive focus:text-destructive">
                    {t("common.delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ),
          },
        ]}
        data={agents}
        emptyMessage={t("setting.ai.no-chat-agents")}
        getRowKey={(agent) => agent.id}
      />
    </SettingGroup>
  );
};
