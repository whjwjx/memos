import { useCallback, useEffect, useRef, useState } from "react";

interface SpeakOptions {
  key: string;
  text: string;
  lang: string;
  rate?: number;
}

export const useSpeechSynthesis = () => {
  const [isSupported] = useState(
    () => typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window,
  );
  const [speakingKey, setSpeakingKey] = useState<string | undefined>();
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const stop = useCallback(() => {
    if (!isSupported) return;

    try {
      window.speechSynthesis.cancel();
    } catch {
      // Ignore browser-specific speech synthesis failures.
    } finally {
      utteranceRef.current = null;
      setSpeakingKey(undefined);
    }
  }, [isSupported]);

  const speak = useCallback(
    (options: SpeakOptions): boolean => {
      const text = options.text.trim();
      if (!isSupported || !text) return false;

      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = options.lang;
        utterance.rate = options.rate ?? 1;

        const clearSpeaking = () => {
          if (utteranceRef.current !== utterance) return;
          utteranceRef.current = null;
          setSpeakingKey(undefined);
        };

        utterance.onstart = () => setSpeakingKey(options.key);
        utterance.onend = clearSpeaking;
        utterance.onerror = clearSpeaking;

        utteranceRef.current = utterance;
        setSpeakingKey(options.key);
        window.speechSynthesis.speak(utterance);
        return true;
      } catch {
        utteranceRef.current = null;
        setSpeakingKey(undefined);
        return false;
      }
    },
    [isSupported],
  );

  const toggle = useCallback(
    (options: SpeakOptions): boolean => {
      if (speakingKey === options.key) {
        stop();
        return true;
      }
      return speak(options);
    },
    [speak, speakingKey, stop],
  );

  useEffect(() => {
    return () => {
      if (!isSupported) return;

      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore browser-specific speech synthesis failures.
      }
    };
  }, [isSupported]);

  return {
    isSupported,
    speakingKey,
    speak,
    stop,
    toggle,
  };
};
