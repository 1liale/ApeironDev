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
	"github.com/aws/aws-sdk-go-v2/feature/s3/manager"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	log "github.com/sirupsen/logrus"
	"google.golang.org/api/iterator"
	"google.golang.org/protobuf/types/known/durationpb"
	"google.golang.org/protobuf/types/known/timestamppb"
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
	PythonWorkerURL         string
	WorkerSAEmail           string
	CloudTasksQueuePath     string
	FirestoreJobsCollection string
}

// NewApiController creates a new ApiController.
func NewApiController(fs *firestore.Client, tasksClient *cloudtasks.Client, presignClient *s3.PresignClient, r2S3Client *s3.Client, r2BucketName, pythonWorkerURL, workerSAEmail, cloudTasksQueuePath, firestoreJobsCollection string) *ApiController {
	return &ApiController{
		FirestoreClient:         fs,
		TasksClient:             tasksClient,
		R2PresignClient:         presignClient,
		R2S3Client:              r2S3Client,
		R2BucketName:            r2BucketName,
		PythonWorkerURL:         pythonWorkerURL,
		WorkerSAEmail:           workerSAEmail,
		CloudTasksQueuePath:     cloudTasksQueuePath,
		FirestoreJobsCollection: firestoreJobsCollection,
	}
}

// HandleSync processes a batch of client file states, compares with Firestore, 
// and returns necessary actions (like generating pre-signed URLs for uploads/deletes).
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
		r2ObjectKey := "" // Will be determined based on whether it's new or existing
		currentAction := SyncResponseFileAction{
			FilePath:    clientFile.FilePath,
			// R2ObjectKey will be set below
		}
		itemLogCtx := logCtx.WithField("filePath", clientFile.FilePath)

		switch clientFile.Action {
		case "new", "modified":
			var serverMeta FileMetadata
			foundServerMeta := false
			serverHash := ""

			query := ac.FirestoreClient.Collection(filesCollectionPath).Where("file_path", "==", clientFile.FilePath).Limit(1)
			docs, err := query.Documents(ctx).GetAll()

			if err != nil {
				itemLogCtx.WithError(err).Error("Firestore query failed for existing file metadata.")
			} else if len(docs) > 0 {
				if err := docs[0].DataTo(&serverMeta); err == nil {
					foundServerMeta = true
					serverHash = serverMeta.Hash
					r2ObjectKey = serverMeta.R2ObjectKey // Use existing R2 key for modified files
				} else {
					itemLogCtx.WithError(err).Error("Error unmarshalling Firestore data for existing file.")
				}
			}
			currentAction.R2ObjectKey = r2ObjectKey // Set it for the response action

			if clientFile.Action == "new" || !foundServerMeta || (clientFile.Action == "modified" && clientFile.ClientHash != serverHash) {
				if clientFile.Action == "new" || r2ObjectKey == "" {
					// For new or modified files, the R2 object key is directly derived from its logical file path.
					// This preserves the folder structure in R2.
					currentAction.R2ObjectKey = fmt.Sprintf("workspaces/%s/%s", workspaceID, clientFile.FilePath)
				}

				presignedPutURL, presignErr := ac.R2PresignClient.PresignPutObject(ctx, &s3.PutObjectInput{
					Bucket: aws.String(ac.R2BucketName),
					Key:    aws.String(currentAction.R2ObjectKey),
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
				currentAction.Message = "File up to date or hash matches"
			}

		case "deleted":
			// Fetch R2ObjectKey for deletion from server's metadata
			query := ac.FirestoreClient.Collection(filesCollectionPath).Where("file_path", "==", clientFile.FilePath).Limit(1)
			docs, err := query.Documents(ctx).GetAll()
			if err != nil || len(docs) == 0 {
				itemLogCtx.WithError(err).Warn("File metadata not found for deletion.")
				currentAction.ActionRequired = "none"
				currentAction.Message = "File to delete not found on server."
			} else {
				var serverMeta FileMetadata
				if err := docs[0].DataTo(&serverMeta); err == nil {
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
			// We still need to ensure R2ObjectKey is in the response for client consistency, if known
			query := ac.FirestoreClient.Collection(filesCollectionPath).Where("file_path", "==", clientFile.FilePath).Limit(1)
			docs, err := query.Documents(ctx).GetAll()
			if err == nil && len(docs) > 0 {
				var serverMeta FileMetadata
				if docs[0].DataTo(&serverMeta) == nil {
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

	form, err := c.MultipartForm()
	if err != nil {
		logCtx.WithError(err).Warn("Failed to parse multipart form.")
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid form data: " + err.Error()})
		return
	}
	defer form.RemoveAll()

	metadataJSON := c.Request.FormValue("metadata")
	var metadataReq ConfirmSyncRequest
	if err := json.Unmarshal([]byte(metadataJSON), &metadataReq); err != nil {
		logCtx.WithError(err).Warn("Failed to unmarshal sync metadata.")
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid sync metadata: " + err.Error()})
		return
	}

	fileMetadatas := make(map[string]FileMetadata)
	for _, file := range metadataReq.Actions {
		if file.ActionConfirmed == "upload" {
			originalFilename := file.FilePath
			fileID := uuid.New().String()
			sanitizedFilePath := filepath.Clean(file.FilePath)
			r2ObjectKey := fmt.Sprintf("workspaces/%s/files/%s/%s", workspaceID, fileID, sanitizedFilePath)

			fileMetadatas[originalFilename] = FileMetadata{
				FileID:      fileID,
				FilePath:    file.FilePath,
				R2ObjectKey: r2ObjectKey,
				Hash:        file.ClientHash,
				Size:        file.Size,
				ContentType: file.ContentType,
				WorkspaceID: workspaceID,
				UserID:      userID,
			}
			logCtx.Infof("Prepared metadata for '%s' with R2 key '%s'", originalFilename, r2ObjectKey)
		}
	}

	err = ac.FirestoreClient.RunTransaction(ctx, func(ctx context.Context, tx *firestore.Transaction) error {
		wsDocRef := ac.FirestoreClient.Collection("workspaces").Doc(workspaceID)
		wsDocSnap, err := tx.Get(wsDocRef)
		if err != nil {
			return fmt.Errorf("failed to get workspace for version increment: %w", err)
		}
		
		currentVersionStr := "0"
		if version, err := wsDocSnap.DataAt("workspace_version"); err == nil {
			if v, ok := version.(string); ok {
				currentVersionStr = v
			}
		}

		if currentVersionStr != metadataReq.BaseVersion {
			return fmt.Errorf("transaction version conflict: client base version %s does not match server version %s", metadataReq.BaseVersion, currentVersionStr)
		}

		newVersion, _ := strconv.Atoi(currentVersionStr)
		newVersion++
		newVersionStr := strconv.Itoa(newVersion)

		err = tx.Update(wsDocRef, []firestore.Update{
			{Path: "workspace_version", Value: newVersionStr},
			{Path: "updated_at", Value: time.Now().UTC()},
		})
		if err != nil {
			return fmt.Errorf("failed to increment workspace version: %w", err)
		}

		filesCollectionPath := fmt.Sprintf("workspaces/%s/files", workspaceID)

		for _, formFileHeader := range form.File["files"] {
			originalFilename := formFileHeader.Filename
			fileMetadata, ok := fileMetadatas[originalFilename]
			if !ok {
				logCtx.Warnf("Skipping file '%s' as no corresponding metadata was found.", originalFilename)
				continue
			}

			formFile, err := formFileHeader.Open()
			if err != nil {
				return fmt.Errorf("failed to open file %s from form: %w", originalFilename, err)
			}
			defer formFile.Close()

			uploader := manager.NewUploader(ac.R2S3Client)
			_, err = uploader.Upload(ctx, &s3.PutObjectInput{
				Bucket:      aws.String(ac.R2BucketName),
				Key:         aws.String(fileMetadata.R2ObjectKey),
				Body:        formFile,
				ContentType: aws.String(fileMetadata.ContentType),
			})
			if err != nil {
				return fmt.Errorf("failed to upload %s to R2: %w", originalFilename, err)
			}
			
			query := ac.FirestoreClient.Collection(filesCollectionPath).Where("file_path", "==", fileMetadata.FilePath).Limit(1)
			docs, err := tx.Documents(query).GetAll()
			if err != nil {
				return fmt.Errorf("failed to query existing file for modification %s: %w", fileMetadata.FilePath, err)
			}
			
			if len(docs) > 0 {
				fileDocRef := docs[0].Ref
				err = tx.Set(fileDocRef, fileMetadata)
			} else {
				fileDocRef := ac.FirestoreClient.Collection(filesCollectionPath).Doc(fileMetadata.FileID)
				err = tx.Set(fileDocRef, fileMetadata)
			}
			if err != nil {
				return fmt.Errorf("failed to set file metadata for %s in transaction: %w", originalFilename, err)
			}
			logCtx.Infof("Successfully uploaded '%s' to R2 and set metadata in Firestore.", originalFilename)
		}

		for _, action := range metadataReq.Actions {
			if action.ActionConfirmed == "delete" {
				_, err := ac.R2S3Client.DeleteObject(ctx, &s3.DeleteObjectInput{
					Bucket: aws.String(ac.R2BucketName),
					Key:    aws.String(action.R2ObjectKey),
				})
				if err != nil {
					logCtx.WithError(err).Warnf("Failed to delete object '%s' from R2.", action.R2ObjectKey)
				}

				query := ac.FirestoreClient.Collection(filesCollectionPath).Where("file_path", "==", action.FilePath).Limit(1)
				docs, err := tx.Documents(query).GetAll()
				if err != nil {
					logCtx.WithError(err).Warnf("Failed to query for file to delete: %s", action.FilePath)
					continue
				}
				for _, doc := range docs {
					err = tx.Delete(doc.Ref)
					if err != nil {
						return fmt.Errorf("failed to delete firestore doc for %s: %w", action.FilePath, err)
					}
				}
			}
		}

		return nil
	})

	if err != nil {
		logCtx.WithError(err).Error("Transaction failed in ConfirmSync.")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to confirm sync: " + err.Error()})
		return
	}

	wsDoc, err := ac.FirestoreClient.Collection("workspaces").Doc(workspaceID).Get(ctx)
	if err != nil {
		logCtx.WithError(err).Error("Failed to fetch final workspace version after sync.")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to confirm final workspace version."})
		return
	}
	finalVersion := wsDoc.Data()["workspace_version"].(string)

	c.JSON(http.StatusOK, ConfirmSyncResponse{
		Status:                "success",
		FinalWorkspaceVersion: finalVersion,
	})
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

// ExecuteCode handles non-authenticated code execution requests.
func (ac *ApiController) ExecuteCode(c *gin.Context) {
	var reqBody RequestBody 
	if err := c.ShouldBindJSON(&reqBody); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request: " + err.Error()})
		return
	}

	jobID := uuid.New().String()
	ctx := c.Request.Context()

	submittedAt := time.Now().UTC()
	expiresAt := submittedAt.Add(15 * 24 * time.Hour) 

	job := Job{
		Status:      "queued",
		Code:        reqBody.Code,
		Language:    reqBody.Language,
		Input:       reqBody.Input,
		SubmittedAt: submittedAt,
		ExpiresAt:   expiresAt,
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
		Parent: ac.CloudTasksQueuePath,
		Task: &cloudtaskspb.Task{
			MessageType: &cloudtaskspb.Task_HttpRequest{
				HttpRequest: &cloudtaskspb.HttpRequest{
					HttpMethod: cloudtaskspb.HttpMethod_POST,
					Url:        fmt.Sprintf("%s/execute", ac.PythonWorkerURL),
					Headers:    map[string]string{"Content-Type": "application/json"},
					Body:       payloadBytes,
					AuthorizationHeader: &cloudtaskspb.HttpRequest_OidcToken{
						OidcToken: &cloudtaskspb.OidcToken{
							ServiceAccountEmail: ac.WorkerSAEmail,
						},
					},
				},
			},
			DispatchDeadline: durationpb.New(10 * time.Minute),
			ScheduleTime:     timestamppb.New(time.Now().UTC().Add(1 * time.Second)),
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

		if fileMeta.R2ObjectKey != "" {
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
	now := time.Now().UTC()
	newWorkspaceID := uuid.New().String()
	initialVersion := "1"

	workspace := Workspace{
		WorkspaceID:      newWorkspaceID,
		Name:             req.Name,
		CreatedBy:        userID,
		CreatedAt:        now,
		WorkspaceVersion: initialVersion,
	}
	workspaceDocRef := ac.FirestoreClient.Collection("workspaces").Doc(newWorkspaceID)

	membershipID := uuid.New().String()
	membership := WorkspaceMembership{
		MembershipID: membershipID,
		WorkspaceID:  newWorkspaceID,
		UserID:       userID,
		Role:         "owner",
		JoinedAt:     now,
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

	jobID := uuid.New().String()
	logCtx = logCtx.WithField("job_id", jobID)

	jobDocRef := ac.FirestoreClient.Collection(ac.FirestoreJobsCollection).Doc(jobID)
	if _, err := jobDocRef.Set(c.Request.Context(), Job{
		Status:         "queued",
		Language:       req.Language,
		Input:          req.Input,
		SubmittedAt:    time.Now().UTC(),
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
	}

	payloadBytes, err := json.Marshal(taskPayload)
	if err != nil {
		logCtx.WithError(err).Error("Failed to marshal task payload for authenticated execution")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to prepare job for execution"})
		return
	}

	taskReq := &cloudtaskspb.CreateTaskRequest{
		Parent: ac.CloudTasksQueuePath,
		Task: &cloudtaskspb.Task{
			MessageType: &cloudtaskspb.Task_HttpRequest{
				HttpRequest: &cloudtaskspb.HttpRequest{
					HttpMethod: cloudtaskspb.HttpMethod_POST,
					Url:        ac.PythonWorkerURL + "/execute_auth",
					Headers:    map[string]string{"Content-Type": "application/json"},
					Body:       payloadBytes,
					AuthorizationHeader: &cloudtaskspb.HttpRequest_OidcToken{
						OidcToken: &cloudtaskspb.OidcToken{
							ServiceAccountEmail: ac.WorkerSAEmail,
							Audience:            ac.PythonWorkerURL,
						},
					},
				},
			},
			DispatchDeadline: &durationpb.Duration{Seconds: 1800},
		},
	}

	createdTask, err := ac.TasksClient.CreateTask(c.Request.Context(), taskReq)
	if err != nil {
		logCtx.WithError(err).Error("Failed to create Cloud Task for authenticated execution")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to submit job for execution"})
		return
	}

	logCtx.WithFields(log.Fields{
		"job_id":       jobID,
		"task_name":    createdTask.GetName(),
		"entrypoint":   req.EntrypointFile,
	}).Info("Cloud Task created successfully for authenticated execution.")

	c.JSON(http.StatusOK, gin.H{
		"message": "Authenticated code execution job created successfully.",
		"job_id":  jobID,
	})
} 