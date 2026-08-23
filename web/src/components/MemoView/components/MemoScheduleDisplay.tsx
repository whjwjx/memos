import { CalendarClockIcon } from "lucide-react";
import { useMemo } from "react";
import i18n from "@/i18n";
import { useTranslate } from "@/utils/i18n";
import { formatScheduleTimeRange, formatScheduleTooltip, getScheduleTimeRange } from "@/utils/schedule";
import { useMemoViewContext } from "../MemoViewContext";

const MemoScheduleDisplay: React.FC = () => {
  const t = useTranslate();
  const { memo } = useMemoViewContext();

  const schedule = useMemo(() => getScheduleTimeRange(memo), [memo.scheduledTime, memo.scheduledDuration]);

  if (!schedule) {
    return null;
  }

  const displayText = formatScheduleTimeRange(schedule, {
    language: i18n.language,
    todayText: t("memo.schedule.today"),
    tomorrowText: t("memo.schedule.tomorrow"),
  });
  const tooltipText = formatScheduleTooltip(schedule, i18n.language);

  return (
    <div
      title={tooltipText}
      className="inline-flex max-w-full min-w-0 items-center gap-1 h-7 px-2 rounded-md border border-dashed border-border bg-muted/30 text-sm text-muted-foreground"
    >
      <CalendarClockIcon className="w-3.5 h-3.5 shrink-0" />
      <span className="min-w-0 truncate">{displayText}</span>
    </div>
  );
};

export default MemoScheduleDisplay;
