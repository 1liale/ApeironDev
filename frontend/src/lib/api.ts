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
  ConfirmSyncFileItemAPI,
  ConfirmSyncRequestAPI,
  ConfirmSyncResponseAPI,
  ClientFileState,
  ExecuteAuthRequestBody,
  WorkspaceSummaryItem,
  ExecuteCodeAuthResponse,
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
  // Parameters to be supplied from WorkspaceContext or similar source
  currentLocalManifestItems: WorkspaceFileManifestItem[],
  currentLocalWorkspaceVersion: string | number
): Promise<ExecuteCodeAuthResponse> {
  console.log(
    "Starting executeCodeAuth for workspace:",
    workspaceId,
    "with version:",
    currentLocalWorkspaceVersion
  );

  let finalWorkspaceVersion: string | number = currentLocalWorkspaceVersion;

  const localManifestMap = new Map(
    currentLocalManifestItems.map((item) => [item.filePath, item])
  );
  const localSyncStates: SyncFileClientStateAPI[] = [];
  const editorFilePaths = new Set(filesInEditor.map((f) => f.filePath));

  for (const editorFile of filesInEditor) {
    const currentHash = calculateHash(editorFile.content);
    const localManifestFile = localManifestMap.get(editorFile.filePath);

    if (!localManifestFile) {
      localSyncStates.push({
        filePath: editorFile.filePath,
        clientHash: currentHash,
        action: "new",
      });
    } else if (localManifestFile.hash !== currentHash) {
      localSyncStates.push({
        filePath: editorFile.filePath,
        clientHash: currentHash,
        action: "modified",
      });
    } else {
      localSyncStates.push({
        filePath: editorFile.filePath,
        clientHash: currentHash,
        action: "unchanged",
      });
    }
  }

  for (const localManifestFile of currentLocalManifestItems) {
    if (!editorFilePaths.has(localManifestFile.filePath)) {
      localSyncStates.push({
        filePath: localManifestFile.filePath,
        clientHash: localManifestFile.hash || "",
        action: "deleted",
      });
    }
  }
  console.log(
    "Prepared syncFileClientStates based on local manifest:",
    localSyncStates
  );

  const syncRequestPayload: SyncRequestAPI = {
    workspaceVersion: currentLocalWorkspaceVersion,
    files: localSyncStates,
  };

  const syncResult = await syncWorkspace(
    workspaceId,
    syncRequestPayload,
    authToken
  );
  console.log("Sync API Result:", syncResult);

  if (syncResult.status === "workspace_conflict") {
    throw new WorkspaceConflictError(
      syncResult.errorMessage ||
        "Workspace version conflict. Please refresh and try again.",
      workspaceId,
      syncResult.newWorkspaceVersion
    );
  }
  if (syncResult.status === "error") {
    throw new Error(
      syncResult.errorMessage || "Sync process resulted in an error."
    );
  }
  if (syncResult.status === "no_changes") {
    console.log(
      "No file changes to sync according to server. Proceeding to execution."
    );
  } else if (syncResult.status === "pending_confirmation") {
    const filePromises: Promise<ConfirmSyncFileItemAPI>[] = [];
    for (const action of syncResult.actions) {
      if (action.actionRequired === "upload" && action.presignedUrl) {
        const editorFile = filesInEditor.find(
          (f) => f.filePath === action.filePath
        );
        if (editorFile) {
          const currentFileHash = calculateHash(editorFile.content);
          const uploadPromise = fetch(action.presignedUrl, {
            method: "PUT",
            body: editorFile.content,
          })
            .then((uploadRes): ConfirmSyncFileItemAPI => {
              if (!uploadRes.ok)
                return {
                  filePath: action.filePath,
                  r2ObjectKey: action.r2ObjectKey || "",
                  actionConfirmed: "uploaded",
                  status: "failed",
                  error: `Upload failed: ${uploadRes.status}`,
                };
              return {
                filePath: action.filePath,
                r2ObjectKey: action.r2ObjectKey || "",
                actionConfirmed: "uploaded",
                status: "success",
                clientHash: currentFileHash,
              };
            })
            .catch(
              (err): ConfirmSyncFileItemAPI => ({
                filePath: action.filePath,
                r2ObjectKey: action.r2ObjectKey || "",
                actionConfirmed: "uploaded",
                status: "failed",
                error: err.message,
              })
            );
          filePromises.push(uploadPromise);
        } else {
          filePromises.push(
            Promise.resolve({
              filePath: action.filePath,
              r2ObjectKey: action.r2ObjectKey || "",
              actionConfirmed: "uploaded",
              status: "failed",
              error: "File not in editor",
            })
          );
        }
      } else if (action.actionRequired === "delete") {
        const localManifestFile = localManifestMap.get(action.filePath);
        filePromises.push(
          Promise.resolve({
            filePath: action.filePath,
            r2ObjectKey:
              action.r2ObjectKey || localManifestFile?.r2ObjectKey || "",
            actionConfirmed: "deleted",
            status: "success",
          })
        );
      } else if (action.actionRequired === "conflict") {
        throw new Error(
          `File conflict for ${action.filePath}. Server version: ${action.serverVersion}`
        );
      }
    }

    const confirmedFilesResults = await Promise.all(filePromises);
    const successfulConfirmations = confirmedFilesResults.filter(
      (f) => f.status === "success"
    );

    if (
      successfulConfirmations.length !==
        confirmedFilesResults.filter((f) => f.actionConfirmed).length &&
      successfulConfirmations.length > 0
    ) {
      const failedOps = confirmedFilesResults.filter(
        (f) => f.status === "failed"
      );
      throw new Error(
        `Some file operations failed: ${failedOps
          .map((f) => f.filePath)
          .join(", ")}.`
      );
    }

    if (successfulConfirmations.length > 0) {
      const confirmPayload: ConfirmSyncRequestAPI = {
        newWorkspaceVersion: syncResult.newWorkspaceVersion!,
        baseVersion: currentLocalWorkspaceVersion.toString(),
        actions: successfulConfirmations,
      };
      const confirmResult = await confirmSyncWorkspace(
        workspaceId,
        confirmPayload,
        authToken
      );
      console.log("Confirm Sync API Result:", confirmResult);
      if (confirmResult.status !== "success") {
        throw new Error(
          confirmResult.errorMessage || "Final confirmation failed."
        );
      }
      finalWorkspaceVersion = confirmResult.finalWorkspaceVersion;
    } else if (
      syncResult.actions.some(
        (a) => a.actionRequired === "upload" || a.actionRequired === "delete"
      )
    ) {
      // Actions were required, but none succeeded or were confirmable.
      throw new Error(
        "Required file operations could not be successfully confirmed."
      );
    }
  }

  // 3. Call /workspaces/:workspaceId/execute
  const executePayload: ExecuteAuthRequestBody = executionDetails;
  const executionApiResponse = await fetch(
    `${API_BASE_URL}/api/workspaces/${workspaceId}/execute`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(executePayload),
    }
  );

  if (!executionApiResponse.ok) {
    const errorData = await executionApiResponse
      .json()
      .catch(() => ({ message: "Execute API call failed" }));
    throw new Error(
      errorData.error ||
        `Execute API HTTP error! status: ${executionApiResponse.status}`
    );
  }
  const executionResponse = (await executionApiResponse.json()) as ExecuteResponse;

  return {
    executionResponse,
    newWorkspaceVersion: finalWorkspaceVersion,
  };
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
