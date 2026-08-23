import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { DurationSchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";
import { type Memo, MemoSchema } from "@/types/proto/api/v1/memo_service_pb";
import { formatScheduleTimeRange, formatScheduleTooltip, getScheduleTimeRange, type ScheduleTimeRange } from "@/utils/schedule";

const toTimestamp = (date: Date) => create(TimestampSchema, { seconds: BigInt(Math.floor(date.getTime() / 1000)) });

const toDuration = (seconds: number) => create(DurationSchema, { seconds: BigInt(seconds) });

const makeMemo = (overrides: MessageInitShape<typeof MemoSchema> = {}): Memo => create(MemoSchema, overrides);

const ZH = "zh-CN";
const TODAY_TEXT = "今天";
const TOMORROW_TEXT = "明天";
const now = new Date(2026, 7, 23, 10, 0, 0); // 2026-08-23 10:00 local

describe("getScheduleTimeRange", () => {
  it("returns undefined when there is no scheduledTime", () => {
    expect(getScheduleTimeRange(makeMemo({}))).toBeUndefined();
  });

  it("returns start only when no duration is set", () => {
    const start = new Date(2026, 7, 23, 13, 0, 0);
    const range = getScheduleTimeRange(makeMemo({ scheduledTime: toTimestamp(start) }));
    expect(range).toEqual<ScheduleTimeRange>({ start, end: undefined });
  });

  it("computes end from scheduledDuration", () => {
    const start = new Date(2026, 7, 23, 13, 0, 0);
    const range = getScheduleTimeRange(makeMemo({ scheduledTime: toTimestamp(start), scheduledDuration: toDuration(3600) }));
    expect(range?.end?.getTime()).toBe(start.getTime() + 3600 * 1000);
  });

  it("treats zero duration as no end", () => {
    const start = new Date(2026, 7, 23, 13, 0, 0);
    const range = getScheduleTimeRange(makeMemo({ scheduledTime: toTimestamp(start), scheduledDuration: toDuration(0) }));
    expect(range?.end).toBeUndefined();
  });
});

describe("formatScheduleTimeRange", () => {
  it("formats a same-day schedule with today label", () => {
    const start = new Date(2026, 7, 23, 13, 0, 0);
    const range = { start, end: new Date(2026, 7, 23, 14, 0, 0) };
    expect(formatScheduleTimeRange(range, { language: ZH, todayText: TODAY_TEXT, tomorrowText: TOMORROW_TEXT, now })).toBe(
      "今天 13:00–14:00",
    );
  });

  it("formats a next-day schedule with tomorrow label", () => {
    const start = new Date(2026, 7, 24, 9, 30, 0);
    const range = { start, end: undefined };
    expect(formatScheduleTimeRange(range, { language: ZH, todayText: TODAY_TEXT, tomorrowText: TOMORROW_TEXT, now })).toBe("明天 9:30");
  });

  it("falls back to a date label for other same-year days", () => {
    const start = new Date(2026, 8, 5, 15, 0, 0);
    const range = { start, end: new Date(2026, 8, 5, 16, 30, 0) };
    expect(formatScheduleTimeRange(range, { language: ZH, todayText: TODAY_TEXT, tomorrowText: TOMORROW_TEXT, now })).toBe(
      "9月5日 15:00–16:30",
    );
  });

  it("includes the year for dates in another year", () => {
    const start = new Date(2027, 0, 2, 8, 0, 0);
    const range = { start, end: undefined };
    expect(formatScheduleTimeRange(range, { language: ZH, todayText: TODAY_TEXT, tomorrowText: TOMORROW_TEXT, now })).toBe(
      "2027年1月2日 8:00",
    );
  });

  it("omits the end time when there is no duration", () => {
    const start = new Date(2026, 7, 23, 20, 0, 0);
    const range = { start, end: undefined };
    expect(formatScheduleTimeRange(range, { language: ZH, todayText: TODAY_TEXT, tomorrowText: TOMORROW_TEXT, now })).toBe("今天 20:00");
  });
});

describe("formatScheduleTooltip", () => {
  it("formats full date time range", () => {
    const start = new Date(2026, 7, 23, 13, 0, 0);
    const end = new Date(2026, 7, 23, 14, 0, 0);
    expect(formatScheduleTooltip({ start, end }, ZH)).toBe("2026年8月23日 13:00 – 14:00");
  });

  it("formats start only when there is no end", () => {
    const start = new Date(2026, 7, 23, 13, 0, 0);
    expect(formatScheduleTooltip({ start }, ZH)).toBe("2026年8月23日 13:00");
  });
});
