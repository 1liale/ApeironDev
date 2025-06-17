package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	cloudtasks "cloud.google.com/go/cloudtasks/apiv2"
	cloudtaskspb "cloud.google.com/go/cloudtasks/apiv2/cloudtaskspb"
	"cloud.google.com/go/firestore"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	log "github.com/sirupsen/logrus"
	"google.golang.org/api/iterator"
)

// checkWorkspaceMembership queries Firestore to see if a user is a member of a workspace.
func checkWorkspaceMembership(ctx context.Context, fsClient *firestore.Client, userID string, workspaceID string) (bool, error) {
	logCtx := log.WithFields(log.Fields{
		"user_id":      userID,
		"workspace_id": workspaceID,
		"function":     "checkWorkspaceMembership",
	})

	query := fsClient.Collection("workspace_memberships").
		Where("user_id", "==", userID).
		Where("workspace_id", "==", workspaceID).
		Limit(1)

	iter := query.Documents(ctx)
	defer iter.Stop()

	_, err := iter.Next()
	if err == iterator.Done {
		logCtx.Info("User is not a member of the workspace.")
		return false, nil // No document found, so user is not a member
	}
	if err != nil {
		logCtx.WithError(err).Error("Failed to query workspace membership.")
		return false, fmt.Errorf("failed to query workspace membership: %w", err)
	}

	logCtx.Info("User is a member of the workspace.")
	return true, nil // Document found, user is a member
}

// ApiController holds dependencies for HTTP handlers.
type ApiController struct {
	FirestoreClient         *firestore.Client
	TasksClient             *cloudtasks.Client
	R2PresignClient         *s3.PresignClient
	R2S3Client              *s3.Client
	R2BucketName            string
	Services                ServicesConfig
	AppConfig               *AppConfig
	FirestoreJobsCollection string
}

// NewApiController creates a new ApiController.
func NewApiController(fs *firestore.Client, tasksClient *cloudtasks.Client, presignClient *s3.PresignClient, r2S3Client *s3.Client, r2BucketName string, appConfig *AppConfig, firestoreJobsCollection string) *ApiController {
	return &ApiController{
		FirestoreClient:         fs,
		TasksClient:             tasksClient,
		R2PresignClient:         presignClient,
		R2S3Client:              r2S3Client,
		R2BucketName:            r2BucketName,
		Services:                appConfig.Services,
		AppConfig:               appConfig,
		FirestoreJobsCollection: firestoreJobsCollection,
	}
}

