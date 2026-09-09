import { create } from "@bufbuild/protobuf";
import {
  ArrowRightIcon,
  BookOpenTextIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  GraduationCapIcon,
  HelpCircleIcon,
  LightbulbIcon,
  LoaderCircleIcon,
  SaveIcon,
  SendIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useCreateMemo } from "@/hooks/useMemoQueries";
import { useGenerateTranslationPracticeLesson, useReviewTranslationPracticeDraft } from "@/hooks/useTranslation";
import { handleError } from "@/lib/error";
import { cn } from "@/lib/utils";
import type { TranslationPracticeFeedback, TranslationPracticeLesson } from "@/types/proto/api/v1/ai_service_pb";
import { type Memo, MemoSchema, Visibility } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";

type PracticePhase = "idle" | "preparing" | "lesson_ready" | "drafting" | "reviewing" | "needs_revision" | "passed" | "saved";

interface MemoTranslationPracticePanelProps {
  memo?: Memo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const TRANSLATION_PRACTICE_CONFETTI_CLASSES = [
  "left-8 top-4 h-1.5 w-4 rotate-12 bg-amber-400 [--translation-practice-confetti-delay:0ms] [--translation-practice-confetti-drift:34px] [--translation-practice-confetti-fall:88px] [--translation-practice-confetti-spin:210deg]",
  "left-1/4 top-2 size-2 rounded-full bg-sky-400 [--translation-practice-confetti-delay:80ms] [--translation-practice-confetti-drift:-18px] [--translation-practice-confetti-fall:76px] [--translation-practice-confetti-spin:-180deg]",
  "right-10 top-5 h-1.5 w-5 -rotate-12 bg-rose-400 [--translation-practice-confetti-delay:40ms] [--translation-practice-confetti-drift:-30px] [--translation-practice-confetti-fall:92px] [--translation-practice-confetti-spin:-230deg]",
  "right-1/4 top-9 size-2 rounded-full bg-emerald-400 [--translation-practice-confetti-delay:130ms] [--translation-practice-confetti-drift:18px] [--translation-practice-confetti-fall:68px] [--translation-practice-confetti-spin:160deg]",
  "left-1/2 top-3 h-1.5 w-4 -translate-x-1/2 bg-primary [--translation-practice-confetti-delay:110ms] [--translation-practice-confetti-drift:10px] [--translation-practice-confetti-fall:82px] [--translation-practice-confetti-spin:240deg]",
  "right-1/3 top-11 h-1.5 w-4 bg-cyan-400 [--translation-practice-confetti-delay:190ms] [--translation-practice-confetti-drift:-16px] [--translation-practice-confetti-fall:64px] [--translation-practice-confetti-spin:-190deg]",
];

const TRANSLATION_PRACTICE_CELEBRATION_ACCENT_CLASSES = [
  "size-1.5 rounded-full bg-amber-400 [--translation-practice-float-delay:0ms] [--translation-practice-float-rotate:8deg]",
  "h-1.5 w-3 rounded-full bg-rose-400 [--translation-practice-float-delay:160ms] [--translation-practice-float-rotate:-10deg]",
  "size-1.5 rounded-full bg-sky-400 [--translation-practice-float-delay:320ms] [--translation-practice-float-rotate:12deg]",
  "h-1.5 w-3 rounded-full bg-emerald-400 [--translation-practice-float-delay:480ms] [--translation-practice-float-rotate:-8deg]",
];

const TRANSLATION_PRACTICE_ANIMATION_CSS = `
@keyframes translation-practice-confetti-burst {
  0% {
    opacity: 0;
    transform: translate3d(0, -8px, 0) rotate(0deg) scale(0.72);
  }
  14% {
    opacity: 1;
  }
  70% {
    opacity: 0.88;
  }
  100% {
    opacity: 0;
    transform: translate3d(var(--translation-practice-confetti-drift), var(--translation-practice-confetti-fall), 0)
      rotate(var(--translation-practice-confetti-spin)) scale(1);
  }
}

@keyframes translation-practice-celebration-float {
  0%, 100% {
    opacity: 0.55;
    transform: translate3d(0, 0, 0) rotate(0deg);
  }
  50% {
    opacity: 1;
    transform: translate3d(0, -4px, 0) rotate(var(--translation-practice-float-rotate));
  }
}

@keyframes translation-practice-pass-pop {
  0% {
    opacity: 0;
    transform: scale(0.78) translateY(6px);
  }
  64% {
    opacity: 1;
    transform: scale(1.08) translateY(-1px);
  }
  100% {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

@keyframes translation-practice-save-pulse {
  0%, 100% {
    box-shadow: 0 0 0 0 rgb(34 197 94 / 0);
  }
  35% {
    box-shadow: 0 0 0 6px rgb(34 197 94 / 0.16);
  }
}

.translation-practice-confetti {
  animation: translation-practice-confetti-burst 2400ms cubic-bezier(0.16, 1, 0.3, 1)
    var(--translation-practice-confetti-delay) both;
}

.translation-practice-celebration-accent {
  animation: translation-practice-celebration-float 1800ms ease-in-out var(--translation-practice-float-delay) infinite;
}

.translation-practice-pass-pop {
  animation: translation-practice-pass-pop 520ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

.translation-practice-save-pulse {
  animation: translation-practice-save-pulse 1600ms ease-out 220ms both;
}

@media (prefers-reduced-motion: reduce) {
  .translation-practice-confetti,
  .translation-practice-celebration-accent,
  .translation-practice-pass-pop,
  .translation-practice-save-pulse {
    animation: none;
  }

  .translation-practice-confetti {
    opacity: 0;
  }

  .translation-practice-celebration-accent {
    opacity: 0.7;
  }
}
`;

const compactText = (value: string, maxChars: number): string => {
  const compacted = value.trim().replace(/\s+/g, " ");
  if (compacted.length <= maxChars) {
    return compacted;
  }
  return `${compacted.slice(0, maxChars).trimEnd()}...`;
};

const formatSavedPracticeMemo = (
  memo: Memo,
  draft: string,
  feedback: TranslationPracticeFeedback | undefined,
  lesson: TranslationPracticeLesson | undefined,
) => {
  return [
    "原始 memo：",
    memo.content.trim(),
    "",
    "我的最终版本：",
    draft.trim(),
    "",
    "AI 地道版本：",
    feedback?.nativeVersion ?? "",
    "",
    "本次学到的表达：",
    ...(lesson?.phrases ?? []).map((item) => `- ${item}`),
    ...(lesson?.patterns ?? []).map((item) => `- ${item}`),
    "",
    "批改总结：",
    feedback?.summary ?? "",
    feedback?.nextTarget ?? "",
    "",
    `来源：${memo.name}`,
    "",
    "#english #translation-practice #review",
  ].join("\n");
};

const LessonList = ({ title, items }: { title: string; items: string[] }) => (
  <div className="rounded-lg border border-border/70 bg-background/70 p-3">
    <div className="text-xs font-medium text-muted-foreground">{title}</div>
    <ul className="mt-2 space-y-1.5 text-sm leading-6 text-foreground">
      {items.map((item) => (
        <li key={item} className="flex gap-2">
          <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary/70" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  </div>
);

const splitLessonToolItem = (item: string) => {
  const exampleMatch = item.match(/^(.+?)\s*(\((?:e\.g\.|for example|例如|比如)[^)]+\))$/i);
  if (exampleMatch) {
    return { term: exampleMatch[1].trim(), description: exampleMatch[2].trim() };
  }

  const match = item.match(/^(.+?)\s+(?:[-–—])\s+(.+)$/) ?? item.match(/^(.+?)[:：]\s*(.+)$/);
  if (!match) {
    return { term: item };
  }
  return { term: match[1].trim(), description: match[2].trim() };
};

const ExpandableLessonTool = ({ item, variant = "row" }: { item: string; variant?: "row" | "chip" }) => {
  const [expanded, setExpanded] = useState(false);
  const { term, description } = splitLessonToolItem(item);
  const canExpand = Boolean(description);

  if (variant === "chip") {
    if (!canExpand) {
      return (
        <span className="inline-flex max-w-full rounded-full border border-border/70 bg-background/80 px-2.5 py-1 text-xs leading-5 text-foreground shadow-xs">
          <span className="truncate">{term}</span>
        </span>
      );
    }

    return (
      <div className="max-w-full">
        <button
          type="button"
          className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/70 bg-background/80 px-2.5 py-1 text-left text-xs leading-5 text-foreground shadow-xs hover:bg-muted/50"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          <span className="truncate">{term}</span>
          <ChevronDownIcon className={cn("size-3 shrink-0 transition-transform", expanded && "rotate-180")} />
        </button>
        {expanded && <p className="mt-1.5 rounded-md bg-muted/35 px-2.5 py-1.5 text-xs leading-5 text-muted-foreground">{description}</p>}
      </div>
    );
  }

  if (!canExpand) {
    return (
      <div className="flex items-center gap-2 rounded-md bg-muted/30 px-2.5 py-2 text-sm leading-5">
        <span className="size-1.5 shrink-0 rounded-full bg-primary/70" />
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">{term}</span>
      </div>
    );
  }

  return (
    <div className="rounded-md bg-muted/30">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm leading-5 hover:bg-muted/50"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="size-1.5 shrink-0 rounded-full bg-primary/70" />
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">{term}</span>
        <ChevronDownIcon className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")} />
      </button>
      {expanded && <p className="px-6 pb-2 text-sm leading-6 text-muted-foreground">{description}</p>}
    </div>
  );
};

const LessonToolGroup = ({ title, items, variant = "row" }: { title: string; items: string[]; variant?: "row" | "chip" }) => (
  <div className={cn(variant === "row" && "rounded-lg border border-border/70 bg-background/80 p-3")}>
    <div className="text-xs font-medium text-muted-foreground">{title}</div>
    <div className={cn("mt-2", variant === "chip" ? "flex flex-wrap gap-1.5" : "space-y-1.5")}>
      {items.map((item) => (
        <ExpandableLessonTool key={item} item={item} variant={variant} />
      ))}
    </div>
  </div>
);

const ExpandableLessonNote = ({ title, text }: { title: string; text: string }) => {
  const [expanded, setExpanded] = useState(false);
  const preview = compactText(text, 64);
  const canExpand = preview !== text;

  if (!canExpand) {
    return (
      <div className="rounded-lg border border-primary/15 bg-primary/5 px-3 py-2.5">
        <div className="text-xs font-medium text-primary">{title}</div>
        <p className="mt-1 text-sm leading-6 text-foreground">{text}</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-primary/15 bg-primary/5">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="min-w-0 flex-1 text-xs font-medium text-primary">{title}</span>
        <ChevronDownIcon className={cn("size-3.5 shrink-0 text-primary transition-transform", expanded && "rotate-180")} />
      </button>
      <p className="px-3 pb-2.5 text-sm leading-6 text-foreground">{expanded ? text : preview}</p>
    </div>
  );
};

export const MemoTranslationPracticePanel = ({ memo, open, onOpenChange }: MemoTranslationPracticePanelProps) => {
  const t = useTranslate();
  const { i18n } = useTranslation();
  const createMemo = useCreateMemo();
  const generateLesson = useGenerateTranslationPracticeLesson();
  const reviewDraft = useReviewTranslationPracticeDraft();
  const draftSectionRef = useRef<HTMLElement>(null);
  const lessonCacheRef = useRef<{ key: string; lesson: TranslationPracticeLesson } | undefined>(undefined);
  const lessonRequestRef = useRef<{ key: string; promise: Promise<TranslationPracticeLesson> } | undefined>(undefined);
  const [phase, setPhase] = useState<PracticePhase>("idle");
  const [lesson, setLesson] = useState<TranslationPracticeLesson>();
  const [draft, setDraft] = useState("");
  const [feedback, setFeedback] = useState<TranslationPracticeFeedback>();
  const [attempt, setAttempt] = useState(0);
  const [hint, setHint] = useState("");
  const [lessonExpanded, setLessonExpanded] = useState(true);
  const [celebrationAttempt, setCelebrationAttempt] = useState(0);

  const memoContent = memo?.content ?? "";
  const memoExcerpt = useMemo(() => compactText(memoContent, 180), [memoContent]);
  const canSubmit = draft.trim().length > 0 && phase !== "reviewing";
  const canSave = memo && feedback?.passed && phase !== "saved" && !createMemo.isPending;
  const showFooter = phase === "passed" || phase === "saved";
  const showDraft = phase === "drafting" || phase === "needs_revision" || phase === "passed" || phase === "saved" || phase === "reviewing";
  const showFeedback = Boolean(feedback) && (phase === "needs_revision" || phase === "passed" || phase === "saved");
  const visibleLessonWords = useMemo(() => lesson?.words.slice(0, showDraft ? 2 : 3) ?? [], [lesson, showDraft]);
  const visibleLessonPhrases = useMemo(() => lesson?.phrases.slice(0, showDraft ? 2 : 3) ?? [], [lesson, showDraft]);
  const visibleLessonPatterns = useMemo(() => lesson?.patterns.slice(0, showDraft ? 1 : 2) ?? [], [lesson, showDraft]);
  const lessonSummary = t("review.translation-practice.lesson-summary", {
    words: visibleLessonWords.length,
    phrases: visibleLessonPhrases.length,
    patterns: visibleLessonPatterns.length,
  });
  const showPassedCelebration = feedback?.passed && phase === "passed" && celebrationAttempt === attempt;

  useEffect(() => {
    if (!open || !memo) {
      return;
    }

    setPhase("preparing");
    setLesson(undefined);
    setDraft("");
    setFeedback(undefined);
    setAttempt(0);
    setHint("");
    setLessonExpanded(true);
    setCelebrationAttempt(0);

    let cancelled = false;
    const lessonKey = `${memo.name}:${i18n.language}:${memo.content}`;
    if (lessonCacheRef.current?.key === lessonKey) {
      setLesson(lessonCacheRef.current.lesson);
      setPhase("lesson_ready");
      return;
    }

    const existingRequest = lessonRequestRef.current?.key === lessonKey ? lessonRequestRef.current.promise : undefined;
    const lessonPromise =
      existingRequest ??
      generateLesson.mutateAsync({
        memoContent: memo.content,
        locale: i18n.language,
      });
    lessonRequestRef.current = { key: lessonKey, promise: lessonPromise };

    lessonPromise
      .then((nextLesson) => {
        lessonCacheRef.current = { key: lessonKey, lesson: nextLesson };
        if (lessonRequestRef.current?.promise === lessonPromise) {
          lessonRequestRef.current = undefined;
        }
        if (cancelled) {
          return;
        }
        setLesson(nextLesson);
        setPhase("lesson_ready");
      })
      .catch((error: unknown) => {
        if (lessonRequestRef.current?.promise === lessonPromise) {
          lessonRequestRef.current = undefined;
        }
        if (cancelled) {
          return;
        }
        setPhase("idle");
        handleError(error, toast.error, { context: "Generate translation practice lesson" });
      });

    return () => {
      cancelled = true;
    };
  }, [generateLesson.mutateAsync, i18n.language, memo, open]);

  const handleAskTeacher = () => {
    const tip = lesson?.thinking[0] ?? t("review.translation-practice.teacher-hint");
    const phrase = lesson?.phrases[0];
    setHint(phrase ? t("review.translation-practice.teacher-hint-with-phrase", { tip, phrase }) : tip);
  };

  const handleStartPractice = () => {
    setPhase("drafting");
    setLessonExpanded(false);
    window.setTimeout(() => draftSectionRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }), 50);
  };

  const handleSubmit = async () => {
    if (!canSubmit) {
      return;
    }

    const previousPhase = feedback?.passed ? "passed" : feedback ? "needs_revision" : "drafting";
    setPhase("reviewing");
    setHint("");
    const nextAttempt = attempt + 1;
    setAttempt(nextAttempt);
    try {
      const nextFeedback = await reviewDraft.mutateAsync({
        memoContent,
        draft,
        attempt: nextAttempt,
        locale: i18n.language,
      });
      setFeedback(nextFeedback);
      setCelebrationAttempt(nextFeedback.passed ? nextAttempt : 0);
      setPhase(nextFeedback.passed ? "passed" : "needs_revision");
    } catch (error) {
      setAttempt(nextAttempt - 1);
      setPhase(previousPhase);
      handleError(error, toast.error, { context: "Review translation practice draft" });
    }
  };

  const handleSave = async () => {
    if (!memo || !feedback || !lesson) {
      return;
    }

    try {
      await createMemo.mutateAsync(
        create(MemoSchema, {
          content: formatSavedPracticeMemo(memo, draft, feedback, lesson),
          visibility: Visibility.PRIVATE,
        }),
      );
      setPhase("saved");
      toast.success(t("review.translation-practice.saved-toast"));
    } catch (error) {
      handleError(error, toast.error, { context: "Save translation practice memo" });
    }
  };

  return (
    <>
      <style>{TRANSLATION_PRACTICE_ANIMATION_CSS}</style>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="h-[88dvh] gap-0 rounded-t-2xl p-0 md:inset-y-0 md:right-0 md:left-auto md:h-full md:w-[30rem] md:max-w-[30rem] md:translate-y-0 md:rounded-none md:border-t-0 md:border-l md:data-ending-style:translate-x-full md:data-starting-style:translate-x-full"
        >
          <SheetHeader className="border-b border-border/70 px-5 py-3 text-left">
            <div className="flex items-center gap-2 pr-8">
              <GraduationCapIcon className="size-5 text-primary" />
              <SheetTitle>{t("review.translation-practice.title")}</SheetTitle>
            </div>
            <SheetDescription>{t("review.translation-practice.description")}</SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4" data-touch-action="ignore-swipe">
            {!memo ? (
              <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                {t("review.translation-practice.no-memo")}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="rounded-lg border border-border/70 bg-muted/25 px-3 py-2.5">
                  <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <BookOpenTextIcon className="size-3.5" />
                    {t("review.translation-practice.current-memo")}
                  </div>
                  <p className="max-h-14 overflow-auto whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{memoExcerpt}</p>
                </div>

                {phase === "preparing" && (
                  <div className="flex flex-col items-center rounded-xl border border-border/70 bg-background px-4 py-8 text-center">
                    <LoaderCircleIcon className="size-5 animate-spin text-primary" />
                    <p className="mt-3 text-sm font-medium text-foreground">{t("review.translation-practice.preparing-title")}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("review.translation-practice.preparing-description")}</p>
                  </div>
                )}

                {lesson && phase !== "preparing" && (
                  <section
                    className={cn(
                      "overflow-hidden rounded-xl border border-border/80 bg-background shadow-xs",
                      showDraft ? "space-y-0" : "space-y-1",
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 px-3 py-3">
                        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                            <LightbulbIcon className="size-4" />
                          </span>
                          {t("review.translation-practice.lesson-title")}
                        </div>
                        <p className="mt-1 truncate pl-9 text-xs text-muted-foreground">{lessonSummary}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5 pr-2">
                        {!showDraft && (
                          <Badge variant="secondary" shape="pill">
                            {t("review.translation-practice.phase-lesson")}
                          </Badge>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs text-muted-foreground"
                          aria-expanded={lessonExpanded}
                          onClick={() => setLessonExpanded((expanded) => !expanded)}
                        >
                          <span>
                            {lessonExpanded ? t("review.translation-practice.collapse-tips") : t("review.translation-practice.expand-tips")}
                          </span>
                          <ChevronDownIcon className={cn("size-3.5 transition-transform", lessonExpanded && "rotate-180")} />
                        </Button>
                      </div>
                    </div>
                    {lessonExpanded && (
                      <div className="space-y-3 border-t border-border/70 bg-muted/15 p-3">
                        {!showDraft && (
                          <div className="rounded-lg bg-background/80 px-3 py-2.5 text-sm leading-6 text-foreground">{lesson.goal}</div>
                        )}
                        <LessonToolGroup title={t("review.translation-practice.words")} items={visibleLessonWords} />
                        <div className="grid gap-3 rounded-lg border border-border/70 bg-background/80 p-3">
                          <LessonToolGroup title={t("review.translation-practice.phrases")} items={visibleLessonPhrases} variant="chip" />
                          <LessonToolGroup title={t("review.translation-practice.patterns")} items={visibleLessonPatterns} variant="chip" />
                        </div>
                        <ExpandableLessonNote title={t("review.translation-practice.thinking")} text={lesson.thinking[0]} />
                      </div>
                    )}
                  </section>
                )}

                {phase === "lesson_ready" && (
                  <Button className="w-full" onClick={handleStartPractice}>
                    <ArrowRightIcon className="size-4" />
                    {t("review.translation-practice.start-practice")}
                  </Button>
                )}

                {showDraft && (
                  <section ref={draftSectionRef} className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium text-foreground">{t("review.translation-practice.my-draft")}</div>
                      <Badge variant={feedback?.passed ? "default" : "outline"} shape="pill">
                        {feedback?.passed ? t("review.translation-practice.phase-passed") : t("review.translation-practice.phase-drafting")}
                      </Badge>
                    </div>
                    <Textarea
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      placeholder={t("review.translation-practice.draft-placeholder")}
                      className="min-h-36 resize-none bg-background text-sm leading-6"
                      disabled={phase === "reviewing" || phase === "saved"}
                    />
                    {hint && (
                      <div className="rounded-lg border border-amber-300/50 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                        {hint}
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <Button variant="outline" onClick={handleAskTeacher} disabled={phase === "reviewing" || phase === "saved"}>
                        <HelpCircleIcon className="size-4" />
                        {t("review.translation-practice.ask-teacher")}
                      </Button>
                      <Button onClick={handleSubmit} disabled={!canSubmit || phase === "saved"}>
                        {phase === "reviewing" ? <LoaderCircleIcon className="size-4 animate-spin" /> : <SendIcon className="size-4" />}
                        {t("review.translation-practice.submit-review")}
                      </Button>
                    </div>
                  </section>
                )}

                {showFeedback && feedback && (
                  <section
                    className={cn(
                      "relative overflow-hidden rounded-xl border p-3",
                      feedback.passed
                        ? "border-emerald-300/70 bg-emerald-50/60 dark:border-emerald-800/70 dark:bg-emerald-950/20"
                        : "space-y-3 border-border bg-background",
                    )}
                  >
                    {feedback.passed && (
                      <div className="pointer-events-none absolute top-3 right-4 z-10 flex items-start gap-1.5" aria-hidden="true">
                        {TRANSLATION_PRACTICE_CELEBRATION_ACCENT_CLASSES.map((className) => (
                          <span key={className} className={cn("translation-practice-celebration-accent shadow-sm", className)} />
                        ))}
                      </div>
                    )}
                    {showPassedCelebration && (
                      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 overflow-hidden" aria-hidden="true">
                        {TRANSLATION_PRACTICE_CONFETTI_CLASSES.map((className) => (
                          <span key={className} className={cn("translation-practice-confetti absolute opacity-0 shadow-sm", className)} />
                        ))}
                      </div>
                    )}
                    <div className={cn("relative", feedback.passed && "space-y-3")}>
                      <div
                        className={cn(
                          "flex gap-3 rounded-lg px-3 py-3",
                          feedback.passed ? "bg-background/90 shadow-xs" : "bg-muted/30",
                          showPassedCelebration && "translation-practice-pass-pop",
                        )}
                      >
                        <span
                          className={cn(
                            "flex size-9 shrink-0 items-center justify-center rounded-full",
                            feedback.passed ? "bg-emerald-100 text-emerald-700" : "bg-primary/10 text-primary",
                          )}
                        >
                          <CheckCircle2Icon className="size-5" />
                        </span>
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-foreground">
                            {feedback.passed
                              ? t("review.translation-practice.passed-title")
                              : t("review.translation-practice.revision-title")}
                          </div>
                          <p className="mt-1 text-sm leading-6 text-foreground">{feedback.summary}</p>
                        </div>
                      </div>

                      {feedback.passed ? (
                        <>
                          <div className="rounded-lg border border-emerald-200/80 bg-background p-3 shadow-xs dark:border-emerald-900/70">
                            <div className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
                              {t("review.translation-practice.native-version")}
                            </div>
                            <p className="mt-2 text-base leading-7 text-foreground">{feedback.nativeVersion}</p>
                          </div>
                          <div className="grid gap-3">
                            <LessonList title={t("review.translation-practice.feedback-strengths")} items={feedback.strengths} />
                            <LessonList title={t("review.translation-practice.feedback-polish")} items={feedback.improvements} />
                          </div>
                          <div className="rounded-lg bg-background/80 px-3 py-2 text-sm leading-6 text-foreground">
                            {feedback.nextTarget}
                          </div>
                        </>
                      ) : (
                        <>
                          <LessonList title={t("review.translation-practice.feedback-strengths")} items={feedback.strengths} />
                          <LessonList title={t("review.translation-practice.feedback-improvements")} items={feedback.improvements} />
                          <div className="rounded-lg border border-border/70 bg-background/80 p-3">
                            <div className="text-xs font-medium text-muted-foreground">
                              {t("review.translation-practice.native-version")}
                            </div>
                            <p className="mt-2 text-sm leading-6 text-foreground">{feedback.nativeVersion}</p>
                          </div>
                          <div className="rounded-lg bg-background/70 px-3 py-2 text-sm leading-6 text-foreground">
                            {feedback.nextTarget}
                          </div>
                        </>
                      )}
                    </div>
                  </section>
                )}
              </div>
            )}
          </div>

          {showFooter && (
            <SheetFooter className="relative overflow-hidden border-t border-border/70 p-4">
              {showPassedCelebration && (
                <div className="pointer-events-none absolute inset-x-4 top-0 h-14 overflow-hidden" aria-hidden="true">
                  {TRANSLATION_PRACTICE_CONFETTI_CLASSES.map((className) => (
                    <span
                      key={`footer-${className}`}
                      className={cn("translation-practice-confetti absolute opacity-0 shadow-sm", className)}
                    />
                  ))}
                </div>
              )}
              <Button
                className={cn("relative w-full", showPassedCelebration && "translation-practice-save-pulse")}
                onClick={handleSave}
                disabled={!canSave}
              >
                {createMemo.isPending ? <LoaderCircleIcon className="size-4 animate-spin" /> : <SaveIcon className="size-4" />}
                {phase === "saved" ? t("review.translation-practice.saved") : t("review.translation-practice.save-material")}
              </Button>
            </SheetFooter>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
};
