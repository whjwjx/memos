import { create } from "@bufbuild/protobuf";
import dayjs from "dayjs";
import { CalendarClockIcon, ChevronDownIcon, RepeatIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import DateTimeInput from "@/components/DateTimeInput";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  type MemoScheduleRecurrence,
  MemoScheduleRecurrence_Frequency,
  MemoScheduleRecurrenceSchema,
} from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";
import type { ScheduleSelectorProps } from "../types";

const DURATION_OPTIONS = [
  { value: 1800, label: "30m" },
  { value: 3600, label: "1h" },
  { value: 7200, label: "2h" },
  { value: 10800, label: "3h" },
] as const;

const DEFAULT_DURATION = 3600;
const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKENDS = [0, 6];

type RepeatPreset = "none" | "daily" | "weekdays" | "weekends" | "custom";

function nextHour(date: Date): Date {
  const d = new Date(date);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

function getTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function createDailyRecurrence(): MemoScheduleRecurrence {
  return create(MemoScheduleRecurrenceSchema, {
    frequency: MemoScheduleRecurrence_Frequency.DAILY,
    interval: 1,
    timezone: getTimezone(),
  });
}

function createWeeklyRecurrence(daysOfWeek: number[]): MemoScheduleRecurrence {
  return create(MemoScheduleRecurrenceSchema, {
    frequency: MemoScheduleRecurrence_Frequency.WEEKLY,
    daysOfWeek,
    interval: 1,
    timezone: getTimezone(),
  });
}

function sameDays(left: number[], right: number[]): boolean {
  if (left.length !== right.length) return false;
  const a = [...left].sort((x, y) => x - y);
  const b = [...right].sort((x, y) => x - y);
  return a.every((value, index) => value === b[index]);
}

function getRepeatPreset(recurrence?: MemoScheduleRecurrence): RepeatPreset {
  if (!recurrence) return "none";
  if (recurrence.frequency === MemoScheduleRecurrence_Frequency.DAILY) return "daily";
  if (recurrence.frequency !== MemoScheduleRecurrence_Frequency.WEEKLY) return "none";
  if (sameDays(recurrence.daysOfWeek, WEEKDAYS)) return "weekdays";
  if (sameDays(recurrence.daysOfWeek, WEEKENDS)) return "weekends";
  return "custom";
}

const ScheduleSelector = (props: ScheduleSelectorProps) => {
  const { value, duration, recurrence, onChange, onOpenChange, mobileIconOnly } = props;
  const t = useTranslate();
  const [open, setOpen] = useState(false);
  const [draftTime, setDraftTime] = useState(() => nextHour(new Date()));
  const repeatPreset = getRepeatPreset(recurrence);
  const weekdayLabels = [
    t("common.days.sun"),
    t("common.days.mon"),
    t("common.days.tue"),
    t("common.days.wed"),
    t("common.days.thu"),
    t("common.days.fri"),
    t("common.days.sat"),
  ];

  const emitChange = (next?: Date, nextDuration?: number, nextRecurrence?: MemoScheduleRecurrence) => {
    if (nextRecurrence) {
      onChange(next, nextDuration, nextRecurrence);
    } else {
      onChange(next, nextDuration);
    }
  };

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setDraftTime(value ?? nextHour(new Date()));
    }
    setOpen(next);
    onOpenChange?.(next);
  };

  const handleSetTime = (date: Date) => {
    emitChange(date, duration ?? DEFAULT_DURATION, recurrence);
  };

  const handleSetDuration = (next: number) => {
    emitChange(value ?? draftTime, next, recurrence);
  };

  const handleClear = () => {
    emitChange(undefined, undefined);
    handleOpenChange(false);
  };

  const handleRepeatPreset = (preset: RepeatPreset) => {
    if (preset === "none" && !value) {
      return;
    }
    const scheduleTime = value ?? draftTime;
    const nextDuration = duration ?? DEFAULT_DURATION;
    if (preset === "none") {
      emitChange(scheduleTime, nextDuration);
    } else if (preset === "daily") {
      emitChange(scheduleTime, nextDuration, createDailyRecurrence());
    } else if (preset === "weekdays") {
      emitChange(scheduleTime, nextDuration, createWeeklyRecurrence(WEEKDAYS));
    } else if (preset === "weekends") {
      emitChange(scheduleTime, nextDuration, createWeeklyRecurrence(WEEKENDS));
    } else {
      const initialDay = scheduleTime.getDay();
      emitChange(scheduleTime, nextDuration, createWeeklyRecurrence(recurrence?.daysOfWeek.length ? recurrence.daysOfWeek : [initialDay]));
    }
  };

  const handleToggleCustomDay = (day: number) => {
    const scheduleTime = value ?? draftTime;
    const currentDays = recurrence?.frequency === MemoScheduleRecurrence_Frequency.WEEKLY ? recurrence.daysOfWeek : [scheduleTime.getDay()];
    const nextDays = currentDays.includes(day) ? currentDays.filter((value) => value !== day) : [...currentDays, day];
    if (nextDays.length === 0) {
      return;
    }
    emitChange(scheduleTime, duration ?? DEFAULT_DURATION, createWeeklyRecurrence(nextDays));
  };

  const label = value ? dayjs(value).format("MM/DD HH:mm") : t("memo.schedule.set");
  const effectiveTime = value ?? draftTime;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={label}
            className={cn(
              "inline-flex h-8 min-w-0 items-center rounded-md text-sm text-muted-foreground transition-colors hover:bg-accent",
              mobileIconOnly
                ? "w-8 justify-center px-0 sm:w-auto sm:max-w-none sm:justify-start sm:px-2"
                : "max-w-[9.5rem] px-2 sm:max-w-none",
            )}
          />
        }
      >
        <CalendarClockIcon className={cn("h-4 w-4 shrink-0 opacity-60", mobileIconOnly ? "mr-0 sm:mr-1.5" : "mr-1.5")} />
        <span className={cn("min-w-0 truncate", mobileIconOnly && "hidden sm:inline")}>{label}</span>
        <ChevronDownIcon className={cn("ml-0.5 h-4 w-4 shrink-0 opacity-60", mobileIconOnly && "hidden sm:block")} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(18rem,calc(100vw-1rem))] p-3">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-foreground">{t("memo.schedule.time")}</span>
            <DateTimeInput key={effectiveTime.getTime()} value={effectiveTime} onChange={handleSetTime} />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">{t("memo.schedule.duration")}</span>
            <div className="flex flex-wrap gap-1">
              {DURATION_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleSetDuration(opt.value)}
                  className={cn(
                    "rounded-md border px-2 py-1 text-xs transition-colors",
                    (duration ?? DEFAULT_DURATION) === opt.value
                      ? "bg-primary text-primary-foreground border-primary"
                      : "hover:bg-accent border-border",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">{t("memo.schedule.repeat")}</span>
            <div className="grid grid-cols-2 gap-1">
              {(["none", "daily", "weekdays", "weekends"] as const).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => handleRepeatPreset(preset)}
                  className={cn(
                    "inline-flex items-center justify-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors",
                    repeatPreset === preset ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent border-border",
                  )}
                >
                  {preset !== "none" && <RepeatIcon className="size-3" />}
                  {t(`memo.schedule.repeat-${preset}`)}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => handleRepeatPreset("custom")}
              className={cn(
                "rounded-md border px-2 py-1 text-xs transition-colors",
                repeatPreset === "custom" ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent border-border",
              )}
            >
              {t("memo.schedule.repeat-custom")}
            </button>
            {repeatPreset === "custom" && (
              <div className="flex flex-wrap gap-1">
                {weekdayLabels.map((label, index) => {
                  const selected = recurrence?.daysOfWeek.includes(index) ?? false;
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => handleToggleCustomDay(index)}
                      className={cn(
                        "size-7 rounded-md border text-xs transition-colors",
                        selected ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent border-border",
                      )}
                      aria-pressed={selected}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          {value && (
            <button
              type="button"
              onClick={handleClear}
              className="inline-flex items-center justify-center gap-1 rounded-md border border-destructive/40 text-destructive hover:bg-destructive/10 px-2 py-1 text-xs transition-colors"
            >
              <Trash2Icon className="w-3.5 h-3.5" />
              {t("memo.schedule.clear")}
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default ScheduleSelector;
