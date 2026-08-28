import dayjs from "dayjs";
import { CheckCircle2Icon, CircleIcon } from "lucide-react";
import { type ReactNode, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTodayDate } from "@/components/ActivityCalendar/hooks";
import useMediaQuery from "@/hooks/useMediaQuery";
import i18n from "@/i18n";
import { cn } from "@/lib/utils";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";
import { MemoScheduleOccurrence_Status } from "@/types/proto/api/v1/memo_service_pb";
import { type ScheduledItem, type ScheduleTimeRange } from "@/utils/schedule";
import { calcDragRange, type DragMode, MIN_DURATION_MIN } from "./drag-utils";

const HOUR_HEIGHT = 48;
const DEFAULT_DURATION_MIN = 60;

interface DragState {
  memoName: string;
  memo: Memo;
  mode: DragMode;
  startX: number;
  startY: number;
  originalStart: Date;
  originalDurationMin: number;
}

interface WeekViewProps {
  weekStart: dayjs.Dayjs;
  scheduleItems: ScheduledItem[];
  onUpdateSchedule: (memoName: string, patch: { scheduledTime: Date; scheduledDuration?: number }) => void;
  onDropTodo: (memoName: string, targetTime: Date) => void;
  onOpenMemoEditor: (memo: Memo) => void;
  onToggleOccurrence: (item: ScheduledItem) => void;
  /** 活跃日区间的开始分钟数（0-1440），默认 0。周视图只渲染该区间，区间外的时间隐藏。 */
  dayStartMin?: number;
  /** 活跃日区间的结束分钟数（0-1440），默认 1440。 */
  dayEndMin?: number;
}

