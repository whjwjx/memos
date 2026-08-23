import dayjs from "dayjs";
import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTodayDate } from "@/components/ActivityCalendar/hooks";
import i18n from "@/i18n";
import { cn } from "@/lib/utils";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";
import { type ScheduledItem, type ScheduleTimeRange } from "@/utils/schedule";
import { calcDragRange, type DragMode, MIN_DURATION_MIN } from "./drag-utils";

const HOUR_HEIGHT = 48;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const DEFAULT_DURATION_MIN = 60;

interface DragState {
  memoName: string;
  memo: Memo;
  mode: DragMode;
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

export const WeekView = ({ weekStart, scheduleItems, onUpdateSchedule, onDropTodo, onOpenMemoEditor }: WeekViewProps) => {
  const today = useTodayDate();
  const language = i18n.language;
  const isZh = language.toLowerCase().startsWith("zh");

  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => weekStart.add(index, "day")), [weekStart]);

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
      const { memo, mode, originalStart, originalDurationMin } = drag;
      const range = calcDragRange({ mode, originalStart, originalDurationMin, deltaMin, weekStart });
      updatePreview({ memo, range });
    },
    [updatePreview, weekStart],
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

  const handleColumnDrop = (event: React.DragEvent<HTMLDivElement>, day: dayjs.Dayjs) => {
    event.preventDefault();
    const memoName = event.dataTransfer.getData("text/memo-name");
    if (!memoName) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const hour = Math.min(23, Math.max(0, Math.floor((event.clientY - rect.top) / HOUR_HEIGHT)));
    onDropTodo(memoName, day.startOf("day").add(hour, "hour").toDate());
  };

  return (
    <div className="flex overflow-hidden rounded-lg border bg-card">
      {/* 时间刻度列 */}
      <div className="relative w-12 shrink-0 select-none border-r bg-card">
        {HOURS.map((hour) => (
          <span
            key={hour}
            className="absolute right-1 -translate-y-1/2 text-[10px] text-muted-foreground"
            style={{ top: (hour + 1) * HOUR_HEIGHT }}
          >
            {formatHourLabel(hour)}
          </span>
        ))}
      </div>

      {/* 7 天列 */}
      <div className="relative min-w-0 flex-1" style={{ height: 24 * HOUR_HEIGHT }}>
        {HOURS.map((hour) => (
          <div
            key={hour}
            className="pointer-events-none absolute inset-x-0 border-t border-border/60"
            style={{ top: hour * HOUR_HEIGHT }}
          />
        ))}
        <div className="absolute inset-0 grid grid-cols-7">
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
                  const range = isDragging ? preview.range : item.range;
                  const top = (range.start.getHours() + range.start.getMinutes() / 60) * HOUR_HEIGHT;
                  const endMs = range.end?.getTime() ?? range.start.getTime() + 3600000;
                  const height = Math.max((MIN_DURATION_MIN / 60) * HOUR_HEIGHT, ((endMs - range.start.getTime()) / 3600000) * HOUR_HEIGHT);
                  return (
                    <div
                      key={item.memo.name}
                      role="button"
                      tabIndex={0}
                      className={cn(
                        "group absolute inset-x-0.5 cursor-grab overflow-hidden rounded-md border border-primary/20 bg-primary/10 px-1.5 py-1 text-left hover:bg-primary/15 active:cursor-grabbing",
                        isDragging && "opacity-80 ring-1 ring-primary",
                      )}
                      style={{ top, height }}
                      onPointerDown={(event) => beginDrag(event, item.memo.name, "move")}
                      onDoubleClick={() => onOpenMemoEditor(item.memo)}
                    >
                      <div className="truncate text-[10px] font-medium text-primary">{formatBlockTime(range)}</div>
                      <div className="truncate text-[10px] text-muted-foreground">{stripMarkdown(item.memo.content)}</div>
                      <div
                        className="absolute inset-x-0 top-0 h-1.5 cursor-ns-resize"
                        onPointerDown={(event) => beginDrag(event, item.memo.name, "resizeStart")}
                      />
                      <div
                        className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
                        onPointerDown={(event) => beginDrag(event, item.memo.name, "resizeEnd")}
                      />
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
