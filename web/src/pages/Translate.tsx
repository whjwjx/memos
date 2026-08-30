import { create } from "@bufbuild/protobuf";
import { ArrowRightLeftIcon, CheckIcon, ClockIcon, CopyIcon, FilePlus2Icon, LoaderCircleIcon, Trash2Icon, Volume2Icon } from "lucide-react";
import { type KeyboardEvent, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { memoServiceClient } from "@/connect";
import { useInstance } from "@/contexts/InstanceContext";
import { type DictionaryEntry, normalizeDictionaryWord, useDictionaryEntry } from "@/hooks/useDictionary";
import { useCreateMemo } from "@/hooks/useMemoQueries";
import { useSpeechSynthesis } from "@/hooks/useSpeechSynthesis";
import {
  useClearTranslationHistories,
  useDeleteTranslationHistory,
  useTranslateText,
  useTranslationHistories,
} from "@/hooks/useTranslation";
import { handleError } from "@/lib/error";
import { cn } from "@/lib/utils";
import { TranslationDirection, type TranslationHistory } from "@/types/proto/api/v1/ai_service_pb";
import { InstanceSetting_Key } from "@/types/proto/api/v1/instance_service_pb";
import { ListMemosRequestSchema, MemoSchema, Visibility } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";

const directionOptions = [TranslationDirection.AUTO, TranslationDirection.EN_TO_ZH, TranslationDirection.ZH_TO_EN] as const;
const cjkPattern = /[\u3400-\u9fff]/;

const getDirectionFromHistory = (history: TranslationHistory): TranslationDirection => {
  if (history.sourceLanguage === "en" && history.targetLanguage.startsWith("zh")) return TranslationDirection.EN_TO_ZH;
  if (history.sourceLanguage.startsWith("zh") && history.targetLanguage === "en") return TranslationDirection.ZH_TO_EN;
  return TranslationDirection.AUTO;
};

const getDirectionLabelKey = (direction: TranslationDirection) => {
  switch (direction) {
    case TranslationDirection.EN_TO_ZH:
      return "translation.direction-en-to-zh";
    case TranslationDirection.ZH_TO_EN:
      return "translation.direction-zh-to-en";
    default:
      return "translation.direction-auto";
  }
};

const formatHistoryTime = (createTime: bigint): string => {
  const timestamp = Number(createTime);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp * 1000));
};

const getHistorySaveKey = (history: TranslationHistory): string => {
  return history.id || `${history.sourceLanguage}:${history.targetLanguage}:${history.createTime.toString()}`;
};

const getHistoryMemoMarker = (history: TranslationHistory): string => {
  return `translation-history:${getHistorySaveKey(history)}`;
};

const toFilterStringLiteral = (value: string): string => {
  return JSON.stringify(value);
};

const formatTranslationHistoryMemo = (history: TranslationHistory): string => {
  const sourceLanguage = history.sourceLanguage.toUpperCase();
  const targetLanguage = history.targetLanguage.toUpperCase();
  const historyMarker = `<!-- ${getHistoryMemoMarker(history)} -->`;

  return [
    history.sourceText.trim(),
    `→ ${history.translatedText.trim()}`,
    "",
    `\`${sourceLanguage} -> ${targetLanguage}\``,
    "#translation #review",
    historyMarker,
  ].join("\n");
};

const hasSavedTranslationHistoryMemo = async (history: TranslationHistory): Promise<boolean> => {
  const marker = getHistoryMemoMarker(history);
  const response = await memoServiceClient.listMemos(
    create(ListMemosRequestSchema, {
      pageSize: 1,
      filter: `content.contains(${toFilterStringLiteral(marker)})`,
    }),
  );

  return response.memos.length > 0;
};

const getSpeechLanguageFromCode = (language: string): string | undefined => {
  const normalized = language.trim().toLowerCase();
  if (normalized === "en" || normalized.startsWith("en-")) return "en-US";
  if (normalized === "zh" || normalized.startsWith("zh-")) return "zh-CN";
  return undefined;
};

const inferSpeechLanguageFromText = (text: string): string => {
  return cjkPattern.test(text) ? "zh-CN" : "en-US";
};

