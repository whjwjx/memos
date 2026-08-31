import { create } from "@bufbuild/protobuf";
import dayjs from "dayjs";
import {
  type MemoScheduleRecurrence,
  MemoScheduleRecurrence_Frequency,
  MemoScheduleRecurrenceSchema,
} from "@/types/proto/api/v1/memo_service_pb";

const DEFAULT_DURATION_SECONDS = 3600;
const DEFAULT_DATE_ONLY_HOUR = 9;
const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKENDS = [0, 6];
const CHINESE_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};
const WEEKDAY_INDEX: Record<string, number> = {
  日: 0,
  天: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
};

type ParsedClock = {
  hour: number;
  minute: number;
};

type ScheduleKind = "once" | "daily" | "weekdays" | "weekends" | "weekly" | "yearly";

export interface NaturalScheduleSuggestion {
  scheduledTime: Date;
  scheduledDuration: number;
  scheduledRecurrence?: MemoScheduleRecurrence;
  label: string;
  kind: ScheduleKind;
}

function normalizeText(text: string): string {
  return text
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/：/g, ":")
    .replace(/\s+/g, " ")
    .trim();
}

function parseChineseNumber(value: string): number | undefined {
  if (/^\d+$/.test(value)) {
    return Number(value);
  }
  if (value === "十") {
    return 10;
  }
  if (value.startsWith("十")) {
    const ones = CHINESE_DIGITS[value.slice(1)];
    return ones === undefined ? undefined : 10 + ones;
  }
  const tenIndex = value.indexOf("十");
  if (tenIndex > 0) {
    const tens = CHINESE_DIGITS[value.slice(0, tenIndex)];
    const onesRaw = value.slice(tenIndex + 1);
    const ones = onesRaw ? CHINESE_DIGITS[onesRaw] : 0;
    return tens === undefined || ones === undefined ? undefined : tens * 10 + ones;
  }
  return CHINESE_DIGITS[value];
}

function parseClock(text: string): ParsedClock | undefined {
  const match = text.match(
    /(?:(凌晨|早上|上午|中午|下午|晚上|夜里)\s*)?([0-2]?\d|[零〇一二两三四五六七八九十]{1,3})\s*(?:点|:)\s*(半|[0-5]?\d|[零〇一二两三四五六七八九十]{1,3})?\s*(?:分)?/,
  );
  if (!match) {
    return undefined;
  }

  const period = match[1];
  const hour = parseChineseNumber(match[2]);
  const minute = match[3] === "半" ? 30 : match[3] ? parseChineseNumber(match[3]) : 0;
  if (hour === undefined || minute === undefined || hour > 23 || minute > 59) {
    return undefined;
  }

  let normalizedHour = hour;
  if ((period === "下午" || period === "晚上" || period === "夜里") && normalizedHour < 12) {
    normalizedHour += 12;
  } else if (period === "中午" && normalizedHour < 11) {
    normalizedHour += 12;
  } else if ((period === "凌晨" || period === "早上" || period === "上午") && normalizedHour === 12) {
    normalizedHour = 0;
  }

  return { hour: normalizedHour, minute };
}

function withClock(date: Date, clock: ParsedClock): Date {
  const next = new Date(date);
  next.setHours(clock.hour, clock.minute, 0, 0);
  return next;
}

function createRecurrence(frequency: MemoScheduleRecurrence_Frequency, daysOfWeek: number[] = []): MemoScheduleRecurrence {
  return create(MemoScheduleRecurrenceSchema, {
    frequency,
    daysOfWeek,
    interval: 1,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  });
}

function nextMatchingDay(now: Date, daysOfWeek: number[], clock: ParsedClock): Date {
  for (let offset = 0; offset <= 7; offset++) {
    const candidate = withClock(dayjs(now).add(offset, "day").toDate(), clock);
    if (daysOfWeek.includes(candidate.getDay()) && candidate > now) {
      return candidate;
    }
  }
  return withClock(dayjs(now).add(1, "day").toDate(), clock);
}

