const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:8080";
import { WorkspaceConflictError } from "@/types/errors";
import { calculateHash } from "./hashUtils";
import type {
  ExecuteRequestBody,
  ExecuteResponse,
  CreateWorkspaceRequestBody,
  CreateWorkspaceResponse,
  WorkspaceFileManifestItem,
  WorkspaceManifestResponse,
  SyncFileClientStateAPI,
  SyncRequestAPI,
  SyncResponseAPI,
  ConfirmSyncRequestAPI,
  ConfirmSyncResponseAPI,
  ClientFileState,
  ExecuteAuthRequestBody,
  WorkspaceSummaryItem,
  ExecuteCodeAuthResponse,
  FileActionAPI,
} from "@/types/api";

export async function executeCode(
  body: ExecuteRequestBody
): Promise<ExecuteResponse> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ message: "Failed to execute code and parse error" }));
      console.error("Execute API Error:", response.status, errorData);
      throw new Error(
        errorData.error || `HTTP error! status: ${response.status}`
      );
    }
    return await response.json();
  } catch (error) {
    console.error("Error in executeCode:", error);
    if (error instanceof Error) {
      return { job_id: "", error: error.message };
    }
    return {
      job_id: "",
      error: "An unknown error occurred during code execution.",
    };
  }
}

export async function createWorkspace(
  body: CreateWorkspaceRequestBody,
  authToken: string
): Promise<CreateWorkspaceResponse> {
  const response = await fetch(`${API_BASE_URL}/api/workspaces`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorData = await response
      .json()
      .catch(() => ({ message: "Failed to create workspace and parse error" }));
    console.error("Create Workspace API Error:", response.status, errorData);
    throw new Error(
      errorData.error || `HTTP error! status: ${response.status}`
    );
  }
  const workspaceData = (await response.json()) as CreateWorkspaceResponse;
  if (workspaceData.initialVersion === undefined) {
    workspaceData.initialVersion = "1";
  }
  return workspaceData;
}

export async function getWorkspaceManifestFromServer(
  workspaceId: string,
  authToken: string
): Promise<WorkspaceManifestResponse> {
  const response = await fetch(
    `${API_BASE_URL}/api/workspaces/${workspaceId}/manifest`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    const errorData = await response
      .json()
      .catch(() => ({
        message: "Failed to fetch workspace manifest and parse error",
      }));
    console.error(
      "Get Workspace Manifest API Error:",
      response.status,
      errorData
    );
    throw new Error(
      errorData.error || `HTTP error! status: ${response.status}`
    );
  }
  const manifestData = await response.json();

  // some format checks (Ensure there is workspace versioning for OCC)
  if (Array.isArray(manifestData)) {
    return {
      manifest: manifestData as WorkspaceFileManifestItem[],
      workspaceVersion: "1",
    };
  }
  if (
    typeof manifestData === "object" &&
    manifestData !== null &&
    manifestData.manifest &&
    manifestData.workspaceVersion === undefined
  ) {
    return {
      manifest: manifestData.manifest as WorkspaceFileManifestItem[],
      workspaceVersion: "1",
    };
  }
  return manifestData as WorkspaceManifestResponse;
}

export async function syncWorkspace(
  workspaceId: string,
  payload: SyncRequestAPI, // Includes workspaceVersion and file states
  authToken: string
): Promise<SyncResponseAPI> {
  const response = await fetch(
    `${API_BASE_URL}/api/workspaces/${workspaceId}/sync`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    const errorData = await response
      .json()
      .catch(() => ({
        message: "Sync API call failed and could not parse error",
      }));
    console.error("Sync API Error:", response.status, errorData);
    // Try to return a SyncResponseAPI compatible error structure if possible
    if (response.status === 409) {
      // HTTP 409 Conflict for version mismatch
      return {
        status: "workspace_conflict",
        actions: [],
        errorMessage: errorData.errorMessage || "Workspace version conflict.",
        newWorkspaceVersion: errorData.newWorkspaceVersion, // Assuming backend might send current version on conflict
      };
    }
    throw new Error(
      errorData.error || `Sync API HTTP error! status: ${response.status}`
    );
  }
  return (await response.json()) as SyncResponseAPI;
}

export async function confirmSyncWorkspace(
  workspaceId: string,
  payload: ConfirmSyncRequestAPI, // Includes workspaceVersion and confirmed file operations
  authToken: string
): Promise<ConfirmSyncResponseAPI> {
  const response = await fetch(
    `${API_BASE_URL}/api/workspaces/${workspaceId}/sync/confirm`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    const errorData = await response
      .json()
      .catch(() => ({
        message: "Confirm Sync API call failed and could not parse error",
      }));
    console.error("Confirm Sync API Error:", response.status, errorData);
    throw new Error(
      errorData.error ||
        `Confirm Sync API HTTP error! status: ${response.status}`
    );
  }
  return (await response.json()) as ConfirmSyncResponseAPI;
}