const splitDictionaryLines = (value: string | undefined, limit: number): string[] => {
  return (value ?? "")
    .split(/\\n|\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, limit);
};

const parseExchange = (exchange: string | undefined): Array<{ key: string; value: string }> => {
  return (exchange ?? "")
    .split("/")
    .map((item) => item.trim())
    .filter(Boolean)
    .flatMap((item) => {
      const [key, ...rest] = item.split(":");
      const value = rest.join(":").trim();
      return key && value ? [{ key: key.trim(), value }] : [];
    });
};

const getDictionaryExchangeLabelKey = (key: string) => {
  switch (key) {
    case "s":
      return "translation.dictionary-exchange-plural";
    case "p":
      return "translation.dictionary-exchange-past-participle";
    case "d":
      return "translation.dictionary-exchange-past";
    case "i":
      return "translation.dictionary-exchange-present-participle";
    case "3":
      return "translation.dictionary-exchange-third-person";
    case "r":
      return "translation.dictionary-exchange-comparative";
    case "t":
      return "translation.dictionary-exchange-superlative";
    default:
      return undefined;
  }
};

const getDictionaryExchangeOrder = (key: string): number => {
  switch (key) {
    case "s":
      return 1;
    case "p":
      return 3;
    case "d":
      return 2;
    case "i":
      return 4;
    case "3":
      return 5;
    case "r":
      return 6;
    case "t":
      return 7;
    default:
      return 99;
  }
};

const getDictionaryTagLabel = (tag: string): string => {
  switch (tag.toLowerCase()) {
    case "zk":
      return "中考";
    case "gk":
      return "高考";
    case "cet4":
      return "四级";
    case "cet6":
      return "六级";
    case "ky":
      return "考研";
    case "ielts":
      return "雅思";
    case "toefl":
      return "托福";
    case "gre":
      return "GRE";
    default:
      return tag;
  }
};

interface DictionaryEntryPreviewProps {
  entry: DictionaryEntry;
  translationLines: string[];
  definitionLines: string[];
  exchanges: Array<{ key: string; value: string }>;
}

