import { ArrowUpToLineIcon, MoreHorizontalIcon, PencilIcon } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";
import { SIDEBAR_ROW_FOCUS_CLASSES } from "./SidebarRow";

interface Props {
  tag: string;
  pinned: boolean;
  pinDisabled?: boolean;
  onTogglePin?: () => void;
  onRename?: () => void;
}

const TagActionMenu = ({ tag, pinned, pinDisabled, onTogglePin, onRename }: Props) => {
  const t = useTranslate();

  if (!onTogglePin && !onRename) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={`${t("common.actions")} #${tag}`}
            title={`${t("common.actions")} #${tag}`}
            className={cn(
              "-mr-1 flex size-6 shrink-0 scale-95 items-center justify-center rounded text-muted-foreground transition-[background-color,color,opacity,scale] hover:bg-background/70 hover:text-foreground md:opacity-0 md:group-hover/tag:scale-100 md:group-hover/tag:opacity-100 md:focus-visible:scale-100 md:focus-visible:opacity-100",
              SIDEBAR_ROW_FOCUS_CLASSES,
              pinned && "text-primary hover:text-primary",
            )}
          />
        }
      >
        <MoreHorizontalIcon aria-hidden="true" className="size-3.5" strokeWidth={1.8} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" size="sm">
        {onTogglePin && (
          <DropdownMenuItem disabled={pinDisabled} onClick={onTogglePin}>
            <ArrowUpToLineIcon aria-hidden="true" />
            <span>{t(pinned ? "common.unpin" : "common.pin")}</span>
          </DropdownMenuItem>
        )}
        {onRename && (
          <DropdownMenuItem onClick={onRename}>
            <PencilIcon aria-hidden="true" />
            <span>{t("common.rename")}</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default TagActionMenu;
