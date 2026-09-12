import { ChevronDownIcon, Globe2Icon } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { InstanceSetting_WebSearchProvider } from "@/types/proto/api/v1/instance_service_pb";
import { useTranslate } from "@/utils/i18n";
import SettingGroup from "../SettingGroup";
import { SettingPanel } from "../SettingList";
import SettingTable from "../SettingTable";
import { toolRegistry } from "./toolRegistry";
import type { LocalWebSearch } from "./types";

export type ChatToolItem = {
  name: string;
  enabled: boolean;
  requiresConfirmation: boolean;
};

export const ChatToolsPanel = ({
  tools,
  webSearch,
  onToggleTool,
  onToggleToolConfirmation,
  onChangeWebSearch,
  onSaveWebSearch,
}: {
  tools: ChatToolItem[];
  webSearch: LocalWebSearch;
  onToggleTool: (tool: ChatToolItem) => void;
  onToggleToolConfirmation: (tool: ChatToolItem) => void;
  onChangeWebSearch: (webSearch: LocalWebSearch) => void;
  onSaveWebSearch: () => void;
}) => {
  const t = useTranslate();
  const [webSearchOpen, setWebSearchOpen] = useState(false);
  const toolMetaByName = useMemo(() => new Map(toolRegistry.map((item) => [item.name, item])), []);
  const updateWebSearch = (partial: Partial<LocalWebSearch>) => onChangeWebSearch({ ...webSearch, ...partial });
  const webSearchHasKey = webSearch.apiKeySet || webSearch.apiKey.trim() !== "";

  return (
    <>
      <SettingGroup title={t("setting.ai.third-party-tools-title")} description={t("setting.ai.third-party-tools-description")}>
        <SettingPanel className="divide-y divide-border">
          <div className="flex min-w-0 flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <Globe2Icon className="size-4" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{t("setting.ai.web-search-title")}</span>
                  <Badge variant={webSearch.enabled ? "default" : "outline"} shape="pill">
                    {webSearch.enabled ? t("setting.ai.web-search-status-enabled") : t("setting.ai.web-search-status-disabled")}
                  </Badge>
                  <Badge variant={webSearchHasKey ? "secondary" : "warning"} shape="pill">
                    {webSearchHasKey ? t("setting.ai.web-search-api-key-configured") : t("setting.ai.web-search-api-key-missing")}
                  </Badge>
                </div>
                <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">{t("setting.ai.web-search-description")}</p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full justify-between sm:w-auto sm:justify-center"
              aria-expanded={webSearchOpen}
              aria-controls="ai-web-search-config"
              onClick={() => setWebSearchOpen((open) => !open)}
            >
              {webSearchOpen ? t("setting.ai.integration-collapse") : t("setting.ai.integration-configure")}
              <ChevronDownIcon className={cn("size-4 transition-transform", webSearchOpen && "rotate-180")} />
            </Button>
          </div>

          {webSearchOpen && (
            <div id="ai-web-search-config" className="px-4 py-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 sm:col-span-2">
                  <span className="text-sm font-medium text-foreground">{t("setting.ai.web-search-enabled")}</span>
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={webSearch.enabled}
                    onChange={() => updateWebSearch({ enabled: !webSearch.enabled })}
                    aria-label={t("setting.ai.web-search-enabled")}
                  />
                </label>

                <div className="flex flex-col gap-1.5">
                  <Label>{t("setting.ai.web-search-provider")}</Label>
                  <Select
                    value={String(webSearch.provider)}
                    items={[{ value: String(InstanceSetting_WebSearchProvider.TAVILY), label: "Tavily" }]}
                    onValueChange={(value) => updateWebSearch({ provider: Number(value) as InstanceSetting_WebSearchProvider })}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={String(InstanceSetting_WebSearchProvider.TAVILY)}>Tavily</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label>{t("setting.ai.web-search-depth")}</Label>
                  <Select
                    value={webSearch.searchDepth || "basic"}
                    items={[
                      { value: "basic", label: t("setting.ai.web-search-depth-basic") },
                      { value: "advanced", label: t("setting.ai.web-search-depth-advanced") },
                    ]}
                    onValueChange={(value) => updateWebSearch({ searchDepth: value })}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="basic">{t("setting.ai.web-search-depth-basic")}</SelectItem>
                      <SelectItem value="advanced">{t("setting.ai.web-search-depth-advanced")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <Label>{t("setting.ai.endpoint")}</Label>
                  <Input
                    value={webSearch.endpoint}
                    onChange={(e) => updateWebSearch({ endpoint: e.target.value })}
                    placeholder="https://api.tavily.com"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label>{t("setting.ai.api-key")}</Label>
                  <Input
                    type="password"
                    value={webSearch.apiKey}
                    onChange={(e) => updateWebSearch({ apiKey: e.target.value })}
                    placeholder={webSearch.apiKeySet ? t("setting.ai.keep-api-key") : ""}
                  />
                  {webSearch.apiKeySet && (
                    <p className="text-xs text-muted-foreground">{t("setting.ai.current-key", { key: webSearch.apiKeyHint || "-" })}</p>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label>{t("setting.ai.web-search-max-results")}</Label>
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={webSearch.maxResults}
                    onChange={(e) => updateWebSearch({ maxResults: Number(e.target.value) })}
                  />
                </div>

                <label className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 sm:col-span-2">
                  <span className="text-sm text-muted-foreground">{t("setting.ai.web-search-include-answer")}</span>
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={webSearch.includeAnswer}
                    onChange={() => updateWebSearch({ includeAnswer: !webSearch.includeAnswer })}
                    aria-label={t("setting.ai.web-search-include-answer")}
                  />
                </label>

                <div className="flex justify-end sm:col-span-2">
                  <Button className="w-full sm:w-auto" onClick={onSaveWebSearch}>
                    {t("common.save")}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </SettingPanel>
      </SettingGroup>

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
    </>
  );
};
