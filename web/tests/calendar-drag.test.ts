import dayjs from "dayjs";
import { describe, expect, it } from "vitest";
import { calcDragRange, getWeekStart } from "@/components/CalendarView/drag-utils";

describe("getWeekStart", () => {
  it("returns the week start respecting the given weekday offset", () => {
    // 2026-08-26 是周三。
    const date = dayjs("2026-08-26T10:00:00");
    expect(getWeekStart(date, 0).format("YYYY-MM-DD")).toBe("2026-08-23"); // 周日开头
    expect(getWeekStart(date, 1).format("YYYY-MM-DD")).toBe("2026-08-24"); // 周一开头
    expect(getWeekStart(date, 6).format("YYYY-MM-DD")).toBe("2026-08-22"); // 周六开头
  });
});

describe("calcDragRange", () => {
  const weekStart = dayjs("2026-08-24"); // 周一
  const base = {
    originalStart: new Date("2026-08-26T10:00:00"), // 周三 10:00
    originalDurationMin: 120,
    weekStart,
  };

  const expectRange = (range: { start: Date; end?: Date }) => ({
    start: range.start.getTime(),
    end: range.end?.getTime(),
  });

  it("moves the block by the delta, keeping the duration", () => {
    const range = calcDragRange({ ...base, mode: "move", deltaMin: 120 });
    expect(expectRange(range)).toEqual({
      start: new Date("2026-08-26T12:00:00").getTime(),
      end: new Date("2026-08-26T14:00:00").getTime(),
    });
  });

  it("clamps the block inside the current week when moving", () => {
    const range = calcDragRange({ ...base, mode: "move", deltaMin: -200 * 60 });
    expect(expectRange(range)).toEqual({
      start: weekStart.startOf("day").valueOf(),
      end: weekStart.startOf("day").valueOf() + 120 * 60000,
    });
  });

  it("resizeStart moves the start and keeps the end", () => {
    const range = calcDragRange({ ...base, mode: "resizeStart", deltaMin: -60 });
    expect(expectRange(range)).toEqual({
      start: new Date("2026-08-26T09:00:00").getTime(),
      end: new Date("2026-08-26T12:00:00").getTime(),
    });
  });

  it("resizeStart clamps to the start of the day", () => {
    const range = calcDragRange({ ...base, mode: "resizeStart", deltaMin: -600 });
    expect(expectRange(range)).toEqual({
      start: new Date("2026-08-26T00:00:00").getTime(),
      end: new Date("2026-08-26T12:00:00").getTime(),
    });
  });

  it("resizeEnd extends the duration", () => {
    const range = calcDragRange({ ...base, mode: "resizeEnd", deltaMin: 60 });
    expect(expectRange(range)).toEqual({
      start: base.originalStart.getTime(),
      end: new Date("2026-08-26T13:00:00").getTime(),
    });
  });

  it("resizeEnd clamps to the minimum duration", () => {
    const range = calcDragRange({ ...base, mode: "resizeEnd", deltaMin: -600 });
    expect(expectRange(range)).toEqual({ start: base.originalStart.getTime(), end: new Date("2026-08-26T11:00:00").getTime() });
  });

  it("resizeEnd clamps to the end of the day", () => {
    const lateStart = new Date("2026-08-26T23:00:00");
    const range = calcDragRange({ ...base, originalStart: lateStart, mode: "resizeEnd", deltaMin: 240 });
    expect(expectRange(range)).toEqual({ start: lateStart.getTime(), end: new Date("2026-08-27T00:00:00").getTime() });
  });
});
