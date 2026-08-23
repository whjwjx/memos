import { create } from "@bufbuild/protobuf";
import { DurationSchema, timestampFromDate } from "@bufbuild/protobuf/wkt";
import dayjs from "dayjs";
import { CheckSquareIcon, ChevronLeftIcon, ChevronRightIcon, ClockIcon } from "lucide-react";
import { type ComponentType, useCallback, useEffect, useMemo, useState } from "react";
import { useTodayDate, useWeekdayLabels } from "@/components/ActivityCalendar/hooks";
import ActiveHoursSetting from "@/components/CalendarView/ActiveHoursSetting";
import { getWeekStart } from "@/components/CalendarView/drag-utils";
import { stripMarkdown, WeekView } from "@/components/CalendarView/WeekView";
import { loadMemoEditor } from "@/components/MemoEditor/loader";
import type { MemoEditorProps } from "@/components/MemoEditor/types";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/contexts/AuthContext";
import { useGeneralSetting } from "@/hooks/useInstanceQueries";
import useMediaQuery from "@/hooks/useMediaQuery";
import { useInfiniteMemos, useUpdateMemo } from "@/hooks/useMemoQueries";
import { useUpdateUserGeneralSetting } from "@/hooks/useUserQueries";
import i18n from "@/i18n";
import { addMonths, formatMonth } from "@/lib/calendar-utils";
import { cn } from "@/lib/utils";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";
import { formatScheduleTooltip, getScheduleTimeRange, type ScheduledItem } from "@/utils/schedule";

// 只请求设置了排程时间的 memo。scheduled_ts 在 CEL 中是 Timestamp 类型，
// 用 `> timestamp("1970-01-01T00:00:00Z")` 表达"已设置"（NULL 在 SQL 比较中会被排除）。
const SCHEDULED_MEMOS_FILTER = 'scheduled_ts > timestamp("1970-01-01T00:00:00Z")';
// 有未完成任务但还没安排时间的 todo，供拖拽到日历上排期。
const TODO_MEMOS_FILTER = "has_incomplete_tasks == true && scheduled_ts == null";

// 月视图格子最多展示的排程块数量，超出部分折叠为 "+N"。
const MAX_BLOCKS_PER_CELL = 3;

