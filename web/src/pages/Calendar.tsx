import dayjs from "dayjs";
import { ChevronLeftIcon, ChevronRightIcon, LoaderCircleIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTodayDate, useWeekdayLabels } from "@/components/ActivityCalendar/hooks";
import { MemoView } from "@/components/MemoView";
import { Button } from "@/components/ui/button";
import { useGeneralSetting } from "@/hooks/useInstanceQueries";
import { useInfiniteMemos } from "@/hooks/useMemoQueries";
import i18n from "@/i18n";
import { addMonths, formatMonth } from "@/lib/calendar-utils";
import { cn } from "@/lib/utils";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";
import { formatScheduleTooltip, getScheduleTimeRange, type ScheduleTimeRange } from "@/utils/schedule";

// 只请求设置了排程时间的 memo。scheduled_ts 在 CEL 中是 Timestamp 类型，
// 用 `> timestamp("1970-01-01T00:00:00Z")` 表达"已设置"（NULL 在 SQL 比较中会被排除）。
const SCHEDULED_MEMOS_FILTER = 'scheduled_ts > timestamp("1970-01-01T00:00:00Z")';

// 月视图格子最多展示的排程块数量，超出部分折叠为 "+N"。
const MAX_BLOCKS_PER_CELL = 3;

interface CalendarDayCell {
  iso: string;
  date: dayjs.Dayjs;
  isCurrentMonth: boolean;
}

const buildMonthMatrix = (month: string, weekStartOffset: number): CalendarDayCell[] => {
  const firstOfMonth = dayjs(`${month}-01`);
  const startOffset = (firstOfMonth.day() - weekStartOffset + 7) % 7;
  const totalCells = Math.ceil((startOffset + firstOfMonth.daysInMonth()) / 7) * 7;
  return Array.from({ length: totalCells }, (_, index) => {
    const date = firstOfMonth.add(index - startOffset, "day");
    return {
      iso: date.format("YYYY-MM-DD"),
      date,
      isCurrentMonth: date.month() === firstOfMonth.month(),
    };
  });
};

interface ScheduledItem {
  memo: Memo;
  range: ScheduleTimeRange;
}

const createTimeFormatter = (language: string): Intl.DateTimeFormat =>
  new Intl.DateTimeFormat(language, {
    hour: "numeric",
    minute: "2-digit",
    hourCycle: language.toLowerCase().startsWith("zh") ? "h23" : "h12",
  });

