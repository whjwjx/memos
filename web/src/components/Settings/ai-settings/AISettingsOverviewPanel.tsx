import { useTranslate } from "@/utils/i18n";
import SettingGroup from "../SettingGroup";
import { SettingPanel } from "../SettingList";

export const AISettingsOverviewPanel = ({
  enabledChatAgentCount,
  enabledLLMCount,
  enabledToolCount,
  llmCount,
  memoryEnabled,
  memoryEntryCount,
  translationEnabled,
  translationLLMLabel,
}: {
  enabledChatAgentCount: number;
  enabledLLMCount: number;
  enabledToolCount: number;
  llmCount: number;
  memoryEnabled: boolean;
  memoryEntryCount: number;
  translationEnabled: boolean;
  translationLLMLabel: string;
}) => {
  const t = useTranslate();
  const translationStatus = translationEnabled ? t("setting.ai.overview-status-enabled") : t("setting.ai.overview-status-disabled");
  const memoryStatus = memoryEnabled ? t("setting.ai.overview-status-enabled") : t("setting.ai.overview-status-disabled");

  return (
    <SettingGroup title={t("setting.ai.overview-title")} description={t("setting.ai.overview-description")}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <SettingPanel className="px-4 py-3">
          <div className="text-xs text-muted-foreground">{t("setting.ai.llms-tab")}</div>
          <div className="mt-1 text-2xl font-semibold text-foreground">{llmCount}</div>
          <div className="text-xs text-muted-foreground">{t("setting.ai.overview-llms-detail", { count: enabledLLMCount })}</div>
        </SettingPanel>
        <SettingPanel className="px-4 py-3">
          <div className="text-xs text-muted-foreground">{t("setting.ai.agents-tab")}</div>
          <div className="mt-1 text-2xl font-semibold text-foreground">{enabledChatAgentCount}</div>
          <div className="text-xs text-muted-foreground">{t("setting.ai.overview-agents-detail")}</div>
        </SettingPanel>
        <SettingPanel className="px-4 py-3">
          <div className="text-xs text-muted-foreground">{t("setting.ai.tools-tab")}</div>
          <div className="mt-1 text-2xl font-semibold text-foreground">{enabledToolCount}</div>
          <div className="text-xs text-muted-foreground">{t("setting.ai.overview-tools-detail")}</div>
        </SettingPanel>
        <SettingPanel className="px-4 py-3">
          <div className="text-xs text-muted-foreground">{t("setting.ai.translation-tab")}</div>
          <div className="mt-1 text-lg font-semibold text-foreground">{translationStatus}</div>
          <div className="text-xs text-muted-foreground">{translationLLMLabel}</div>
        </SettingPanel>
        <SettingPanel className="px-4 py-3">
          <div className="text-xs text-muted-foreground">{t("setting.ai.memory-tab")}</div>
          <div className="mt-1 text-lg font-semibold text-foreground">{memoryStatus}</div>
          <div className="text-xs text-muted-foreground">{t("setting.ai.overview-memory-detail", { count: memoryEntryCount })}</div>
        </SettingPanel>
      </div>
    </SettingGroup>
  );
};
