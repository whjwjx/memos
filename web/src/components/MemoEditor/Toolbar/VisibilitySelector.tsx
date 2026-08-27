import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import VisibilityIcon from "@/components/VisibilityIcon";
import { cn } from "@/lib/utils";
import { Visibility } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";
import type { VisibilitySelectorProps } from "../types";

const VisibilitySelector = (props: VisibilitySelectorProps) => {
  const { value, onChange } = props;
  const compact = props.size === "compact";
  const mobileIconOnly = props.mobileIconOnly;
  const t = useTranslate();

  const visibilityOptions = [
    { value: Visibility.PRIVATE, label: t("memo.visibility.private"), description: t("memo.visibility.private-description") },
    { value: Visibility.PROTECTED, label: t("memo.visibility.protected"), description: t("memo.visibility.protected-description") },
    { value: Visibility.PUBLIC, label: t("memo.visibility.public"), description: t("memo.visibility.public-description") },
  ] as const;

  const currentLabel = visibilityOptions.find((option) => option.value === value)?.label || "";

  return (
    <DropdownMenu onOpenChange={props.onOpenChange}>
      <DropdownMenuTrigger
        render={
          <button
            aria-label={currentLabel}
            className={cn(
              "inline-flex min-w-0 items-center rounded-md transition-colors hover:bg-accent",
              compact ? "px-1.5 py-[3px] text-[13px] leading-5 text-foreground/85" : "h-8 px-2 text-sm text-muted-foreground",
              !compact && "max-w-[9rem] sm:max-w-none",
              mobileIconOnly && !compact && "w-8 justify-center px-0 sm:w-auto sm:justify-start sm:px-2",
            )}
          />
        }
      >
        <VisibilityIcon
          visibility={value}
          className={cn("shrink-0 opacity-60", compact ? "mr-1.5 w-[13px]" : mobileIconOnly ? "mr-0 sm:mr-1.5" : "mr-1.5")}
        />
        <span className={cn("min-w-0 truncate", mobileIconOnly && "hidden sm:inline")}>{currentLabel}</span>
        <ChevronDownIcon
          className={cn(
            "ml-0.5 shrink-0 opacity-60",
            compact ? "size-3.5 text-muted-foreground/70" : "w-4 h-4",
            mobileIconOnly && "hidden sm:block",
          )}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {visibilityOptions.map((option) => (
          <DropdownMenuItem key={option.value} onClick={() => onChange(option.value)}>
            <VisibilityIcon visibility={option.value} />
            <div className="flex flex-col">
              <span>{option.label}</span>
              <span className="text-xs text-muted-foreground">{option.description}</span>
            </div>
            {value === option.value && <CheckIcon className="ml-auto w-4 h-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default VisibilitySelector;
