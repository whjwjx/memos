import { create } from "@bufbuild/protobuf";
import {
  BookOpenTextIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  GraduationCapIcon,
  HelpCircleIcon,
  LightbulbIcon,
  LoaderCircleIcon,
  RotateCcwIcon,
  SaveIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useCreateMemo } from "@/hooks/useMemoQueries";
import { useGenerateTranslationPracticeLesson } from "@/hooks/useTranslation";
import { handleError } from "@/lib/error";
import { cn } from "@/lib/utils";
import {
  type TranslationPracticeBlock,
  TranslationPracticeBlockSchema,
  type TranslationPracticeLesson,
} from "@/types/proto/api/v1/ai_service_pb";
import { type Memo, MemoSchema, Visibility } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";

type PracticePhase = "idle" | "preparing" | "building" | "passed" | "saved";
type MatchedVersion = "basic" | "native";
type PracticeLessonView = Omit<TranslationPracticeLesson, "basicBlocks" | "nativeBlocks" | "optionBlocks"> & {
  basicBlocks: TranslationPracticeBlock[];
  nativeBlocks: TranslationPracticeBlock[];
  optionBlocks: TranslationPracticeBlock[];
};

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

const cleanLessonItemLabel = (item: string) => {
  const [label] = item.split(/\s+[—-]\s+|：/);
  return (label || item).trim();
};

const makePracticeBlock = (id: string, text: string, explanation = "") =>
  create(TranslationPracticeBlockSchema, {
    id,
    text: text.trim(),
    explanation: explanation.trim(),
  });

const buildFallbackBlocksFromVersion = (version: string, prefix: string) => {
  const words = version.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  if (words.length === 0) {
    return [];
  }

  const chunkSize = words.length <= 6 ? 2 : 3;
  const blocks: TranslationPracticeBlock[] = [];
  for (let index = 0; index < words.length; index += chunkSize) {
    const text = words.slice(index, index + chunkSize).join(" ");
    blocks.push(makePracticeBlock(`${prefix}_${blocks.length + 1}`, text));
  }
  return blocks;
};

const mergePracticeBlocks = (...blockGroups: TranslationPracticeBlock[][]) => {
  const seen = new Set<string>();
  const blocks: TranslationPracticeBlock[] = [];

  for (const block of blockGroups.flat()) {
    const text = block.text.trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) {
      continue;
    }
    seen.add(key);
    blocks.push(block);
  }

  return blocks.map((block, index) => (block.id ? block : makePracticeBlock(`option_${index + 1}`, block.text, block.explanation)));
};

const alignBlocksToOptions = (blocks: TranslationPracticeBlock[], options: TranslationPracticeBlock[]) => {
  const optionByText = new Map(options.map((block) => [block.text.trim().toLowerCase(), block]));
  return blocks.map((block) => optionByText.get(block.text.trim().toLowerCase()) ?? block);
};

const normalizePracticeLessonForBuilder = (lesson: TranslationPracticeLesson): PracticeLessonView => {
  const phraseLabels = lesson.phrases.map(cleanLessonItemLabel).filter(Boolean);
  const wordLabels = lesson.words.map(cleanLessonItemLabel).filter(Boolean);
  const fallbackVersion = phraseLabels.length > 0 ? phraseLabels.join(" ") : wordLabels.join(" ");
  const basicVersion = lesson.basicVersion.trim() || fallbackVersion;
  const nativeVersion = lesson.nativeVersion.trim() || fallbackVersion || basicVersion;
  const basicBlocks = lesson.basicBlocks.length > 0 ? lesson.basicBlocks : buildFallbackBlocksFromVersion(basicVersion, "basic");
  const nativeBlocks = lesson.nativeBlocks.length > 0 ? lesson.nativeBlocks : buildFallbackBlocksFromVersion(nativeVersion, "native");
  const extraBlocks =
    lesson.optionBlocks.length > 0
      ? []
      : [...phraseLabels, ...wordLabels].map((text, index) =>
          makePracticeBlock(`extra_${index + 1}`, text, lesson.phrases[index] || lesson.words[index] || ""),
        );
  const optionBlocks =
    lesson.optionBlocks.length > 0 ? mergePracticeBlocks(lesson.optionBlocks) : mergePracticeBlocks(basicBlocks, nativeBlocks, extraBlocks);

  return {
    ...lesson,
    basicVersion,
    nativeVersion,
    basicBlocks: alignBlocksToOptions(basicBlocks, optionBlocks),
    nativeBlocks: alignBlocksToOptions(nativeBlocks, optionBlocks),
    optionBlocks,
  };
};