type CalendarView = "month" | "week";

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
  // 手机端仅查看：未排期 todo 面板与拖拽排期只对桌面端可用。
  const isDesktop = useMediaQuery("md");

  // 用户偏好的活跃时段：周视图只渲染该区间，区间外（如睡眠时间）隐藏。
  const { currentUser, userGeneralSetting, refetchSettings } = useAuth();
  const { mutate: updateUserGeneralSetting } = useUpdateUserGeneralSetting(currentUser?.name);
  const dayStartMin = userGeneralSetting?.calendarDayStart ?? 0;
  const dayEndMin = userGeneralSetting?.calendarDayEnd ?? 1440;

  const [view, setView] = useState<CalendarView>("month");
  const [month, setMonth] = useState<string>(() => formatMonth(new Date()));
  const [weekStart, setWeekStart] = useState<dayjs.Dayjs>(() => getWeekStart(dayjs(), weekStartOffset));
  const [EditorComponent, setEditorComponent] = useState<ComponentType<MemoEditorProps>>();
  const [editMemo, setEditMemo] = useState<Memo | null>(null);

  const { data, fetchNextPage, hasNextPage, isFetching } = useInfiniteMemos({ filter: SCHEDULED_MEMOS_FILTER });
  // 排程 memo 数量通常有限，自动拉取剩余分页以确保完整。
  useEffect(() => {
    if (hasNextPage && !isFetching) {
      void fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetching]);

  const scheduledMemos = useMemo(() => (data?.pages.flatMap((page) => page.memos) ?? []).filter((memo) => memo.scheduledTime), [data]);

  const scheduleItems = useMemo<ScheduledItem[]>(() => {
    const items: ScheduledItem[] = [];
    for (const memo of scheduledMemos) {
      const range = getScheduleTimeRange(memo);
      if (range) {
        items.push({ memo, range });
      }
    }
    return items;
  }, [scheduledMemos]);

  const {
    data: todoData,
    fetchNextPage: fetchTodoPage,
    hasNextPage: todoHasNextPage,
    isFetching: todoIsFetching,
  } = useInfiniteMemos({ filter: TODO_MEMOS_FILTER }, { enabled: isDesktop });

  useEffect(() => {
    if (todoHasNextPage && !todoIsFetching) {
      void fetchTodoPage();
    }
  }, [fetchTodoPage, todoHasNextPage, todoIsFetching]);

  const todoMemos = useMemo(() => todoData?.pages.flatMap((page) => page.memos) ?? [], [todoData]);

  const { mutate: updateMemo } = useUpdateMemo();
  const handleUpdateSchedule = useCallback(
    (memoName: string, patch: { scheduledTime: Date; scheduledDuration?: number }) => {
      const update: Partial<Memo> = { name: memoName, scheduledTime: timestampFromDate(patch.scheduledTime) };
      const updateMask = ["scheduled_time"];
      if (patch.scheduledDuration !== undefined) {
        update.scheduledDuration = create(DurationSchema, { seconds: BigInt(patch.scheduledDuration) });
        updateMask.push("scheduled_duration");
      }
      updateMemo({ update, updateMask });
    },
    [updateMemo],
  );

  const openMemoEditor = useCallback((memo: Memo) => {
    setEditMemo(memo);
    void loadMemoEditor()
      .then(({ default: MemoEditor }) => setEditorComponent(() => MemoEditor))
      .catch(() => undefined);
  }, []);

  // 保存活跃时段偏好（周视图快捷设置与偏好设置页共用同一存储）。
  const handleActiveHoursChange = useCallback(
    (patch: { calendarDayStart?: number; calendarDayEnd?: number }) => {
      const updateMask: string[] = [];
      if (patch.calendarDayStart !== undefined) {
        updateMask.push("calendar_day_start");
      }
      if (patch.calendarDayEnd !== undefined) {
        updateMask.push("calendar_day_end");
      }
      updateUserGeneralSetting(
        { generalSetting: patch, updateMask },
        {
          onSuccess: () => {
            refetchSettings();
          },
        },
      );
    },
    [updateUserGeneralSetting, refetchSettings],
  );

  const scheduleItemsByDate = useMemo(() => {
    const map = new Map<string, ScheduledItem[]>();
    for (const item of scheduleItems) {
      const iso = dayjs(item.range.start).format("YYYY-MM-DD");
      const group = map.get(iso) ?? [];
      group.push(item);
      map.set(iso, group);
    }
    for (const group of map.values()) {
      group.sort((a, b) => a.range.start.getTime() - b.range.start.getTime());
    }
    return map;
  }, [scheduleItems]);

  const monthCells = useMemo(() => buildMonthMatrix(month, weekStartOffset), [month, weekStartOffset]);

  // useWeekdayLabels 固定从周日开始，按用户偏好的周起始日旋转表头以对齐网格。
  const rotatedWeekdayLabels = useMemo(
    () => [...weekdayLabels.slice(weekStartOffset), ...weekdayLabels.slice(0, weekStartOffset)],
    [weekdayLabels, weekStartOffset],
  );

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => weekStart.add(index, "day")), [weekStart]);

  const timeFormatter = useMemo(() => createTimeFormatter(i18n.language), [i18n.language]);

  const monthTitle = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { year: "numeric", month: "long" }).format(dayjs(`${month}-01`).toDate()),
    [month, i18n.language],
  );

  const weekTitle = useMemo(() => {
    const weekEnd = weekStart.add(6, "day");
    const dateFormat = new Intl.DateTimeFormat(i18n.language, { year: "numeric", month: "short", day: "numeric" });
    return `${dateFormat.format(weekStart.toDate())} – ${dateFormat.format(weekEnd.toDate())}`;
  }, [weekStart, i18n.language]);

  const handleNavigate = (delta: number) => {
    if (view === "month") {
      setMonth((prev) => addMonths(prev, delta));
    } else {
      setWeekStart((prev) => prev.add(delta * 7, "day"));
    }
  };

  const handleViewChange = (next: CalendarView) => {
    if (next === "week") {
      setWeekStart(getWeekStart(dayjs(), weekStartOffset));
    }
    setView(next);
  };

  const handleToday = () => {
    if (view === "month") {
      setMonth(formatMonth(new Date()));
    } else {
      setWeekStart(getWeekStart(dayjs(), weekStartOffset));
    }
  };

  // 月视图点某天 → 切换到周视图（以该天所在周为锚点）。
  const handleSelectDate = (iso: string) => {
    setWeekStart(getWeekStart(dayjs(iso), weekStartOffset));
    setView("week");
  };

  const formatBlockText = (item: ScheduledItem): string => {
    const start = timeFormatter.format(item.range.start);
    if (!item.range.end) {
      return start;
    }
    return `${start}–${timeFormatter.format(item.range.end)}`;
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 py-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" aria-label={t("calendar.previous-month")} onClick={() => handleNavigate(-1)}>
            <ChevronLeftIcon className="size-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label={t("calendar.next-month")} onClick={() => handleNavigate(1)}>
            <ChevronRightIcon className="size-4" />
          </Button>
          <h2 className="ml-1 text-lg font-semibold">{view === "month" ? monthTitle : weekTitle}</h2>
        </div>
        <div className="flex items-center gap-2">
          {view === "week" && (
            <Popover>
              <PopoverTrigger render={<Button variant="outline" size="sm" aria-label={t("calendar.active-hours")} />}>
                <ClockIcon className="size-4" />
              </PopoverTrigger>
              <PopoverContent className="w-72" side="bottom" align="end">
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium">{t("setting.preference.calendar-title")}</p>
                  <p className="text-xs text-muted-foreground">{t("setting.preference.calendar-description")}</p>
                  <ActiveHoursSetting
                    dayStartMin={dayStartMin}
                    dayEndMin={dayEndMin}
                    onStartChange={(calendarDayStart) => handleActiveHoursChange({ calendarDayStart })}
                    onEndChange={(calendarDayEnd) => handleActiveHoursChange({ calendarDayEnd })}
                    onRangeChange={(dayStartMin, dayEndMin) =>
                      handleActiveHoursChange({ calendarDayStart: dayStartMin, calendarDayEnd: dayEndMin })
                    }
                  />
                </div>
              </PopoverContent>
            </Popover>
          )}
          <Button variant="outline" size="sm" onClick={handleToday}>
            {t("common.today")}
          </Button>
          <div className="flex overflow-hidden rounded-md border">
            {(["month", "week"] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={cn(
                  "px-3 py-1.5 text-sm",
                  view === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent",
                )}
                onClick={() => handleViewChange(value)}
              >
                {t(`calendar.${value}`)}
              </button>
            ))}
          </div>
        </div>
      </header>

      {editMemo && EditorComponent && (
        <EditorComponent
          autoFocus
          className="mb-2"
          cacheKey={`calendar-editor-${editMemo.name}`}
          memo={editMemo}
          onConfirm={() => setEditMemo(null)}
          onCancel={() => setEditMemo(null)}
        />
      )}

      <div className="flex flex-col gap-4 md:flex-row">
        <div className="min-w-0 flex-1">
          {view === "month" ? (
            <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border bg-border">
              {rotatedWeekdayLabels.map((label) => (
                <div key={label} className="bg-card px-2 py-1.5 text-center text-xs font-medium text-muted-foreground">
                  {label}
                </div>
              ))}
              {monthCells.map((cell) => {
                const items = scheduleItemsByDate.get(cell.iso) ?? [];
                const isToday = cell.iso === todayDate;
                return (
                  <button
                    key={cell.iso}
                    type="button"
                    aria-label={cell.date.format("YYYY-MM-DD")}
                    onClick={() => handleSelectDate(cell.iso)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      const memoName = event.dataTransfer.getData("text/memo-name");
                      if (memoName) {
                        // 落到活跃时段开始（而非 00:00），保证切到周视图后任务可见。
                        handleUpdateSchedule(memoName, {
                          scheduledTime: cell.date.startOf("day").add(dayStartMin, "minute").toDate(),
                        });
                      }
                    }}
                    className={cn(
                      "flex min-h-16 flex-col items-stretch gap-0.5 bg-card p-1 text-left transition-colors hover:bg-accent/50",
                      !cell.isCurrentMonth && "bg-muted/30",
                    )}
                  >
                    <span
                      className={cn("px-1 text-xs", !cell.isCurrentMonth && "text-muted-foreground", isToday && "font-bold text-primary")}
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
                      <span className="px-1 text-[10px] leading-3 text-muted-foreground">+{items.length - MAX_BLOCKS_PER_CELL}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-[3rem_1fr] overflow-hidden rounded-lg border bg-card">
                <div className="border-r" />
                <div className="grid grid-cols-7">
                  {weekDays.map((day, index) => {
                    const isToday = day.format("YYYY-MM-DD") === todayDate;
                    return (
                      <div
                        key={day.format("YYYY-MM-DD")}
                        className={cn("flex flex-col items-center gap-0.5 border-l py-2 first:border-l-0", isToday && "text-primary")}
                      >
                        <span className="text-xs text-muted-foreground">{rotatedWeekdayLabels[index]}</span>
                        <span className={cn("text-sm font-semibold", isToday && "rounded-full bg-primary px-1.5 text-primary-foreground")}>
                          {day.date()}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <WeekView
                weekStart={weekStart}
                scheduleItems={scheduleItems}
                onUpdateSchedule={handleUpdateSchedule}
                onDropTodo={(memoName, targetTime) => handleUpdateSchedule(memoName, { scheduledTime: targetTime })}
                onOpenMemoEditor={openMemoEditor}
                dayStartMin={dayStartMin}
                dayEndMin={dayEndMin}
              />
            </div>
          )}
        </div>

        <aside className="hidden w-full shrink-0 flex-col gap-2 rounded-lg border bg-card p-3 md:flex md:w-64">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <CheckSquareIcon className="size-4 text-muted-foreground" />
            {t("calendar.no-time-todos")}
          </h3>
          {todoMemos.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("calendar.no-todos")}</p>
          ) : (
            <div className="flex flex-col gap-1">
              {todoMemos.map((memo) => (
                <div
                  key={memo.name}
                  draggable
                  title={t("calendar.drag-to-schedule")}
                  onDragStart={(event) => event.dataTransfer.setData("text/memo-name", memo.name)}
                  onDoubleClick={() => openMemoEditor(memo)}
                  className="cursor-grab rounded-md border border-border/60 bg-background px-2 py-1.5 text-xs active:cursor-grabbing"
                >
                  <div className="line-clamp-2 text-foreground">{stripMarkdown(memo.content)}</div>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};

export default CalendarPage;
