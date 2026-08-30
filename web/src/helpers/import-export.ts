import { getRequestToken } from "@/connect";

export type ImportExportScope = "mine" | "all";
export type ImportSource = "memos" | "flomo";

export interface ImportExportResult {
  source?: ImportSource;
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

interface ImportUploadResponse {
  uploadId?: string;
  chunkSize?: number;
  chunkCount?: number;
  expiresAt?: string;
  uploadedChunks?: number[];
  result?: ImportExportResult;
}

export interface ImportProgress {
  uploadedChunks: number;
  totalChunks: number;
  uploadedBytes: number;
  totalBytes: number;
}

const directImportThresholdBytes = 32 * 1024 * 1024;

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

export const importMemosExport = async (
  scope: ImportExportScope,
  file: File,
  source: ImportSource = "memos",
  onProgress?: (progress: ImportProgress) => void,
): Promise<ImportExportResult> => {
  if (file.size > directImportThresholdBytes) {
    return importMemosExportInChunks(scope, file, source, onProgress);
  }

  const headers = await buildHeaders();
  const formData = new FormData();
  formData.set("file", file);

  const response = await fetch(`/api/v1/import?scope=${scope}&source=${source}`, {
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

const importMemosExportInChunks = async (
  scope: ImportExportScope,
  file: File,
  source: ImportSource,
  onProgress?: (progress: ImportProgress) => void,
): Promise<ImportExportResult> => {
  const headers = await buildHeaders();
  headers.set("Content-Type", "application/json");
  const createResponse = await fetch("/api/v1/import/uploads", {
    body: JSON.stringify({
      filename: file.name,
      scope,
      sha256: "",
      size: file.size,
      source,
    }),
    credentials: "include",
    headers,
    method: "POST",
  });
  if (!createResponse.ok) {
    throw new Error(await parseErrorMessage(createResponse));
  }

  const upload = (await createResponse.json()) as ImportUploadResponse;
  if (!upload.uploadId || !upload.chunkSize || !upload.chunkCount) {
    throw new Error("Invalid import upload session");
  }

  try {
    let uploadedBytes = 0;
    for (let index = 0; index < upload.chunkCount; index++) {
      const start = index * upload.chunkSize;
      const end = Math.min(start + upload.chunkSize, file.size);
      const chunk = file.slice(start, end);
      const chunkHeaders = await buildHeaders();
      const chunkResponse = await fetch(`/api/v1/import/uploads/${upload.uploadId}/chunks/${index}`, {
        body: chunk,
        credentials: "include",
        headers: chunkHeaders,
        method: "PUT",
      });
      if (!chunkResponse.ok) {
        throw new Error(await parseErrorMessage(chunkResponse));
      }
      uploadedBytes += chunk.size;
      onProgress?.({
        totalBytes: file.size,
        totalChunks: upload.chunkCount,
        uploadedBytes,
        uploadedChunks: index + 1,
      });
    }

    const completeHeaders = await buildHeaders();
    const completeResponse = await fetch(`/api/v1/import/uploads/${upload.uploadId}/complete`, {
      credentials: "include",
      headers: completeHeaders,
      method: "POST",
    });
    if (!completeResponse.ok) {
      throw new Error(await parseErrorMessage(completeResponse));
    }
    const completed = (await completeResponse.json()) as ImportUploadResponse;
    if (!completed.result) {
      throw new Error("Import did not return a result");
    }
    return completed.result;
  } catch (error) {
    const cancelHeaders = await buildHeaders();
    await fetch(`/api/v1/import/uploads/${upload.uploadId}`, {
      credentials: "include",
      headers: cancelHeaders,
      method: "DELETE",
    }).catch(() => undefined);
    throw error;
  }
};
