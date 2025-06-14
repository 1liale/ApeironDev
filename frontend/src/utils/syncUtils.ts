import { calculateFileHash } from "./workspaceUtils";
import type {
  ClientFileState,
  ConfirmSyncRequestAPI,
  FileActionAPI,
} from "@/types/api";

/**
 * Performs file uploads for sync actions that require upload
 */
export async function performFileUploads(
  actions: Array<{ filePath: string; presignedUrl?: string; actionRequired: string; type: string }>,
  editorFileMap: Map<string, ClientFileState>
): Promise<void> {
  const uploadPromises = actions
    .filter((action) => action.actionRequired === "upload" && action.type === 'file')
    .map(async (action) => {
      const fileToUpload = editorFileMap.get(action.filePath);
      if (fileToUpload && action.presignedUrl) {
        try {
          const uploadResponse = await fetch(action.presignedUrl, {
            method: "PUT",
            body: fileToUpload.content,
            headers: {
              "Content-Type": "application/octet-stream",
            },
          });
          if (!uploadResponse.ok) {
            throw new Error(`Upload failed with status: ${uploadResponse.status}`);
          }
          return uploadResponse;
        } catch (error) {
          throw new Error(`Failed to upload ${action.filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
      return Promise.reject(
        new Error(`File not found or no presigned URL for ${action.filePath}`)
      );
    });

  if (uploadPromises.length > 0) {
    await Promise.all(uploadPromises);
  }
}

/**
 * Creates confirm sync payload from sync response actions
 */
export function createConfirmSyncPayload(
  newWorkspaceVersion: string,
  actions: Array<{
    filePath: string;
    fileId?: string;
    r2ObjectKey: string;
    actionRequired: string;
    type: string;
  }>,
  editorFileMap: Map<string, ClientFileState>
): ConfirmSyncRequestAPI {
  return {
    workspaceVersion: newWorkspaceVersion,
    syncActions: actions
      .filter((action) => action.actionRequired === "upload" || action.actionRequired === "delete")
      .filter((action) => action.fileId && action.r2ObjectKey)
      .map((action): FileActionAPI => {
        const fileState = editorFileMap.get(action.filePath);
        const content = fileState?.content ?? '';
        return {
          filePath: action.filePath,
          fileId: action.fileId!,
          r2ObjectKey: action.r2ObjectKey,
          action: action.actionRequired === 'upload' ? 'upsert' : 'delete',
          type: action.type as "file" | "folder",
          // Only include hash and size for files
          clientHash: action.type === 'file' ? calculateFileHash(content) : undefined,
          size: action.type === 'file' ? new Blob([content]).size : undefined,
        };
      }),
  };
} 