// HandleSync processes a batch of client file states, compares with Firestore, 
// and returns necessary actions (like generating pre-signed URLs for uploads).
// This is phase 1 of 2PC.
func (ac *ApiController) HandleSync(c *gin.Context) {
	workspaceID := c.Param("workspaceId")
	userID := c.GetString("userID") // Get userID from context set by AuthMiddleware
	if userID == "" {
		log.Error("UserID not found in context or is empty after auth middleware. This should not happen if middleware is effective.")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "User authentication error"})
		return
	}

	logCtx := log.WithFields(log.Fields{
		"workspace_id": workspaceID,
		"user_id":      userID,
		"handler":      "HandleSync",
	})

	// Authorization check
	isMember, err := checkWorkspaceMembership(c.Request.Context(), ac.FirestoreClient, userID, workspaceID)
	if err != nil {
		logCtx.WithError(err).Error("Workspace membership check failed.")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to verify workspace membership"})
		return
	}
	if !isMember {
		logCtx.Warn("User does not have access to this workspace.")
		c.JSON(http.StatusForbidden, gin.H{"error": "User does not have access to this workspace"})
		return
	}
	logCtx.Info("User authorized for workspace access.") // Log successful authorization

	var req SyncRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		logCtx.WithError(err).Warn("Invalid request body")
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request: " + err.Error()})
		return
	}

	if len(req.Files) == 0 {
		logCtx.Info("Request received with no files to sync.")
		c.JSON(http.StatusOK, SyncResponse{Actions: []SyncResponseFileAction{}})
		return
	}

	ctx := c.Request.Context()

	wsDocRef := ac.FirestoreClient.Collection("workspaces").Doc(workspaceID)
	wsDocSnap, err := wsDocRef.Get(ctx)
	if err != nil {
		logCtx.WithError(err).Errorf("Failed to get workspace %s for OCC check", workspaceID)
		c.JSON(http.StatusNotFound, gin.H{"error": "Workspace not found for sync"})
		return
	}
	var currentServerWorkspace Workspace
	if err := wsDocSnap.DataTo(&currentServerWorkspace); err != nil {
		logCtx.WithError(err).Errorf("Failed to parse workspace data for %s (OCC check)", workspaceID)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to parse server workspace data"})
		return
	}

	if req.WorkspaceVersion != currentServerWorkspace.WorkspaceVersion {
		logCtx.Warnf("Workspace version conflict. Client: %s, Server: %s", req.WorkspaceVersion, currentServerWorkspace.WorkspaceVersion)
		c.JSON(http.StatusConflict, SyncResponse{
			Status:              "workspace_conflict",
			Actions:             []SyncResponseFileAction{},
			NewWorkspaceVersion: currentServerWorkspace.WorkspaceVersion,
			ErrorMessage:        "Workspace version conflict. Please refresh.",
		})
		return
	}

	responseActions := make([]SyncResponseFileAction, 0, len(req.Files))
	presignDuration := 15 * time.Minute
	filesCollectionPath := fmt.Sprintf("workspaces/%s/files", workspaceID)

	for _, clientFile := range req.Files {
		currentAction := SyncResponseFileAction{
			FilePath: clientFile.FilePath,
			Type:     clientFile.Type,
		}
		itemLogCtx := logCtx.WithField("filePath", clientFile.FilePath)

		switch clientFile.Action {
		case "new", "modified":
			var serverMeta FileMetadata
			foundServerMeta := false
			serverHash := ""
			fileID := ""
			r2ObjectKey := ""

			query := ac.FirestoreClient.Collection(filesCollectionPath).Where("file_path", "==", clientFile.FilePath).Limit(1)
			docs, err := query.Documents(ctx).GetAll()

			if err != nil {
				itemLogCtx.WithError(err).Error("Firestore query failed for existing file metadata.")
			} else if len(docs) > 0 {
				if err := docs[0].DataTo(&serverMeta); err == nil {
					foundServerMeta = true
					serverHash = serverMeta.Hash
					fileID = serverMeta.FileID // Use existing FileID
				} else {
					itemLogCtx.WithError(err).Error("Error unmarshalling Firestore data for existing file.")
				}
			}

			// For folders, we only care if they are new. "modified" doesn't apply.
			if clientFile.Type == "folder" {
				if clientFile.Action == "new" && !foundServerMeta {
					fileID = uuid.New().String()
					// Generate R2ObjectKey for folders (even though we don't store anything in R2)
					r2ObjectKey = fmt.Sprintf("workspaces/%s/folders/%s", workspaceID, fileID)
					currentAction.ActionRequired = "upload" // This signals the client to include it in the confirm step
					itemLogCtx.Info("New folder identified. Flagging for metadata creation.")
				} else {
					currentAction.ActionRequired = "none"
					// For existing folders, get the existing metadata
					if foundServerMeta {
						fileID = serverMeta.FileID
						r2ObjectKey = serverMeta.R2ObjectKey
					}
				}
				currentAction.FileID = fileID
				currentAction.R2ObjectKey = r2ObjectKey
				responseActions = append(responseActions, currentAction)
				continue // Go to next file
			}

			// --- File-specific logic from here ---
			needsUpload := clientFile.Action == "new" || !foundServerMeta || (clientFile.Action == "modified" && clientFile.ClientHash != serverHash)

			if needsUpload {
				if fileID == "" {
					fileID = uuid.New().String()
					itemLogCtx.Infof("Generated new FileID: %s", fileID)
				}

				fileNameOnly := filepath.Base(clientFile.FilePath)
				r2ObjectKey = fmt.Sprintf("workspaces/%s/files/%s/%s", workspaceID, fileID, fileNameOnly)

				presignedPutURL, presignErr := ac.R2PresignClient.PresignPutObject(ctx, &s3.PutObjectInput{
					Bucket: aws.String(ac.R2BucketName),
					Key:    aws.String(r2ObjectKey),
				}, func(po *s3.PresignOptions) {
					po.Expires = presignDuration
				})
				if presignErr != nil {
					itemLogCtx.WithError(presignErr).Error("Failed to generate PUT URL for sync.")
					currentAction.ActionRequired = "none"
					currentAction.Message = "Error generating upload URL"
				} else {
					currentAction.ActionRequired = "upload"
					currentAction.PresignedURL = presignedPutURL.URL
				}
			} else {
				currentAction.ActionRequired = "none"
				currentAction.Message = "File up to date"
				r2ObjectKey = serverMeta.R2ObjectKey // carry over existing key if no upload needed
			}
			currentAction.FileID = fileID
			currentAction.R2ObjectKey = r2ObjectKey

		case "deleted":
			query := ac.FirestoreClient.Collection(filesCollectionPath).Where("file_path", "==", clientFile.FilePath).Limit(1)
			docs, err := query.Documents(ctx).GetAll()
			if err != nil || len(docs) == 0 {
				itemLogCtx.WithError(err).Warn("File metadata not found for deletion.")
				currentAction.ActionRequired = "none"
				currentAction.Message = "File to delete not found on server."
			} else {
				var serverMeta FileMetadata
				if err := docs[0].DataTo(&serverMeta); err == nil {
					currentAction.FileID = serverMeta.FileID
					currentAction.R2ObjectKey = serverMeta.R2ObjectKey
					currentAction.ActionRequired = "delete"
					itemLogCtx.Info("Marked for deletion. Server will delete on confirm.")
				} else {
					itemLogCtx.WithError(err).Error("Error unmarshalling Firestore data for file to delete.")
					currentAction.ActionRequired = "none"
					currentAction.Message = "Server error processing delete request."
				}
			}

		case "unchanged":
			currentAction.ActionRequired = "none"
			currentAction.Message = "File unchanged as per client"
			query := ac.FirestoreClient.Collection(filesCollectionPath).Where("file_path", "==", clientFile.FilePath).Limit(1)
			docs, err := query.Documents(ctx).GetAll()
			if err == nil && len(docs) > 0 {
				var serverMeta FileMetadata
				if docs[0].DataTo(&serverMeta) == nil {
					currentAction.FileID = serverMeta.FileID
					currentAction.R2ObjectKey = serverMeta.R2ObjectKey
				}
			}

		default:
			itemLogCtx.WithField("action", clientFile.Action).Warn("Unknown action in sync request for file.")
			currentAction.ActionRequired = "none"
			currentAction.Message = "Unknown action specified"
		}
		responseActions = append(responseActions, currentAction)
	}

	var newTentativeVersion string
	currentVersionStr := currentServerWorkspace.WorkspaceVersion
	if currentVersionStr == "" {
		// This case implies an unversioned workspace on the server.
		// If req.WorkspaceVersion (client's version) was also "", the OCC check above passed.
		// So, this can be considered the first versioning action.
		newTentativeVersion = "1"
		logCtx.Infof("Workspace %s is currently unversioned. Initializing tentative version to '1'.", workspaceID)
	} else {
		currentVersionInt, err := strconv.Atoi(currentVersionStr)
		if err != nil {
			logCtx.WithError(err).Errorf("Failed to parse current workspace version '%s' to int for incrementing. Workspace ID: %s", currentVersionStr, workspaceID)
			c.JSON(http.StatusInternalServerError, SyncResponse{
				Status:       "error",
				Actions:      responseActions, // Send actions processed so far, though client should probably discard on error
				ErrorMessage: fmt.Sprintf("Server error: Invalid current workspace version format ('%s') on workspace %s. Cannot proceed with sync.", currentVersionStr, workspaceID),
			})
			return
		}
		newTentativeVersion = strconv.Itoa(currentVersionInt + 1)
		logCtx.Infof("Incremented workspace version from '%s' to tentative '%s' for workspace %s.", currentVersionStr, newTentativeVersion, workspaceID)
	}

	// If no files were in the request, but the version check passed, it's "no_changes".
	if len(req.Files) == 0 {
		logCtx.Info("HandleSync: No files in request, version matches. Responding with no_changes.")
		c.JSON(http.StatusOK, SyncResponse{
			Status:              "no_changes",
			Actions:             []SyncResponseFileAction{},
			NewWorkspaceVersion: currentServerWorkspace.WorkspaceVersion, // Return current server version
		})
		return
	}

	// Check if any actual changes are proposed by the client for files that require action
	actualChangesProposed := false
	for _, action := range responseActions {
		if action.ActionRequired == "upload" || action.ActionRequired == "delete" {
			actualChangesProposed = true
			break
		}
	}

	if !actualChangesProposed {
		logCtx.Info("HandleSync: No effective changes required after processing files (all 'none' or client-side issues).")
		c.JSON(http.StatusOK, SyncResponse{
			Status:              "no_changes",
			Actions:             responseActions, // Return the actions, even if they are all 'none'
			NewWorkspaceVersion: currentServerWorkspace.WorkspaceVersion, // No version change if no effective file changes
		})
		return
	}

	logCtx.WithField("processed_files_count", len(req.Files)).WithField("new_tentative_version", newTentativeVersion).Info("HandleSync request processed, pending confirmation.")
	c.JSON(http.StatusOK, SyncResponse{
		Status:              "pending_confirmation",
		Actions:             responseActions,
		NewWorkspaceVersion: newTentativeVersion,
	})
}

