import { create } from "@bufbuild/protobuf";
import {
  ArrowRightIcon,
  BookOpenTextIcon,
  CheckCircle2Icon,
  GraduationCapIcon,
  HelpCircleIcon,
  LightbulbIcon,
  LoaderCircleIcon,
  SaveIcon,
  SendIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useCreateMemo } from "@/hooks/useMemoQueries";
import { handleError } from "@/lib/error";
import { cn } from "@/lib/utils";
import { type Memo, MemoSchema, Visibility } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";

type PracticePhase = "idle" | "preparing" | "lesson_ready" | "drafting" | "reviewing" | "needs_revision" | "passed" | "saved";

interface MemoTranslationPracticePanelProps {
  memo?: Memo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface PracticeLesson {
  goal: string;
  words: string[];
  phrases: string[];
  patterns: string[];
  thinking: string[];
}

interface TeacherFeedback {
  passed: boolean;
  summary: string;
  strengths: string[];
  improvements: string[];
  nextTarget: string;
  nativeVersion: string;
}

const compactText = (value: string, maxChars: number): string => {
  const compacted = value.trim().replace(/\s+/g, " ");
  if (compacted.length <= maxChars) {
    return compacted;
  }
  return `${compacted.slice(0, maxChars).trimEnd()}...`;
};

const buildLesson = (content: string, t: ReturnType<typeof useTranslate>): PracticeLesson => {
  const excerpt = compactText(content, 72) || t("review.translation-practice.empty-memo");
  return {
    goal: t("review.translation-practice.lesson-goal", { excerpt }),
    words: [
      t("review.translation-practice.lesson-word-1"),
      t("review.translation-practice.lesson-word-2"),
      t("review.translation-practice.lesson-word-3"),
    ],
    phrases: [
      t("review.translation-practice.lesson-phrase-1"),
      t("review.translation-practice.lesson-phrase-2"),
      t("review.translation-practice.lesson-phrase-3"),
    ],
    patterns: [
      t("review.translation-practice.lesson-pattern-1"),
      t("review.translation-practice.lesson-pattern-2"),
      t("review.translation-practice.lesson-pattern-3"),
    ],
    thinking: [
      t("review.translation-practice.lesson-thinking-1"),
      t("review.translation-practice.lesson-thinking-2"),
      t("review.translation-practice.lesson-thinking-3"),
    ],
  };
};

const buildFeedback = (draft: string, attempt: number, content: string, t: ReturnType<typeof useTranslate>): TeacherFeedback => {
  const normalizedDraft = draft.trim();
  const passed = normalizedDraft.length >= 60 || attempt >= 2;
  const memoExcerpt = compactText(content, 80) || t("review.translation-practice.empty-memo");

  return {
    passed,
    summary: passed ? t("review.translation-practice.feedback-passed-summary") : t("review.translation-practice.feedback-revision-summary"),
    strengths: [
      normalizedDraft
        ? t("review.translation-practice.feedback-strength-user-effort")
        : t("review.translation-practice.feedback-strength-started"),
      t("review.translation-practice.feedback-strength-structure"),
    ],
    improvements: passed
      ? [t("review.translation-practice.feedback-polish-1"), t("review.translation-practice.feedback-polish-2")]
      : [t("review.translation-practice.feedback-improvement-1"), t("review.translation-practice.feedback-improvement-2")],
    nextTarget: passed
      ? t("review.translation-practice.feedback-passed-target")
      : t("review.translation-practice.feedback-revision-target"),
    nativeVersion: t("review.translation-practice.native-version-placeholder", { excerpt: memoExcerpt }),
  };
};

const formatSavedPracticeMemo = (memo: Memo, draft: string, feedback: TeacherFeedback | undefined, lesson: PracticeLesson | undefined) => {
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

const ToolChipGroup = ({ title, items }: { title: string; items: string[] }) => (
  <div>
    <div className="text-xs font-medium text-muted-foreground">{title}</div>
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span key={item} className="rounded-full border border-border/70 bg-background/80 px-2 py-1 text-xs leading-5 text-foreground">
          {item}
        </span>
      ))}
    </div>
  </div>
);

