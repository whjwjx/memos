import { CalendarClockIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useTranslate } from "@/utils/i18n";
import { parseNaturalSchedule, scheduleSuggestionSignature } from "@/utils/natural-schedule";
import { useEditorContext, useEditorSelector } from "../state";

const sameTime = (left?: Date, right?: Date) => left?.getTime() === right?.getTime();

type SuggestionMarker = {
  content: string;
  signature: string;
};

export const ScheduleSuggestion = () => {
  const t = useTranslate();
  const { actions, dispatch } = useEditorContext();
  const content = useEditorSelector((s) => s.content);
  const scheduledTime = useEditorSelector((s) => s.metadata.scheduledTime);
  const scheduledDuration = useEditorSelector((s) => s.metadata.scheduledDuration);
  const scheduledRecurrence = useEditorSelector((s) => s.metadata.scheduledRecurrence);
  const isSaving = useEditorSelector((s) => s.ui.isLoading.saving);
  const [now] = useState(() => new Date());
  const [dismissedSuggestion, setDismissedSuggestion] = useState<SuggestionMarker | null>(null);
  const lastAppliedSuggestionRef = useRef<SuggestionMarker | null>(null);

  const suggestion = useMemo(() => parseNaturalSchedule(content, now), [content, now]);
  const suggestionSignature = useMemo(() => (suggestion ? scheduleSuggestionSignature(suggestion) : ""), [suggestion]);
  const isDismissed = dismissedSuggestion?.signature === suggestionSignature && dismissedSuggestion.content === content;
  const currentScheduleSignature = useMemo(() => {
    if (!scheduledTime) {
      return "";
    }
    return scheduleSuggestionSignature({
      scheduledTime,
      scheduledDuration: scheduledDuration ?? 3600,
      scheduledRecurrence,
    });
  }, [scheduledDuration, scheduledRecurrence, scheduledTime]);

  useEffect(() => {
    if (!suggestion) {
      if (currentScheduleSignature && currentScheduleSignature === lastAppliedSuggestionRef.current?.signature) {
        dispatch(actions.setMetadata({ scheduledTime: undefined, scheduledDuration: undefined, scheduledRecurrence: undefined }));
      }
      if (!currentScheduleSignature && !content.trim()) {
        setDismissedSuggestion(null);
        lastAppliedSuggestionRef.current = null;
      }
      return;
    }
    if (isSaving || isDismissed) {
      return;
    }
    if (
      !currentScheduleSignature &&
      lastAppliedSuggestionRef.current?.signature === suggestionSignature &&
      lastAppliedSuggestionRef.current.content === content
    ) {
      setDismissedSuggestion({ signature: suggestionSignature, content });
      return;
    }
    if (currentScheduleSignature && currentScheduleSignature !== lastAppliedSuggestionRef.current?.signature) {
      return;
    }
    if (currentScheduleSignature === suggestionSignature) {
      return;
    }

    dispatch(
      actions.setMetadata({
        scheduledTime: suggestion.scheduledTime,
        scheduledDuration: suggestion.scheduledDuration,
        scheduledRecurrence: suggestion.scheduledRecurrence,
      }),
    );
    lastAppliedSuggestionRef.current = { signature: suggestionSignature, content };
  }, [actions, content, currentScheduleSignature, dispatch, isDismissed, isSaving, suggestion, suggestionSignature]);

  useEffect(() => {
    if (!suggestion) {
      return;
    }
    if (dismissedSuggestion && !isDismissed) {
      setDismissedSuggestion(null);
    }
  }, [dismissedSuggestion, isDismissed, suggestion]);

  if (!suggestion || isSaving || isDismissed) {
    return null;
  }

  const handleDismiss = () => {
    setDismissedSuggestion({ signature: suggestionSignature, content });
    if (
      sameTime(scheduledTime, suggestion.scheduledTime) &&
      (scheduledDuration ?? 3600) === suggestion.scheduledDuration &&
      currentScheduleSignature === suggestionSignature
    ) {
      dispatch(actions.setMetadata({ scheduledTime: undefined, scheduledDuration: undefined, scheduledRecurrence: undefined }));
    }
  };

  return (
    <div className="flex w-full items-center justify-between gap-2 rounded-md border border-primary/20 bg-primary/5 px-2.5 py-1.5 text-xs text-primary">
      <div className="flex min-w-0 items-center gap-1.5">
        <CalendarClockIcon className="size-3.5 shrink-0" />
        <span className="shrink-0 font-medium">{t("editor.schedule-detected")}</span>
        <span className="min-w-0 truncate text-foreground">{suggestion.label}</span>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
        onClick={handleDismiss}
        aria-label={t("editor.schedule-dismiss")}
        title={t("editor.schedule-dismiss")}
      >
        <XIcon className="size-3.5" />
      </Button>
    </div>
  );
};
