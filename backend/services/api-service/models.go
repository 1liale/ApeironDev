package main

// RequestBody struct for the /execute endpoint (public, non-workspace specific)
type RequestBody struct {
	Code     string `json:"code" binding:"required"`
	Language string `json:"language" binding:"required"`
	Input    string `json:"input"`
}

// --- Structs for Workspace Management ---

// Workspace represents a user's workspace in Firestore.
type Workspace struct {
	WorkspaceID      string `json:"workspaceId" firestore:"workspace_id"`
	Name             string `json:"name" firestore:"name"`
	CreatedBy        string `json:"createdBy" firestore:"created_by"`
	CreatedAt        string `json:"createdAt" firestore:"created_at"`                                   // ISO 8601 string
	UpdatedAt        string `json:"updatedAt,omitempty" firestore:"updated_at,omitempty"`              // ISO 8601 string
	WorkspaceVersion string `json:"workspaceVersion,omitempty" firestore:"workspace_version,omitempty"` // Added for OCC
}

// CreateWorkspaceRequest defines the expected request body for creating a new workspace.
type CreateWorkspaceRequest struct {
	Name      string `json:"name" binding:"required"`
	UserEmail string `json:"userEmail,omitempty"`
	UserName  string `json:"userName,omitempty"`
}

// CreateWorkspaceResponse is the response after creating a new workspace.
type CreateWorkspaceResponse struct {
	WorkspaceID    string `json:"workspaceId"`
	Name           string `json:"name"`
	CreatedBy      string `json:"createdBy"`
	CreatedAt      string `json:"createdAt"`      // ISO 8601 string
	InitialVersion string `json:"initialVersion"` // Added initial version
}

// WorkspaceSummary defines the data structure for listing workspaces for a user.
type WorkspaceSummary struct {
	WorkspaceID string `json:"workspaceId"`
	Name        string `json:"name"`
	CreatedBy   string `json:"createdBy"`
	CreatedAt   string `json:"createdAt"` // ISO 8601 string
	UserRole    string `json:"userRole"`
}

// WorkspaceMembership links a user to a workspace with a specific role.
type WorkspaceMembership struct {
	MembershipID string `json:"membershipId" firestore:"membership_id"`
	WorkspaceID  string `json:"workspaceId" firestore:"workspace_id"`
	UserID       string `json:"userId" firestore:"user_id"`
	UserEmail    string `json:"userEmail" firestore:"user_email"`
	UserName     string `json:"userName" firestore:"user_name"`
	Role         string `json:"role" firestore:"role"`
	JoinedAt     string `json:"joinedAt" firestore:"joined_at"` // ISO 8601 string
}

// --- Structs for File Manifest ---

// FileMetadata represents the metadata for a single file within a workspace.
type FileMetadata struct {
	FileID      string `json:"fileId" firestore:"file_id"`
	FilePath    string `json:"filePath" firestore:"file_path"`
	Type        string `json:"type" firestore:"type"` // "file" or "folder"
	R2ObjectKey string `json:"r2ObjectKey,omitempty" firestore:"r2_object_key,omitempty"`
	Size        int64  `json:"size,omitempty" firestore:"size,omitempty"`
	Hash        string `json:"hash,omitempty" firestore:"hash,omitempty"`
	CreatedAt   string `json:"createdAt" firestore:"created_at"`  // ISO 8601 string
	UpdatedAt   string `json:"updatedAt" firestore:"updated_at"`  // ISO 8601 string
	ContentURL  string `json:"contentUrl,omitempty" firestore:"-"` 
}

// WorkspaceManifestResponse is the response for GET /workspaces/:workspaceId/manifest
type WorkspaceManifestResponse struct {
	Manifest         []FileMetadata `json:"manifest"`
	WorkspaceVersion string         `json:"workspaceVersion"`
}

// --- Structs for Sync Endpoint (/workspaces/:workspaceId/sync) ---

// SyncFileClientState represents a single file's state as known by the client.
type SyncFileClientState struct {
	FilePath   string `json:"filePath" binding:"required"`
	Type       string `json:"type" binding:"required"`
	ClientHash string `json:"clientHash,omitempty"`
	Action     string `json:"action" binding:"required"` // "new", "modified", "deleted", "unchanged"
}

// SyncRequest is the request body for POST /api/sync/:workspaceId.
type SyncRequest struct {
	WorkspaceVersion string                `json:"workspaceVersion" binding:"required"`
	Files            []SyncFileClientState `json:"files" binding:"required"`
}

// SyncResponseFileAction represents an action the client needs to take for a file.
type SyncResponseFileAction struct {
	FilePath       string `json:"filePath"`
	Type           string `json:"type"`
	FileID         string `json:"fileId,omitempty"`
	R2ObjectKey    string `json:"r2ObjectKey"`
	ActionRequired string `json:"actionRequired"` // "upload", "delete", "none"
	PresignedURL   string `json:"presignedUrl,omitempty"`
	Message        string `json:"message,omitempty"`
}

