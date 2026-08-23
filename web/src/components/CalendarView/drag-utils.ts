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
  /** 拖拽的天偏移量（周视图列偏移），仅 move 模式生效，默认 0。 */
  dayOffset?: number;
  weekStart: dayjs.Dayjs;
  /** 活跃日的开始分钟数（0-1440），默认 0。区间外的拖动会被限制在活跃区间内。 */
  dayStartMin?: number;
  /** 活跃日的结束分钟数（0-1440），默认 1440。 */
  dayEndMin?: number;
}

/**
 * 将分钟数钳制到 [0, 1440]，并保证活跃区间至少 1 小时且结束晚于开始。
 */
const resolveActiveMinutes = (dayStartMin: number | undefined, dayEndMin: number | undefined): { start: number; end: number } => {
  const clamp = (value: number | undefined, fallback: number): number => {
    if (value === undefined) {
      return fallback;
    }
    return Math.max(0, Math.min(1440, Math.trunc(value)));
  };
  const start = clamp(dayStartMin, 0);
  const end = clamp(dayEndMin, 1440);
  return {
    start: Math.max(0, Math.min(start, end - 60)),
    end: Math.min(1440, Math.max(end, start + 60)),
  };
};

/**
 * 根据拖拽偏移量计算新的排程时间范围。
 * - move: 整块平移，开始时间按 dayOffset 天 + deltaMin 分钟移动，时长保持不变。
 * - resizeStart: 拖动上边缘，调整开始时间，结束时间不变。
 * - resizeEnd: 拖动下边缘，调整时长，开始时间不变。
 * - 所有模式都会将结果钳制到活跃日区间 [dayStartMin, dayEndMin] 内。
 */
export const calcDragRange = ({
  mode,
  originalStart,
  originalDurationMin,
  deltaMin,
  dayOffset = 0,
  weekStart,
  dayStartMin,
  dayEndMin,
}: DragCalcInput): ScheduleTimeRange => {
  const { start: activeStartMin, end: activeEndMin } = resolveActiveMinutes(dayStartMin, dayEndMin);
  const originalEnd = new Date(originalStart.getTime() + originalDurationMin * 60000);
  let start = new Date(originalStart.getTime());
  let end = new Date(originalEnd.getTime());

  if (mode === "move") {
    start = new Date(originalStart.getTime() + dayOffset * 86400000 + deltaMin * 60000);
    end = new Date(start.getTime() + originalDurationMin * 60000);
    // 限制在本周的活跃时间范围内拖动。
    const weekStartMs = weekStart.startOf("day").add(activeStartMin, "minute").valueOf();
    const weekEndMs = weekStart.add(6, "day").startOf("day").add(activeEndMin, "minute").valueOf();
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
    const dayStart = dayjs(originalStart).startOf("day").add(activeStartMin, "minute").toDate();
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
    const dayEnd = dayjs(originalStart).startOf("day").add(activeEndMin, "minute").valueOf();
    if (end.getTime() > dayEnd) {
      end = new Date(dayEnd);
    }
    start = originalStart;
  }

  return { start, end };
};
