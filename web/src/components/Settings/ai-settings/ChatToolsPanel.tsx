import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
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
  const toolMetaByName = useMemo(() => new Map(toolRegistry.map((item) => [item.name, item])), []);

  return (
    <SettingGroup title={t("setting.ai.chat-tools-title")} description={t("setting.ai.chat-tools-description")} showSeparator>
      <div className="flex flex-col gap-2 md:hidden">
        {tools.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            {t("setting.ai.no-chat-tools")}
          </div>
        ) : (
          tools.map((tool) => {
            const meta = toolMetaByName.get(tool.name);
            const locked = meta?.confirmEditable === false;
            return (
              <div key={tool.name} className="rounded-lg border border-border bg-background px-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-medium text-foreground">{tool.name}</span>
                      <Badge variant={meta?.adminOnly ? "outline" : "secondary"} shape="pill">
                        {meta?.adminOnly ? t("setting.ai.chat-tool-admin") : t("setting.ai.chat-tool-user")}
                      </Badge>
                    </div>
                    {meta && (
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{t(meta.descriptionKey as Parameters<typeof t>[0])}</p>
                    )}
                  </div>
                  <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    <span>{t("setting.ai.chat-tool-enabled")}</span>
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={tool.enabled}
                      onChange={() => onToggleTool(tool)}
                      aria-label={t("setting.ai.chat-tool-toggle-aria", { name: tool.name })}
                    />
                  </label>
                </div>
                {!locked && (
                  <label className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3 text-sm">
                    <span className="text-muted-foreground">{t("setting.ai.chat-tool-confirm")}</span>
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={tool.requiresConfirmation}
                      onChange={() => onToggleToolConfirmation(tool)}
                      aria-label={t("setting.ai.chat-tool-confirm-toggle-aria", { name: tool.name })}
                    />
                  </label>
                )}
              </div>
            );
          })
        )}
      </div>
      <SettingTable
        className="hidden md:block"
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
