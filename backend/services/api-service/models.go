package main

import (
	"time"
)

// RequestBody struct for the /execute endpoint (public, non-workspace specific)
type RequestBody struct {
	Code     string `json:"code" binding:"required"`
	Language string `json:"language" binding:"required"`
	Input    string `json:"input"`
}

// --- Structs for Workspace Management ---

// Workspace represents a user's workspace in Firestore.
type Workspace struct {
	WorkspaceID      string    `json:"workspaceId" firestore:"workspace_id"`
	Name             string    `json:"name" firestore:"name"`
	CreatedBy        string    `json:"createdBy" firestore:"created_by"`
	CreatedAt        time.Time `json:"createdAt" firestore:"created_at"`
	WorkspaceVersion string    `json:"workspaceVersion,omitempty" firestore:"workspace_version,omitempty"` // Added for OCC
}

// CreateWorkspaceRequest defines the expected request body for creating a new workspace.
type CreateWorkspaceRequest struct {
	Name string `json:"name" binding:"required"`
}

// CreateWorkspaceResponse is the response after creating a new workspace.
type CreateWorkspaceResponse struct {
	WorkspaceID    string    `json:"workspaceId"`
	Name           string    `json:"name"`
	CreatedBy      string    `json:"createdBy"`
	CreatedAt      time.Time `json:"createdAt"`
	InitialVersion string    `json:"initialVersion"` // Added initial version
}

// WorkspaceSummary defines the data structure for listing workspaces for a user.
type WorkspaceSummary struct {
	WorkspaceID string    `json:"workspaceId"`
	Name        string    `json:"name"`
	CreatedBy   string    `json:"createdBy"`
	CreatedAt   time.Time `json:"createdAt"`
	UserRole    string    `json:"userRole"`
}

// WorkspaceMembership links a user to a workspace with a specific role.
type WorkspaceMembership struct {
	MembershipID string    `json:"membershipId" firestore:"membership_id"`
	WorkspaceID  string    `json:"workspaceId" firestore:"workspace_id"`
	UserID       string    `json:"userId" firestore:"user_id"`
	Role         string    `json:"role" firestore:"role"`
	JoinedAt     time.Time `json:"joinedAt" firestore:"joined_at"`
}

// --- Structs for File Manifest --- 

// FileMetadata represents the metadata for a single file within a workspace.
type FileMetadata struct {
	FileID        string    `json:"-" firestore:"file_id"`
	FileName      string    `json:"-" firestore:"file_name"`
	FilePath      string    `json:"filePath" firestore:"file_path"`
	R2ObjectKey   string    `json:"r2ObjectKey" firestore:"r2_object_key"`
	Size          int64     `json:"size,omitempty" firestore:"size,omitempty"`
	ContentType   string    `json:"contentType,omitempty" firestore:"content_type,omitempty"`
	UserID        string    `json:"-" firestore:"user_id"`
	WorkspaceID   string    `json:"-" firestore:"workspace_id"`
	Hash          string    `json:"hash,omitempty" firestore:"hash,omitempty"`
	CreatedAt     time.Time `json:"-" firestore:"created_at"`
	UpdatedAt     time.Time `json:"-" firestore:"updated_at"`
	ContentURL    string    `json:"contentUrl,omitempty" firestore:"-"` // Renamed from DownloadURL
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
	ClientHash string `json:"clientHash,omitempty"`
	Action     string `json:"action" binding:"required"`
}

// SyncRequest is the request body for POST /api/sync/:workspaceId.
type SyncRequest struct {
	WorkspaceVersion string                `json:"workspaceVersion" binding:"required"` // Added client's current workspace version
	Files            []SyncFileClientState `json:"files" binding:"required"`
}

// SyncResponseFileAction represents an action the client needs to take for a file.
type SyncResponseFileAction struct {
	FilePath       string `json:"filePath"`
	R2ObjectKey    string `json:"r2ObjectKey"`
	ActionRequired string `json:"actionRequired"` // e.g., "upload", "delete", "none", "conflict"
	PresignedURL   string `json:"presignedUrl,omitempty"`
	Message        string `json:"message,omitempty"`
	ServerVersion  string `json:"serverVersion,omitempty"` // For conflict resolution
}

