import { getRequestToken } from "@/connect";

export interface RenameTagResult {
  from: string;
  to: string;
  scannedMemos: number;
  updatedMemos: number;
  migratedMetadata: boolean;
}

const getErrorMessage = async (response: Response): Promise<string> => {
  try {
    const data = (await response.json()) as { message?: string; error?: string };
    return data.message || data.error || response.statusText;
  } catch {
    return response.statusText;
  }
};

export const renameTag = async (from: string, to: string): Promise<RenameTagResult> => {
  const headers = new Headers({
    Accept: "application/json",
    "Content-Type": "application/json",
  });
  const token = await getRequestToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch("/api/v1/tags:rename", {
    method: "POST",
    headers,
    credentials: "include",
    body: JSON.stringify({ from, to }),
  });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }
  return (await response.json()) as RenameTagResult;
};
