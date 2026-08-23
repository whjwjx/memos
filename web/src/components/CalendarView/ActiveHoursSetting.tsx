import { toast } from "react-hot-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTranslate } from "@/utils/i18n";

interface ActiveHoursSettingProps {
  dayStartMin: number;
  dayEndMin: number;
  disabled?: boolean;
  onStartChange: (minutes: number) => void;
  onEndChange: (minutes: number) => void;
  /** 当选择导致开始/结束区间非法时，联动调整两端并一次提交（可选；未提供则依次调用 onStartChange/onEndChange）。 */
  onRangeChange?: (dayStartMin: number, dayEndMin: number) => void;
}

/** 开始时间的可选项：00:00 ~ 23:00（整点，分钟数）。 */
const START_OPTIONS = Array.from({ length: 24 }, (_, hour) => hour * 60);
/** 结束时间的可选项：01:00 ~ 24:00（整点，分钟数，1440 表示次日 0 点）。 */
const END_OPTIONS = Array.from({ length: 24 }, (_, index) => (index + 1) * 60);

const formatTimeLabel = (minutes: number): string => {
  if (minutes === 1440) {
    return "24:00";
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins === 0 ? `${hours}:00` : `${hours}:${String(mins).padStart(2, "0")}`;
};

/**
 * 活跃时段设置：开始/结束两个整点时间选择器。
 * 同时用于偏好设置页和周视图顶部的快捷设置 Popover。
 * 结束时间必须晚于开始时间；若用户选择产生非法组合，则自动联动调整另一端
 * （开始向后推 1 小时 / 结束向前收 1 小时），保证区间始终有效，而不是报错阻止保存。
 */
const ActiveHoursSetting = ({ dayStartMin, dayEndMin, disabled, onStartChange, onEndChange, onRangeChange }: ActiveHoursSettingProps) => {
  const t = useTranslate();

  const handleStartChange = (value: string) => {
    const minutes = Number(value);
    if (minutes < dayEndMin) {
      onStartChange(minutes);
      return;
    }
    // 开始时间不早于结束时间：联动把结束时间推到开始后 1 小时。
    const nextEndMin = Math.min(minutes + 60, 1440);
    if (onRangeChange) {
      onRangeChange(minutes, nextEndMin);
    } else {
      onStartChange(minutes);
      onEndChange(nextEndMin);
    }
    toast(t("setting.preference.calendar-adjusted"));
  };

  const handleEndChange = (value: string) => {
    const minutes = Number(value);
    if (minutes > dayStartMin) {
      onEndChange(minutes);
      return;
    }
    // 结束时间不晚于开始时间：联动把开始时间提前到结束前 1 小时。
    const nextStartMin = Math.max(minutes - 60, 0);
    if (onRangeChange) {
      onRangeChange(nextStartMin, minutes);
    } else {
      onStartChange(nextStartMin);
      onEndChange(minutes);
    }
    toast(t("setting.preference.calendar-adjusted"));
  };

  return (
    <div className="flex items-center gap-1.5">
      <Select value={String(dayStartMin)} onValueChange={handleStartChange}>
        <SelectTrigger size="sm" disabled={disabled} aria-label={t("setting.preference.calendar-day-start")} className="min-w-fit">
          <SelectValue>{(value) => <span>{formatTimeLabel(Number(value))}</span>}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {START_OPTIONS.map((minutes) => (
            <SelectItem key={minutes} value={String(minutes)}>
              {formatTimeLabel(minutes)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-muted-foreground">–</span>
      <Select value={String(dayEndMin)} onValueChange={handleEndChange}>
        <SelectTrigger size="sm" disabled={disabled} aria-label={t("setting.preference.calendar-day-end")} className="min-w-fit">
          <SelectValue>{(value) => <span>{formatTimeLabel(Number(value))}</span>}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {END_OPTIONS.map((minutes) => (
            <SelectItem key={minutes} value={String(minutes)}>
              {formatTimeLabel(minutes)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};

export default ActiveHoursSetting;
