import { timestampDate } from "@bufbuild/protobuf/wkt";
import dayjs from "dayjs";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";

export interface ScheduleTimeRange {
  start: Date;
  end?: Date;
}

export const getScheduleTimeRange = (memo: Memo): ScheduleTimeRange | undefined => {
  if (!memo.scheduledTime) {
    return undefined;
  }
  const start = timestampDate(memo.scheduledTime);
  const durationMs = memo.scheduledDuration ? Number(memo.scheduledDuration.seconds) * 1000 : 0;
  return {
    start,
    end: durationMs > 0 ? new Date(start.getTime() + durationMs) : undefined,
  };
};

const resolveHourCycle = (language: string): "h23" | "h12" => (language.toLowerCase().startsWith("zh") ? "h23" : "h12");

const createTimeFormatter = (language: string): Intl.DateTimeFormat =>
  new Intl.DateTimeFormat(language, {
    hour: "numeric",
    minute: "2-digit",
    hourCycle: resolveHourCycle(language),
  });

export interface FormatScheduleTimeRangeOptions {
  language: string;
  todayText: string;
  tomorrowText: string;
  now?: Date;
}

export const formatScheduleTimeRange = (range: ScheduleTimeRange, options: FormatScheduleTimeRangeOptions): string => {
  const { start, end } = range;
  const now = options.now ?? new Date();

  const timeFormat = createTimeFormatter(options.language);
  const startTime = timeFormat.format(start);
  const endTime = end ? timeFormat.format(end) : undefined;

  let dayLabel: string;
  if (dayjs(start).isSame(dayjs(now), "day")) {
    dayLabel = options.todayText;
  } else if (dayjs(start).isSame(dayjs(now).add(1, "day"), "day")) {
    dayLabel = options.tomorrowText;
  } else {
    const includeYear = start.getFullYear() !== now.getFullYear();
    const dateFormat = new Intl.DateTimeFormat(options.language, {
      ...(includeYear ? { year: "numeric" as const } : {}),
      month: "short",
      day: "numeric",
    });
    dayLabel = dateFormat.format(start);
  }

  return endTime ? `${dayLabel} ${startTime}–${endTime}` : `${dayLabel} ${startTime}`;
};

export const formatScheduleTooltip = (range: ScheduleTimeRange, language: string): string => {
  const { start, end } = range;
  const fullFormat = new Intl.DateTimeFormat(language, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hourCycle: resolveHourCycle(language),
  });
  const startText = fullFormat.format(start);
  if (!end) {
    return startText;
  }
  const endText = dayjs(start).isSame(dayjs(end), "day") ? createTimeFormatter(language).format(end) : fullFormat.format(end);
  return `${startText} – ${endText}`;
};
