import { useTranslate } from "@/utils/i18n";
import SettingGroup from "../SettingGroup";
import SettingTable from "../SettingTable";
import { toolRegistry } from "./toolRegistry";

export type ChatToolItem = {
  name: string;
  enabled: boolean;
  requiresConfirmation: boolean;
};

export const ChatToolsPanel = ({
  tools,
  onToggleTool,
  onToggleToolConfirmation,
}: {
  tools: ChatToolItem[];
  onToggleTool: (tool: ChatToolItem) => void;
  onToggleToolConfirmation: (tool: ChatToolItem) => void;
}) => {
  const t = useTranslate();

  return (
    <SettingGroup title={t("setting.ai.chat-tools-title")} description={t("setting.ai.chat-tools-description")} showSeparator>
      <SettingTable
        columns={[
          {
            key: "name",
            header: t("common.name"),
            render: (_, tool: ChatToolItem) => {
              const meta = toolRegistry.find((item) => item.name === tool.name);
              return (
                <div className="flex flex-col gap-0.5">
                  <span className="text-foreground">{tool.name}</span>
                  {meta && <span className="text-xs text-muted-foreground">{t(meta.descriptionKey as Parameters<typeof t>[0])}</span>}
                </div>
              );
            },
          },
          {
            key: "scope",
            header: t("setting.ai.chat-tool-scope"),
            render: (_, tool: ChatToolItem) => {
              const meta = toolRegistry.find((item) => item.name === tool.name);
              return <span>{meta?.adminOnly ? t("setting.ai.chat-tool-admin") : t("setting.ai.chat-tool-user")}</span>;
            },
          },
          {
            key: "enabled",
            header: t("setting.ai.chat-tool-enabled"),
            render: (_, tool: ChatToolItem) => (
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={tool.enabled}
                onChange={() => onToggleTool(tool)}
                aria-label={t("setting.ai.chat-tool-toggle-aria", { name: tool.name })}
              />
            ),
          },
          {
            key: "requiresConfirmation",
            header: t("setting.ai.chat-tool-confirm"),
            render: (_, tool: ChatToolItem) => {
              const meta = toolRegistry.find((item) => item.name === tool.name);
              const locked = meta?.confirmEditable === false;
              return (
                <input
                  type="checkbox"
                  className="size-4 accent-primary disabled:cursor-not-allowed disabled:opacity-40"
                  checked={locked ? false : tool.requiresConfirmation}
                  disabled={locked}
                  onChange={() => onToggleToolConfirmation(tool)}
                  aria-label={t("setting.ai.chat-tool-confirm-toggle-aria", { name: tool.name })}
                />
              );
            },
          },
        ]}
        data={tools}
        emptyMessage={t("setting.ai.no-chat-tools")}
        getRowKey={(tool) => tool.name}
      />
    </SettingGroup>
  );
};
