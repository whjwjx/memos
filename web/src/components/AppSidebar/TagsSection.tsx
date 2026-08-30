import { create } from "@bufbuild/protobuf";
import { FieldMaskSchema } from "@bufbuild/protobuf/wkt";
import { useQueryClient } from "@tanstack/react-query";
import { HashIcon, ListIcon, ListTreeIcon } from "lucide-react";
import { forwardRef, useMemo, useState } from "react";
import { toast } from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { userServiceClient } from "@/connect";
import { useOptionalAuth } from "@/contexts/AuthContext";
import { replaceFiltersByFactor, stringifyFilters, useMemoFilterContext } from "@/contexts/MemoFilterContext";
import { renameTag } from "@/helpers/tag";
import { useLocalStorage, useOverflowTitle } from "@/hooks";
import { memoKeys } from "@/hooks/useMemoQueries";
import { userKeys } from "@/hooks/useUserQueries";
import { handleError } from "@/lib/error";
import { buildUserSettingName } from "@/lib/resource-names";
import { cn } from "@/lib/utils";
import {
  UserSetting_Key,
  UserSetting_TagMetadataSchema,
  UserSetting_TagsSettingSchema,
  UserSettingSchema,
} from "@/types/proto/api/v1/user_service_pb";
import { useTranslate } from "@/utils/i18n";
import TagTree from "../TagTree";
import {
  SIDEBAR_ROW_BOX_CLASSES,
  SIDEBAR_ROW_COUNT_CLASSES,
  SIDEBAR_ROW_FOCUS_CLASSES,
  SIDEBAR_ROW_ICON_CLASSES,
  sidebarRowStateClasses,
} from "./SidebarRow";
import SidebarSection, {
  SIDEBAR_SECTION_ACTION_ACTIVE_CLASSES,
  SIDEBAR_SECTION_ACTION_BUTTON_CLASSES,
  SIDEBAR_SECTION_ACTION_ICON_CLASSES,
} from "./SidebarSection";
import TagActionMenu from "./TagActionMenu";

interface Props {
  tagCount: Record<string, number>;
  onSelect?: () => void;
  /** When set, tag clicks land on this route with the tag filter instead of filtering the current one. */
  navigationTarget?: string;
  /** Whose tags these are; keeps tree expansion state from bleeding between users and views. */
  scope: string;
}

const TagPath = forwardRef<HTMLSpanElement, { tag: string }>(({ tag }, ref) => {
  const segments = tag.split("/");

  return (
    <span ref={ref} className="min-w-0 flex-1 truncate text-left">
      {segments.map((segment, index) => (
        <span key={`${segment}-${index}`}>
          {index > 0 && <span className="px-0.5 text-muted-foreground/40">/</span>}
          <span className={index === segments.length - 1 ? "text-current" : "text-muted-foreground/75"}>{segment}</span>
        </span>
      ))}
    </span>
  );
});
TagPath.displayName = "TagPath";

interface FlatTagRowProps {
  tag: string;
  amount: number;
  active: boolean;
  pinned: boolean;
  pinDisabled?: boolean;
  onClick: () => void;
  onTogglePin?: () => void;
  onRename?: () => void;
}

const FlatTagRow = ({ tag, amount, active, pinned, pinDisabled, onClick, onTogglePin, onRename }: FlatTagRowProps) => {
  const { ref, title } = useOverflowTitle<HTMLSpanElement>(`#${tag}`);

  return (
    <div className={cn(SIDEBAR_ROW_BOX_CLASSES, "group/tag", sidebarRowStateClasses(active))}>
      <button
        type="button"
        aria-pressed={active || undefined}
        title={title}
        className={cn("flex h-full min-w-0 flex-1 items-center gap-2 text-left", SIDEBAR_ROW_FOCUS_CLASSES)}
        onClick={onClick}
      >
        <HashIcon aria-hidden="true" className={SIDEBAR_ROW_ICON_CLASSES} strokeWidth={1.8} />
        <TagPath ref={ref} tag={tag} />
        <span className={SIDEBAR_ROW_COUNT_CLASSES}>{amount}</span>
      </button>
      <TagActionMenu tag={tag} pinned={pinned} pinDisabled={pinDisabled} onTogglePin={onTogglePin} onRename={onRename} />
    </div>
  );
};

