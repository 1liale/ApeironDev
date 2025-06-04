package main

import (
	"time"
	// Add other imports here if structs use types from other packages, e.g., cloudfirestore.Timestamp if not using time.Time directly
)

// RequestBody struct for the /execute endpoint
type RequestBody struct {
	Code     string `json:"code" binding:"required"`
	Language string `json:"language" binding:"required"`
	Input    string `json:"input"` // Optional input field
}

// --- Structs for Batch Sync Confirmation ---

// ConfirmSyncFileItem represents the client-reported status of a single file operation (upload or delete).
type ConfirmSyncFileItem struct {
	FilePath        string `json:"filePath" binding:"required"`
	R2ObjectKey     string `json:"r2ObjectKey" binding:"required"`      // The R2 key for the object
	ActionConfirmed string `json:"actionConfirmed" binding:"required"`  // "uploaded" or "deleted"
	Status          string `json:"status" binding:"required"`          // "success" or "failed"
	ClientHash      string `json:"clientHash,omitempty"`             // Hash of the uploaded content (for action:"uploaded", status:"success")
	Size            int64  `json:"size,omitempty"`                   // Size of the uploaded file (for action:"uploaded", status:"success")
	ContentType     string `json:"contentType,omitempty"`           // ContentType of the uploaded file (for action:"uploaded", status:"success")
	Error           string `json:"error,omitempty"`                  // Error message if status is "failed"
}

// ConfirmSyncRequest is the request body for POST /api/sync/:workspaceId/confirm for batch operations.
type ConfirmSyncRequest struct {
	Files []ConfirmSyncFileItem `json:"files" binding:"required"`
}

// ConfirmSyncResponseItem details the server-side outcome of confirming a single file operation.
type ConfirmSyncResponseItem struct {
	FilePath string `json:"filePath"`
	Status   string `json:"status"` // e.g., "metadata_updated", "metadata_created", "metadata_deleted", "confirmation_failed", "invalid_action"
	FileID   string `json:"fileId,omitempty"`
	Message  string `json:"message,omitempty"`
}

// ConfirmSyncResponse is the response body for batch confirmation.
type ConfirmSyncResponse struct {
	Results []ConfirmSyncResponseItem `json:"results"`
}

// FileMetadata struct for storing file information in Firestore.
type FileMetadata struct {
	FileID      string    `firestore:"fileId"`
	FileName    string    `firestore:"fileName"`
	FilePath    string    `firestore:"filePath"`
	R2ObjectKey string    `firestore:"r2ObjectKey"`
	Size        int64     `firestore:"size"`
	ContentType string    `firestore:"contentType"`
	UserID      string    `firestore:"userId"`
	WorkspaceID string    `firestore:"workspaceId"`
	Hash        string    `firestore:"hash,omitempty" json:"hash,omitempty"` // SHA-256 hash of the file content
	CreatedAt   time.Time `firestore:"createdAt"`
	UpdatedAt   time.Time `firestore:"updatedAt"`
	DownloadURL string    `json:"downloadUrl,omitempty" firestore:"-"` // For serving pre-signed GET URLs
}

// Job struct stores information about a code execution job.
type Job struct {
	Status         string    `json:"status" firestore:"status"`
	Code           string    `json:"code,omitempty" firestore:"-"` // Omit from Firestore
	Language       string    `json:"language" firestore:"language"`
	Input          string    `json:"input,omitempty" firestore:"-"` // Omit from Firestore
	Output         string    `json:"output,omitempty" firestore:"output,omitempty"`
	Error          string    `json:"error,omitempty" firestore:"error,omitempty"`
	SubmittedAt    time.Time `json:"submittedAt" firestore:"submitted_at"`
	ExpiresAt      time.Time `json:"expiresAt,omitempty" firestore:"expires_at,omitempty"`       // TTL field
	UserID         string    `json:"userID,omitempty" firestore:"user_id,omitempty"`
	WorkspaceID    string    `json:"workspaceID,omitempty" firestore:"workspace_id,omitempty"`
	EntrypointFile string    `json:"entrypointFile,omitempty" firestore:"entrypoint_file,omitempty"`
	ExecutionType  string    `json:"executionType,omitempty" firestore:"execution_type,omitempty"`
}

// CloudTaskPayload is the structure of the JSON payload sent to the Cloud Task for code execution.
type CloudTaskPayload struct {
	JobID    string `json:"job_id"`
	Code     string `json:"code"`
	Language string `json:"language"`
	Input    string `json:"input"`
}

// --- Structs for Consolidated Sync Endpoint --- 

// SyncFileClientState represents a single file's state as known by the client.
type SyncFileClientState struct {
	FilePath   string `json:"filePath" binding:"required"`
	ClientHash string `json:"clientHash,omitempty"` // Omitted for "deleted" action
	Action     string `json:"action" binding:"required"`   // e.g., "new", "modified", "unchanged", "deleted"
}

// SyncRequest is the request body for POST /api/sync/:workspaceId.
type SyncRequest struct {
	Files []SyncFileClientState `json:"files" binding:"required"`
}

// SyncResponseFileAction represents an action the client needs to take for a file.
type SyncResponseFileAction struct {
	FilePath            string `json:"filePath"`
	R2ObjectKey         string `json:"r2ObjectKey"`
	ActionRequired      string `json:"actionRequired"` // e.g., "upload", "delete", "none"
	PresignedURL        string `json:"presignedUrl,omitempty"`
	ClientHashForUpload string `json:"clientHashForUpload,omitempty"` // Client's hash for the file to be uploaded, returned for confirm step
	Message             string `json:"message,omitempty"`
}

// SyncResponse is the response body from POST /api/sync/:workspaceId.
type SyncResponse struct {
	Actions []SyncResponseFileAction `json:"actions"`
	// ComputeToken string `json:"computeToken,omitempty"` // Optional, as per user plan
}

// ExecuteAuthRequest is the request body for the authenticated code execution endpoint.
type ExecuteAuthRequest struct {
	Language       string `json:"language" binding:"required"`
	EntrypointFile string `json:"entrypointFile" binding:"required"`
	Input          string `json:"input,omitempty"` // Optional input
	// WorkspaceID will be from path param, not in the body for the POST request.
}

// CloudTaskAuthPayload is used for authenticated code execution via Cloud Tasks.
// It instructs the worker to fetch code from R2.
type CloudTaskAuthPayload struct {
	JobID          string `json:"job_id"`
	WorkspaceID    string `json:"workspace_id"`
	EntrypointFile string `json:"entrypoint_file"`
	Language       string `json:"language"`
	Input          string `json:"input,omitempty"`      // Optional input
	R2BucketName   string `json:"r2_bucket_name"` // Worker needs to know the bucket
} 