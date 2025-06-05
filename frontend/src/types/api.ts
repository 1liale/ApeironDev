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

export interface CreateWorkspaceResponse { // Renamed from Workspace to be more specific
  workspaceId: string;
  name:string;
  createdBy: string;
  createdAt: string; // ISO 8601 date string
  initialVersion: string | number; // Added initial version for new workspaces
}

// Represents the summary of a workspace for listing purposes
export interface WorkspaceSummaryItem {
  workspaceId: string;
  name: string;
  createdBy: string;
  createdAt: string; // ISO 8601 date string
  userRole: string;  // Role of the current user in this workspace
  // Consider adding currentVersion here if useful for summaries before selection
}

// ====== File, Manifest, and Content Types ======
export interface WorkspaceFileManifestItem {
  filePath: string; // Changed from path for clarity
  r2ObjectKey: string;
  size?: number;
  contentType?: string;
  hash?: string; // Hash of the file content
  contentUrl: string; // Presigned URL to fetch content directly from R2 - replacing downloadUrl
}

export interface WorkspaceManifestResponse {
  manifest: WorkspaceFileManifestItem[];
  workspaceVersion: string | number; // Version of the workspace manifest itself
}

// Represents client's view of a single file's content (primarily for local state)
export interface ClientFileState {
  filePath: string;
  content: string;
  // Potentially add localHash, isDirty, etc.
}


// ====== Sync Process Types (Client -> Server) ======

// Represents the state of a file as known by the client, to be sent to the /sync endpoint.
export interface SyncFileClientStateAPI {
  filePath: string;
  clientHash: string; // Hash of the current client-side content for 'new' or 'modified' files.
  // lastKnownServerHash?: string; // Optional: Could be useful for more advanced sync logic
  action: 'new' | 'modified' | 'deleted' | 'unchanged';
}

export interface SyncRequestAPI {
  workspaceVersion: string | number; // Client's current workspace version for OCC
  files: SyncFileClientStateAPI[];
}

// ====== Sync Process Types (Server -> Client) ======

// Represents an action the client needs to take for a file, received from /sync endpoint.
export interface SyncResponseFileActionAPI {
  filePath: string;
  r2ObjectKey?: string; // May not be needed if client doesn't construct this
  actionRequired: 'upload' | 'delete' | 'none' | 'conflict'; // Added 'conflict'
  presignedUrl?: string; // For uploads
  serverVersion?: string | number; // If conflict, server provides current version
  serverContent?: string; // Optional: If conflict, server provides current content for merging
  message?: string;
}

export interface SyncResponseAPI {
  newWorkspaceVersion?: string | number; // The new version after successful preliminary sync
  actions: SyncResponseFileActionAPI[];
  // Global status like 'needs_confirmation', 'conflict', 'success_no_changes'
  status: 'pending_confirmation' | 'workspace_conflict' | 'no_changes' | 'error'; 
  errorMessage?: string;
}

// ====== Confirm Sync Process Types ======

// Represents a single item in the /sync/confirm request.
export interface ConfirmSyncFileItemAPI {
  filePath: string;
  r2ObjectKey: string; // Provided by server in SyncResponseFileActionAPI if action is 'upload'
  actionConfirmed: 'uploaded' | 'deleted';
  status: 'success' | 'failed'; // Status of the operation (e.g., upload to R2)
  clientHash?: string; // Hash of the content that was successfully uploaded.
  size?: number;
  contentType?: string;
  error?: string; // Error message if R2 operation failed for this specific file.
}

export interface ConfirmSyncRequestAPI {
  workspaceVersion: string | number; // The version server provided in SyncResponseAPI
  files: ConfirmSyncFileItemAPI[];
}

// Represents a single item in the /sync/confirm response.
export interface ConfirmSyncResponseItemAPI {
  filePath: string;
  status: string; // e.g., "metadata_updated", "metadata_created", "metadata_deleted", etc.
  fileId?: string; // If you use persistent file IDs in a DB
  message?: string;
}

export interface ConfirmSyncResponseAPI {
  finalWorkspaceVersion: string | number; // The definitive new version after all confirmations
  results: ConfirmSyncResponseItemAPI[];
  // Overall status: 'success', 'partial_failure', 'total_failure'
  status: 'success' | 'partial_failure' | 'error'; 
  errorMessage?: string;
}


// ====== Authenticated Execution ======
export interface ExecuteAuthRequestBody {
  language: string;
  entrypointFile: string; // file path relative to workspace root
  input?: string;
  // Potentially: workspaceId if not inferred from route/token scope
} 