export async function executeCodeAuth(
  workspaceId: string,
  authToken: string,
  filesInEditor: ClientFileState[],
  executionDetails: ExecuteAuthRequestBody,
  currentLocalManifestItems: WorkspaceFileManifestItem[],
  currentLocalWorkspaceVersion: string
): Promise<ExecuteCodeAuthResponse> {
  // 1. Determine local changes to create the initial sync request
  const localManifestMap = new Map(
    currentLocalManifestItems.map((item) => [item.filePath, item])
  );
  const editorFileMap = new Map(
    filesInEditor.map((file) => [file.filePath, file])
  );
  const localSyncStates: SyncFileClientStateAPI[] = [];

  // Check for new and modified files
  for (const file of filesInEditor) {
    const manifestItem = localManifestMap.get(file.filePath);
    if (file.type === 'folder') {
        if (!manifestItem) {
            localSyncStates.push({ filePath: file.filePath, action: 'new', type: 'folder' });
        }
        // Note: folders can't be "modified" - they're either new or unchanged
        continue; // No hash calculation for folders
    }
    const currentHash = calculateHash(file.content ?? '');
    if (!manifestItem) {
      localSyncStates.push({
        filePath: file.filePath,
        clientHash: currentHash,
        action: "new",
        type: "file",
      });
    } else if (manifestItem.hash !== currentHash) {
      localSyncStates.push({
        filePath: file.filePath,
        clientHash: currentHash,
        action: "modified",
        type: "file",
      });
    }
  }

  // Check for deleted files or folders
  for (const manifestItem of currentLocalManifestItems) {
    if (!editorFileMap.has(manifestItem.filePath)) {
      localSyncStates.push({
        filePath: manifestItem.filePath,
        action: "deleted",
        type: manifestItem.type,
      });
    }
  }

  if (localSyncStates.length > 0) {
    // 2. First phase of 2PC: Call /sync to get actions
    const syncRequest: SyncRequestAPI = {
      workspaceVersion: currentLocalWorkspaceVersion,
      files: localSyncStates,
    };
    const syncResponse = await syncWorkspace(
      workspaceId,
      syncRequest,
      authToken
    );

    if (syncResponse.status === "workspace_conflict") {
      throw new WorkspaceConflictError(
        syncResponse.errorMessage || "Workspace version conflict during sync.",
        syncResponse.newWorkspaceVersion
      );
    }
    if (syncResponse.status === "error") {
      throw new Error(syncResponse.errorMessage || "Unknown error during sync.");
    }

    // 3. Perform client-side actions (uploads) only if needed
    const actionsWithPresignedUrls = syncResponse.actions;

    // 2. Upload files that the server requested
    const uploadPromises = actionsWithPresignedUrls
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

    // 4. Second phase of 2PC: Call /sync/confirm only if we have actions to confirm
    if (syncResponse.newWorkspaceVersion && actionsWithPresignedUrls.some(action => 
      action.actionRequired === "upload" || action.actionRequired === "delete")) {
      const payloadForConfirm: ConfirmSyncRequestAPI = {
        workspaceVersion: syncResponse.newWorkspaceVersion!,
        syncActions: actionsWithPresignedUrls
          .filter((action) => action.actionRequired === "upload" || action.actionRequired === "delete")
          .filter((action) => action.fileId && action.r2ObjectKey) // Ensure we have required fields
          .map((action): FileActionAPI => {
            const fileState = editorFileMap.get(action.filePath);
            const content = fileState?.content ?? '';
            return {
              filePath: action.filePath,
              fileId: action.fileId!,
              r2ObjectKey: action.r2ObjectKey,
              action: action.actionRequired === 'upload' ? 'upsert' : 'delete',
              type: action.type,
              // Only include hash and size for files
              clientHash: action.type === 'file' ? calculateHash(content) : undefined,
              size: action.type === 'file' ? new Blob([content]).size : undefined,
            };
          }),
      };

      const confirmResponse = await confirmSyncWorkspace(
        workspaceId,
        payloadForConfirm,
        authToken
      );
      if (confirmResponse.status !== "success") {
        throw new Error(
          confirmResponse.errorMessage || "Failed to confirm sync."
        );
      }
    }
  }

  // 5. Execute code
  const response = await fetch(
    `${API_BASE_URL}/api/workspaces/${workspaceId}/execute`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(executionDetails),
    }
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      errorData.error || `Execute API HTTP error! status: ${response.status}`
    );
  }

  return (await response.json()) as ExecuteCodeAuthResponse;
}

export async function listWorkspaces(
  authToken: string
): Promise<WorkspaceSummaryItem[]> {
  const response = await fetch(`${API_BASE_URL}/api/workspaces`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${authToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorData = await response
      .json()
      .catch(() => ({ message: "Failed to list workspaces and parse error" }));
    console.error("List Workspaces API Error:", response.status, errorData);
    throw new Error(
      errorData.error || `HTTP error! status: ${response.status}`
    );
  }
  return (await response.json()) as WorkspaceSummaryItem[];
}