const CalendarPage = () => {
  const t = useTranslate();
  const todayDate = useTodayDate();
  const weekdayLabels = useWeekdayLabels();
  const { data: generalSetting } = useGeneralSetting();
  const weekStartOffset = generalSetting?.weekStartDayOffset ?? 0;

  const [month, setMonth] = useState<string>(() => formatMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState<string>(todayDate);

  const { data, fetchNextPage, hasNextPage, isFetching } = useInfiniteMemos({ filter: SCHEDULED_MEMOS_FILTER });

  // 排程 memo 数量通常有限，自动拉取剩余分页以确保完整。
  useEffect(() => {
    if (hasNextPage && !isFetching) {
      void fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetching]);

  const scheduledMemos = useMemo(
    () => (data?.pages.flatMap((page) => page.memos) ?? []).filter((memo) => memo.scheduledTime),
    [data],
  );

  const scheduleItemsByDate = useMemo(() => {
    const map = new Map<string, ScheduledItem[]>();
    for (const memo of scheduledMemos) {
      const range = getScheduleTimeRange(memo);
      if (!range) {
        continue;
      }
      const iso = dayjs(range.start).format("YYYY-MM-DD");
      const group = map.get(iso) ?? [];
      group.push({ memo, range });
      map.set(iso, group);
    }
    for (const group of map.values()) {
      group.sort((a, b) => a.range.start.getTime() - b.range.start.getTime());
    }
    return map;
  }, [scheduledMemos]);

  const monthCells = useMemo(() => buildMonthMatrix(month, weekStartOffset), [month, weekStartOffset]);
  const selectedItems = selectedDate ? (scheduleItemsByDate.get(selectedDate) ?? []) : [];

  const timeFormatter = useMemo(() => createTimeFormatter(i18n.language), [i18n.language]);

  const monthTitle = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { year: "numeric", month: "long" }).format(dayjs(`${month}-01`).toDate()),
    [month, i18n.language],
  );

  const selectedDateTitle = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, { weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(
        dayjs(selectedDate).toDate(),
      ),
    [selectedDate, i18n.language],
  );

  // useWeekdayLabels 固定从周日开始，按用户偏好的周起始日旋转表头以对齐网格。
  const rotatedWeekdayLabels = useMemo(
    () => [...weekdayLabels.slice(weekStartOffset), ...weekdayLabels.slice(0, weekStartOffset)],
    [weekdayLabels, weekStartOffset],
  );

  const handleSelectDate = (iso: string, date: dayjs.Dayjs) => {
    setSelectedDate(iso);
    if (date.format("YYYY-MM") !== month) {
      setMonth(date.format("YYYY-MM"));
    }
  };

  const formatBlockText = (item: ScheduledItem): string => {
    const start = timeFormatter.format(item.range.start);
    if (!item.range.end) {
      return start;
    }
    return `${start}–${timeFormatter.format(item.range.end)}`;
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 py-4">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("calendar.previous-month")}
            onClick={() => setMonth(addMonths(month, -1))}
          >
            <ChevronLeftIcon className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("calendar.next-month")}
            onClick={() => setMonth(addMonths(month, 1))}
          >
            <ChevronRightIcon className="size-4" />
          </Button>
          <h2 className="ml-1 text-lg font-semibold">{monthTitle}</h2>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setMonth(formatMonth(new Date()));
            setSelectedDate(todayDate);
          }}
        >
          {t("common.today")}
        </Button>
      </header>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border bg-border">
        {rotatedWeekdayLabels.map((label) => (
          <div key={label} className="bg-card px-2 py-1.5 text-center text-xs font-medium text-muted-foreground">
            {label}
          </div>
        ))}
        {monthCells.map((cell) => {
          const items = scheduleItemsByDate.get(cell.iso) ?? [];
          const isToday = cell.iso === todayDate;
          const isSelected = cell.iso === selectedDate;
          return (
            <button
              key={cell.iso}
              type="button"
              aria-label={cell.date.format("YYYY-MM-DD")}
              onClick={() => handleSelectDate(cell.iso, cell.date)}
              className={cn(
                "flex min-h-16 flex-col items-stretch gap-0.5 bg-card p-1 text-left transition-colors hover:bg-accent/50",
                !cell.isCurrentMonth && "bg-muted/30",
                isSelected && "ring-1 ring-inset ring-primary",
              )}
            >
              <span
                className={cn(
                  "px-1 text-xs",
                  !cell.isCurrentMonth && "text-muted-foreground",
                  isToday && "font-bold text-primary",
                )}
              >
                {cell.date.date()}
              </span>
              {items.slice(0, MAX_BLOCKS_PER_CELL).map((item) => (
                <span
                  key={item.memo.name}
                  title={formatScheduleTooltip(item.range, i18n.language)}
                  className="truncate rounded bg-primary/10 px-1 py-0.5 text-[10px] leading-3 text-primary"
                >
                  {formatBlockText(item)}
                </span>
              ))}
              {items.length > MAX_BLOCKS_PER_CELL && (
                <span className="px-1 text-[10px] leading-3 text-muted-foreground">
                  +{items.length - MAX_BLOCKS_PER_CELL}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <section className="flex flex-col gap-3">
        <h3 className="text-base font-semibold">{selectedDateTitle}</h3>
        {isFetching && selectedItems.length === 0 ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <LoaderCircleIcon className="size-5 animate-spin" />
          </div>
        ) : selectedItems.length === 0 ? (
          <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
            {t("calendar.no-schedules")}
          </div>
        ) : (
          selectedItems.map(({ memo }) => (
            <MemoView key={memo.name} memo={memo} compact showCreator={false} showVisibility={false} />
          ))
        )}
      </section>
    </div>
  );
};

export default CalendarPage;
