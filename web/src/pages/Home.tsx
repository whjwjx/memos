import { useMemo } from "react";
import MemoEditor from "@/components/MemoEditor";
import { deriveDefaultCreateTimeFromFilters } from "@/components/MemoEditor/utils/deriveDefaultCreateTime";
import { deriveSuggestedContentFromFilters } from "@/components/MemoEditor/utils/deriveSuggestedContent";
import MemoView from "@/components/MemoView";
import PagedMemoList, { getMemoKey } from "@/components/PagedMemoList";
import { useAuth } from "@/contexts/AuthContext";
import { useMemoFilterContext } from "@/contexts/MemoFilterContext";
import { NewMemoProvider } from "@/contexts/NewMemoContext";
import { useMemoFilters, useMemoSorting } from "@/hooks";
import useCurrentUser from "@/hooks/useCurrentUser";
import { State } from "@/types/proto/api/v1/common_pb";
import { Memo } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";

const Home = () => {
  const user = useCurrentUser();
  const t = useTranslate();
  const { isUserSettingsInitialized } = useAuth();
  const { filters } = useMemoFilterContext();
  const defaultCreateTime = useMemo(() => deriveDefaultCreateTimeFromFilters(filters), [filters]);
  const suggestedContent = useMemo(() => deriveSuggestedContentFromFilters(filters), [filters]);
  const editorCacheKey = suggestedContent ? `home-memo-editor:${suggestedContent}` : "home-memo-editor";

  const memoFilter = useMemoFilters({
    creatorName: user?.name,
    includeMemoViews: true,
    includePinned: true,
  });

  const { listSort, orderBy } = useMemoSorting({
    pinnedFirst: true,
    state: State.NORMAL,
  });

  return (
    <div className="w-full min-h-full bg-background text-foreground">
      <NewMemoProvider>
        <PagedMemoList
          renderer={(memo: Memo, { compact }) => (
            <MemoView key={getMemoKey(memo)} memo={memo} showVisibility showPinned compact={compact} />
          )}
          listSort={listSort}
          orderBy={orderBy}
          filter={memoFilter}
          renderLeading={({ useGrid }) => {
            if (!isUserSettingsInitialized) return null;

            return (
              <MemoEditor
                key={editorCacheKey}
                className={useGrid ? undefined : "mb-2"}
                cacheKey={editorCacheKey}
                placeholder={t("editor.any-thoughts")}
                defaultCreateTime={defaultCreateTime}
                suggestedContent={suggestedContent}
              />
            );
          }}
        />
      </NewMemoProvider>
    </div>
  );
};

export default Home;
