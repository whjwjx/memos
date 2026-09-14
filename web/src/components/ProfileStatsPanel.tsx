import dayjs from "dayjs";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { UserProfileStats } from "@/types/proto/api/v1/user_service_pb";
import { useTranslate } from "@/utils/i18n";

interface Props {
  stats?: UserProfileStats;
}

const CELL_CLASSES = ["bg-muted", "bg-primary/25", "bg-primary/45", "bg-primary/70", "bg-primary"];

type ContributionDay = {
  date: string;
  count: number;
  level: number;
  inYear: boolean;
};

const buildContributionWeeks = (year: number, stats?: UserProfileStats) => {
  const activityByDate = new Map(stats?.dailyActivity.map((day) => [day.date, day.count]) ?? []);
  const yearStart = dayjs(`${year}-01-01`).startOf("year");
  const yearEnd = dayjs(`${year}-12-31`).endOf("year");
  const gridStart = yearStart.startOf("week");
  const gridEnd = yearEnd.endOf("week");
  const yearCounts = Array.from(activityByDate.entries())
    .filter(([date]) => dayjs(date).year() === year)
    .map(([, count]) => count);
  const maxCount = Math.max(...yearCounts, 0);
  const weeks: ContributionDay[][] = [];
  let cursor = gridStart;

  while (cursor.isBefore(gridEnd) || cursor.isSame(gridEnd, "day")) {
    const week: ContributionDay[] = [];
    for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
      const date = cursor.add(dayIndex, "day");
      const dateString = date.format("YYYY-MM-DD");
      const inYear = date.year() === year;
      const count = inYear ? (activityByDate.get(dateString) ?? 0) : 0;
      const level = count === 0 || maxCount === 0 ? 0 : Math.max(1, Math.ceil((count / maxCount) * 4));
      week.push({ date: dateString, count, level, inYear });
    }
    weeks.push(week);
    cursor = cursor.add(1, "week");
  }

  return weeks;
};

const ProfileStatsPanel = ({ stats }: Props) => {
  const t = useTranslate();
  const scrollRef = useRef<HTMLDivElement>(null);
  const currentYear = dayjs().year();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const firstActivityYear = useMemo(() => {
    const firstActivity = stats?.dailyActivity.find((day) => day.count > 0);
    return firstActivity ? dayjs(firstActivity.date).year() : currentYear;
  }, [currentYear, stats?.dailyActivity]);
  const contributionWeeks = useMemo(() => buildContributionWeeks(selectedYear, stats), [selectedYear, stats]);
  const monthLabels = useMemo(
    () =>
      contributionWeeks.map((week) => {
        const firstDayOfMonth = week.find((day) => day.inYear && dayjs(day.date).date() === 1);
        return firstDayOfMonth ? dayjs(firstDayOfMonth.date).format("MMM") : "";
      }),
    [contributionWeeks],
  );
  const canGoPrev = selectedYear > firstActivityYear;
  const canGoNext = selectedYear < currentYear;

  useEffect(() => {
    if (selectedYear < firstActivityYear) {
      setSelectedYear(firstActivityYear);
    }
  }, [firstActivityYear, selectedYear]);

  useEffect(() => {
    const scrollContainer = scrollRef.current;
    if (!scrollContainer) {
      return;
    }

    scrollContainer.scrollLeft = scrollContainer.scrollWidth;
  }, [selectedYear, stats?.dailyActivity.length]);

  return (
    <div className="rounded-lg border border-border bg-background px-4 py-3 shadow-xs">
      <div className="mb-2 flex justify-end">
        <div className="inline-flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={!canGoPrev}
            aria-label="Previous year"
            className="size-6 rounded-md text-muted-foreground/70 hover:bg-muted/50 hover:text-foreground"
            onClick={() => canGoPrev && setSelectedYear(selectedYear - 1)}
          >
            <ChevronLeftIcon className="size-3.5 rtl:rotate-180" strokeWidth={1.75} />
          </Button>
          <div className="min-w-10 text-center text-sm font-medium tabular-nums text-foreground">{selectedYear}</div>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={!canGoNext}
            aria-label="Next year"
            className="size-6 rounded-md text-muted-foreground/70 hover:bg-muted/50 hover:text-foreground"
            onClick={() => canGoNext && setSelectedYear(selectedYear + 1)}
          >
            <ChevronRightIcon className="size-3.5 rtl:rotate-180" strokeWidth={1.75} />
          </Button>
        </div>
      </div>
      <div ref={scrollRef} className="overflow-x-auto pb-1">
        <div className="w-max">
          <div className="mb-1 flex gap-1 text-[10px] leading-3 text-muted-foreground/55">
            {monthLabels.map((label, weekIndex) => (
              <div key={`${selectedYear}-${weekIndex}`} className="relative h-3 w-2.5 shrink-0">
                {label && <span className="absolute left-0 top-0 whitespace-nowrap">{label}</span>}
              </div>
            ))}
          </div>
          <div className="flex gap-1">
            {contributionWeeks.map((week, weekIndex) => (
              <div key={weekIndex} className="grid grid-rows-7 gap-1">
                {week.map((day) => (
                  <div
                    key={day.date}
                    className={cn("size-2.5 rounded-[2px]", day.inYear ? CELL_CLASSES[day.level] : "bg-transparent")}
                    title={t("profile.stats.day-count", { count: day.count, date: day.date })}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfileStatsPanel;