const DictionaryEntryPreview = ({ entry, translationLines, definitionLines, exchanges }: DictionaryEntryPreviewProps) => {
  const t = useTranslate();
  const tags = (entry.tag ?? "")
    .split(/\s+/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map(getDictionaryTagLabel)
    .slice(0, 5);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-xl font-medium leading-none text-foreground">{entry.word}</span>
          {entry.phonetic && <span className="text-sm text-muted-foreground">/{entry.phonetic}/</span>}
        </div>
        <div className="shrink-0 text-[11px] text-muted-foreground">{entry.source}</div>
      </div>

      {translationLines.length > 0 && (
        <div className="space-y-1.5 text-sm leading-6 text-foreground">
          {translationLines.map((line, index) => (
            <p key={`${line}:${index}`} className="break-words">
              {line}
            </p>
          ))}
        </div>
      )}

      {definitionLines.length > 0 && <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">{definitionLines[0]}</p>}

      {(exchanges.length > 0 || tags.length > 0 || entry.pos) && (
        <div className="space-y-2 pt-1">
          {exchanges.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {exchanges.flatMap((exchange) => {
                const labelKey = getDictionaryExchangeLabelKey(exchange.key);
                return labelKey
                  ? [
                      <span key={`${exchange.key}:${exchange.value}`} className="whitespace-nowrap">
                        <span className="mr-1 text-muted-foreground/70">{t(labelKey)}</span>
                        <span className="text-foreground/80">{exchange.value}</span>
                      </span>,
                    ]
                  : [];
              })}
            </div>
          )}

          {(tags.length > 0 || entry.pos) && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {entry.pos && <span>{entry.pos}</span>}
              {tags.length > 0 && <span>{tags.join(" / ")}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const TranslatePage = () => {
  const t = useTranslate();
  const { aiSetting, fetchSetting } = useInstance();
  const translationConfig = aiSetting.translation;
  const maxTextLength = translationConfig?.maxTextLength && translationConfig.maxTextLength > 0 ? translationConfig.maxTextLength : 5000;
  const enabled = translationConfig?.enabled ?? false;

  const [sourceText, setSourceText] = useState("");
  const [translatedText, setTranslatedText] = useState("");
  const [sourceLanguage, setSourceLanguage] = useState("");
  const [targetLanguage, setTargetLanguage] = useState("");
  const [direction, setDirection] = useState<TranslationDirection>(TranslationDirection.AUTO);
  const [sourcePanePercent, setSourcePanePercent] = useState(50);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [loadingSetting, setLoadingSetting] = useState(true);
  const [savingHistoryKeys, setSavingHistoryKeys] = useState<Set<string>>(() => new Set());
  const [savedHistoryKeys, setSavedHistoryKeys] = useState<Set<string>>(() => new Set());
  const mainPanelRef = useRef<HTMLElement>(null);
  const lastTranslationSignatureRef = useRef("");
  const savingHistoryKeysRef = useRef(new Set<string>());
  const savedHistoryKeysRef = useRef(new Set<string>());

  const historiesQuery = useTranslationHistories(historyOpen);
  const translateText = useTranslateText();
  const createMemo = useCreateMemo();
  const deleteHistory = useDeleteTranslationHistory();
  const clearHistories = useClearTranslationHistories();
  const speech = useSpeechSynthesis();
  const dictionaryWord = useMemo(() => normalizeDictionaryWord(sourceText), [sourceText]);
  const [debouncedDictionaryWord, setDebouncedDictionaryWord] = useState<string | undefined>(undefined);
  const dictionaryQuery = useDictionaryEntry(debouncedDictionaryWord);

  useEffect(() => {
    setLoadingSetting(true);
    fetchSetting(InstanceSetting_Key.AI)
      .catch((error: unknown) => handleError(error, toast.error, { context: "Load translation setting" }))
      .finally(() => setLoadingSetting(false));
  }, [fetchSetting]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedDictionaryWord(dictionaryWord);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [dictionaryWord]);

  const count = sourceText.length;
  const overLimit = count > maxTextLength;
  const isTranslating = translateText.isPending;
  const canTranslate = enabled && sourceText.trim().length > 0 && !overLimit && !isTranslating;

  const languageLabel = useMemo(() => {
    if (!sourceLanguage || !targetLanguage) return t("translation.result-placeholder");
    return t("translation.language-pair", { source: sourceLanguage.toUpperCase(), target: targetLanguage.toUpperCase() });
  }, [sourceLanguage, targetLanguage, t]);
  const dictionaryEntry = dictionaryQuery.data?.configured ? dictionaryQuery.data.entry : undefined;
  const shouldShowDictionaryPanel = Boolean(dictionaryWord && (dictionaryQuery.isLoading || dictionaryEntry));
  const dictionaryTranslationLines = splitDictionaryLines(dictionaryEntry?.translation, 4);
  const dictionaryDefinitionLines = splitDictionaryLines(dictionaryEntry?.definition, 2);
  const dictionaryExchanges = parseExchange(dictionaryEntry?.exchange)
    .filter((exchange) => Boolean(getDictionaryExchangeLabelKey(exchange.key)))
    .sort((a, b) => getDictionaryExchangeOrder(a.key) - getDictionaryExchangeOrder(b.key))
    .slice(0, 6);

  const performTranslate = useCallback(
    async (rawText: string, inputDirection: TranslationDirection, options?: { silentValidation?: boolean }) => {
      const text = rawText.trim();

      if (!enabled) {
        if (!options?.silentValidation) {
          toast.error(t("translation.disabled"));
        }
        return;
      }
      if (!text) {
        if (!options?.silentValidation) {
          toast.error(t("translation.input-required"));
        }
        return;
      }
      if (text.length > maxTextLength) {
        if (!options?.silentValidation) {
          toast.error(t("translation.too-long", { count: maxTextLength }));
        }
        return;
      }

      const signature = `${inputDirection}:${text}`;
      if (isTranslating || (options?.silentValidation && signature === lastTranslationSignatureRef.current)) {
        return;
      }

      lastTranslationSignatureRef.current = signature;
      try {
        const response = await translateText.mutateAsync({ text, direction: inputDirection });
        setTranslatedText(response.translatedText);
        setSourceLanguage(response.sourceLanguage);
        setTargetLanguage(response.targetLanguage);
      } catch (error: unknown) {
        handleError(error, toast.error, { context: "Translate text" });
      }
    },
    [enabled, isTranslating, maxTextLength, t, translateText.mutateAsync],
  );

  useEffect(() => {
    const text = sourceText.trim();
    if (!text) {
      setTranslatedText("");
      setSourceLanguage("");
      setTargetLanguage("");
      lastTranslationSignatureRef.current = "";
      return;
    }
    if (!enabled || loadingSetting || overLimit || isTranslating) {
      return;
    }

    const signature = `${direction}:${text}`;
    if (signature === lastTranslationSignatureRef.current) {
      return;
    }

    const timer = window.setTimeout(() => {
      void performTranslate(text, direction, { silentValidation: true });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [direction, enabled, isTranslating, loadingSetting, overLimit, performTranslate, sourceText]);

  const handleTranslate = () => {
    void performTranslate(sourceText, direction);
  };

  const getSourceSpeechLanguage = () => {
    const reportedLanguage = getSpeechLanguageFromCode(sourceLanguage);
    if (reportedLanguage) return reportedLanguage;
    if (direction === TranslationDirection.EN_TO_ZH) return "en-US";
    if (direction === TranslationDirection.ZH_TO_EN) return "zh-CN";
    return inferSpeechLanguageFromText(sourceText);
  };

  const getTargetSpeechLanguage = () => {
    const reportedLanguage = getSpeechLanguageFromCode(targetLanguage);
    if (reportedLanguage) return reportedLanguage;
    if (direction === TranslationDirection.EN_TO_ZH) return "zh-CN";
    if (direction === TranslationDirection.ZH_TO_EN) return "en-US";
    return inferSpeechLanguageFromText(translatedText);
  };

  const handleSpeechToggle = (key: "source" | "target", text: string, lang: string) => {
    if (!text.trim()) return;
    if (!speech.toggle({ key, text, lang })) {
      toast.error(t("translation.speech-unsupported"));
    }
  };

  const updateSourcePaneWidth = useCallback((clientX: number) => {
    const panel = mainPanelRef.current;
    if (!panel) return;

    const { left, width } = panel.getBoundingClientRect();
    if (width <= 0) return;

    const nextPercent = ((clientX - left) / width) * 100;
    setSourcePanePercent(Math.min(65, Math.max(35, nextPercent)));
  }, []);

  const handleDividerPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!mainPanelRef.current) return;

      event.preventDefault();
      updateSourcePaneWidth(event.clientX);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const handlePointerMove = (moveEvent: PointerEvent) => updateSourcePaneWidth(moveEvent.clientX);
      const handlePointerUp = () => {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    },
    [updateSourcePaneWidth],
  );

  const handleDividerKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

    event.preventDefault();
    setSourcePanePercent((percent) => Math.min(65, Math.max(35, percent + (event.key === "ArrowRight" ? 2 : -2))));
  }, []);

  const handleUseHistory = (history: TranslationHistory) => {
    const historyDirection = getDirectionFromHistory(history);
    lastTranslationSignatureRef.current = `${historyDirection}:${history.sourceText.trim()}`;
    setSourceText(history.sourceText);
    setTranslatedText(history.translatedText);
    setSourceLanguage(history.sourceLanguage);
    setTargetLanguage(history.targetLanguage);
    setDirection(historyDirection);
  };

  const handleCopy = async (text: string) => {
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("translation.copied"));
    } catch (error: unknown) {
      handleError(error, toast.error, { context: "Copy translation" });
    }
  };

  const handleDeleteHistory = async (id: string) => {
    try {
      await deleteHistory.mutateAsync(id);
    } catch (error: unknown) {
      handleError(error, toast.error, { context: "Delete translation history" });
    }
  };

  const handleSaveHistoryToMemo = async (history: TranslationHistory) => {
    const historyKey = getHistorySaveKey(history);
    if (savingHistoryKeysRef.current.has(historyKey)) {
      return;
    }
    if (savedHistoryKeysRef.current.has(historyKey)) {
      toast.success(t("translation.already-saved"));
      return;
    }

    savingHistoryKeysRef.current = new Set(savingHistoryKeysRef.current).add(historyKey);
    setSavingHistoryKeys(new Set(savingHistoryKeysRef.current));

    try {
      if (await hasSavedTranslationHistoryMemo(history)) {
        savedHistoryKeysRef.current = new Set(savedHistoryKeysRef.current).add(historyKey);
        setSavedHistoryKeys(new Set(savedHistoryKeysRef.current));
        toast.success(t("translation.already-saved"));
        return;
      }

      await createMemo.mutateAsync(
        create(MemoSchema, {
          content: formatTranslationHistoryMemo(history),
          visibility: Visibility.PRIVATE,
        }),
      );
      savedHistoryKeysRef.current = new Set(savedHistoryKeysRef.current).add(historyKey);
      setSavedHistoryKeys(new Set(savedHistoryKeysRef.current));
      toast.success(t("translation.saved-to-memo"));
    } catch (error: unknown) {
      handleError(error, toast.error, { context: "Save translation history to memo" });
    } finally {
      const nextSavingHistoryKeys = new Set(savingHistoryKeysRef.current);
      nextSavingHistoryKeys.delete(historyKey);
      savingHistoryKeysRef.current = nextSavingHistoryKeys;
      setSavingHistoryKeys(nextSavingHistoryKeys);
    }
  };

  const handleClearHistories = async () => {
    try {
      await clearHistories.mutateAsync();
      setClearOpen(false);
    } catch (error: unknown) {
      handleError(error, toast.error, { context: "Clear translation histories" });
    }
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-muted/25">
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto px-2 py-10 md:px-4 md:pb-10 md:pt-36 xl:px-6">
        <div
          className={cn(
            "flex w-full max-w-[92rem] flex-col transition-[gap] duration-300 md:w-[92%] md:flex-row",
            historyOpen ? "gap-4" : "gap-0",
          )}
        >
          <div className="min-w-0 flex-1">
            <main ref={mainPanelRef} className="flex min-h-[28rem] flex-col overflow-hidden rounded-lg bg-card md:min-h-0">
              <div className="flex min-h-[28rem] flex-col md:h-[24rem] md:min-h-0 md:flex-row">
                <section
                  className="flex min-h-[18rem] min-w-0 flex-col transition-[flex-basis] duration-200 ease-out md:min-h-0"
                  style={{ flexBasis: `${sourcePanePercent}%` }}
                >
                  <div className="flex h-11 items-center justify-between gap-3 px-7">
                    <Select
                      value={`${direction}`}
                      items={directionOptions.map((option) => ({ value: `${option}`, label: t(getDirectionLabelKey(option)) }))}
                      onValueChange={(value) => setDirection(Number(value) as TranslationDirection)}
                    >
                      <SelectTrigger
                        size="sm"
                        className="w-28 border-0 bg-transparent shadow-none hover:bg-muted/60 focus-visible:ring-0"
                        aria-label={t("translation.direction")}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="border-0">
                        {directionOptions.map((option) => (
                          <SelectItem key={option} value={`${option}`}>
                            {t(getDirectionLabelKey(option))}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Textarea
                    value={sourceText}
                    onChange={(e) => setSourceText(e.target.value)}
                    placeholder={t("translation.input-placeholder")}
                    className="min-h-0 flex-1 resize-none border-0 bg-transparent px-7 py-5 text-base shadow-none focus-visible:ring-0"
                    maxLength={maxTextLength + 1}
                    disabled={!enabled || loadingSetting}
                  />
                  <div className="flex items-center justify-between gap-3 px-7 py-3 text-xs text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <Button
                        variant={speech.speakingKey === "source" ? "secondary" : "ghost"}
                        size="icon-sm"
                        disabled={!sourceText.trim() || !speech.isSupported}
                        aria-label={t(speech.speakingKey === "source" ? "translation.stop-speaking" : "translation.listen-source")}
                        title={t(speech.speakingKey === "source" ? "translation.stop-speaking" : "translation.listen-source")}
                        onClick={() => handleSpeechToggle("source", sourceText, getSourceSpeechLanguage())}
                        className="transition-[background-color,color,transform] active:scale-95"
                      >
                        <Volume2Icon className="size-4" strokeWidth={1.8} />
                      </Button>
                      <span className={cn(overLimit && "text-destructive")}>{t("translation.count", { count, max: maxTextLength })}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="icon-sm" onClick={() => setSourceText("")} disabled={!sourceText}>
                        <Trash2Icon className="size-4" strokeWidth={1.8} />
                      </Button>
                      <Button onClick={handleTranslate} disabled={!canTranslate}>
                        {isTranslating ? (
                          <LoaderCircleIcon className="mr-2 size-4 animate-spin" />
                        ) : (
                          <ArrowRightLeftIcon className="mr-2 size-4" />
                        )}
                        {t("translation.translate")}
                      </Button>
                    </div>
                  </div>
                </section>

                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-valuemin={35}
                  aria-valuemax={65}
                  aria-valuenow={Math.round(sourcePanePercent)}
                  tabIndex={0}
                  onPointerDown={handleDividerPointerDown}
                  onKeyDown={handleDividerKeyDown}
                  className="group hidden w-4 shrink-0 cursor-col-resize touch-none items-stretch justify-center outline-none md:flex"
                >
                  <span className="my-6 w-px border-l border-dashed border-border/70 transition-colors duration-200 group-hover:border-primary/70 group-focus-visible:border-primary" />
                </div>

                <section className="flex min-h-[18rem] min-w-0 flex-1 flex-col md:min-h-0">
                  <div className="flex h-11 items-center justify-between gap-3 px-7 text-xs text-muted-foreground">
                    <span className="truncate font-medium">{languageLabel}</span>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon-sm" onClick={() => handleCopy(translatedText)} disabled={!translatedText}>
                        <CopyIcon className="size-4" strokeWidth={1.8} />
                      </Button>
                      <Button
                        variant={historyOpen ? "secondary" : "ghost"}
                        size="icon-sm"
                        aria-label={t(historyOpen ? "translation.hide-history" : "translation.show-history")}
                        title={t(historyOpen ? "translation.hide-history" : "translation.show-history")}
                        onClick={() => setHistoryOpen((open) => !open)}
                        className="transition-[background-color,color,box-shadow,transform] active:scale-95"
                      >
                        <ClockIcon className="size-4" strokeWidth={1.8} />
                      </Button>
                    </div>
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words px-7 py-5 text-base text-foreground">
                    {translatedText || (
                      <span className="text-muted-foreground">
                        {loadingSetting
                          ? t("translation.loading")
                          : enabled
                            ? t("translation.result-empty")
                            : t("translation.disabled-description")}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-3 px-7 py-3 text-xs text-muted-foreground">
                    <Button
                      variant={speech.speakingKey === "target" ? "secondary" : "ghost"}
                      size="icon-sm"
                      disabled={!translatedText.trim() || !speech.isSupported}
                      aria-label={t(speech.speakingKey === "target" ? "translation.stop-speaking" : "translation.listen-result")}
                      title={t(speech.speakingKey === "target" ? "translation.stop-speaking" : "translation.listen-result")}
                      onClick={() => handleSpeechToggle("target", translatedText, getTargetSpeechLanguage())}
                      className="transition-[background-color,color,transform] active:scale-95"
                    >
                      <Volume2Icon className="size-4" strokeWidth={1.8} />
                    </Button>
                  </div>
                </section>
              </div>
              <div
                className={cn(
                  "overflow-hidden border-t border-dashed border-border/70 transition-[max-height,opacity] duration-300 ease-out",
                  shouldShowDictionaryPanel ? "max-h-72 opacity-100" : "pointer-events-none max-h-0 opacity-0",
                )}
              >
                <div className="flex max-h-72 overflow-auto">
                  <div
                    className="min-w-0 px-7 py-5 transition-[flex-basis] duration-200 ease-out"
                    style={{ flexBasis: `${sourcePanePercent}%` }}
                  >
                    {dictionaryQuery.isLoading ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <LoaderCircleIcon className="size-3.5 animate-spin" />
                        <span>{t("translation.dictionary-loading")}</span>
                      </div>
                    ) : dictionaryEntry ? (
                      <DictionaryEntryPreview
                        entry={dictionaryEntry}
                        translationLines={dictionaryTranslationLines}
                        definitionLines={dictionaryDefinitionLines}
                        exchanges={dictionaryExchanges}
                      />
                    ) : null}
                  </div>
                  <div className="hidden min-w-0 flex-1 md:block" />
                </div>
              </div>
            </main>
          </div>

          <aside
            aria-hidden={!historyOpen}
            className={cn(
              "flex w-full shrink-0 flex-col overflow-hidden rounded-lg bg-card transition-[max-height,width,opacity,transform] duration-300 ease-out",
              historyOpen
                ? "min-h-[18rem] max-h-[28rem] translate-y-0 opacity-100 md:h-[24rem] md:max-h-[24rem] md:w-64 md:translate-x-0"
                : "pointer-events-none max-h-0 -translate-y-2 opacity-0 md:h-[24rem] md:max-h-[24rem] md:w-0 md:translate-x-3 md:translate-y-0",
            )}
          >
            <div className="flex h-full w-full flex-col md:w-64">
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="text-sm font-medium text-foreground">{t("translation.history")}</div>
                <Button variant="ghost" size="sm" onClick={() => setClearOpen(true)} disabled={(historiesQuery.data ?? []).length === 0}>
                  {t("common.clear")}
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-2">
                {historiesQuery.isLoading ? (
                  <div className="px-2 py-4 text-sm text-muted-foreground">{t("translation.loading")}</div>
                ) : (historiesQuery.data ?? []).length === 0 ? (
                  <div className="px-2 py-4 text-sm text-muted-foreground">{t("translation.history-empty")}</div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {(historiesQuery.data ?? []).map((history) => {
                      const historyKey = getHistorySaveKey(history);
                      const isSavingHistory = savingHistoryKeys.has(historyKey);
                      const isSavedHistory = savedHistoryKeys.has(historyKey);

                      return (
                        <div key={history.id} className="group rounded-md hover:bg-muted/50">
                          <div className="flex items-start gap-2 px-3 py-2">
                            <button type="button" onClick={() => handleUseHistory(history)} className="min-w-0 flex-1 text-left">
                              <div className="truncate text-sm font-medium text-foreground">{history.sourceText}</div>
                              <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{history.translatedText}</div>
                              <div className="mt-2 text-[11px] text-muted-foreground">
                                {`${history.sourceLanguage.toUpperCase()} -> ${history.targetLanguage.toUpperCase()}`}
                                {formatHistoryTime(history.createTime) ? ` / ${formatHistoryTime(history.createTime)}` : ""}
                              </div>
                            </button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="-mr-1 -mt-1 opacity-70 md:opacity-0 md:group-hover:opacity-100"
                              aria-label={t("translation.save-to-memo")}
                              title={t(isSavedHistory ? "translation.already-saved" : "translation.save-to-memo")}
                              disabled={isSavingHistory}
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleSaveHistoryToMemo(history);
                              }}
                            >
                              {isSavingHistory ? (
                                <LoaderCircleIcon className="size-4 animate-spin" strokeWidth={1.8} />
                              ) : isSavedHistory ? (
                                <CheckIcon className="size-4" strokeWidth={1.8} />
                              ) : (
                                <FilePlus2Icon className="size-4" strokeWidth={1.8} />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="-mr-1 -mt-1 opacity-70 md:opacity-0 md:group-hover:opacity-100"
                              onClick={() => handleDeleteHistory(history.id)}
                            >
                              <Trash2Icon className="size-4" strokeWidth={1.8} />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>

      <ConfirmDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title={t("translation.clear-confirm")}
        confirmLabel={t("common.clear")}
        cancelLabel={t("common.cancel")}
        onConfirm={handleClearHistories}
        confirmVariant="destructive"
      />
    </div>
  );
};

export default TranslatePage;