function dateForWeekday(now: Date, weekday: number, clock: ParsedClock, forceNextWeek: boolean): Date {
  const today = now.getDay();
  if (forceNextWeek) {
    const daysUntilNextMonday = (8 - (today || 7)) % 7 || 7;
    const targetOffsetFromMonday = weekday === 0 ? 6 : weekday - 1;
    return withClock(
      dayjs(now)
        .add(daysUntilNextMonday + targetOffsetFromMonday, "day")
        .toDate(),
      clock,
    );
  }
  const offset = (weekday - today + 7) % 7;
  const candidate = withClock(dayjs(now).add(offset, "day").toDate(), clock);
  if (!forceNextWeek && candidate <= now) {
    return withClock(dayjs(candidate).add(7, "day").toDate(), clock);
  }
  return candidate;
}

function parseWeekday(text: string): { weekday: number; forceNextWeek: boolean } | undefined {
  const nextWeekMatch = text.match(/下(?:周|星期|礼拜)([一二三四五六日天])/);
  if (nextWeekMatch) {
    return { weekday: WEEKDAY_INDEX[nextWeekMatch[1]], forceNextWeek: true };
  }

  const weekMatch = text.match(/(?:这|本)?(?:周|星期|礼拜)([一二三四五六日天])/);
  if (weekMatch) {
    return { weekday: WEEKDAY_INDEX[weekMatch[1]], forceNextWeek: false };
  }

  return undefined;
}

function parseMonthDay(text: string): { month: number; day: number } | undefined {
  const match = text.match(/([0-1]?\d|[零〇一二两三四五六七八九十]{1,3})\s*月\s*([0-3]?\d|[零〇一二两三四五六七八九十]{1,3})\s*(?:日|号)?/);
  if (!match) {
    return undefined;
  }
  const month = parseChineseNumber(match[1]);
  const day = parseChineseNumber(match[2]);
  if (!month || !day || month < 1 || month > 12 || day < 1 || day > 31) {
    return undefined;
  }
  return { month, day };
}

function scheduleMonthDay(now: Date, month: number, day: number, clock: ParsedClock): Date | undefined {
  const candidate = new Date(now.getFullYear(), month - 1, day, clock.hour, clock.minute, 0, 0);
  if (candidate.getMonth() !== month - 1 || candidate.getDate() !== day) {
    return undefined;
  }
  if (candidate > now) {
    return candidate;
  }
  const nextYear = new Date(now.getFullYear() + 1, month - 1, day, clock.hour, clock.minute, 0, 0);
  return nextYear.getMonth() === month - 1 && nextYear.getDate() === day ? nextYear : undefined;
}

function formatLabel(kind: ScheduleKind, date: Date): string {
  const timeText = dayjs(date).format("M/D HH:mm");
  if (kind === "daily") return `每天 ${dayjs(date).format("HH:mm")}`;
  if (kind === "weekdays") return `工作日 ${dayjs(date).format("HH:mm")}`;
  if (kind === "weekends") return `周末 ${dayjs(date).format("HH:mm")}`;
  if (kind === "yearly") return `每年 ${timeText}`;
  if (kind === "weekly") return `每周${"日一二三四五六"[date.getDay()]} ${dayjs(date).format("HH:mm")}`;
  return timeText;
}

export function scheduleSuggestionSignature(
  suggestion: Pick<NaturalScheduleSuggestion, "scheduledTime" | "scheduledDuration" | "scheduledRecurrence">,
): string {
  const recurrence = suggestion.scheduledRecurrence;
  return [
    suggestion.scheduledTime.getTime(),
    suggestion.scheduledDuration,
    recurrence?.frequency ?? 0,
    recurrence?.daysOfWeek.join(",") ?? "",
    recurrence?.interval ?? 0,
    recurrence?.timezone ?? "",
  ].join("|");
}