// SyncResponse is the response body from POST /api/sync/:workspaceId.
type SyncResponse struct {
	Status              string                   `json:"status"` // "pending_confirmation", "workspace_conflict", "no_changes", "error"
	Actions             []SyncResponseFileAction `json:"actions"`
	NewWorkspaceVersion string                   `json:"newWorkspaceVersion,omitempty"` // Tentative new version
	ErrorMessage        string                   `json:"errorMessage,omitempty"`
}

// --- Structs for Confirm Sync Endpoint (/workspaces/:workspaceId/sync/confirm) ---

// ConfirmSyncFileItem represents the client-reported status of a single file operation.
type ConfirmSyncFileItem struct {
	FilePath        string `json:"filePath" binding:"required"`
	R2ObjectKey     string `json:"r2ObjectKey" binding:"required"`
	ActionConfirmed string `json:"actionConfirmed" binding:"required"`
	Status          string `json:"status" binding:"required"`
	ClientHash      string `json:"clientHash,omitempty"`
	Size            int64  `json:"size,omitempty"`
	ContentType     string `json:"contentType,omitempty"`
	Error           string `json:"error,omitempty"`
}

// ConfirmSyncRequest is the request body for POST /api/sync/:workspaceId/confirm.
type ConfirmSyncRequest struct {
	WorkspaceVersion string                `json:"workspaceVersion" binding:"required"` // The NewWorkspaceVersion from /sync response
	Files            []ConfirmSyncFileItem `json:"files" binding:"required"`
}

// ConfirmSyncResponseItem details the server-side outcome of confirming a single file operation.
type ConfirmSyncResponseItem struct {
	FilePath string `json:"filePath"`
	Status   string `json:"status"`
	FileID   string `json:"fileId,omitempty"`
	Message  string `json:"message,omitempty"`
}

// ConfirmSyncResponse is the response body for batch confirmation.
type ConfirmSyncResponse struct {
	Status                string                    `json:"status"` // "success", "partial_failure", "error"
	Results               []ConfirmSyncResponseItem `json:"results"`
	FinalWorkspaceVersion string                    `json:"finalWorkspaceVersion,omitempty"` // Final new version
	ErrorMessage          string                    `json:"errorMessage,omitempty"`
}

// --- Structs for Authenticated Code Execution --- 

// ExecuteAuthRequest is the request body for the authenticated code execution endpoint.
type ExecuteAuthRequest struct {
	Language       string `json:"language" binding:"required"`
	EntrypointFile string `json:"entrypointFile" binding:"required"`
	Input          string `json:"input,omitempty"`
}

// --- Structs for Jobs & Cloud Tasks (existing, largely unchanged for this refactor scope) ---

// Job struct stores information about a code execution job.
type Job struct {
	Status         string    `json:"status" firestore:"status"`
	Code           string    `json:"code,omitempty" firestore:"-"`
	Language       string    `json:"language" firestore:"language"`
	Input          string    `json:"input,omitempty" firestore:"-"`
	Output         string    `json:"output,omitempty" firestore:"output,omitempty"`
	Error          string    `json:"error,omitempty" firestore:"error,omitempty"`
	SubmittedAt    time.Time `json:"submittedAt" firestore:"submitted_at"`
	ExpiresAt      time.Time `json:"expiresAt,omitempty" firestore:"expires_at,omitempty"`
	UserID         string    `json:"userID,omitempty" firestore:"user_id,omitempty"`
	WorkspaceID    string    `json:"workspaceID,omitempty" firestore:"workspace_id,omitempty"`
	EntrypointFile string    `json:"entrypointFile,omitempty" firestore:"entrypoint_file,omitempty"`
	ExecutionType  string    `json:"executionType,omitempty" firestore:"execution_type,omitempty"`
}

// CloudTaskPayload is the structure for public code execution.
type CloudTaskPayload struct {
	JobID    string `json:"job_id"`
	Code     string `json:"code"`
	Language string `json:"language"`
	Input    string `json:"input"`
}

// CloudTaskAuthPayload is used for authenticated code execution via Cloud Tasks.
type CloudTaskAuthPayload struct {
	JobID          string `json:"job_id"`
	WorkspaceID    string `json:"workspace_id"`
	EntrypointFile string `json:"entrypoint_file"`
	Language       string `json:"language"`
	Input          string `json:"input,omitempty"`
	R2BucketName   string `json:"r2_bucket_name"`
} 