import type { ReactNode } from "react";
import type {
  WorkspaceFileManifestItem,
  WorkspaceSummaryItem,
  ClientSideWorkspaceFileManifestItem,
} from "@/types/api";

// --- CodeExecutionContext ---

export interface CodeExecutionContextType {
  editorRef: React.RefObject<{ getValue: () => string } | null>;
  consoleInputValue: string;
  setConsoleInputValue: (value: string) => void;
  consoleOutput: string[];
  setConsoleOutput: (
    output: string[] | ((prevOutput: string[]) => string[])
  ) => void;
  isExecuting: boolean;
  setIsExecuting: (isExecuting: boolean) => void;
  triggerExecution: () => Promise<void>;
  currentJobId: string | null;
  activeFileForExecution: string;
  setActiveFileForExecution: (fileName: string) => void;
}

export interface CodeExecutionProviderProps {
  children: ReactNode;
}

// --- WorkspaceContext ---

export interface CachedWorkspaces {
  userId: string;
  workspaces: WorkspaceSummaryItem[];
}

export interface CachedManifestData {
  manifest: WorkspaceFileManifestItem[];
  version: string | number;
}

export interface InvitationState {
  isProcessing: boolean;
  status: "idle" | "processing" | "success" | "error";
  message: string;
  invitationId: string | null;
  clerkTicket: string | null;
  requiresSignup: boolean;
  requiresProcessing: boolean;
}

export interface WorkspaceContextState {
  workspaces: WorkspaceSummaryItem[];
  selectedWorkspace: WorkspaceSummaryItem | null;
  currentWorkspaceManifest: WorkspaceFileManifestItem[] | null;
  currentWorkspaceVersion: string | number | null;
  manifestAndVersionCache: Record<string, CachedManifestData>;
  fileContentCache: Record<string, Record<string, string | null>>;
  isLoadingWorkspaces: boolean;
  isLoadingManifest: boolean;
  isLoadingWorkspaceContents: boolean;
  isCreatingWorkspace: boolean;
  // Invitation state
  invitation: InvitationState;
}

export interface WorkspaceContextActions {
  selectWorkspace: (workspace: WorkspaceSummaryItem | null) => void;
  refreshWorkspaces: () => Promise<void>;
  createNewWorkspace: (name: string) => Promise<WorkspaceSummaryItem | null>;
  refreshWorkspace: (workspace: WorkspaceSummaryItem) => Promise<void>;
  setWorkspaceVersion: (version: string | number) => void;
  updateFileContent: (filePath: string, newContent: string) => void;
  addFileToCache: (filePath: string) => void;
  addFolderToCache: (folderPath: string) => void;
  renamePathInCache: (oldPath: string, newPath: string) => void;
  removePathFromCache: (path: string) => void;
  updateCurrentWorkspaceManifest: (
    newManifest: ClientSideWorkspaceFileManifestItem[],
  ) => void;
  refreshManifestOnly: (workspace: WorkspaceSummaryItem) => Promise<void>;
  // Invitation handling
  processWorkspaceInvitation: (invitationId: string) => Promise<void>;
}

export type WorkspaceContextType = WorkspaceContextState &
  WorkspaceContextActions; 