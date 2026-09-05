import { MoreVerticalIcon, PlusIcon } from "lucide-react";
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
        <div className="flex flex-wrap items-center gap-2">
          {templates.map((template) => (
            <Button key={template.name} variant="outline" onClick={() => onCreateAgentFromTemplate(template)}>
              <PlusIcon className="w-4 h-4 mr-2" />
              {template.name}
            </Button>
          ))}
          <Button onClick={onCreateAgent}>
            <PlusIcon className="w-4 h-4 mr-2" />
            {t("setting.ai.add-chat-agent")}
          </Button>
        </div>
      }
    >
      <SettingTable
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
