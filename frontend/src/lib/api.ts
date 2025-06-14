const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:8080";

import { detectWorkspaceChanges, createFileMaps } from "@/utils/workspaceUtils";
import {
  performFileUploads,
  createConfirmSyncPayload,
} from "@/utils/syncUtils";
import { WorkspaceConflictError } from "@/types/errors";

import type {
  ExecuteRequestBody,
  ExecuteResponse,
  CreateWorkspaceRequestBody,
  CreateWorkspaceResponse,
  WorkspaceFileManifestItem,
  WorkspaceManifestResponse,
  SyncRequestAPI,
  SyncResponseAPI,
  ConfirmSyncRequestAPI,
  ConfirmSyncResponseAPI,
  ClientFileState,
  ExecuteAuthRequestBody,
  WorkspaceSummaryItem,
  ExecuteCodeAuthResponse,
} from "@/types/api";

// ===== BASIC API CALLS =====

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

export async function getWorkspaceManifest(
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
    const errorData = await response.json().catch(() => ({
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

export async function syncWorkspace(
  workspaceId: string,
  payload: SyncRequestAPI,
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
    const errorData = await response.json().catch(() => ({
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
        newWorkspaceVersion: errorData.newWorkspaceVersion,
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
  payload: ConfirmSyncRequestAPI,
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
    const errorData = await response.json().catch(() => ({
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

export async function executeCodeAuthCore(
  workspaceId: string,
  authToken: string,
  executionDetails: ExecuteAuthRequestBody
): Promise<ExecuteCodeAuthResponse> {
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

/**
 * Full sync + execute flow - always cacheable by TanStack Query
 * Performs sync only when workspace changes are detected
 */
export async function executeCodeAuth(
  workspaceId: string,
  authToken: string,
  filesInEditor: ClientFileState[],
  executionDetails: ExecuteAuthRequestBody,
  currentLocalManifestItems: WorkspaceFileManifestItem[],
  currentLocalWorkspaceVersion: string
): Promise<ExecuteCodeAuthResponse> {
  // Detect changes for sync
  const localSyncStates = detectWorkspaceChanges(
    filesInEditor,
    currentLocalManifestItems
  );

  if (localSyncStates.length > 0) {
    console.log(
      "Workspace changes detected - performing sync + execute",
      localSyncStates
    );

    // Create file maps for sync operations
    const { editorFileMap } = createFileMaps(
      filesInEditor,
      currentLocalManifestItems
    );

    // Phase 1: Sync request
    const syncRequest: SyncRequestAPI = {
      workspaceVersion: currentLocalWorkspaceVersion,
      files: localSyncStates,
    };
    const syncResponse = await syncWorkspace(
      workspaceId,
      syncRequest,
      authToken
    );

    // Handle sync response errors
    if (syncResponse.status === "workspace_conflict") {
      throw new WorkspaceConflictError(
        syncResponse.errorMessage || "Workspace version conflict during sync.",
        workspaceId,
        syncResponse.newWorkspaceVersion
      );
    }
    if (syncResponse.status === "error") {
      throw new Error(
        syncResponse.errorMessage || "Unknown error during sync."
      );
    }

    // Phase 2: File uploads
    await performFileUploads(syncResponse.actions, editorFileMap);

    // Phase 3: Confirm sync (only happens if server provided a new version)
    if (syncResponse.newWorkspaceVersion) {
      const confirmPayload = createConfirmSyncPayload(
        syncResponse.newWorkspaceVersion,
        syncResponse.actions,
        editorFileMap
      );

      const confirmResponse = await confirmSyncWorkspace(
        workspaceId,
        confirmPayload,
        authToken
      );

      if (confirmResponse.status !== "success") {
        throw new Error(
          confirmResponse.errorMessage || "Failed to confirm sync."
        );
      }
    }
  }

  // Execute code
  return executeCodeAuthCore(workspaceId, authToken, executionDetails);
}