// ConfirmSync handles the commit phase of the 2PC file synchronization.
func (ac *ApiController) ConfirmSync(c *gin.Context) {
	workspaceID := c.Param("workspaceId")
	userID := c.GetString("userID")

	ctx := c.Request.Context()
	logCtx := log.WithFields(log.Fields{
		"workspace_id": workspaceID,
		"user_id":      userID,
		"handler":      "ConfirmSync",
	})

	isMember, err := checkWorkspaceMembership(ctx, ac.FirestoreClient, userID, workspaceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to verify workspace membership"})
		return
	}
	if !isMember {
		c.JSON(http.StatusForbidden, gin.H{"error": "User does not have access to this workspace"})
		return
	}

	var req ConfirmSyncRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		logCtx.WithError(err).Warn("Failed to bind JSON for ConfirmSync.")
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body: " + err.Error()})
		return
	}

	var r2KeysToDelete []string

	err = ac.FirestoreClient.RunTransaction(ctx, func(ctx context.Context, tx *firestore.Transaction) error {
		// --- READ PHASE ---
		// 1. Read workspace document for version check.
		wsDocRef := ac.FirestoreClient.Collection("workspaces").Doc(workspaceID)
		wsDocSnap, err := tx.Get(wsDocRef)
		if err != nil {
			return fmt.Errorf("failed to get workspace for version check: %w", err)
		}

		var workspaceData Workspace
		if err := wsDocSnap.DataTo(&workspaceData); err != nil {
			return fmt.Errorf("failed to parse workspace data: %w", err)
		}

		// 2. Read all file documents that will be modified or deleted.
		filesCollectionRef := ac.FirestoreClient.Collection(fmt.Sprintf("workspaces/%s/files", workspaceID))
		existingFileDocs := make(map[string]*firestore.DocumentSnapshot)
		for _, clientFile := range req.SyncActions {
			fileDocRef := filesCollectionRef.Doc(SanitizePathToDocID(clientFile.FilePath))
			docSnap, err := tx.Get(fileDocRef)
			if err != nil {
				if strings.Contains(err.Error(), "not found") {
					// This is fine for new files, so we just note it doesn't exist.
					existingFileDocs[clientFile.FilePath] = nil
					continue
				}
				// Any other error is a problem.
				return fmt.Errorf("failed to get file doc '%s': %w", clientFile.FilePath, err)
			}
			existingFileDocs[clientFile.FilePath] = docSnap
		}
		
		// --- VALIDATION PHASE ---
		baseVersionInt, err := strconv.Atoi(workspaceData.WorkspaceVersion)
		if err != nil {
			return fmt.Errorf("server workspace version '%s' is invalid", workspaceData.WorkspaceVersion)
		}
		clientVersionInt, err := strconv.Atoi(req.WorkspaceVersion)
		if err != nil {
			return fmt.Errorf("client workspace version '%s' is invalid", req.WorkspaceVersion)
		}

		if clientVersionInt != baseVersionInt+1 {
			return fmt.Errorf("workspace version mismatch: server is at %d, but client commit is for %d", baseVersionInt, clientVersionInt-1)
		}

		// --- WRITE PHASE ---
		// 1. Update workspace version and timestamp. This is the first write.
		// Update workspace with new version and standardized ISO 8601 timestamp
		err = tx.Update(wsDocRef, []firestore.Update{
			{Path: "workspace_version", Value: req.WorkspaceVersion},
			{Path: "updated_at", Value: NowISO8601()},
		})
		if err != nil {
			return fmt.Errorf("failed to increment workspace version: %w", err)
		}

		// 2. Perform file metadata writes and deletes.
		for _, clientFile := range req.SyncActions {
			fileDocRef := filesCollectionRef.Doc(SanitizePathToDocID(clientFile.FilePath))
			itemLogCtx := logCtx.WithField("filePath", clientFile.FilePath).WithField("action", clientFile.Action)

			switch clientFile.Action {
			case "upsert":
				// Create file metadata with standardized ISO 8601 timestamps
				newMeta := FileMetadata{
					FileID:      clientFile.FileID,
					FilePath:    clientFile.FilePath,
					Type:        clientFile.Type,
					R2ObjectKey: clientFile.R2ObjectKey,
					UpdatedAt:   NowISO8601(), // Exact JavaScript toISOString() format
				}

				if clientFile.Type == "file" {
					newMeta.Hash = clientFile.ClientHash
					newMeta.Size = clientFile.Size
				}

				docSnap := existingFileDocs[clientFile.FilePath]
				if docSnap != nil && docSnap.Exists() {
					var existingMeta FileMetadata
					docSnap.DataTo(&existingMeta)
					newMeta.CreatedAt = existingMeta.CreatedAt // Preserve original creation time
				} else {
					newMeta.CreatedAt = newMeta.UpdatedAt // It's a new file
				}

				itemLogCtx.WithFields(log.Fields{
					"fileID":      newMeta.FileID,
					"r2ObjectKey": newMeta.R2ObjectKey,
				}).Info("Upserting file metadata in Firestore.")
				if err := tx.Set(fileDocRef, newMeta); err != nil {
					return fmt.Errorf("failed to upsert file %s: %w", clientFile.FilePath, err)
				}

			case "delete":
				docSnap := existingFileDocs[clientFile.FilePath]
				if docSnap != nil && docSnap.Exists() {
					var fileMeta FileMetadata
					if err := docSnap.DataTo(&fileMeta); err == nil {
						if fileMeta.R2ObjectKey != "" {
							r2KeysToDelete = append(r2KeysToDelete, fileMeta.R2ObjectKey)
						}
					}
					itemLogCtx.Info("Deleting file metadata from Firestore.")
					if err := tx.Delete(fileDocRef); err != nil {
						// This check is for robustness, but Get should have caught "not found".
						if !strings.Contains(err.Error(), "not found") {
							return fmt.Errorf("failed to delete file metadata: %w", err)
						}
					}
				}
			}
		}
		return nil
	})

	if err != nil {
		logCtx.WithError(err).Error("Transaction failed in ConfirmSync.")
		c.JSON(http.StatusConflict, ConfirmSyncResponse{
			Status:       "error",
			ErrorMessage: "Failed to confirm sync: " + err.Error(),
		})
		return
	}

	// After transaction succeeds, delete the R2 objects
	if len(r2KeysToDelete) > 0 {
		logCtx.Infof("Starting deletion of %d R2 objects post-transaction.", len(r2KeysToDelete))
		for _, key := range r2KeysToDelete {
			_, err := ac.R2S3Client.DeleteObject(ctx, &s3.DeleteObjectInput{
				Bucket: aws.String(ac.R2BucketName),
				Key:    aws.String(key),
			})
			if err != nil {
				logCtx.WithError(err).Errorf("Failed to delete object '%s' from R2.", key)
			} else {
				logCtx.Infof("Successfully deleted object '%s' from R2.", key)
			}
		}
	}

	c.JSON(http.StatusOK, ConfirmSyncResponse{
		Status:                "success",
		FinalWorkspaceVersion: req.WorkspaceVersion,
	})

	// Trigger RAG indexing for modified files (fire and forget)
	go func() {
		modifiedFiles := make([]WorkerFile, 0)
		for _, action := range req.SyncActions {
			if action.Action == "upsert" && action.Type == "file" {
				logCtx.WithFields(log.Fields{
					"file_path": action.FilePath,
					"r2_object_key": action.R2ObjectKey,
					"action": action.Action,
					"type": action.Type,
				}).Info("Adding file for RAG indexing")
				
				modifiedFiles = append(modifiedFiles, WorkerFile{
					R2ObjectKey: action.R2ObjectKey,
					FilePath:    action.FilePath,
				})
			}
		}

		if len(modifiedFiles) > 0 {
			indexingJobID := uuid.New().String()
			if err := ac.enqueueRagIndexing(indexingJobID, workspaceID, modifiedFiles); err != nil {
				logCtx.WithError(err).WithField("indexing_job_id", indexingJobID).Error("Failed to enqueue RAG indexing task")
			} else {
				logCtx.WithField("indexing_job_id", indexingJobID).WithField("file_count", len(modifiedFiles)).Info("RAG indexing task enqueued successfully")
			}
		}
	}()
}