export const MemoTranslationPracticePanel = ({ memo, open, onOpenChange }: MemoTranslationPracticePanelProps) => {
  const t = useTranslate();
  const createMemo = useCreateMemo();
  const draftSectionRef = useRef<HTMLElement>(null);
  const [phase, setPhase] = useState<PracticePhase>("idle");
  const [lesson, setLesson] = useState<PracticeLesson>();
  const [draft, setDraft] = useState("");
  const [feedback, setFeedback] = useState<TeacherFeedback>();
  const [attempt, setAttempt] = useState(0);
  const [hint, setHint] = useState("");

  const memoContent = memo?.content ?? "";
  const memoExcerpt = useMemo(() => compactText(memoContent, 180), [memoContent]);
  const canSubmit = draft.trim().length > 0 && phase !== "reviewing";
  const canSave = memo && feedback?.passed && phase !== "saved" && !createMemo.isPending;
  const showFooter = phase === "passed" || phase === "saved";

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

    const timer = window.setTimeout(() => {
      setLesson(buildLesson(memo.content, t));
      setPhase("lesson_ready");
    }, 480);

    return () => window.clearTimeout(timer);
  }, [memo, open, t]);

  const handleAskTeacher = () => {
    setHint(t("review.translation-practice.teacher-hint"));
  };

  const handleStartPractice = () => {
    setPhase("drafting");
    window.setTimeout(() => draftSectionRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }), 50);
  };

  const handleSubmit = () => {
    if (!canSubmit) {
      return;
    }

    setPhase("reviewing");
    setHint("");
    const nextAttempt = attempt + 1;
    setAttempt(nextAttempt);
    window.setTimeout(() => {
      const nextFeedback = buildFeedback(draft, nextAttempt, memoContent, t);
      setFeedback(nextFeedback);
      setPhase(nextFeedback.passed ? "passed" : "needs_revision");
    }, 520);
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

  const showDraft = phase === "drafting" || phase === "needs_revision" || phase === "passed" || phase === "saved" || phase === "reviewing";
  const showFeedback = Boolean(feedback) && (phase === "needs_revision" || phase === "passed" || phase === "saved");

  return (
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
                <section className={cn("rounded-xl border border-primary/20 bg-primary/5 p-3", showDraft ? "space-y-2" : "space-y-3")}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <LightbulbIcon className="size-4 text-primary" />
                      {t("review.translation-practice.lesson-title")}
                    </div>
                    {!showDraft && (
                      <Badge variant="secondary" shape="pill">
                        {t("review.translation-practice.phase-lesson")}
                      </Badge>
                    )}
                  </div>
                  {!showDraft && <p className="text-sm leading-6 text-foreground">{lesson.goal}</p>}
                  <div className="grid gap-2">
                    <ToolChipGroup title={t("review.translation-practice.words")} items={lesson.words.slice(0, showDraft ? 2 : 3)} />
                    <ToolChipGroup title={t("review.translation-practice.phrases")} items={lesson.phrases.slice(0, showDraft ? 2 : 3)} />
                    <ToolChipGroup title={t("review.translation-practice.patterns")} items={lesson.patterns.slice(0, showDraft ? 1 : 2)} />
                  </div>
                  <p className="rounded-lg bg-background/60 px-3 py-2 text-xs leading-5 text-muted-foreground">{lesson.thinking[0]}</p>
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
                    "space-y-3 rounded-xl border p-4",
                    feedback.passed ? "border-emerald-300/60 bg-emerald-50/70 dark:bg-emerald-950/20" : "border-border bg-background",
                  )}
                >
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <CheckCircle2Icon className={cn("size-4", feedback.passed ? "text-emerald-600" : "text-primary")} />
                    {feedback.passed ? t("review.translation-practice.passed-title") : t("review.translation-practice.revision-title")}
                  </div>
                  <p className="text-sm leading-6 text-foreground">{feedback.summary}</p>
                  <LessonList title={t("review.translation-practice.feedback-strengths")} items={feedback.strengths} />
                  <LessonList title={t("review.translation-practice.feedback-improvements")} items={feedback.improvements} />
                  <div className="rounded-lg border border-border/70 bg-background/80 p-3">
                    <div className="text-xs font-medium text-muted-foreground">{t("review.translation-practice.native-version")}</div>
                    <p className="mt-2 text-sm leading-6 text-foreground">{feedback.nativeVersion}</p>
                  </div>
                  <div className="rounded-lg bg-background/70 px-3 py-2 text-sm leading-6 text-foreground">{feedback.nextTarget}</div>
                </section>
              )}
            </div>
          )}
        </div>

        {showFooter && (
          <SheetFooter className="border-t border-border/70 p-4">
            <Button className="w-full" onClick={handleSave} disabled={!canSave}>
              {createMemo.isPending ? <LoaderCircleIcon className="size-4 animate-spin" /> : <SaveIcon className="size-4" />}
              {phase === "saved" ? t("review.translation-practice.saved") : t("review.translation-practice.save-material")}
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
};
