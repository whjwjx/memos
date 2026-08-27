import { create } from "@bufbuild/protobuf";
import { useQuery } from "@tanstack/react-query";
import { isEqual } from "lodash-es";
import { RefreshCwIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { instanceServiceClient } from "@/connect";
import { useInstance } from "@/contexts/InstanceContext";
import { InstanceSetting_Key, InstanceSettingSchema, LogSetting, LogSettingSchema } from "@/types/proto/api/v1/instance_service_pb";
import { useTranslate } from "@/utils/i18n";
import SettingGroup from "./SettingGroup";
import { SettingList, SettingListItem, SettingPanel } from "./SettingList";
import SettingSection from "./SettingSection";
import useInstanceSettingUpdater, { buildInstanceSettingName } from "./useInstanceSettingUpdater";

const formatBytes = (bytes: number | bigint): string => {
  const n = typeof bytes === "bigint" ? Number(bytes) : bytes;
  if (n < 0) return "—";
  if (n === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};

const formatTime = (ts: number): string => new Date(ts).toLocaleTimeString();

const StatValue = ({ value }: { value: string }) => (
  <span className="block min-w-0 max-w-full break-all text-right font-mono text-sm tabular-nums text-foreground">{value}</span>
);

const StatRow = ({ label, value }: { label: string; value: string }) => (
  <SettingListItem label={label} controlClassName="w-full justify-end sm:w-auto">
    <StatValue value={value} />
  </SettingListItem>
);

const LogSection = () => {
  const t = useTranslate();
  const saveInstanceSetting = useInstanceSettingUpdater();
  const { logSetting: originalSetting } = useInstance();
  const [logSetting, setLogSetting] = useState<LogSetting>(originalSetting);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  const {
    data: logStats,
    refetch: refetchLogStats,
    isFetching: isLogStatsFetching,
  } = useQuery({
    queryKey: ["instanceLogStats"],
    queryFn: () => instanceServiceClient.getInstanceLogStats({}),
  });

  useEffect(() => {
    setLogSetting(originalSetting);
  }, [originalSetting]);

  useEffect(() => {
    if (logStats && lastUpdatedAt === null) {
      setLastUpdatedAt(Date.now());
    }
  }, [logStats, lastUpdatedAt]);

  const handleRefreshLogStats = async () => {
    const result = await refetchLogStats();
    if (result.data) {
      setLastUpdatedAt(Date.now());
    }
  };

  const updateLocalState = (partial: Partial<LogSetting>) => {
    setLogSetting((prev) => ({ ...prev, ...partial }));
  };

  const handleSaveLogSetting = async () => {
    const setting = create(InstanceSettingSchema, {
      name: buildInstanceSettingName(InstanceSetting_Key.LOG),
      value: {
        case: "logSetting",
        value: create(LogSettingSchema, {
          enabled: logSetting.enabled ?? false,
          retentionDays: logSetting.retentionDays || 3,
        }),
      },
    });
    const saved = await saveInstanceSetting({ key: InstanceSetting_Key.LOG, setting, errorContext: "setting.log.title" });
    if (saved) {
      void refetchLogStats();
    }
  };

  return (
    <SettingSection title={t("setting.log.title")} description={t("setting.log.description")}>
      <SettingGroup title={t("setting.log.retention-title")} description={t("setting.log.retention-description")}>
        <SettingList>
          <SettingListItem label={t("setting.log.enabled")} description={t("setting.log.enabled-description")}>
            <Switch checked={logSetting.enabled ?? false} onCheckedChange={(checked) => updateLocalState({ enabled: checked })} />
          </SettingListItem>
          <SettingListItem label={t("setting.log.retention-days")} description={t("setting.log.retention-days-description")}>
            <Input
              className="w-24 text-right"
              type="number"
              min={1}
              max={3650}
              value={logSetting.retentionDays || 3}
              onChange={(event) => updateLocalState({ retentionDays: Number(event.target.value) || 0 })}
            />
          </SettingListItem>
        </SettingList>
        <div className="mt-2 flex justify-end">
          <Button size="sm" disabled={isEqual(logSetting, originalSetting)} onClick={() => void handleSaveLogSetting()}>
            {t("common.save")}
          </Button>
        </div>
      </SettingGroup>

      <SettingGroup
        title={t("setting.log.stats-title")}
        showSeparator
        actions={
          <>
            {lastUpdatedAt ? (
              <span className="text-xs text-muted-foreground">{t("setting.log.last-updated", { time: formatTime(lastUpdatedAt) })}</span>
            ) : null}
            <Button variant="outline" size="sm" disabled={isLogStatsFetching} onClick={() => void handleRefreshLogStats()}>
              <RefreshCwIcon className="mr-1 size-4" />
              {t("setting.log.refresh")}
            </Button>
          </>
        }
      >
        {logStats ? (
          <SettingList>
            <StatRow label={t("setting.log.file-count")} value={`${logStats.fileCount}`} />
            <StatRow label={t("setting.log.total-size")} value={formatBytes(logStats.totalBytes)} />
          </SettingList>
        ) : (
          <SettingPanel>
            <div className="px-3 py-3 text-sm text-muted-foreground">…</div>
          </SettingPanel>
        )}
      </SettingGroup>
    </SettingSection>
  );
};

export default LogSection;