export const stripMarkdown = (content: string): string =>
  content
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/!\[.*?]\(.*?\)/g, "")
    .replace(/\[(.*?)]\(.*?\)/g, "$1")
    .replace(/[`*_~>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

export const WeekView = ({
  weekStart,
  scheduleItems,
  onUpdateSchedule,
  onDropTodo,
  onOpenMemoEditor,
  onToggleOccurrence,
  dayStartMin = 0,
  dayEndMin = 1440,
}: WeekViewProps) => {
  const today = useTodayDate();
  const language = i18n.language;
  // 手机端仅查看：拖拽排期只对桌面端可用，避免触摸手势被 pointerdown 拦截。
  const isDesktop = useMediaQuery("md");
  const isZh = language.toLowerCase().startsWith("zh");

  // 活跃日区间：钳制到 [0, 1440]，保证至少 1 小时且结束晚于开始。
  const { effectiveStartMin, effectiveEndMin, totalHeight } = useMemo(() => {
    const clamp = (value: number | undefined, fallback: number): number => {
      if (value === undefined) {
        return fallback;
      }
      return Math.max(0, Math.min(1440, Math.trunc(value)));
    };
    const start = clamp(dayStartMin, 0);
    const end = clamp(dayEndMin, 1440);
    const effectiveEndMin = Math.min(1440, Math.max(end, start + 60));
    const effectiveStartMin = Math.max(0, Math.min(start, effectiveEndMin - 60));
    return {
      effectiveStartMin,
      effectiveEndMin,
      totalHeight: ((effectiveEndMin - effectiveStartMin) / 60) * HOUR_HEIGHT,
    };
  }, [dayStartMin, dayEndMin]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => weekStart.add(index, "day")), [weekStart]);

  // 活跃区间内需要显示的小时刻度，top 为相对区间的像素偏移。
  const visibleHours = useMemo(() => {
    const list: { hour: number; top: number }[] = [];
    const firstHour = Math.floor(effectiveStartMin / 60);
    const lastHour = Math.ceil(effectiveEndMin / 60);
    for (let hour = firstHour; hour < lastHour; hour++) {
      const top = ((hour * 60 - effectiveStartMin) / 60) * HOUR_HEIGHT;
      list.push({ hour, top: Math.max(0, top) });
    }
    return list;
  }, [effectiveStartMin, effectiveEndMin]);

  const itemsByDay = useMemo(() => {
    const map = new Map<string, ScheduledItem[]>();
    for (const item of scheduleItems) {
      const iso = dayjs(item.range.start).format("YYYY-MM-DD");
      if (days.some((day) => day.format("YYYY-MM-DD") === iso)) {
        const group = map.get(iso) ?? [];
        group.push(item);
        map.set(iso, group);
      }
    }
    for (const group of map.values()) {
      group.sort((a, b) => a.range.start.getTime() - b.range.start.getTime());
    }
    return map;
  }, [days, scheduleItems]);

  const timeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(language, {
        hour: "numeric",
        minute: "2-digit",
        hourCycle: isZh ? "h23" : "h12",
      }),
    [language, isZh],
  );

  const dragRef = useRef<DragState | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<ScheduledItem | null>(null);
  const [preview, setPreview] = useState<ScheduledItem | null>(null);

  const updatePreview = useCallback((next: ScheduledItem | null) => {
    previewRef.current = next;
    setPreview(next);
  }, []);

  const handleDragMove = useCallback(
    (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) {
        return;
      }
      const deltaMin = Math.round((((event.clientY - drag.startY) / HOUR_HEIGHT) * 60) / 60) * 60;
      // move 模式支持跨天：按指针所在列相对起始列的偏移计算天数。
      let dayOffset = 0;
      if (drag.mode === "move" && gridRef.current) {
        const rect = gridRef.current.getBoundingClientRect();
        const colWidth = rect.width / 7;
        const startColumn = Math.min(6, Math.max(0, Math.floor((drag.startX - rect.left) / colWidth)));
        const currentColumn = Math.min(6, Math.max(0, Math.floor((event.clientX - rect.left) / colWidth)));
        dayOffset = currentColumn - startColumn;
      }
      const { memo, mode, originalStart, originalDurationMin } = drag;
      const range = calcDragRange({
        mode,
        originalStart,
        originalDurationMin,
        deltaMin,
        dayOffset,
        weekStart,
        dayStartMin: effectiveStartMin,
        dayEndMin: effectiveEndMin,
      });
      updatePreview({ memo, range });
    },
    [updatePreview, weekStart, effectiveStartMin, effectiveEndMin],
  );

  const handleDragEnd = useCallback(() => {
    const drag = dragRef.current;
    const finalPreview = previewRef.current;
    dragRef.current = null;
    updatePreview(null);
    document.removeEventListener("pointermove", handleDragMove);
    document.removeEventListener("pointerup", handleDragEnd);
    if (!drag || !finalPreview || finalPreview.memo.name !== drag.memoName) {
      return;
    }
    const previewEnd = finalPreview.range.end ?? new Date(finalPreview.range.start.getTime() + 3600000);
    const durationMin = Math.round((previewEnd.getTime() - finalPreview.range.start.getTime()) / 60000);
    const patch: { scheduledTime: Date; scheduledDuration?: number } = { scheduledTime: finalPreview.range.start };
    if (drag.mode === "resizeStart" || drag.mode === "resizeEnd") {
      patch.scheduledDuration = durationMin * 60;
    }
    onUpdateSchedule(drag.memoName, patch);
  }, [handleDragMove, onUpdateSchedule, updatePreview]);

  const beginDrag = (event: ReactPointerEvent, memoName: string, mode: DragMode) => {
    const item = previewRef.current?.memo.name === memoName ? previewRef.current : scheduleItems.find((it) => it.memo.name === memoName);
    if (!item) {
      return;
    }
    const start = item.range.start;
    const durationMin = Math.max(
      DEFAULT_DURATION_MIN,
      Math.round(((item.range.end?.getTime() ?? start.getTime() + DEFAULT_DURATION_MIN * 60000) - start.getTime()) / 60000),
    );
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      memoName,
      memo: item.memo,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      originalStart: start,
      originalDurationMin: durationMin,
    };
    document.addEventListener("pointermove", handleDragMove);
    document.addEventListener("pointerup", handleDragEnd);
  };

  useEffect(
    () => () => {
      document.removeEventListener("pointermove", handleDragMove);
      document.removeEventListener("pointerup", handleDragEnd);
    },
    [handleDragMove, handleDragEnd],
  );

  const formatHourLabel = (hour: number): string => {
    if (isZh) {
      return `${String(hour).padStart(2, "0")}:00`;
    }
    return new Intl.DateTimeFormat(language, { hour: "numeric", hourCycle: "h12" }).format(new Date(2000, 0, 1, hour));
  };

  const formatBlockTime = (range: ScheduleTimeRange): string => {
    const start = timeFormatter.format(range.start);
    if (!range.end) {
      return start;
    }
    return `${start}–${timeFormatter.format(range.end)}`;
  };

  // 计算排程块在活跃区间内的渲染位置。完全落在区间外的块返回 null（隐藏）。
  const getBlockLayout = (start: Date, end: Date, day: dayjs.Dayjs): { top: number; height: number } | null => {
    const dayStartMs = day.startOf("day").add(effectiveStartMin, "minute").valueOf();
    const dayEndMs = day.startOf("day").add(effectiveEndMin, "minute").valueOf();
    const startMs = start.getTime();
    const endMs = end.getTime();
    if (endMs <= dayStartMs || startMs >= dayEndMs) {
      return null;
    }
    const pxPerMin = HOUR_HEIGHT / 60;
    const top = Math.max(0, ((startMs - dayStartMs) / 60000) * pxPerMin);
    const bottom = Math.min(totalHeight, ((endMs - dayStartMs) / 60000) * pxPerMin);
    const height = Math.max(MIN_DURATION_MIN * pxPerMin, bottom - top);
    return { top, height };
  };

  // 拖拽中的跨天预览：在目标列渲染一个虚线 ghost 块，跟随指针显示新位置。
  const renderPreviewGhost = (): ReactNode | null => {
    if (!preview) {
      return null;
    }
    const range = preview.range;
    const end = range.end ?? new Date(range.start.getTime() + DEFAULT_DURATION_MIN * 60000);
    const layout = getBlockLayout(range.start, end, dayjs(range.start));
    if (!layout) {
      return null;
    }
    return (
      <div
        className="pointer-events-none absolute inset-x-0.5 z-10 overflow-hidden rounded-md border border-dashed border-primary/60 bg-primary/15 px-1.5 py-1"
        style={{ top: layout.top, height: layout.height }}
      >
        <div className="truncate text-[10px] font-medium text-primary">{formatBlockTime(range)}</div>
        <div className="truncate text-[10px] text-muted-foreground">{stripMarkdown(preview.memo.content)}</div>
      </div>
    );
  };

  const handleColumnDrop = (event: React.DragEvent<HTMLDivElement>, day: dayjs.Dayjs) => {
    event.preventDefault();
    const memoName = event.dataTransfer.getData("text/memo-name");
    if (!memoName) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const minutesFromTop = Math.floor((event.clientY - rect.top) / HOUR_HEIGHT) * 60;
    // 钳制到活跃时段内，避免拖到表头等位置时落入区间外（区间外会被隐藏、无法看到）。
    const minuteOfDay = Math.min(effectiveEndMin - 60, Math.max(effectiveStartMin, effectiveStartMin + minutesFromTop));
    onDropTodo(memoName, day.startOf("day").add(minuteOfDay, "minute").toDate());
  };

  return (
    <div className="flex overflow-hidden rounded-lg border bg-card">
      {/* 时间刻度列 */}
      <div className="relative w-12 shrink-0 select-none border-r bg-card">
        {visibleHours.map(({ hour, top }) => (
          <span key={hour} className="absolute right-1 text-[10px] text-muted-foreground" style={{ top: top === 0 ? 0 : top - 6 }}>
            {formatHourLabel(hour)}
          </span>
        ))}
      </div>

      {/* 7 天列 */}
      <div className="relative min-w-0 flex-1" style={{ height: totalHeight }}>
        {visibleHours.map(({ hour, top }) => (
          <div key={hour} className="pointer-events-none absolute inset-x-0 border-t border-border/60" style={{ top }} />
        ))}
        <div className="absolute inset-0 grid grid-cols-7" ref={gridRef}>
          {days.map((day) => {
            const iso = day.format("YYYY-MM-DD");
            const isToday = iso === today;
            const items = itemsByDay.get(iso) ?? [];
            return (
              <div
                key={iso}
                className={cn("relative border-l border-border/60 first:border-l-0", isToday && "bg-primary/[0.04]")}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => handleColumnDrop(event, day)}
              >
                {items.map((item) => {
                  const isDragging = preview?.memo.name === item.memo.name;
                  const range = item.range;
                  const layout = getBlockLayout(range.start, range.end ?? new Date(range.start.getTime() + 3600000), day);
                  if (!layout) {
                    return null;
                  }
                  const isDone = item.status === MemoScheduleOccurrence_Status.DONE;
                  const isRecurring = item.recurring ?? false;
                  const blockKey = `${item.memo.name}-${item.occurrenceTime?.toISOString() ?? range.start.toISOString()}`;
                  return (
                    <div
                      key={blockKey}
                      role="button"
                      tabIndex={0}
                      className={cn(
                        "group absolute inset-x-0.5 overflow-hidden rounded-md border border-primary/20 bg-primary/10 px-1.5 py-1 text-left hover:bg-primary/15",
                        isRecurring ? "cursor-default" : "cursor-grab active:cursor-grabbing",
                        isDone && "border-muted bg-muted/40 text-muted-foreground",
                        isDragging && "opacity-40",
                      )}
                      style={{ top: layout.top, height: layout.height }}
                      onPointerDown={isDesktop && !isRecurring ? (event) => beginDrag(event, item.memo.name, "move") : undefined}
                      onDoubleClick={() => onOpenMemoEditor(item.memo)}
                    >
                      <div className="flex min-w-0 items-start gap-1">
                        <button
                          type="button"
                          aria-label={isDone ? "Mark pending" : "Mark done"}
                          aria-pressed={isDone}
                          className={cn(
                            "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full text-primary transition-colors",
                            isDone ? "text-primary" : "text-muted-foreground hover:text-primary",
                          )}
                          onClick={(event) => {
                            event.stopPropagation();
                            onToggleOccurrence(item);
                          }}
                          onPointerDown={(event) => event.stopPropagation()}
                        >
                          {isDone ? <CheckCircle2Icon className="size-4" /> : <CircleIcon className="size-4" />}
                        </button>
                        <div className="min-w-0">
                          <div
                            className={cn("truncate text-[10px] font-medium text-primary", isDone && "text-muted-foreground line-through")}
                          >
                            {formatBlockTime(range)}
                          </div>
                          <div className={cn("truncate text-[10px] text-muted-foreground", isDone && "line-through")}>
                            {stripMarkdown(item.memo.content)}
                          </div>
                        </div>
                      </div>
                      {!isRecurring && (
                        <>
                          <div
                            className="absolute inset-x-0 top-0 h-1.5 cursor-ns-resize max-md:hidden"
                            onPointerDown={(event) => beginDrag(event, item.memo.name, "resizeStart")}
                          />
                          <div
                            className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize max-md:hidden"
                            onPointerDown={(event) => beginDrag(event, item.memo.name, "resizeEnd")}
                          />
                        </>
                      )}
                    </div>
                  );
                })}
                {preview && dayjs(preview.range.start).format("YYYY-MM-DD") === iso && renderPreviewGhost()}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