// SanitizePathToDocID converts a file path to a Firestore-safe document ID.
func SanitizePathToDocID(path string) string {
	sanitized := strings.ReplaceAll(path, "/", "__SLASH__")
	sanitized = strings.ReplaceAll(sanitized, ".", "__DOT__")
	if len(sanitized) > 500 { 
		sanitized = sanitized[:500]
	}
	return sanitized
}



// GetWorkspaceManifest handles requests to list all file metadata for a given workspace.
func (ac *ApiController) GetWorkspaceManifest(c *gin.Context) {
	workspaceID := c.Param("workspaceId")
	userID := c.GetString("userID")

	if userID == "" {
		log.Error("UserID not found in context for GetWorkspaceManifest")
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User ID not found in context"})
		return
	}

	logCtx := log.WithFields(log.Fields{
		"workspace_id": workspaceID,
		"user_id":      userID,
		"handler":      "GetWorkspaceManifest",
	})

	isMember, err := checkWorkspaceMembership(c.Request.Context(), ac.FirestoreClient, userID, workspaceID)
	if err != nil {
		logCtx.WithError(err).Error("Workspace membership check failed for GetWorkspaceManifest.")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to verify workspace membership"})
		return
	}
	if !isMember {
		logCtx.Warn("User forbidden from listing files in workspace.")
		c.JSON(http.StatusForbidden, gin.H{"error": "User does not have access to list files in this workspace"})
		return
	}
	logCtx.Info("User authorized for listing files in workspace.")

	ctx := c.Request.Context()

	wsDocRef := ac.FirestoreClient.Collection("workspaces").Doc(workspaceID)
	wsDocSnap, err := wsDocRef.Get(ctx)
	if err != nil {
		logCtx.WithError(err).Errorf("Failed to get workspace document %s", workspaceID)
		c.JSON(http.StatusNotFound, gin.H{"error": "Workspace not found"})
		return
	}
	var workspaceData Workspace
	if err := wsDocSnap.DataTo(&workspaceData); err != nil {
		logCtx.WithError(err).Errorf("Failed to parse workspace data for %s", workspaceID)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to parse workspace data"})
		return
	}

	filesCollectionPath := fmt.Sprintf("workspaces/%s/files", workspaceID)
	iter := ac.FirestoreClient.Collection(filesCollectionPath).Documents(ctx)
	defer iter.Stop()

	var files []FileMetadata
	presignDuration := 15 * time.Minute

	for {
		doc, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			logCtx.WithError(err).Error("Failed to iterate over file documents in Firestore")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve file list"})
			return
		}

		var fileMeta FileMetadata
		if err := doc.DataTo(&fileMeta); err != nil {
			logCtx.WithError(err).WithField("document_id", doc.Ref.ID).Warn("Failed to parse file metadata from Firestore document")
			continue
		}

		// For files, generate a presigned URL. For folders, don't.
		if fileMeta.Type == "file" && fileMeta.R2ObjectKey != "" {
			presignedURLRequest, presignErr := ac.R2PresignClient.PresignGetObject(ctx, &s3.GetObjectInput{
				Bucket: aws.String(ac.R2BucketName),
				Key:    aws.String(fileMeta.R2ObjectKey),
			}, func(po *s3.PresignOptions) {
				po.Expires = presignDuration
			})
			if presignErr != nil {
				logCtx.WithError(presignErr).WithFields(log.Fields{
					"r2_object_key": fileMeta.R2ObjectKey,
				}).Warn("Failed to generate R2 pre-signed GET URL for file")
				fileMeta.ContentURL = ""
			} else {
				fileMeta.ContentURL = presignedURLRequest.URL
			}
		} else {
			fileMeta.ContentURL = ""
		}
		files = append(files, fileMeta)
	}

	if files == nil {
		files = make([]FileMetadata, 0)
	}

	logCtx.WithField("file_count", len(files)).Info("Successfully retrieved workspace manifest with content URLs")
	c.JSON(http.StatusOK, WorkspaceManifestResponse{
		Manifest:         files,
		WorkspaceVersion: workspaceData.WorkspaceVersion,
	})
}

