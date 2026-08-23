import dayjs from "dayjs";
import { CalendarClockIcon, ChevronDownIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import DateTimeInput from "@/components/DateTimeInput";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";
import type { ScheduleSelectorProps } from "../types";

const DURATION_OPTIONS = [
  { value: 1800, label: "30m" },
  { value: 3600, label: "1h" },
  { value: 7200, label: "2h" },
  { value: 10800, label: "3h" },
] as const;

const DEFAULT_DURATION = 3600;

function nextHour(date: Date): Date {
  const d = new Date(date);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

const ScheduleSelector = (props: ScheduleSelectorProps) => {
  const { value, duration, onChange, onOpenChange } = props;
  const t = useTranslate();
  const [open, setOpen] = useState(false);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };

  const handleSetTime = (date: Date) => {
    onChange(date, duration ?? DEFAULT_DURATION);
  };

  const handleSetDuration = (next: number) => {
    if (value) {
      onChange(value, next);
    }
  };

  const handleClear = () => {
    onChange(undefined, undefined);
    handleOpenChange(false);
  };

  const label = value ? dayjs(value).format("MM/DD HH:mm") : t("memo.schedule.set");
  const defaultDate = value ?? nextHour(new Date());

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="inline-flex items-center rounded-md hover:bg-accent transition-colors h-8 px-2 text-sm text-muted-foreground"
          />
        }
      >
        <CalendarClockIcon className={cn("opacity-60 mr-1.5", "w-4 h-4")} />
        <span className="truncate">{label}</span>
        <ChevronDownIcon className="ml-0.5 opacity-60 w-4 h-4" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">{t("memo.schedule.time")}</span>
            <DateTimeInput key={value?.getTime() ?? "empty"} value={defaultDate} onChange={handleSetTime} />
          </div>
          {value && (
            <>
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
                        duration === opt.value ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent border-border",
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={handleClear}
                className="inline-flex items-center justify-center gap-1 rounded-md border border-destructive/40 text-destructive hover:bg-destructive/10 px-2 py-1 text-xs transition-colors"
              >
                <Trash2Icon className="w-3.5 h-3.5" />
                {t("memo.schedule.clear")}
              </button>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default ScheduleSelector;
