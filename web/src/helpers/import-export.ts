import { getRequestToken } from "@/connect";

export type ImportExportScope = "mine" | "all";

export interface ImportExportResult {
  scope: ImportExportScope;
  createdMemos: number;
  skippedMemos: number;
  createdAttachments: number;
  skippedAttachments: number;
  createdRelations: number;
  skippedRelations: number;
  createdReactions: number;
  skippedReactions: number;
  warnings?: string[];
}

const parseErrorMessage = async (response: Response) => {
  const text = await response.text();
  if (!text) return response.statusText;
  try {
    const data = JSON.parse(text) as { message?: string; error?: string };
    return data.message || data.error || text;
  } catch {
    return text;
  }
};

const buildHeaders = async () => {
  const token = await getRequestToken();
  const headers = new Headers();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
};

const filenameFromDisposition = (disposition: string | null, fallback: string) => {
  if (!disposition) return fallback;
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1]);
  const asciiMatch = disposition.match(/filename="?([^";]+)"?/i);
  return asciiMatch?.[1] || fallback;
};

export const downloadMemosExport = async (scope: ImportExportScope) => {
  const headers = await buildHeaders();
  const response = await fetch(`/api/v1/export:download?scope=${scope}`, {
    credentials: "include",
    headers,
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  const blob = await response.blob();
  const filename = filenameFromDisposition(response.headers.get("Content-Disposition"), `memos-export-${scope}.zip`);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

export const importMemosExport = async (scope: ImportExportScope, file: File): Promise<ImportExportResult> => {
  const headers = await buildHeaders();
  const formData = new FormData();
  formData.set("file", file);

  const response = await fetch(`/api/v1/import?scope=${scope}`, {
    body: formData,
    credentials: "include",
    headers,
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }
  return (await response.json()) as ImportExportResult;
};