// CreateWorkspace handles requests to create a new workspace.
func (ac *ApiController) CreateWorkspace(c *gin.Context) {
	userID := c.GetString("userID")
	if userID == "" {
		log.Error("UserID not found in context for CreateWorkspace. AuthMiddleware might not be effective.")
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User authentication required"})
		return
	}

	logCtx := log.WithFields(log.Fields{
		"user_id": userID,
		"handler": "CreateWorkspace",
	})

	var req CreateWorkspaceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		logCtx.WithError(err).Warn("Invalid request body for CreateWorkspace")
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request: " + err.Error()})
		return
	}

	if strings.TrimSpace(req.Name) == "" {
		logCtx.Warn("Workspace name cannot be empty")
		c.JSON(http.StatusBadRequest, gin.H{"error": "Workspace name cannot be empty"})
		return
	}

	ctx := c.Request.Context()
	// Use standardized ISO 8601 timestamps for consistent time formatting
	now := NowISO8601() // Exact JavaScript toISOString() format
	newWorkspaceID := uuid.New().String()
	initialVersion := "1"

	workspace := Workspace{
		WorkspaceID:      newWorkspaceID,
		Name:             req.Name,
		CreatedBy:        userID,
		CreatedAt:        now, // Standardized ISO 8601 with milliseconds
		WorkspaceVersion: initialVersion,
	}
	workspaceDocRef := ac.FirestoreClient.Collection("workspaces").Doc(newWorkspaceID)

	membershipID := uuid.New().String()
	membership := WorkspaceMembership{
		MembershipID: membershipID,
		WorkspaceID:  newWorkspaceID,
		UserID:       userID,
		UserEmail:    req.UserEmail,
		UserName:     req.UserName,
		Role:         "owner",
		JoinedAt:     now, // Standardized ISO 8601 timestamp
	}
	membershipDocRef := ac.FirestoreClient.Collection("workspace_memberships").Doc(membershipID)

	err := ac.FirestoreClient.RunTransaction(ctx, func(ctx context.Context, tx *firestore.Transaction) error {
		tx.Set(workspaceDocRef, workspace)
		tx.Set(membershipDocRef, membership)
		return nil
	})

	if err != nil {
		logCtx.WithError(err).Error("Failed to commit transaction for workspace creation")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create workspace"})
		return
	}

	logCtx.WithFields(log.Fields{
		"workspace_id": newWorkspaceID,
		"workspace_name": req.Name,
	}).Info("Workspace created successfully")

	c.JSON(http.StatusCreated, CreateWorkspaceResponse{
		WorkspaceID:    newWorkspaceID,
		Name:           req.Name,
		CreatedBy:      userID,
		CreatedAt:      now,
		InitialVersion: initialVersion,
	})
}