const normalizeSentence = (blocks: TranslationPracticeBlock[]) => {
  return blocks
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/\s+'/g, "'")
    .trim();
};

const sequenceKey = (blocks: TranslationPracticeBlock[]) => blocks.map((block) => block.id).join("|");

const formatSavedPracticeMemo = (
  memo: Memo,
  lesson: PracticeLessonView,
  selectedBlocks: TranslationPracticeBlock[],
  matchedVersion: MatchedVersion | undefined,
) => {
  const masteredBlocks = selectedBlocks.length > 0 ? selectedBlocks : lesson.basicBlocks;
  return [
    "原始 memo：",
    memo.content.trim(),
    "",
    "基础表达：",
    lesson.basicVersion,
    "",
    "地道表达：",
    lesson.nativeVersion,
    "",
    "我的拼句：",
    normalizeSentence(masteredBlocks),
    "",
    "通过版本：",
    matchedVersion === "native" ? "地道表达" : "基础表达",
    "",
    "本次掌握的表达块：",
    ...masteredBlocks.map((block) => `- ${block.text}${block.explanation ? `：${block.explanation}` : ""}`),
    "",
    "来源：",
    memo.name,
    "",
    "#english #translation-practice #review",
  ].join("\n");
};

const splitToolkitItem = (item: string) => {
  const match = item.match(/^(.+?)\s+[—-]\s+(.+)$/) ?? item.match(/^(.+?)[:：]\s*(.+)$/);
  if (!match) {
    return { label: item.trim(), explanation: "" };
  }
  return { label: match[1].trim(), explanation: match[2].trim() };
};

const ToolkitItem = ({ item }: { item: string }) => {
  const [expanded, setExpanded] = useState(false);
  const { label, explanation } = splitToolkitItem(item);

  if (!label) {
    return null;
  }

  if (!explanation) {
    return (
      <span className="inline-flex max-w-full rounded-full border border-border/70 bg-background px-2.5 py-1 text-xs leading-5 text-foreground">
        <span className="truncate">{label}</span>
      </span>
    );
  }

  return (
    <div className="max-w-full">
      <button
        type="button"
        className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/70 bg-background px-2.5 py-1 text-left text-xs leading-5 text-foreground shadow-xs hover:bg-muted/50"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="truncate">{label}</span>
        <ChevronDownIcon className={cn("size-3 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")} />
      </button>
      {expanded && <p className="mt-1.5 rounded-md bg-muted/40 px-2.5 py-1.5 text-xs leading-5 text-muted-foreground">{explanation}</p>}
    </div>
  );
};

const ToolkitGroup = ({ title, items }: { title: string; items: string[] }) => {
  if (items.length === 0) {
    return null;
  }

  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground">{title}</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {items.map((item) => (
          <ToolkitItem key={item} item={item} />
        ))}
      </div>
    </div>
  );
};

const ExpressionToolkit = ({
  lesson,
  wordsTitle,
  phrasesTitle,
  patternsTitle,
}: {
  lesson: PracticeLessonView;
  wordsTitle: string;
  phrasesTitle: string;
  patternsTitle: string;
}) => (
  <div className="space-y-3 rounded-lg border border-border/70 bg-background/80 p-3">
    <ToolkitGroup title={wordsTitle} items={lesson.words} />
    <ToolkitGroup title={phrasesTitle} items={lesson.phrases} />
    <ToolkitGroup title={patternsTitle} items={lesson.patterns} />
  </div>
);

const VersionCard = ({ label, value, tone }: { label: string; value: string; tone: "basic" | "native" }) => (
  <div
    className={cn(
      "rounded-lg border p-3",
      tone === "basic"
        ? "border-sky-200/80 bg-sky-50/70 dark:border-sky-900/70 dark:bg-sky-950/20"
        : "border-emerald-200/80 bg-emerald-50/70 dark:border-emerald-900/70 dark:bg-emerald-950/20",
    )}
  >
    <div
      className={cn("text-xs font-medium", tone === "basic" ? "text-sky-700 dark:text-sky-300" : "text-emerald-700 dark:text-emerald-300")}
    >
      {label}
    </div>
    <p className="mt-1.5 text-sm leading-6 text-foreground">{value}</p>
  </div>
);

