import dayjs from "dayjs";
import type { ScheduleTimeRange } from "@/utils/schedule";

export type DragMode = "move" | "resizeStart" | "resizeEnd";

export const MIN_DURATION_MIN = 60;

export const getWeekStart = (date: dayjs.Dayjs, weekStartOffset: number): dayjs.Dayjs => {
  const diff = (date.day() - weekStartOffset + 7) % 7;
  return date.startOf("day").subtract(diff, "day");
};

export interface DragCalcInput {
  mode: DragMode;
  originalStart: Date;
  originalDurationMin: number;
  deltaMin: number;
  weekStart: dayjs.Dayjs;
}

/**
 * 根据拖拽偏移量计算新的排程时间范围。
 * - move: 整块平移，开始时间按 deltaMin 移动，时长保持不变。
 * - resizeStart: 拖动上边缘，调整开始时间，结束时间不变。
 * - resizeEnd: 拖动下边缘，调整时长，开始时间不变。
 */
export const calcDragRange = ({ mode, originalStart, originalDurationMin, deltaMin, weekStart }: DragCalcInput): ScheduleTimeRange => {
  const originalEnd = new Date(originalStart.getTime() + originalDurationMin * 60000);
  let start = new Date(originalStart.getTime());
  let end = new Date(originalEnd.getTime());

  if (mode === "move") {
    start = new Date(originalStart.getTime() + deltaMin * 60000);
    end = new Date(start.getTime() + originalDurationMin * 60000);
    // 限制在本周范围内拖动。
    const weekStartMs = weekStart.startOf("day").valueOf();
    const weekEndMs = weekStart.add(7, "day").startOf("day").valueOf();
    const durationMs = originalDurationMin * 60000;
    if (start.getTime() < weekStartMs) {
      start = new Date(weekStartMs);
      end = new Date(weekStartMs + durationMs);
    } else if (end.getTime() > weekEndMs) {
      end = new Date(weekEndMs);
      start = new Date(weekEndMs - durationMs);
    }
  } else if (mode === "resizeStart") {
    start = new Date(originalStart.getTime() + deltaMin * 60000);
    const dayStart = dayjs(originalStart).startOf("day").toDate();
    const maxStart = new Date(originalEnd.getTime() - MIN_DURATION_MIN * 60000);
    if (start.getTime() < dayStart.getTime()) {
      start = dayStart;
    }
    if (start.getTime() > maxStart.getTime()) {
      start = maxStart;
    }
    end = originalEnd;
  } else {
    // resizeEnd
    const newDurationMin = Math.max(MIN_DURATION_MIN, originalDurationMin + deltaMin);
    end = new Date(originalStart.getTime() + newDurationMin * 60000);
    const dayEnd = dayjs(originalStart).endOf("day").valueOf() + 1;
    if (end.getTime() > dayEnd) {
      end = new Date(dayEnd);
    }
    start = originalStart;
  }

  return { start, end };
};
