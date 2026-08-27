import { useDirection } from "@base-ui/react/direction-provider";
import { ChevronLeftIcon, ChevronRightIcon, LoaderCircleIcon, RefreshCwIcon, Settings2Icon, TagsIcon } from "lucide-react";
import { type TouchEvent, useEffect, useMemo, useRef, useState } from "react";
import { MentionResolutionProvider } from "@/components/MemoContent/MentionResolutionContext";
import MemoView from "@/components/MemoView";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { useLocalStorage } from "@/hooks";
import { useInfiniteMemos } from "@/hooks/useMemoQueries";
import { useTagCounts } from "@/hooks/useUserQueries";
import { buildMemoCreatorFilter } from "@/lib/resource-names";
import { cn } from "@/lib/utils";
import { State } from "@/types/proto/api/v1/common_pb";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";

type ReviewTagMode = "all" | "include" | "exclude" | "untagged";
type ReviewTimeRange = "all" | "12m" | "6m" | "3m" | "1m";
type ReviewCount = 4 | 8 | 12 | 16 | 20 | 24;

interface ReviewSettings {
  tagMode: ReviewTagMode;
  tagName: string;
  timeRange: ReviewTimeRange;
  count: ReviewCount;
}

interface ReviewHistoryRecord {
  lastSeenDate: string;
  seenCount: number;
}

type ReviewHistory = Record<string, ReviewHistoryRecord>;

interface ReviewSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: ReviewSettings;
  selectedTagName: string;
  tagOptions: string[];
  onSettingsChange: (patch: Partial<ReviewSettings>) => void;
  onTagModeChange: (tagMode: ReviewTagMode) => void;
}

const REVIEW_STORAGE_KEY = "memos-review-setting";
const REVIEW_HISTORY_STORAGE_KEY = "memos-review-history";
const REVIEW_PAGE_SIZE = 1000;
const REVIEW_COOLDOWN_DAYS = 7;
const REVIEW_SWIPE_DISTANCE_PX = 48;
const REVIEW_SWIPE_MAX_VERTICAL_PX = 72;
const REVIEW_SWIPE_AXIS_RATIO = 1.2;
const DEFAULT_SETTINGS: ReviewSettings = { tagMode: "all", tagName: "", timeRange: "all", count: 8 };
const TAG_MODES: ReviewTagMode[] = ["all", "include", "exclude", "untagged"];
const TIME_RANGES: ReviewTimeRange[] = ["all", "12m", "6m", "3m", "1m"];
const REVIEW_COUNTS: ReviewCount[] = [4, 8, 12, 16, 20, 24];

const isReviewTagMode = (value: unknown): value is ReviewTagMode => typeof value === "string" && TAG_MODES.includes(value as ReviewTagMode);
const isReviewTimeRange = (value: unknown): value is ReviewTimeRange =>
  typeof value === "string" && TIME_RANGES.includes(value as ReviewTimeRange);
const isReviewCount = (value: unknown): value is ReviewCount => typeof value === "number" && REVIEW_COUNTS.includes(value as ReviewCount);

const normalizeSettings = (value: unknown): ReviewSettings => {
  const data = value && typeof value === "object" ? (value as Partial<ReviewSettings>) : {};
  return {
    tagMode: isReviewTagMode(data.tagMode) ? data.tagMode : DEFAULT_SETTINGS.tagMode,
    tagName: typeof data.tagName === "string" ? data.tagName : "",
    timeRange: isReviewTimeRange(data.timeRange) ? data.timeRange : DEFAULT_SETTINGS.timeRange,
    count: isReviewCount(data.count) ? data.count : DEFAULT_SETTINGS.count,
  };
};

const normalizeReviewHistory = (value: unknown): ReviewHistory => {
  if (!value || typeof value !== "object") return {};

  return Object.entries(value as Record<string, Partial<ReviewHistoryRecord>>).reduce<ReviewHistory>((history, [memoName, record]) => {
    if (typeof memoName !== "string" || !record || typeof record !== "object") {
      return history;
    }

    if (typeof record.lastSeenDate === "string" && typeof record.seenCount === "number" && Number.isFinite(record.seenCount)) {
      history[memoName] = {
        lastSeenDate: record.lastSeenDate,
        seenCount: Math.max(0, Math.floor(record.seenCount)),
      };
    }

    return history;
  }, {});
};