const PracticeBlockButton = ({
  block,
  selected,
  disabled,
  onClick,
}: {
  block: TranslationPracticeBlock;
  selected?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    className={cn(
      "inline-flex min-h-9 max-w-full items-center rounded-full border px-3 py-1.5 text-left text-sm leading-5 shadow-xs transition",
      selected
        ? "border-primary/30 bg-primary/10 text-primary hover:bg-primary/15"
        : "border-border/80 bg-background text-foreground hover:border-primary/40 hover:bg-primary/5",
      disabled && "cursor-not-allowed opacity-55 hover:border-border/80 hover:bg-background",
    )}
    disabled={disabled}
    onClick={onClick}
  >
    <span className="truncate">{block.text}</span>
  </button>
);

export const MemoTranslationPracticePanel = ({ memo, open, onOpenChange }: MemoTranslationPracticePanelProps) => {
  const t = useTranslate();
  const { i18n } = useTranslation();
  const createMemo = useCreateMemo();
  const generateLesson = useGenerateTranslationPracticeLesson();
  const lessonCacheRef = useRef<{ key: string; lesson: TranslationPracticeLesson } | undefined>(undefined);
  const lessonRequestRef = useRef<{ key: string; promise: Promise<TranslationPracticeLesson> } | undefined>(undefined);
  const [phase, setPhase] = useState<PracticePhase>("idle");
  const [lesson, setLesson] = useState<TranslationPracticeLesson>();
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([]);
  const [matchedVersion, setMatchedVersion] = useState<MatchedVersion>();
  const [hint, setHint] = useState("");
  const [lessonExpanded, setLessonExpanded] = useState(true);
  const [celebrationRun, setCelebrationRun] = useState(0);

  const memoContent = memo?.content ?? "";
  const memoExcerpt = useMemo(() => compactText(memoContent, 160), [memoContent]);
  const practiceLesson = useMemo(() => (lesson ? normalizePracticeLessonForBuilder(lesson) : undefined), [lesson]);
  const optionBlocks = useMemo(() => practiceLesson?.optionBlocks ?? [], [practiceLesson]);
  const blockById = useMemo(() => new Map(optionBlocks.map((block) => [block.id, block])), [optionBlocks]);
  const selectedBlocks = useMemo(
    () => selectedBlockIds.map((id) => blockById.get(id)).filter((block): block is TranslationPracticeBlock => Boolean(block)),
    [blockById, selectedBlockIds],
  );
  const availableBlocks = useMemo(() => {
    const selectedIds = new Set(selectedBlockIds);
    return optionBlocks.filter((block) => !selectedIds.has(block.id));
  }, [optionBlocks, selectedBlockIds]);
  const answerText = useMemo(() => normalizeSentence(selectedBlocks), [selectedBlocks]);
  const basicAnswerKey = useMemo(() => sequenceKey(practiceLesson?.basicBlocks ?? []), [practiceLesson]);
  const nativeAnswerKey = useMemo(() => sequenceKey(practiceLesson?.nativeBlocks ?? []), [practiceLesson]);
  const selectedAnswerKey = selectedBlockIds.join("|");
  const canCheck = phase === "building" && selectedBlockIds.length > 0;
  const canSave = memo && practiceLesson && phase !== "saved" && !createMemo.isPending;
  const showFooter = phase === "passed" || phase === "saved";
  const showPassedCelebration = phase === "passed" && celebrationRun > 0;
  const toolkitSummary = t("review.translation-practice.lesson-summary", {
    words: practiceLesson?.words.length ?? 0,
    phrases: practiceLesson?.phrases.length ?? 0,
    patterns: practiceLesson?.patterns.length ?? 0,
  });

  useEffect(() => {
    if (!open || !memo) {
      return;
    }

    setPhase("preparing");
    setLesson(undefined);
    setSelectedBlockIds([]);
    setMatchedVersion(undefined);
    setHint("");
    setLessonExpanded(true);
    setCelebrationRun(0);

    let cancelled = false;
    const lessonKey = `${memo.name}:${i18n.language}:${memo.content}`;
    if (lessonCacheRef.current?.key === lessonKey) {
      setLesson(lessonCacheRef.current.lesson);
      setPhase("building");
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
        setPhase("building");
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

  const handleSelectBlock = (blockId: string) => {
    if (phase === "saved") {
      return;
    }
    setSelectedBlockIds((current) => [...current, blockId]);
    setHint("");
    if (phase === "passed") {
      setPhase("building");
      setMatchedVersion(undefined);
    }
  };

  const handleRemoveSelectedBlock = (index: number) => {
    if (phase === "saved") {
      return;
    }
    setSelectedBlockIds((current) => current.filter((_, currentIndex) => currentIndex !== index));
    setHint("");
    if (phase === "passed") {
      setPhase("building");
      setMatchedVersion(undefined);
    }
  };

  const handleReset = () => {
    if (phase === "saved") {
      return;
    }
    setSelectedBlockIds([]);
    setMatchedVersion(undefined);
    setHint("");
    setPhase("building");
  };

  const handleHint = () => {
    setHint(practiceLesson?.quickTip || practiceLesson?.thinking[0] || t("review.translation-practice.builder-default-hint"));
  };

  const handleCheck = () => {
    if (!practiceLesson || !canCheck) {
      return;
    }

    if (selectedAnswerKey === basicAnswerKey) {
      setMatchedVersion("basic");
      setHint("");
      setPhase("passed");
      setCelebrationRun((current) => current + 1);
      return;
    }

    if (selectedAnswerKey === nativeAnswerKey) {
      setMatchedVersion("native");
      setHint("");
      setPhase("passed");
      setCelebrationRun((current) => current + 1);
      return;
    }

    setMatchedVersion(undefined);
    setHint(
      t("review.translation-practice.builder-try-again-hint", {
        tip: practiceLesson.quickTip || practiceLesson.thinking[0] || t("review.translation-practice.builder-default-hint"),
      }),
    );
  };

  const handleSave = async () => {
    if (!memo || !practiceLesson) {
      return;
    }

    try {
      await createMemo.mutateAsync(
        create(MemoSchema, {
          content: formatSavedPracticeMemo(memo, practiceLesson, selectedBlocks, matchedVersion),
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
                  <p className="line-clamp-2 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{memoExcerpt}</p>
                </div>

                {phase === "preparing" && (
                  <div className="flex flex-col items-center rounded-xl border border-border/70 bg-background px-4 py-8 text-center">
                    <LoaderCircleIcon className="size-5 animate-spin text-primary" />
                    <p className="mt-3 text-sm font-medium text-foreground">{t("review.translation-practice.preparing-title")}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("review.translation-practice.preparing-description")}</p>
                  </div>
                )}

                {practiceLesson && phase !== "preparing" && (
                  <>
                    <section className="overflow-hidden rounded-xl border border-border/80 bg-background shadow-xs">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 px-3 py-3">
                          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                              <LightbulbIcon className="size-4" />
                            </span>
                            {t("review.translation-practice.lesson-title")}
                          </div>
                          <p className="mt-1 truncate pl-9 text-xs text-muted-foreground">{toolkitSummary}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5 pr-2">
                          <Badge variant="secondary" shape="pill">
                            {t("review.translation-practice.phase-lesson")}
                          </Badge>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-muted-foreground"
                            aria-expanded={lessonExpanded}
                            onClick={() => setLessonExpanded((expanded) => !expanded)}
                          >
                            <span>
                              {lessonExpanded
                                ? t("review.translation-practice.collapse-tips")
                                : t("review.translation-practice.expand-tips")}
                            </span>
                            <ChevronDownIcon className={cn("size-3.5 transition-transform", lessonExpanded && "rotate-180")} />
                          </Button>
                        </div>
                      </div>
                      {lessonExpanded && (
                        <div className="space-y-3 border-t border-border/70 bg-muted/15 p-3">
                          <div className="grid gap-2">
                            <VersionCard
                              label={t("review.translation-practice.basic-version")}
                              value={practiceLesson.basicVersion}
                              tone="basic"
                            />
                            <VersionCard
                              label={t("review.translation-practice.native-version")}
                              value={practiceLesson.nativeVersion}
                              tone="native"
                            />
                          </div>
                          <ExpressionToolkit
                            lesson={practiceLesson}
                            wordsTitle={t("review.translation-practice.words")}
                            phrasesTitle={t("review.translation-practice.phrases")}
                            patternsTitle={t("review.translation-practice.patterns")}
                          />
                        </div>
                      )}
                    </section>

                    <section className="space-y-3 rounded-xl border border-border/80 bg-background p-3 shadow-xs">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-medium text-foreground">{t("review.translation-practice.build-answer")}</div>
                        <Badge variant={phase === "passed" || phase === "saved" ? "default" : "outline"} shape="pill">
                          {phase === "passed" || phase === "saved"
                            ? t("review.translation-practice.phase-passed")
                            : t("review.translation-practice.phase-building")}
                        </Badge>
                      </div>

                      <div className="min-h-16 rounded-lg border border-dashed border-border bg-muted/20 p-2">
                        {selectedBlocks.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {selectedBlocks.map((block, index) => (
                              <PracticeBlockButton
                                key={`${block.id}-${index}`}
                                block={block}
                                selected
                                disabled={phase === "saved"}
                                onClick={() => handleRemoveSelectedBlock(index)}
                              />
                            ))}
                          </div>
                        ) : (
                          <div className="flex min-h-11 items-center px-1 text-sm text-muted-foreground">
                            {t("review.translation-practice.empty-answer")}
                          </div>
                        )}
                      </div>

                      {answerText && (
                        <div className="rounded-lg bg-muted/25 px-3 py-2 text-sm leading-6 text-foreground">
                          <span className="text-xs font-medium text-muted-foreground">
                            {t("review.translation-practice.preview-answer")}
                          </span>
                          <p className="mt-1">{answerText}</p>
                        </div>
                      )}

                      <div>
                        <div className="mb-2 text-xs font-medium text-muted-foreground">
                          {t("review.translation-practice.available-blocks")}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {availableBlocks.map((block) => (
                            <PracticeBlockButton
                              key={block.id}
                              block={block}
                              disabled={phase === "saved"}
                              onClick={() => handleSelectBlock(block.id)}
                            />
                          ))}
                        </div>
                      </div>

                      {hint && (
                        <div className="rounded-lg border border-amber-300/50 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                          {hint}
                        </div>
                      )}

                      <div className="grid grid-cols-[1fr_1fr_1.4fr] gap-2">
                        <Button variant="outline" onClick={handleHint} disabled={phase === "saved"}>
                          <HelpCircleIcon className="size-4" />
                          {t("review.translation-practice.hint")}
                        </Button>
                        <Button variant="outline" onClick={handleReset} disabled={selectedBlockIds.length === 0 || phase === "saved"}>
                          <RotateCcwIcon className="size-4" />
                          {t("review.translation-practice.reset-answer")}
                        </Button>
                        <Button onClick={handleCheck} disabled={!canCheck}>
                          <CheckCircle2Icon className="size-4" />
                          {t("review.translation-practice.check-answer")}
                        </Button>
                      </div>
                    </section>
                  </>
                )}

                {phase === "passed" && practiceLesson && (
                  <section className="relative overflow-hidden rounded-xl border border-emerald-300/70 bg-emerald-50/60 p-3 dark:border-emerald-800/70 dark:bg-emerald-950/20">
                    <div className="pointer-events-none absolute top-3 right-4 z-10 flex items-start gap-1.5" aria-hidden="true">
                      {TRANSLATION_PRACTICE_CELEBRATION_ACCENT_CLASSES.map((className) => (
                        <span key={className} className={cn("translation-practice-celebration-accent shadow-sm", className)} />
                      ))}
                    </div>
                    {showPassedCelebration && (
                      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 overflow-hidden" aria-hidden="true">
                        {TRANSLATION_PRACTICE_CONFETTI_CLASSES.map((className) => (
                          <span key={className} className={cn("translation-practice-confetti absolute opacity-0 shadow-sm", className)} />
                        ))}
                      </div>
                    )}
                    <div className="translation-practice-pass-pop relative flex gap-3 rounded-lg bg-background/90 px-3 py-3 shadow-xs">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                        <CheckCircle2Icon className="size-5" />
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground">{t("review.translation-practice.passed-title")}</div>
                        <p className="mt-1 text-sm leading-6 text-foreground">
                          {t("review.translation-practice.builder-passed-summary", {
                            version:
                              matchedVersion === "native"
                                ? t("review.translation-practice.native-version")
                                : t("review.translation-practice.basic-version"),
                          })}
                        </p>
                      </div>
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
