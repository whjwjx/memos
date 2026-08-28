import { create } from "@bufbuild/protobuf";
import { FieldMaskSchema } from "@bufbuild/protobuf/wkt";
import { ArrowUpToLineIcon, HashIcon, ListIcon, ListTreeIcon } from "lucide-react";
import { forwardRef, useMemo, useState } from "react";
import { toast } from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { userServiceClient } from "@/connect";
import { useOptionalAuth } from "@/contexts/AuthContext";
import { replaceFiltersByFactor, stringifyFilters, useMemoFilterContext } from "@/contexts/MemoFilterContext";
import { useLocalStorage, useOverflowTitle } from "@/hooks";
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
}

const FlatTagRow = ({ tag, amount, active, pinned, pinDisabled, onClick, onTogglePin }: FlatTagRowProps) => {
  const t = useTranslate();
  const { ref, title } = useOverflowTitle<HTMLSpanElement>(`#${tag}`);
  const pinLabel = `${t(pinned ? "common.unpin" : "common.pin")} #${tag}`;

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
      {onTogglePin && (
        <button
          type="button"
          aria-label={pinLabel}
          title={pinLabel}
          disabled={pinDisabled}
          className={cn(
            "-mr-1 flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-[background-color,color,opacity,scale] hover:bg-background/70 hover:text-foreground disabled:pointer-events-none disabled:opacity-40",
            SIDEBAR_ROW_FOCUS_CLASSES,
            "scale-95 md:opacity-0 md:group-hover/tag:scale-100 md:group-hover/tag:opacity-100",
            pinned && "text-primary hover:text-primary",
          )}
          onClick={onTogglePin}
        >
          <ArrowUpToLineIcon aria-hidden="true" className="size-3.5" strokeWidth={1.8} />
        </button>
      )}
    </div>
  );
};

const TagsSection = ({ tagCount, onSelect, navigationTarget, scope }: Props) => {
  const t = useTranslate();
  const navigate = useNavigate();
  const authContext = useOptionalAuth();
  const currentUser = authContext?.currentUser;
  const userTagsSetting = authContext?.userTagsSetting;
  const refetchSettings = authContext?.refetchSettings;
  const { filters, setFilters, getFiltersByFactor, addFilter, removeFilter } = useMemoFilterContext();
  const [treeMode, setTreeMode] = useLocalStorage<boolean>("tag-view-as-tree", false);
  const [pinningTag, setPinningTag] = useState<string>();
  const activeTags = new Set(getFiltersByFactor("tagSearch").map((filter) => filter.value));
  const activeTag = activeTags.values().next().value as string | undefined;
  const tags = useMemo(() => Object.entries(tagCount).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])), [tagCount]);
  const pinnedTagSet = useMemo(() => {
    const settingTags = userTagsSetting?.tags ?? {};
    return new Set(Object.keys(tagCount).filter((tag) => settingTags[tag]?.pinned));
  }, [tagCount, userTagsSetting?.tags]);
  const pinnedTags = useMemo(() => tags.filter(([tag]) => pinnedTagSet.has(tag)), [pinnedTagSet, tags]);
  const regularTags = useMemo(() => tags.filter(([tag]) => !pinnedTagSet.has(tag)), [pinnedTagSet, tags]);

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
            />
          ))}
        </SidebarSection>
      )}

      {regularTags.length > 0 && (
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
              tagAmounts={regularTags}
              activeTag={activeTag}
              scope={scope}
              onTagClick={handleTagClick}
              onTogglePin={currentUser ? handleTogglePin : undefined}
              pinningTag={pinningTag}
            />
          ) : (
            <>
              {regularTags.map(([tag, amount]) => (
                <FlatTagRow
                  key={tag}
                  tag={tag}
                  amount={amount}
                  active={activeTags.has(tag)}
                  pinned={false}
                  pinDisabled={pinningTag === tag}
                  onClick={() => handleTagClick(tag)}
                  onTogglePin={currentUser ? () => handleTogglePin(tag) : undefined}
                />
              ))}
            </>
          )}
        </SidebarSection>
      )}
    </>
  );
};

export default TagsSection;