const escapeFilterValue = (value: string) => JSON.stringify(value);

const getCutoffDate = (timeRange: ReviewTimeRange): Date | undefined => {
  if (timeRange === "all") return undefined;
  const months = Number(timeRange.slice(0, -1));
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return date;
};

const buildReviewFilter = (settings: ReviewSettings, currentUserName?: string): string | undefined => {
  const conditions: string[] = [];
  const creatorFilter = buildMemoCreatorFilter(currentUserName ?? "");
  if (creatorFilter) {
    conditions.push(creatorFilter);
  }

  if (settings.tagMode === "include" && settings.tagName) {
    conditions.push(`tag in [${escapeFilterValue(settings.tagName)}]`);
  } else if (settings.tagMode === "exclude" && settings.tagName) {
    conditions.push(`!(tag in [${escapeFilterValue(settings.tagName)}])`);
  } else if (settings.tagMode === "untagged") {
    conditions.push("size(tags) == 0");
  }

  const cutoffDate = getCutoffDate(settings.timeRange);
  if (cutoffDate) {
    conditions.push(`created_ts >= timestamp(${Math.floor(cutoffDate.getTime() / 1000)})`);
  }

  return conditions.length > 0 ? conditions.join(" && ") : undefined;
};

const getLocalDateKey = (date = new Date()) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const hashString = (value: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const daysBetween = (fromDate: string, toDate: string): number => {
  const fromTime = new Date(`${fromDate}T00:00:00`).getTime();
  const toTime = new Date(`${toDate}T00:00:00`).getTime();
  if (!Number.isFinite(fromTime) || !Number.isFinite(toTime)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((toTime - fromTime) / 86400000));
};

const getMemoReviewScore = (memo: Memo, seed: string, history: ReviewHistory, todayKey: string): number => {
  const record = history[memo.name]?.lastSeenDate === todayKey ? undefined : history[memo.name];
  const randomScore = hashString(`${seed}:${memo.name}`) / 4294967295;
  if (!record) {
    return randomScore - 0.25;
  }

  const daysSinceSeen = daysBetween(record.lastSeenDate, todayKey);
  const staleBonus = Math.min(daysSinceSeen, 365) / 365 / 4;
  const seenPenalty = Math.min(record.seenCount, 20) * 0.015;
  return randomScore - staleBonus + seenPenalty;
};

const pickDailyMemos = (memos: Memo[], seed: string, count: number, history: ReviewHistory, todayKey: string): Memo[] => {
  const rankedMemos = memos
    .map((memo) => {
      const record = history[memo.name]?.lastSeenDate === todayKey ? undefined : history[memo.name];
      const daysSinceSeen = record ? daysBetween(record.lastSeenDate, todayKey) : Number.POSITIVE_INFINITY;
      return {
        memo,
        inCooldown: daysSinceSeen < REVIEW_COOLDOWN_DAYS,
        score: getMemoReviewScore(memo, seed, history, todayKey),
      };
    })
    .sort(
      (left, right) =>
        Number(left.inCooldown) - Number(right.inCooldown) || left.score - right.score || left.memo.name.localeCompare(right.memo.name),
    );

  return rankedMemos.slice(0, count).map(({ memo }) => memo);
};

const areReviewHistoriesEqual = (left: ReviewHistory, right: ReviewHistory): boolean => {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  if (leftEntries.length !== rightEntries.length) return false;

  return leftEntries.every(([memoName, leftRecord]) => {
    const rightRecord = right[memoName];
    return rightRecord?.lastSeenDate === leftRecord.lastSeenDate && rightRecord.seenCount === leftRecord.seenCount;
  });
};

const markReviewMemosSeen = (value: unknown, memos: Memo[], todayKey: string): ReviewHistory => {
  const original = value && typeof value === "object" ? (value as ReviewHistory) : undefined;
  const current = normalizeReviewHistory(value);
  const nextHistory: ReviewHistory = {};
  const memoNames = new Set(memos.map((memo) => memo.name));

  for (const [memoName, record] of Object.entries(current)) {
    if (memoNames.has(memoName) || daysBetween(record.lastSeenDate, todayKey) <= 180) {
      nextHistory[memoName] = record;
    }
  }

  for (const memo of memos) {
    const previous = current[memo.name];
    nextHistory[memo.name] = {
      lastSeenDate: todayKey,
      seenCount: previous?.lastSeenDate === todayKey ? previous.seenCount : (previous?.seenCount ?? 0) + 1,
    };
  }

  if (areReviewHistoriesEqual(current, nextHistory)) {
    return original ?? current;
  }

  return nextHistory;
};

const ReviewSettingsDialog = ({
  open,
  onOpenChange,
  settings,
  selectedTagName,
  tagOptions,
  onSettingsChange,
  onTagModeChange,
}: ReviewSettingsDialogProps) => {
  const t = useTranslate();
  const needsTag = settings.tagMode === "include" || settings.tagMode === "exclude";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="lg"
        className="top-auto bottom-0 left-0 max-h-[min(88vh,42rem)] w-full max-w-none translate-x-0 translate-y-0 rounded-b-none rounded-t-2xl p-0 sm:top-[50%] sm:bottom-auto sm:left-[50%] sm:w-[calc(100%-3rem)] sm:max-w-lg sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-lg sm:p-6"
      >
        <DialogHeader className="border-b border-border/70 px-5 pt-5 pb-4 text-start sm:border-b-0 sm:p-0">
          <DialogTitle>{t("review.settings-title")}</DialogTitle>
          <DialogDescription>{t("review.settings-description")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5 px-5 py-4 sm:px-0 sm:py-0">
          <div className="grid gap-2">
            <Label>{t("review.content-range")}</Label>
            <div className="grid grid-cols-1 gap-1 rounded-md bg-muted p-1 min-[420px]:grid-cols-2 sm:grid-cols-4">
              {TAG_MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  disabled={(mode === "include" || mode === "exclude") && tagOptions.length === 0}
                  className={cn(
                    "h-8 rounded px-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                    settings.tagMode === mode
                      ? "bg-background font-medium text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => onTagModeChange(mode)}
                >
                  {t(`review.tag-mode.${mode}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-2">
            <Label>{t("common.tags")}</Label>
            <Select
              value={selectedTagName}
              onValueChange={(tagName) => onSettingsChange({ tagName })}
              disabled={!needsTag || tagOptions.length === 0}
            >
              <SelectTrigger className="w-full">
                <TagsIcon className="size-4" />
                <SelectValue placeholder={t("review.select-tag")} />
              </SelectTrigger>
              <SelectContent>
                {tagOptions.map((tag) => (
                  <SelectItem key={tag} value={tag}>
                    #{tag}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>{t("review.time-range")}</Label>
              <Select value={settings.timeRange} onValueChange={(value) => onSettingsChange({ timeRange: value as ReviewTimeRange })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIME_RANGES.map((range) => (
                    <SelectItem key={range} value={range}>
                      {t(`review.time.${range}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>{t("review.daily-count")}</Label>
              <Select value={`${settings.count}`} onValueChange={(value) => onSettingsChange({ count: Number(value) as ReviewCount })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REVIEW_COUNTS.map((count) => (
                    <SelectItem key={count} value={`${count}`}>
                      {t("review.count-option", { count })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter className="border-t border-border/70 px-5 py-4 sm:border-t-0 sm:p-0">
          <Button className="w-full sm:w-auto" onClick={() => onOpenChange(false)}>
            {t("common.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const Review = () => {
  const t = useTranslate();
  const direction = useDirection();
  const { currentUser, isUserSettingsInitialized } = useAuth();
  const [storedSettings, setStoredSettings] = useLocalStorage<ReviewSettings>(REVIEW_STORAGE_KEY, DEFAULT_SETTINGS);
  const [storedHistory, setStoredHistory] = useLocalStorage<ReviewHistory>(REVIEW_HISTORY_STORAGE_KEY, {});
  const settings = useMemo(() => normalizeSettings(storedSettings), [storedSettings]);
  const reviewHistory = useMemo(() => normalizeReviewHistory(storedHistory), [storedHistory]);
  const [seedNonce, setSeedNonce] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const { data: tagCounts = {} } = useTagCounts(true);
  const tagOptions = useMemo(() => Object.keys(tagCounts).sort((left, right) => left.localeCompare(right)), [tagCounts]);
  const selectedTagName = tagOptions.includes(settings.tagName) ? settings.tagName : "";
  const needsTag = settings.tagMode === "include" || settings.tagMode === "exclude";
  const filterSettings = useMemo(() => ({ ...settings, tagName: needsTag ? selectedTagName : "" }), [needsTag, selectedTagName, settings]);
  const filter = useMemo(() => buildReviewFilter(filterSettings, currentUser?.name), [currentUser?.name, filterSettings]);
  const request = useMemo(
    () => ({
      filter,
      orderBy: "create_time desc",
      pageSize: REVIEW_PAGE_SIZE,
      state: State.NORMAL,
    }),
    [filter],
  );
  const { data, error, fetchNextPage, hasNextPage, isError, isFetching, isFetchingNextPage, isLoading, refetch } = useInfiniteMemos(
    request,
    {
      enabled: !!currentUser?.name,
    },
  );
  const memos = useMemo(() => data?.pages.flatMap((page) => page.memos) ?? [], [data]);
  const todayKey = getLocalDateKey();
  const dailySeed = `${todayKey}:${seedNonce}:${currentUser?.name ?? ""}:${JSON.stringify(filterSettings)}`;
  const reviewMemos = useMemo(
    () => pickDailyMemos(memos, dailySeed, settings.count, reviewHistory, todayKey),
    [dailySeed, memos, reviewHistory, settings.count, todayKey],
  );
  const activeMemo = reviewMemos[activeIndex];
  const contents = useMemo(() => (activeMemo ? [activeMemo.content] : []), [activeMemo]);
  const userNames = useMemo(
    () => (activeMemo ? Array.from(new Set((activeMemo.reactions ?? []).map((reaction) => reaction.creator))) : []),
    [activeMemo],
  );
  const isLoadingAllCandidates = isLoading || isFetchingNextPage || !!hasNextPage || !isUserSettingsInitialized;

  useEffect(() => {
    if (hasNextPage && !isFetching) {
      void fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetching]);

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(reviewMemos.length - 1, 0)));
  }, [reviewMemos.length]);

  useEffect(() => {
    if (reviewMemos.length > 0) {
      setStoredHistory((current) => markReviewMemosSeen(current, reviewMemos, todayKey));
    }
  }, [reviewMemos, setStoredHistory, todayKey]);

  const goToPrevious = () => {
    setActiveIndex((current) => Math.max(current - 1, 0));
  };

  const goToNext = () => {
    setActiveIndex((current) => Math.min(current + 1, reviewMemos.length - 1));
  };

  const updateSettings = (patch: Partial<ReviewSettings>) => {
    setActiveIndex(0);
    setSeedNonce(0);
    setStoredSettings((current) => normalizeSettings({ ...current, ...patch }));
  };

  const handleTagModeChange = (tagMode: ReviewTagMode) => {
    updateSettings({
      tagMode,
      tagName: tagMode === "include" || tagMode === "exclude" ? selectedTagName || tagOptions[0] || "" : "",
    });
  };

  const handleShuffle = () => {
    setActiveIndex(0);
    setSeedNonce((current) => current + 1);
  };

  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 1) {
      swipeStartRef.current = null;
      return;
    }

    const target = event.target;
    if (
      target instanceof Element &&
      target.closest("a, button, input, textarea, select, [contenteditable='true'], [data-touch-action='ignore-swipe']")
    ) {
      swipeStartRef.current = null;
      return;
    }

    const touch = event.touches[0];
    if (!touch) {
      swipeStartRef.current = null;
      return;
    }

    swipeStartRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start || reviewMemos.length <= 1) {
      return;
    }

    const touch = event.changedTouches[0];
    if (!touch) {
      return;
    }

    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);
    const isHorizontalSwipe =
      absX >= REVIEW_SWIPE_DISTANCE_PX && absY <= REVIEW_SWIPE_MAX_VERTICAL_PX && absX / Math.max(absY, 1) >= REVIEW_SWIPE_AXIS_RATIO;

    if (!isHorizontalSwipe) {
      return;
    }

    const forward = direction === "rtl" ? deltaX > 0 : deltaX < 0;
    forward ? goToNext() : goToPrevious();
  };

  return (
    <section className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-3xl flex-col pb-8">
      <h1 className="sr-only">{t("review.title")}</h1>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 rounded-lg bg-muted/40 px-3 py-5 sm:px-6">
        {isError ? (
          <div className="flex w-full max-w-xl flex-col items-center rounded-lg border border-destructive/30 bg-background px-4 py-10 text-center shadow-xs">
            <p className="text-sm font-medium text-foreground">{t("review.load-error")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{error instanceof Error ? error.message : t("message.no-data")}</p>
            <Button variant="outline" className="mt-4" onClick={() => refetch()}>
              <RefreshCwIcon className="size-4" />
              {t("attachment-library.actions.retry")}
            </Button>
          </div>
        ) : activeMemo ? (
          <MentionResolutionProvider contents={contents} userNames={userNames}>
            <div
              className="relative w-full max-w-xl touch-pan-y select-none overscroll-x-contain"
              data-review-swipe-area="true"
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
              onTouchCancel={() => {
                swipeStartRef.current = null;
              }}
            >
              <div className="absolute inset-x-5 top-3 h-full rounded-xl border border-border/60 bg-background/65" />
              <div className="absolute inset-x-10 top-6 h-full rounded-xl border border-border/50 bg-background/45" />
              <MemoView
                memo={activeMemo}
                parentPage="/review"
                showPinned
                className="relative z-10 mb-0 min-h-[min(32rem,calc(100vh-14rem))] rounded-xl bg-card px-5 py-4 shadow-lg sm:px-6 sm:py-5"
              />
            </div>
          </MentionResolutionProvider>
        ) : (
          <div className="flex w-full max-w-xl flex-col items-center rounded-lg border border-dashed border-border bg-background px-4 py-12 text-center">
            {isLoadingAllCandidates ? (
              <>
                <LoaderCircleIcon className="size-5 animate-spin text-muted-foreground" />
                <p className="mt-3 text-sm text-muted-foreground">{t("review.loading")}</p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-foreground">{t("review.empty-title")}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t("review.empty-description")}</p>
              </>
            )}
          </div>
        )}

        <div className="flex w-full max-w-xl items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="icon-sm"
              className="size-9 rounded-full bg-background shadow-xs"
              onClick={handleShuffle}
              disabled={memos.length === 0}
              aria-label={t("review.shuffle")}
              title={t("review.shuffle")}
            >
              <RefreshCwIcon className="size-4" />
            </Button>
            <Button
              variant="secondary"
              size="icon-sm"
              className="size-9 rounded-full bg-background shadow-xs"
              onClick={() => setSettingsOpen(true)}
              aria-label={t("review.open-settings")}
            >
              <Settings2Icon className="size-4" />
            </Button>
          </div>

          <div className="flex h-9 items-center justify-center gap-2">
            <Button
              variant="secondary"
              size="icon-sm"
              className="rounded-full bg-background shadow-xs"
              onClick={goToPrevious}
              disabled={activeIndex === 0 || reviewMemos.length === 0}
              aria-label={t("review.previous")}
            >
              <ChevronLeftIcon className="size-4" />
            </Button>
            <span className="min-w-14 rounded-full bg-background px-3 py-1 text-center text-xs font-medium text-muted-foreground shadow-xs">
              {reviewMemos.length > 0 ? t("review.progress", { current: activeIndex + 1, total: reviewMemos.length }) : "0/0"}
            </span>
            <Button
              variant="secondary"
              size="icon-sm"
              className="rounded-full bg-background shadow-xs"
              onClick={goToNext}
              disabled={activeIndex >= reviewMemos.length - 1 || reviewMemos.length === 0}
              aria-label={t("review.next")}
            >
              <ChevronRightIcon className="size-4" />
            </Button>
          </div>
        </div>

        <div className="min-h-5 text-center text-xs text-muted-foreground">
          {isLoadingAllCandidates ? (
            <span className="inline-flex items-center gap-1">
              <LoaderCircleIcon className="size-3.5 animate-spin" />
              {t("review.loading")}
            </span>
          ) : (
            t("review.candidate-count", { count: memos.length })
          )}
        </div>
      </div>

      <ReviewSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        selectedTagName={selectedTagName}
        tagOptions={tagOptions}
        onSettingsChange={updateSettings}
        onTagModeChange={handleTagModeChange}
      />
    </section>
  );
};

export default Review;
