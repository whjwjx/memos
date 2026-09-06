import dayjs from "dayjs";
import { useState } from "react";
import { calculateMaxCount, MonthCalendar } from "@/components/ActivityCalendar";
import { useMemoFilterContext } from "@/contexts/MemoFilterContext";
import { useDateFilterNavigation } from "@/hooks";
import type { StatisticsData, StatisticsSummary } from "@/types/statistics";
import { useTranslate } from "@/utils/i18n";
import { MonthNavigator } from "./MonthNavigator";

interface Props {
  statisticsData: StatisticsData;
  loading?: boolean;
  onDateSelect?: () => void;
  summary: StatisticsSummary;
  /** When set, day clicks land on this route with the date filter instead of filtering the current one. */
  navigationTarget?: string;
}

const StatisticsView = (props: Props) => {
  const { loading, statisticsData, summary } = props;
  const t = useTranslate();
  const { activityStats, timeBasis } = statisticsData;
  const { filters } = useMemoFilterContext();
  const navigateToDateFilter = useDateFilterNavigation(props.navigationTarget);
  const [visibleMonthString, setVisibleMonthString] = useState(dayjs().format("YYYY-MM"));
  const selectedDate = filters.find((filter) => filter.factor === "displayTime")?.value;
  const summaryItems = [
    { key: "notes", label: t("statistics-summary.notes"), value: summary.memoCount },
    { key: "tags", label: t("statistics-summary.tags"), value: summary.tagCount },
    { key: "days", label: t("statistics-summary.days"), value: summary.activeDays },
  ];

  return (
    <div className="group flex w-full flex-col text-muted-foreground animate-fade-in">
      <div className="grid grid-cols-3 gap-2 px-1 pb-3 pt-1">
        {summaryItems.map((item) => (
          <div key={item.key} className="min-w-0">
            <div className="truncate text-2xl font-semibold leading-8 text-muted-foreground tabular-nums">
              {loading ? <span className="inline-block h-6 w-8 animate-pulse rounded bg-muted align-middle" /> : item.value}
            </div>
            <div className="mt-0.5 truncate text-xs leading-4 text-muted-foreground/80">{item.label}</div>
          </div>
        ))}
      </div>
      <MonthNavigator visibleMonth={visibleMonthString} onMonthChange={setVisibleMonthString} />

      <div className="w-full animate-scale-in">
        <MonthCalendar
          month={visibleMonthString}
          data={activityStats}
          maxCount={calculateMaxCount(activityStats)}
          selectedDate={selectedDate}
          onClick={(date) => {
            navigateToDateFilter(date);
            props.onDateSelect?.();
          }}
          timeBasis={timeBasis}
        />
      </div>
    </div>
  );
};

export default StatisticsView;