// ListWorkspaces retrieves all workspaces a user is a member of.
func (ac *ApiController) ListWorkspaces(c *gin.Context) {
	userID := c.GetString("userID")
	if userID == "" {
		log.Error("UserID not found in context for ListWorkspaces. AuthMiddleware might not be effective.")
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User authentication required"})
		return
	}

	logCtx := log.WithFields(log.Fields{
		"user_id": userID,
		"handler": "ListWorkspaces",
	})

	ctx := c.Request.Context()
	var summaries []WorkspaceSummary

	membershipQuery := ac.FirestoreClient.Collection("workspace_memberships").Where("user_id", "==", userID)
	membershipIter := membershipQuery.Documents(ctx)
	defer membershipIter.Stop()

	for {
		membershipDoc, err := membershipIter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			logCtx.WithError(err).Error("Failed to iterate over workspace memberships.")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve workspace memberships"})
			return
		}

		var membership WorkspaceMembership
		if err := membershipDoc.DataTo(&membership); err != nil {
			logCtx.WithError(err).WithField("membership_doc_id", membershipDoc.Ref.ID).Warn("Failed to parse workspace membership data.")
			continue
		}

		workspaceDocRef := ac.FirestoreClient.Collection("workspaces").Doc(membership.WorkspaceID)
		workspaceDoc, err := workspaceDocRef.Get(ctx)
		if err != nil {
			logCtx.WithError(err).WithFields(log.Fields{
				"workspace_id": membership.WorkspaceID,
				"membership_id": membership.MembershipID,
			}).Warn("Failed to retrieve workspace details for a membership.")
			continue
		}

		var workspace Workspace
		if err := workspaceDoc.DataTo(&workspace); err != nil {
			logCtx.WithError(err).WithField("workspace_doc_id", workspaceDoc.Ref.ID).Warn("Failed to parse workspace data.")
			continue
		}

		summaries = append(summaries, WorkspaceSummary{
			WorkspaceID: workspace.WorkspaceID,
			Name:        workspace.Name,
			CreatedBy:   workspace.CreatedBy,
			CreatedAt:   workspace.CreatedAt,
			UserRole:    membership.Role,
		})
	}

	if summaries == nil {
		summaries = make([]WorkspaceSummary, 0)
	}

	logCtx.WithField("retrieved_workspaces_count", len(summaries)).Info("Successfully retrieved user's workspaces.")
	c.JSON(http.StatusOK, summaries)
}

// ExecuteCode handles non-authenticated code execution requests.
func (ac *ApiController) ExecuteCode(c *gin.Context) {
	var reqBody RequestBody 
	if err := c.ShouldBindJSON(&reqBody); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request: " + err.Error()})
		return
	}

	jobID := uuid.New().String()
	ctx := c.Request.Context()

	// Create job with standardized ISO 8601 timestamps
	submittedAt := NowISO8601() // Exact JavaScript toISOString() format
	expiresAt := TimeToISO8601(time.Now().UTC().Add(15 * 24 * time.Hour))

	job := Job{
		Status:      "queued",
		Code:        reqBody.Code,
		Language:    reqBody.Language,
		Input:       reqBody.Input,
		SubmittedAt: submittedAt, // Standardized ISO 8601 with milliseconds
		ExpiresAt:   expiresAt,   // Standardized ISO 8601 with milliseconds
	}

	docRef := ac.FirestoreClient.Collection(ac.FirestoreJobsCollection).Doc(jobID)
	if _, err := docRef.Set(ctx, job); err != nil {
		log.WithError(err).WithField("job_id", jobID).Error("Failed to create job in Firestore")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create job record"})
		return
	}
	log.WithFields(log.Fields{"job_id": jobID, "language": job.Language}).Info("Job queued in Firestore for public execution")

	taskPayload := CloudTaskPayload{ 
		JobID: jobID, Code: reqBody.Code, Language: reqBody.Language, Input: reqBody.Input,
	}
	payloadBytes, err := json.Marshal(taskPayload)
	if err != nil {
		log.WithError(err).WithField("job_id", jobID).Error("Failed to marshal task payload for public execution")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to prepare job for execution"})
		return
	}

	taskReq := &cloudtaskspb.CreateTaskRequest{
		Parent: ac.AppConfig.GetQueuePath(ac.Services.PythonWorker.QueueID),
		Task: &cloudtaskspb.Task{
			MessageType: &cloudtaskspb.Task_HttpRequest{
				HttpRequest: &cloudtaskspb.HttpRequest{
					HttpMethod: cloudtaskspb.HttpMethod_POST,
					Url:        fmt.Sprintf("%s/execute", ac.Services.PythonWorker.ServiceURL),
					Headers:    map[string]string{"Content-Type": "application/json"},
					Body:       payloadBytes,
					AuthorizationHeader: &cloudtaskspb.HttpRequest_OidcToken{
						OidcToken: &cloudtaskspb.OidcToken{
							ServiceAccountEmail: ac.Services.PythonWorker.ServiceAccount,
						},
					},
				},
			},
		},
	}

	createdTask, err := ac.TasksClient.CreateTask(ctx, taskReq)
	if err != nil {
		log.WithError(err).WithField("job_id", jobID).Error("Failed to create Cloud Task for public execution")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to submit job for execution"})
		return
	}

	log.WithFields(log.Fields{"job_id": jobID, "task_name": createdTask.GetName()}).Info("Job enqueued to Cloud Tasks for public execution")
	c.JSON(http.StatusOK, gin.H{"job_id": jobID})
}

