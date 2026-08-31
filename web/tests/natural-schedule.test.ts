import { describe, expect, it } from "vitest";
import { MemoScheduleRecurrence_Frequency } from "@/types/proto/api/v1/memo_service_pb";
import { parseNaturalSchedule } from "@/utils/natural-schedule";

const now = new Date(2026, 7, 31, 10, 0, 0, 0); // Monday, Aug 31, 2026.

describe("parseNaturalSchedule", () => {
  it("detects a one-time meeting from natural Chinese text", () => {
    const suggestion = parseNaturalSchedule("下周二下午2点有个线上会议", now);

    expect(suggestion?.scheduledTime).toEqual(new Date(2026, 8, 8, 14, 0, 0, 0));
    expect(suggestion?.scheduledDuration).toBe(3600);
    expect(suggestion?.scheduledRecurrence).toBeUndefined();
    expect(suggestion?.label).toBe("9/8 14:00");
  });

  it("detects weekday recurrence", () => {
    const suggestion = parseNaturalSchedule("工作日 8点吃早饭", now);

    expect(suggestion?.scheduledTime).toEqual(new Date(2026, 8, 1, 8, 0, 0, 0));
    expect(suggestion?.scheduledRecurrence?.frequency).toBe(MemoScheduleRecurrence_Frequency.WEEKLY);
    expect(suggestion?.scheduledRecurrence?.daysOfWeek).toEqual([1, 2, 3, 4, 5]);
    expect(suggestion?.label).toBe("工作日 08:00");
  });

  it("detects annual birthday reminders", () => {
    const suggestion = parseNaturalSchedule("每年8月31日生日提醒", now);

    expect(suggestion?.scheduledTime).toEqual(new Date(2027, 7, 31, 9, 0, 0, 0));
    expect(suggestion?.scheduledRecurrence?.frequency).toBe(MemoScheduleRecurrence_Frequency.YEARLY);
    expect(suggestion?.label).toBe("每年 8/31 09:00");
  });

  it("does not detect plain prose without scheduling hints", () => {
    expect(parseNaturalSchedule("下午2点这个想法挺有意思", now)).toBeUndefined();
  });
});