export function parseNaturalSchedule(text: string, now = new Date()): NaturalScheduleSuggestion | undefined {
  const normalized = normalizeText(text);
  if (!normalized) {
    return undefined;
  }

  const clock = parseClock(normalized);
  const monthDay = parseMonthDay(normalized);
  const annual = /每年|生日|纪念日|周年/.test(normalized);
  if (monthDay && (annual || clock)) {
    const scheduledTime = scheduleMonthDay(now, monthDay.month, monthDay.day, clock ?? { hour: DEFAULT_DATE_ONLY_HOUR, minute: 0 });
    if (!scheduledTime) {
      return undefined;
    }
    const kind: ScheduleKind = annual ? "yearly" : "once";
    return {
      scheduledTime,
      scheduledDuration: DEFAULT_DURATION_SECONDS,
      scheduledRecurrence: annual ? createRecurrence(MemoScheduleRecurrence_Frequency.YEARLY) : undefined,
      label: formatLabel(kind, scheduledTime),
      kind,
    };
  }

  if (!clock) {
    return undefined;
  }

  let scheduledTime: Date;
  let scheduledRecurrence: MemoScheduleRecurrence | undefined;
  let kind: ScheduleKind = "once";

  if (/每天|每日/.test(normalized)) {
    scheduledTime = nextMatchingDay(now, [0, 1, 2, 3, 4, 5, 6], clock);
    scheduledRecurrence = createRecurrence(MemoScheduleRecurrence_Frequency.DAILY);
    kind = "daily";
  } else if (/工作日|周一到周五|周一至周五/.test(normalized)) {
    scheduledTime = nextMatchingDay(now, WEEKDAYS, clock);
    scheduledRecurrence = createRecurrence(MemoScheduleRecurrence_Frequency.WEEKLY, WEEKDAYS);
    kind = "weekdays";
  } else if (/周末/.test(normalized)) {
    scheduledTime = nextMatchingDay(now, WEEKENDS, clock);
    scheduledRecurrence = createRecurrence(MemoScheduleRecurrence_Frequency.WEEKLY, WEEKENDS);
    kind = "weekends";
  } else {
    const weeklyMatch = normalized.match(/每(?:周|星期|礼拜)([一二三四五六日天])/);
    if (weeklyMatch) {
      const weekday = WEEKDAY_INDEX[weeklyMatch[1]];
      scheduledTime = dateForWeekday(now, weekday, clock, false);
      scheduledRecurrence = createRecurrence(MemoScheduleRecurrence_Frequency.WEEKLY, [weekday]);
      kind = "weekly";
    } else if (/大后天/.test(normalized)) {
      scheduledTime = withClock(dayjs(now).add(3, "day").toDate(), clock);
    } else if (/后天/.test(normalized)) {
      scheduledTime = withClock(dayjs(now).add(2, "day").toDate(), clock);
    } else if (/明天/.test(normalized)) {
      scheduledTime = withClock(dayjs(now).add(1, "day").toDate(), clock);
    } else if (/今天/.test(normalized)) {
      scheduledTime = withClock(now, clock);
      if (scheduledTime <= now) {
        scheduledTime = withClock(dayjs(now).add(1, "day").toDate(), clock);
      }
    } else {
      const weekday = parseWeekday(normalized);
      if (weekday) {
        scheduledTime = dateForWeekday(now, weekday.weekday, clock, weekday.forceNextWeek);
      } else if (/会议|开会|提醒|待办|todo|吃|上课|面试|电话|安排|日程|约/.test(normalized)) {
        scheduledTime = nextMatchingDay(now, [0, 1, 2, 3, 4, 5, 6], clock);
      } else {
        return undefined;
      }
    }
  }

  return {
    scheduledTime,
    scheduledDuration: DEFAULT_DURATION_SECONDS,
    scheduledRecurrence,
    label: formatLabel(kind, scheduledTime),
    kind,
  };
}