// SyncResponse is the response body from POST /api/sync/:workspaceId.
type SyncResponse struct {
	Status              string                   `json:"status"` // "pending_confirmation", "workspace_conflict", "no_changes", "error"
	Actions             []SyncResponseFileAction `json:"actions"`
	NewWorkspaceVersion string                   `json:"newWorkspaceVersion,omitempty"`
	ErrorMessage        string                   `json:"errorMessage,omitempty"`
}

// --- Structs for Confirm Sync Endpoint (/workspaces/:workspaceId/sync/confirm) ---

// FileAction represents the client-confirmed action for a single file.
type FileAction struct {
	FilePath    string `json:"filePath" binding:"required"`
	Type        string `json:"type" binding:"required"`
	FileID      string `json:"fileId" binding:"required"`
	R2ObjectKey string `json:"r2ObjectKey"` // Key for new object in "upsert", old object in "delete"
	Action      string `json:"action" binding:"required"` // "upsert", "delete"
	ClientHash  string `json:"clientHash,omitempty"`      // For "upsert"
	Size        int64  `json:"size,omitempty"`            // For "upsert"
}

// ConfirmSyncRequest is the request body for POST /api/sync/:workspaceId/confirm.
type ConfirmSyncRequest struct {
	WorkspaceVersion string       `json:"workspaceVersion" binding:"required"`
	SyncActions      []FileAction `json:"syncActions" binding:"required"`
}

// ConfirmSyncResponse is the response body for the confirmation step.
type ConfirmSyncResponse struct {
	Status              string `json:"status"` // "success", "error"
	FinalWorkspaceVersion string `json:"finalWorkspaceVersion,omitempty"`
	ErrorMessage        string `json:"errorMessage,omitempty"`
}

// --- Structs for Authenticated Code Execution ---

// ExecuteAuthRequest is the request body for the authenticated code execution endpoint.
type ExecuteAuthRequest struct {
	Language       string `json:"language" binding:"required"`
	EntrypointFile string `json:"entrypointFile" binding:"required"`
	Input          string `json:"input,omitempty"`
}

type ExecuteAuthResponse struct {
	Message                string `json:"message"`
	JobID                  string `json:"job_id"`
	FinalWorkspaceVersion  string `json:"finalWorkspaceVersion,omitempty"`
}

// --- Structs for Jobs & Cloud Tasks (existing, largely unchanged for this refactor scope) ---

// Job struct stores information about a code execution job.
type Job struct {
	Status         string `json:"status" firestore:"status"`
	Code           string `json:"code,omitempty" firestore:"-"`
	Language       string `json:"language" firestore:"language"`
	Input          string `json:"input,omitempty" firestore:"-"`
	Output         string `json:"output,omitempty" firestore:"output,omitempty"`
	Error          string `json:"error,omitempty" firestore:"error,omitempty"`
	SubmittedAt    string `json:"submittedAt" firestore:"submitted_at"`                 // ISO 8601 string
	ExpiresAt      string `json:"expiresAt,omitempty" firestore:"expires_at,omitempty"` // ISO 8601 string
	UserID         string `json:"userID,omitempty" firestore:"user_id,omitempty"`
	WorkspaceID    string `json:"workspaceID,omitempty" firestore:"workspace_id,omitempty"`
	EntrypointFile string `json:"entrypointFile,omitempty" firestore:"entrypoint_file,omitempty"`
	ExecutionType  string `json:"executionType,omitempty" firestore:"execution_type,omitempty"`
}

// CloudTaskPayload is the structure for public code execution.
type CloudTaskPayload struct {
	JobID    string `json:"job_id"`
	Code     string `json:"code"`
	Language string `json:"language"`
	Input    string `json:"input"`
}

// WorkerFile provides the necessary info for the worker to download a file.
type WorkerFile struct {
	R2ObjectKey string `json:"r2_object_key"`
	FilePath    string `json:"file_path"`
}

// CloudTaskAuthPayload is used for authenticated code execution via Cloud Tasks.
type CloudTaskAuthPayload struct {
	JobID          string       `json:"job_id"`
	WorkspaceID    string       `json:"workspace_id"`
	EntrypointFile string       `json:"entrypoint_file"`
	Language       string       `json:"language"`
	Input          string       `json:"input,omitempty"`
	R2BucketName   string       `json:"r2_bucket_name"`
	Files          []WorkerFile `json:"files"`
}

// RAG Query payload for Cloud Tasks
type RagQueryPayload struct {
	JobID       string `json:"job_id"`
	UserID      string `json:"user_id"`
	WorkspaceID string `json:"workspace_id"`
	Query       string `json:"query"`
}

// RAG Indexing payload for Cloud Tasks
type RagIndexingPayload struct {
	JobID       string   `json:"job_id"`
	WorkspaceID string   `json:"workspace_id"`
	FilePaths   []string `json:"file_paths"`
}

// RAG Query request from frontend
type RagQueryRequest struct {
	Query       string `json:"query" binding:"required"`
	WorkspaceID string `json:"workspaceId" binding:"required"`
} 