const TagsSection = ({ tagCount, onSelect, navigationTarget, scope }: Props) => {
  const t = useTranslate();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const authContext = useOptionalAuth();
  const currentUser = authContext?.currentUser;
  const userTagsSetting = authContext?.userTagsSetting;
  const refetchSettings = authContext?.refetchSettings;
  const { filters, setFilters, getFiltersByFactor, addFilter, removeFilter } = useMemoFilterContext();
  const [treeMode, setTreeMode] = useLocalStorage<boolean>("tag-view-as-tree", false);
  const [pinningTag, setPinningTag] = useState<string>();
  const [renameTarget, setRenameTarget] = useState<string>();
  const [renameValue, setRenameValue] = useState("");
  const [renamingTag, setRenamingTag] = useState<string>();
  const activeTags = new Set(getFiltersByFactor("tagSearch").map((filter) => filter.value));
  const activeTag = activeTags.values().next().value as string | undefined;
  const tags = useMemo(() => Object.entries(tagCount).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])), [tagCount]);
  const pinnedTagSet = useMemo(() => {
    const settingTags = userTagsSetting?.tags ?? {};
    return new Set(Object.keys(tagCount).filter((tag) => settingTags[tag]?.pinned));
  }, [tagCount, userTagsSetting?.tags]);
  const pinnedTags = useMemo(() => tags.filter(([tag]) => pinnedTagSet.has(tag)), [pinnedTagSet, tags]);

  if (tags.length === 0) {
    return null;
  }

  const handleTagClick = (tag: string) => {
    if (navigationTarget) {
      const nextFilters = replaceFiltersByFactor(filters, "tagSearch", [{ factor: "tagSearch", value: tag }]);
      setFilters(nextFilters);
      navigate({ pathname: navigationTarget, search: `?filter=${stringifyFilters(nextFilters)}` });
      onSelect?.();
      return;
    }
    const active = activeTags.has(tag);
    if (active) {
      removeFilter((filter) => filter.factor === "tagSearch" && filter.value === tag);
    } else {
      removeFilter((filter) => filter.factor === "tagSearch");
      addFilter({ factor: "tagSearch", value: tag });
    }
    onSelect?.();
  };

  const handleTogglePin = async (tag: string) => {
    if (!currentUser || pinningTag) {
      return;
    }

    const currentTags = userTagsSetting?.tags ?? {};
    const currentMetadata = currentTags[tag];
    const nextPinned = !currentMetadata?.pinned;
    const nextTags = { ...currentTags };

    if (!nextPinned && !currentMetadata?.backgroundColor && !currentMetadata?.blurContent) {
      delete nextTags[tag];
    } else {
      nextTags[tag] = create(UserSetting_TagMetadataSchema, {
        ...(currentMetadata?.backgroundColor ? { backgroundColor: currentMetadata.backgroundColor } : {}),
        blurContent: currentMetadata?.blurContent ?? false,
        pinned: nextPinned,
      });
    }

    setPinningTag(tag);
    try {
      await userServiceClient.updateUserSetting({
        setting: create(UserSettingSchema, {
          name: buildUserSettingName(currentUser.name, UserSetting_Key.TAGS),
          value: {
            case: "tagsSetting",
            value: create(UserSetting_TagsSettingSchema, { tags: nextTags }),
          },
        }),
        updateMask: create(FieldMaskSchema, { paths: ["tags"] }),
      });
      await refetchSettings?.();
    } catch (error: unknown) {
      handleError(error, toast.error, { context: "Pin tag" });
    } finally {
      setPinningTag(undefined);
    }
  };

  const handleStartRename = (tag: string) => {
    setRenameTarget(tag);
    setRenameValue(tag);
  };

  const handleRenameOpenChange = (open: boolean) => {
    if (open || renamingTag) {
      return;
    }
    setRenameTarget(undefined);
    setRenameValue("");
  };

  const handleRenameTag = async () => {
    if (!renameTarget || renamingTag) {
      return;
    }

    const nextTag = renameValue.trim().replace(/^#/, "");
    if (!nextTag || /\s/.test(nextTag) || nextTag.includes("#")) {
      toast.error(t("tag.rename-error-empty"));
      return;
    }
    if (nextTag === renameTarget) {
      toast.error(t("tag.rename-error-repeat"));
      return;
    }

    setRenamingTag(renameTarget);
    try {
      const result = await renameTag(renameTarget, nextTag);
      await Promise.all([
        refetchSettings?.(),
        queryClient.invalidateQueries({ queryKey: memoKeys.all }),
        queryClient.invalidateQueries({ queryKey: userKeys.stats() }),
      ]);
      toast.success(`${t("tag.rename-success")} (${result.updatedMemos})`);
      setRenameTarget(undefined);
      setRenameValue("");
    } catch (error: unknown) {
      handleError(error, toast.error, { context: "Rename tag" });
    } finally {
      setRenamingTag(undefined);
    }
  };

  return (
    <>
      {pinnedTags.length > 0 && (
        <SidebarSection label={t("common.pinned-tags")}>
          {pinnedTags.map(([tag, amount]) => (
            <FlatTagRow
              key={tag}
              tag={tag}
              amount={amount}
              active={activeTags.has(tag)}
              pinned
              pinDisabled={pinningTag === tag}
              onClick={() => handleTagClick(tag)}
              onTogglePin={currentUser ? () => handleTogglePin(tag) : undefined}
              onRename={currentUser ? () => handleStartRename(tag) : undefined}
            />
          ))}
        </SidebarSection>
      )}

      {tags.length > 0 && (
        <SidebarSection
          label={t("common.tags")}
          action={
            <div className="flex items-center gap-0.5" role="group" aria-label={t("common.tags")}>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`${t("common.tags")}: ${t("memo.layout-list")}`}
                aria-pressed={!treeMode}
                className={cn(SIDEBAR_SECTION_ACTION_BUTTON_CLASSES, !treeMode && SIDEBAR_SECTION_ACTION_ACTIVE_CLASSES)}
                onClick={() => setTreeMode(false)}
              >
                <ListIcon className={SIDEBAR_SECTION_ACTION_ICON_CLASSES} strokeWidth={1.8} />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`${t("common.tags")}: ${t("common.tree-mode")}`}
                aria-pressed={treeMode}
                className={cn(SIDEBAR_SECTION_ACTION_BUTTON_CLASSES, treeMode && SIDEBAR_SECTION_ACTION_ACTIVE_CLASSES)}
                onClick={() => setTreeMode(true)}
              >
                <ListTreeIcon className={SIDEBAR_SECTION_ACTION_ICON_CLASSES} strokeWidth={1.8} />
              </Button>
            </div>
          }
        >
          {treeMode ? (
            <TagTree
              key={scope}
              tagAmounts={tags}
              activeTag={activeTag}
              scope={scope}
              onTagClick={handleTagClick}
              onTogglePin={currentUser ? handleTogglePin : undefined}
              onRenameTag={currentUser ? handleStartRename : undefined}
              pinnedTags={pinnedTagSet}
              pinningTag={pinningTag}
            />
          ) : (
            <>
              {tags.map(([tag, amount]) => (
                <FlatTagRow
                  key={tag}
                  tag={tag}
                  amount={amount}
                  active={activeTags.has(tag)}
                  pinned={pinnedTagSet.has(tag)}
                  pinDisabled={pinningTag === tag}
                  onClick={() => handleTagClick(tag)}
                  onTogglePin={currentUser ? () => handleTogglePin(tag) : undefined}
                  onRename={currentUser ? () => handleStartRename(tag) : undefined}
                />
              ))}
            </>
          )}
        </SidebarSection>
      )}
      <Dialog open={!!renameTarget} onOpenChange={handleRenameOpenChange}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{t("tag.rename-tag")}</DialogTitle>
            <DialogDescription>{t("tag.rename-tip")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-foreground">{t("tag.old-name")}</span>
              <Input value={renameTarget ? `#${renameTarget}` : ""} readOnly />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-foreground">{t("tag.new-name")}</span>
              <Input
                autoFocus
                value={renameValue}
                disabled={!!renamingTag}
                onChange={(event) => setRenameValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleRenameTag();
                  }
                }}
              />
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" disabled={!!renamingTag} onClick={() => handleRenameOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button disabled={!!renamingTag} onClick={handleRenameTag}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default TagsSection;
