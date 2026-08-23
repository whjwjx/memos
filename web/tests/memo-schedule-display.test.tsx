import { create } from "@bufbuild/protobuf";
import { DurationSchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MemoScheduleDisplay from "@/components/MemoView/components/MemoScheduleDisplay";
import { MemoViewContext, type MemoViewContextValue } from "@/components/MemoView/MemoViewContext";
import { type Memo, MemoSchema } from "@/types/proto/api/v1/memo_service_pb";

vi.mock("@/i18n", () => ({ default: { language: "zh-CN" } }));
vi.mock("@/utils/i18n", () => ({
  useTranslate:
    () =>
    (key: string): string =>
      key === "memo.schedule.today" ? "今天" : key === "memo.schedule.tomorrow" ? "明天" : key,
}));

const toTimestamp = (date: Date) => create(TimestampSchema, { seconds: BigInt(Math.floor(date.getTime() / 1000)) });

const atHour = (hour: number, dayOffset = 0): Date => {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  date.setHours(hour, 0, 0, 0);
  return date;
};

const renderWithContext = (memo: Memo) => {
  const value = {
    memo,
    creator: undefined,
    currentUser: undefined,
    parentPage: "/",
    cardWidth: 0,
    isArchived: false,
    readonly: false,
    showBlurredContent: false,
    blurred: false,
    openEditor: () => undefined,
    toggleBlurVisibility: () => undefined,
    openPreview: () => undefined,
  } satisfies MemoViewContextValue;

  return render(
    <MemoViewContext.Provider value={value}>
      <MemoScheduleDisplay />
    </MemoViewContext.Provider>,
  );
};

describe("MemoScheduleDisplay", () => {
  it("renders nothing when the memo has no scheduledTime", () => {
    const memo = create(MemoSchema, {});
    const { container } = renderWithContext(memo);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the time range for a same-day schedule", () => {
    const start = atHour(13);
    const memo = create(MemoSchema, {
      scheduledTime: toTimestamp(start),
      scheduledDuration: create(DurationSchema, { seconds: 3600n }),
    });
    const { container } = renderWithContext(memo);
    expect(container.textContent).toContain("今天 13:00–14:00");
  });

  it("shows only the start time when no duration is set", () => {
    const start = atHour(20);
    const memo = create(MemoSchema, { scheduledTime: toTimestamp(start) });
    const { container } = renderWithContext(memo);
    expect(container.textContent).toContain("今天 20:00");
  });

  it("shows a tomorrow label for the next day", () => {
    const start = atHour(9, 1);
    const memo = create(MemoSchema, { scheduledTime: toTimestamp(start) });
    const { container } = renderWithContext(memo);
    expect(container.textContent).toContain("明天 9:00");
  });
});
