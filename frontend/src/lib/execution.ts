import type { ExecuteRequestBody } from "@/types/api";

export const getLanguageForExecution = (
  filename: string,
): ExecuteRequestBody["language"] | null => {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "py") {
    return "python";
  }
  // Add other languages if needed, e.g.:
  // if (ext === 'js') return 'javascript';
  // if (ext === 'go') return 'go';
  return null;
}; 