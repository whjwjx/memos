import { useQuery } from "@tanstack/react-query";
import { getRequestToken } from "@/connect";

export interface DictionaryEntry {
  word: string;
  phonetic?: string;
  definition?: string;
  translation?: string;
  pos?: string;
  tag?: string;
  exchange?: string;
  source: string;
}

interface DictionaryEntryResponse {
  configured: boolean;
  entry?: DictionaryEntry;
}

export const dictionaryKeys = {
  entry: (word: string) => ["dictionary", "entry", word] as const,
};

export const normalizeDictionaryWord = (text: string): string | undefined => {
  const word = text.trim().toLowerCase();
  if (!/^[a-z][a-z'-]{0,63}$/.test(word)) {
    return undefined;
  }
  return word;
};

export const useDictionaryEntry = (word: string | undefined) => {
  return useQuery({
    queryKey: dictionaryKeys.entry(word ?? ""),
    enabled: Boolean(word),
    staleTime: 24 * 60 * 60 * 1000,
    queryFn: async () => {
      const token = await getRequestToken();
      const headers = new Headers();
      if (token) {
        headers.set("Authorization", `Bearer ${token}`);
      }

      const response = await fetch(`/api/v1/dictionary/entries/${encodeURIComponent(word ?? "")}`, {
        credentials: "include",
        headers,
      });
      if (!response.ok) {
        throw new Error(response.statusText);
      }
      return (await response.json()) as DictionaryEntryResponse;
    },
  });
};
