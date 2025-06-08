// ====== Execution & Job Types ======
export interface ExecuteRequestBody {
  code: string;
  language: string;
  input?: string;
}

export interface ExecuteResponse {
  job_id: string;
  error?: string;
}

export interface JobResult {
  job_id: string;
  status: "queued" | "processing" | "completed" | "failed";
  code: string;
  language: string;
  input?: string;
  submitted_at: string; // ISO 8601 date string
  processing_started_at?: string | null; // ISO 8601 date string
  completed_at?: string | null; // ISO 8601 date string
  output?: string;
  error?: string;
}

// ====== Workspace Types ======
export interface CreateWorkspaceRequestBody {
  name: string;
}

export interface CreateWorkspaceResponse {
  workspaceId: string;
  name: string;
  createdBy: string;
  createdAt: string; // ISO 8601 date string
  initialVersion: string;
}

// Represents the summary of a workspace for listing purposes
export interface WorkspaceSummaryItem {
  workspaceId: string;
  name: string;
  createdBy: string;
  createdAt: string; // ISO 8601 date string
  userRole: string;  // Role of the current user in this workspace
}

// ====== File and Manifest Types ======
export interface WorkspaceFileManifestItem {
  fileId: string;
  filePath: string;
  type: 'file' | 'folder';
  r2ObjectKey: string;
  size?: number;
  hash?: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  contentUrl: string; // Presigned URL
}

export interface WorkspaceManifestResponse {
  manifest: WorkspaceFileManifestItem[];
  workspaceVersion: string;
}

// Represents client's view of a single file's content (primarily for local state)
export interface ClientFileState {
  filePath: string;
  type: 'file' | 'folder';
  content: string | null;
}

// ====== Sync Process Types (Phase 1: Client -> Server -> Client) ======

// Represents the state of a file as known by the client, to be sent to the /sync endpoint.
export interface SyncFileClientStateAPI {
  filePath: string;
  type: 'file' | 'folder';
  clientHash?: string;
  action: "new" | "modified" | "deleted" | "unchanged";
}

export interface SyncRequestAPI {
  workspaceVersion: string;
  files: SyncFileClientStateAPI[];
}

// Represents an action the client needs to take for a file, received from /sync endpoint.
export interface SyncResponseFileActionAPI {
  filePath: string;
  type: 'file' | 'folder';
  fileId?: string;
  r2ObjectKey: string;
  actionRequired: "upload" | "delete" | "none";
  presignedUrl?: string;
  message?: string;
}

export interface SyncResponseAPI {
  status: "pending_confirmation" | "workspace_conflict" | "no_changes" | "error";
  actions: SyncResponseFileActionAPI[];
  newWorkspaceVersion?: string;
  errorMessage?: string;
}

// ====== Sync Process Types (Phase 2: Client -> Server) ======

export interface FileActionAPI {
  filePath: string;
  type: 'file' | 'folder';
  fileId: string;
  r2ObjectKey: string;
  action: "upsert" | "delete";
  clientHash?: string; // For "upsert"
  size?: number; // For "upsert"
}

export interface ConfirmSyncRequestAPI {
  workspaceVersion: string;
  syncActions: FileActionAPI[];
}

export interface ConfirmSyncResponseAPI {
  status: "success" | "error";
  finalWorkspaceVersion?: string;
  errorMessage?: string;
}

// ====== Authenticated Execution ======
export interface ExecuteAuthRequestBody {
  language: string;
  entrypointFile: string;
  input?: string;
}

export interface ExecuteCodeAuthResponse {
  message: string;
  job_id: string;
  finalWorkspaceVersion?: string;
}

export interface ClientSideWorkspaceFileManifestItem {
  filePath: string;
  type: "file" | "folder";
}

export interface WorkspaceManifestWithVersion {
  manifest: WorkspaceFileManifestItem[];
  workspaceVersion: string;
} 