// ExecuteCodeAuthenticated handles requests for authenticated code execution.
func (ac *ApiController) ExecuteCodeAuthenticated(c *gin.Context) {
	workspaceID := c.Param("workspaceId")
	userID := c.GetString("userID")

	logCtx := log.WithFields(log.Fields{"workspace_id": workspaceID, "user_id": userID, "handler": "ExecuteCodeAuthenticated"})

	isMember, err := checkWorkspaceMembership(c.Request.Context(), ac.FirestoreClient, userID, workspaceID)
	if err != nil {
		logCtx.WithError(err).Error("Workspace membership check failed during authenticated execution.")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to verify workspace membership"})
		return
	}
	if !isMember {
		logCtx.Warn("User tried to execute code in a workspace they are not a member of.")
		c.JSON(http.StatusForbidden, gin.H{"error": "User does not have access to this workspace"})
		return
	}

	var req ExecuteAuthRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		logCtx.WithError(err).Warn("Invalid request body for authenticated execution.")
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request: " + err.Error()})
		return
	}

	entrypointFile := filepath.Clean(req.EntrypointFile)
	if entrypointFile == "." || strings.HasPrefix(entrypointFile, "..") {
		logCtx.Warnf("Invalid entrypoint path received: %s", req.EntrypointFile)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid entrypoint file path."})
		return
	}

	ctx := c.Request.Context()

	// Get current workspace version to return to client
	wsDocRef := ac.FirestoreClient.Collection("workspaces").Doc(workspaceID)
	wsDocSnap, err := wsDocRef.Get(ctx)
	if err != nil {
		logCtx.WithError(err).Errorf("Failed to get workspace %s for version check", workspaceID)
		c.JSON(http.StatusNotFound, gin.H{"error": "Workspace not found"})
		return
	}
	var workspaceData Workspace
	if err := wsDocSnap.DataTo(&workspaceData); err != nil {
		logCtx.WithError(err).Errorf("Failed to parse workspace data for %s", workspaceID)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to parse workspace data"})
		return
	}

	// --- Fetch File Manifest ---
	filesCollectionPath := fmt.Sprintf("workspaces/%s/files", workspaceID)
	iter := ac.FirestoreClient.Collection(filesCollectionPath).Documents(ctx)
	defer iter.Stop()

	var workerFiles []WorkerFile
	for {
		doc, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			logCtx.WithError(err).Error("Failed to iterate over file documents for execution manifest.")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve workspace files for execution."})
			return
		}

		var fileMeta FileMetadata
		if err := doc.DataTo(&fileMeta); err != nil {
			logCtx.WithError(err).WithField("document_id", doc.Ref.ID).Warn("Failed to parse file metadata for execution manifest.")
			continue
		}
		// Only include actual files for the worker to download and use.
		if fileMeta.Type == "file" {
			workerFiles = append(workerFiles, WorkerFile{
				R2ObjectKey: fileMeta.R2ObjectKey,
				FilePath:    fileMeta.FilePath,
			})
		}
	}
	// --- End Fetch File Manifest ---

	jobID := uuid.New().String()
	logCtx = logCtx.WithField("job_id", jobID)

	jobDocRef := ac.FirestoreClient.Collection(ac.FirestoreJobsCollection).Doc(jobID)
	// Create authenticated job with standardized ISO 8601 timestamp
	if _, err := jobDocRef.Set(ctx, Job{
		Status:         "queued",
		Language:       req.Language,
		Input:          req.Input,
		SubmittedAt:    NowISO8601(), // Exact JavaScript toISOString() format
		UserID:         userID,
		WorkspaceID:    workspaceID,
		EntrypointFile: entrypointFile,
		ExecutionType:  "authenticated_r2",
	}); err != nil {
		logCtx.WithError(err).Error("Failed to create authenticated job in Firestore")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create job record"})
		return
	}
	logCtx.Info("Authenticated job created in Firestore.")

	taskPayload := CloudTaskAuthPayload{
		WorkspaceID:    workspaceID,
		EntrypointFile: entrypointFile,
		Language:       req.Language,
		Input:          req.Input,
		R2BucketName:   ac.R2BucketName,
		JobID:          jobID,
		Files:          workerFiles,
	}

	payloadBytes, err := json.Marshal(taskPayload)
	if err != nil {
		logCtx.WithError(err).Error("Failed to marshal task payload for authenticated execution")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to prepare job for execution"})
		return
	}

	taskReq := &cloudtaskspb.CreateTaskRequest{
		Parent: ac.AppConfig.GetQueuePath(ac.Services.PythonWorker.QueueID),
		Task: &cloudtaskspb.Task{
			MessageType: &cloudtaskspb.Task_HttpRequest{
				HttpRequest: &cloudtaskspb.HttpRequest{
					HttpMethod: cloudtaskspb.HttpMethod_POST,
					Url:        fmt.Sprintf("%s/execute_auth", ac.Services.PythonWorker.ServiceURL),
					Headers:    map[string]string{"Content-Type": "application/json"},
					Body:       payloadBytes,
					AuthorizationHeader: &cloudtaskspb.HttpRequest_OidcToken{
						OidcToken: &cloudtaskspb.OidcToken{
							ServiceAccountEmail: ac.Services.PythonWorker.ServiceAccount,
						},
					},
				},
			},
		},
	}

	createdTask, err := ac.TasksClient.CreateTask(ctx, taskReq)
	if err != nil {
		logCtx.WithError(err).Error("Failed to create Cloud Task for authenticated execution")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to submit job for execution"})
		return
	}

	logCtx.WithFields(log.Fields{
		"job_id":       jobID,
		"task_name":    createdTask.GetName(),
		"entrypoint":   req.EntrypointFile,
		"final_workspace_version": workspaceData.WorkspaceVersion,
	}).Info("Cloud Task created successfully for authenticated execution.")

	c.JSON(http.StatusOK, ExecuteAuthResponse{
		Message:               "Authenticated code execution job created successfully.",
		JobID:                 jobID,
		FinalWorkspaceVersion: workspaceData.WorkspaceVersion,
	})
}

