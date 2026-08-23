import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import ScheduleSelector from "@/components/MemoEditor/Toolbar/ScheduleSelector";

vi.mock("@/utils/i18n", () => ({
  useTranslate:
    () =>
    (key: string): string =>
      key,
}));

if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverMock {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverMock;
}

const openPopover = (container: HTMLElement) => {
  const trigger = container.querySelector("button");
  expect(trigger).not.toBeNull();
  fireEvent.click(trigger as HTMLButtonElement);
};

const getTimeInput = () => document.querySelector('input[type="datetime-local"]') as HTMLInputElement;

describe("ScheduleSelector", () => {
  it("keeps the popover open after setting a time so duration options are reachable", () => {
    const onChange = vi.fn();
    const Harness = () => {
      const [time, setTime] = useState<Date | undefined>();
      const [duration, setDuration] = useState<number | undefined>();
      return (
        <ScheduleSelector
          value={time}
          duration={duration}
          onChange={(nextTime, nextDuration) => {
            setTime(nextTime);
            setDuration(nextDuration);
            onChange(nextTime, nextDuration);
          }}
        />
      );
    };
    const { container } = render(<Harness />);

    openPopover(container);
    expect(screen.queryByText("memo.schedule.duration")).not.toBeInTheDocument();

    fireEvent.change(getTimeInput(), { target: { value: "2026-08-23T15:00" } });
    fireEvent.blur(getTimeInput());

    expect(screen.getByText("memo.schedule.duration")).toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith(expect.any(Date), 3600);
  });

  it("keeps an already-selected duration when the time changes", () => {
    const onChange = vi.fn();
    const time = new Date(2026, 7, 23, 15, 0, 0);
    const { container } = render(<ScheduleSelector value={time} duration={7200} onChange={onChange} />);

    openPopover(container);
    fireEvent.change(getTimeInput(), { target: { value: "2026-08-24T10:30" } });
    fireEvent.blur(getTimeInput());

    expect(onChange).toHaveBeenCalledWith(expect.any(Date), 7200);
  });

  it("passes the selected duration together with the current scheduled time", () => {
    const onChange = vi.fn();
    const time = new Date(2026, 7, 23, 15, 0, 0);
    const { container } = render(<ScheduleSelector value={time} duration={3600} onChange={onChange} />);

    openPopover(container);
    fireEvent.click(screen.getByText("2h"));

    expect(onChange).toHaveBeenCalledWith(time, 7200);
  });
});