// enqueueTask creates a Cloud Task with OIDC authentication
func (ac *ApiController) enqueueTask(queuePath, serviceURL, serviceAccount string, payload interface{}) (*cloudtaskspb.Task, error) {
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal task payload: %w", err)
	}

	task := &cloudtaskspb.Task{
		MessageType: &cloudtaskspb.Task_HttpRequest{
			HttpRequest: &cloudtaskspb.HttpRequest{
				HttpMethod: cloudtaskspb.HttpMethod_POST,
				Url:        serviceURL,
				Headers:    map[string]string{"Content-Type": "application/json"},
				Body:       payloadBytes,
				AuthorizationHeader: &cloudtaskspb.HttpRequest_OidcToken{
					OidcToken: &cloudtaskspb.OidcToken{
						ServiceAccountEmail: serviceAccount,
					},
				},
			},
		},
	}

	req := &cloudtaskspb.CreateTaskRequest{
		Parent: queuePath,
		Task:   task,
	}

	return ac.TasksClient.CreateTask(context.Background(), req)
}

// enqueueRagQuery enqueues a RAG query task
func (ac *ApiController) enqueueRagQuery(jobID, userID, workspaceID, query string) error {
	payload := RagQueryPayload{
		JobID:       jobID,
		UserID:      userID,
		WorkspaceID: workspaceID,
		Query:       query,
	}

	queuePath := ac.AppConfig.GetQueuePath(ac.Services.RagQuery.QueueID)
	_, err := ac.enqueueTask(queuePath, ac.Services.RagQuery.ServiceURL, ac.Services.RagQuery.ServiceAccount, payload)
	return err
}

// enqueueRagIndexing enqueues a RAG indexing task
func (ac *ApiController) enqueueRagIndexing(jobID, workspaceID string, files []WorkerFile) error {
	payload := RagIndexingPayload{
		JobID:       jobID,
		WorkspaceID: workspaceID,
		Files:       files,
	}

	queuePath := ac.AppConfig.GetQueuePath(ac.Services.RagIndexing.QueueID)
	_, err := ac.enqueueTask(queuePath, ac.Services.RagIndexing.ServiceURL, ac.Services.RagIndexing.ServiceAccount, payload)
	return err
}

// RagQuery handles RAG query requests from the frontend
func (ac *ApiController) RagQuery(c *gin.Context) {
	userID := c.GetString("userID")
	if userID == "" {
		log.Error("UserID not found in context after auth middleware")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "User authentication error"})
		return
	}

	var req RagQueryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		log.WithError(err).Warn("Invalid RAG query request body")
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request: " + err.Error()})
		return
	}

	logCtx := log.WithFields(log.Fields{
		"workspace_id": req.WorkspaceID,
		"user_id":      userID,
		"handler":      "RagQuery",
	})

	// Authorization check
	isMember, err := checkWorkspaceMembership(c.Request.Context(), ac.FirestoreClient, userID, req.WorkspaceID)
	if err != nil {
		logCtx.WithError(err).Error("Workspace membership check failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to verify workspace membership"})
		return
	}
	if !isMember {
		logCtx.Warn("User does not have access to this workspace")
		c.JSON(http.StatusForbidden, gin.H{"error": "User does not have access to this workspace"})
		return
	}

	// Create job in Firestore
	jobID := uuid.New().String()
	now := NowISO8601()
	expiresAt := TimeToISO8601(time.Now().Add(24 * time.Hour))

	job := Job{
		Status:         "queued",
		Language:       "rag_query",
		SubmittedAt:    now,
		ExpiresAt:      expiresAt,
		UserID:         userID,
		WorkspaceID:    req.WorkspaceID,
		ExecutionType:  "rag_query",
	}

	jobDocRef := ac.FirestoreClient.Collection(ac.FirestoreJobsCollection).Doc(jobID)
	if _, err := jobDocRef.Set(c.Request.Context(), job); err != nil {
		logCtx.WithError(err).Error("Failed to create RAG query job in Firestore")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create query job"})
		return
	}

	// Enqueue RAG query task
	if err := ac.enqueueRagQuery(jobID, userID, req.WorkspaceID, req.Query); err != nil {
		logCtx.WithError(err).Error("Failed to enqueue RAG query task")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to enqueue query task"})
		return
	}

	logCtx.WithField("job_id", jobID).Info("RAG query task enqueued successfully")

	c.JSON(http.StatusOK, gin.H{
		"message": "RAG query enqueued successfully",
		"job_id":  jobID,
	})
} 